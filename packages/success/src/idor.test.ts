/**
 * Portão estático: escrita em tabela de conta declara o recorte de carteira.
 *
 * `recorte.test.ts` prova o comportamento das funções que existem HOJE. Este pega a
 * próxima — a que alguém vai escrever em três meses copiando a de cima e apagando a
 * cláusula sem perceber, porque a tela dela não tem o botão que revelaria o problema.
 *
 * A falha original passou por revisão de código porque cada função parecia certa
 * sozinha: `WHERE id = $1` é o que se espera ver num update por id. O que estava
 * errado só aparecia comparando `revisar` com `fecharItem` — e ninguém abre dois
 * arquivos lado a lado numa revisão.
 *
 * Roda sem banco: descobre as tabelas de conta lendo as migrations e as funções lendo
 * o TypeScript.
 */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const MIGRATIONS = join(RAIZ, 'packages', 'db', 'migrations')

/** Tabelas que têm `account_id`: são as que pertencem a uma carteira. */
function tabelasDeConta(): Set<string> {
  const achadas = new Set<string>()
  for (const arq of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(join(MIGRATIONS, arq), 'utf8')
    for (const m of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? ([\w.]+)\s*\(([\s\S]*?)\n\);/g)) {
      if (/\baccount_id\b/.test(m[2] ?? '')) achadas.add((m[1] ?? '').toLowerCase())
    }
  }
  return achadas
}

const CONTA = tabelasDeConta()

test('as migrations declaram tabelas de conta', () => {
  // Sem isto, um erro de caminho ou de regex faz o portão passar sem verificar nada —
  // e um portão que não recusa nada parece cobertura.
  assert.ok(CONTA.size >= 4, `só ${CONTA.size} tabela(s) de conta encontrada(s): ${[...CONTA]}`)
  assert.ok(CONTA.has('success.client_report'))
  assert.ok(CONTA.has('success.cancellation'))
})

/** Arquivos de domínio, sem teste. */
function fontes(): { caminho: string; texto: string }[] {
  const out: { caminho: string; texto: string }[] = []
  for (const pacote of ['success', 'contratos', 'contracts']) {
    const dir = join(RAIZ, 'packages', pacote, 'src')
    let nomes: string[]
    try {
      nomes = readdirSync(dir)
    } catch {
      continue
    }
    for (const n of nomes) {
      if (!n.endsWith('.ts') || n.endsWith('.test.ts')) continue
      out.push({ caminho: relative(RAIZ, join(dir, n)), texto: readFileSync(join(dir, n), 'utf8') })
    }
  }
  return out
}

/**
 * As funções exportadas, com corpo, que recebem `Identidade`.
 *
 * Corta em `\nexport ` e não por chave balanceada: o corpo pode ter template literal
 * com chave dentro, e contar chave em SQL embutido erra. Pegar até o próximo export é
 * grosseiro mas não dá falso negativo — no máximo inclui código a mais, o que só
 * torna o portão mais permissivo, nunca mais frouxo do que o necessário.
 */
function funcoesComIdentidade(texto: string): { nome: string; corpo: string }[] {
  const out: { nome: string; corpo: string }[] = []
  const partes = texto.split(/\nexport (?:async )?function /)
  for (const parte of partes.slice(1)) {
    const nome = /^(\w+)/.exec(parte)?.[1]
    if (!nome) continue
    if (!/Identidade/.test(parte.slice(0, 500))) continue
    out.push({ nome, corpo: parte })
  }
  return out
}

const ESCRITA = /(?:INSERT INTO|UPDATE|DELETE FROM)\s+([\w.]+)/g

/**
 * Marcas que contam como recorte declarado.
 *
 * `recorteDaConta` e `exigirConta` são as duas formas certas. `csm_email` e
 * `dono_email` valem porque há SQL que recorta à mão e está correto (`fecharItem`
 * recorta por dono do item, não por dono da conta).
 */
const RECORTE = /recorteDaConta|exigirConta|csm_email|dono_email/

/**
 * Exceções DECLARADAS, com o motivo no código.
 *
 * `perderPorSaida` é chamada interna de `encerrar`, dentro da transação e depois de a
 * alçada ter sido verificada — não recebe `Identidade` de fora e não é alcançável por
 * Server Action. Está aqui e não solta porque um dia alguém pode exportá-la.
 */
const PERMITIDAS = new Set([
  'perderPorSaida',
  // Cláusula NÃO é recortada por carteira, e isso é o modelo declarado, não um furo:
  // a visibilidade dela é por FAIXA DE AUDIÊNCIA (aberta/reservada/restrita), aplicada
  // em `taxonomia.ts`. A leitura (`buscarPorTipo`, `filaDeConfirmacao`) também não
  // recorta por `csm_email` — as duas pontas concordam. Recortar a escrita por carteira
  // impediria o jurídico de confirmar cláusula de contrato que ele mesmo redigiu.
  'propor',
  'confirmar',
  'substituir',
])

test('toda escrita em tabela de conta declara o recorte de carteira', () => {
  const faltando: string[] = []

  for (const { caminho, texto } of fontes()) {
    for (const { nome, corpo } of funcoesComIdentidade(texto)) {
      if (PERMITIDAS.has(nome)) continue
      const tabelas = [...corpo.matchAll(ESCRITA)]
        .map((m) => (m[1] ?? '').toLowerCase())
        .filter((t) => CONTA.has(t))
      if (tabelas.length === 0) continue
      if (RECORTE.test(corpo)) continue
      faltando.push(`${caminho} → ${nome}() escreve em ${[...new Set(tabelas)].join(', ')}`)
    }
  }

  assert.deepEqual(
    faltando,
    [],
    `\nEscrita em tabela de conta sem recorte de carteira:\n${faltando.join('\n')}\n\n` +
      'Use `recorteDaConta` na cláusula WHERE, ou `exigirConta` antes se houver leitura.\n',
  )
})

test('o portão pega uma função sem recorte', () => {
  // O teste acima passa quando não há nada errado, e passaria também se a detecção
  // estivesse quebrada. Este confere que ela ainda acusa.
  const fingido = `
export async function ruim(db: pg.Pool, id: Identidade, x: string): Promise<void> {
  await db.query(\`UPDATE success.client_report SET estado='x' WHERE id = $1\`, [x])
}
`
  const fns = funcoesComIdentidade(fingido)
  assert.equal(fns.length, 1, 'não achou a função de mentira')
  const tabelas = [...(fns[0]?.corpo ?? '').matchAll(ESCRITA)].map((m) => (m[1] ?? '').toLowerCase())
  assert.ok(tabelas.some((t) => CONTA.has(t)), 'não reconheceu a tabela de conta')
  assert.equal(RECORTE.test(fns[0]?.corpo ?? ''), false, 'achou recorte onde não há')
})

/* ═══════════════════════════════════════════════════════════════════════════════
 * PORTÃO: tela de RECEITA exige permissão de RECEITA.
 *
 * Nasceu de um achado do pen test da inadimplência. A tela foi escrita copiando a
 * guarda da revisão de faturamento — `temEscopo(p.contas)` — e o efeito é que CINCO
 * papéis com `receita: 'nenhum'` liam a carteira em atraso inteira:
 * `pulse-csm`, `pulse-implantacao`, `pulse-juridico`, `pulse-marketing` e
 * `pulse-produto`. Os dois últimos entraram no sistema só para conferir uso de
 * marca em contrato.
 *
 * É a mesma classe de falha que o portão de cima pega, e pelo mesmo motivo: cada
 * guarda parece certa sozinha. `temEscopo(p.contas)` é exatamente o que se espera
 * ver numa tela de operação. O que estava errado só aparece comparando a tela com a
 * cascata que mora no mesmo menu — e ninguém abre duas telas lado a lado.
 *
 * A regra é por DIRETÓRIO e não por lista de arquivos: uma lista não cobre a
 * próxima tela, que é justamente a que vai errar.
 * ═══════════════════════════════════════════════════════════════════════════════ */

function telasDe(dir: string): string[] {
  const achadas: string[] = []
  const varrer = (d: string) => {
    for (const nome of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, nome.name)
      if (nome.isDirectory()) varrer(p)
      else if (nome.name === 'page.tsx' || nome.name === 'acoes.ts') achadas.push(p)
    }
  }
  varrer(dir)
  return achadas
}

test('toda tela de /receita exige permissão de receita', () => {
  const raiz = join(RAIZ, 'apps', 'web-internal', 'app', '(interno)', 'receita')
  const telas = telasDe(raiz)
  assert.ok(telas.length >= 2, `achei só ${telas.length} telas em /receita — o caminho mudou?`)

  const frouxas: string[] = []
  for (const tela of telas) {
    const texto = readFileSync(tela, 'utf8')
    // Só os `exigir` que estão em CÓDIGO: o comentário desta correção cita a
    // expressão antiga para explicá-la, e ler a prosa acusaria o arquivo corrigido.
    const semComentarios = texto
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    for (const achado of semComentarios.matchAll(/exigir\(\s*\(p\)\s*=>\s*([^,]+),/g)) {
      const guarda = achado[1] ?? ''
      if (!/p\.receita|p\.configurar/.test(guarda)) {
        frouxas.push(`${relative(RAIZ, tela)} — exigir(${guarda.trim().slice(0, 52)})`)
      }
    }
  }
  assert.deepEqual(
    frouxas,
    [],
    `\ntela de receita sem checar receita:\n${frouxas.join('\n')}\n` +
      'A expressão da casa é `temEscopo(p.receita) || p.configurar` (ver renovacoes e saidas).\n',
  )
})

test('a cascata continua sendo a mais estrita das telas de receita', () => {
  // Ela mostra o fechamento inteiro do mês, então exige `receita === 'base'` e não
  // só "tem algum escopo". Se alguém afrouxar isso para uniformizar com as outras,
  // o portão avisa — uniformizar para baixo é como uma exceção justificada morre.
  const cascata = readFileSync(
    join(RAIZ, 'apps', 'web-internal', 'app', '(interno)', 'receita', 'page.tsx'),
    'utf8',
  )
  assert.match(cascata, /p\.receita === 'base'/, 'a cascata deixou de exigir escopo de base')
})

/* ═══════════════════════════════════════════════════════════════════════════════
 * PORTÃO: toda rota de /docs resolve identidade.
 *
 * `/docs` serve material interno — o PRD com arquitetura, desenho de isolamento
 * entre clientes e o kickoff dos times. A política é deliberadamente mais frouxa
 * que a das telas: PAPEL não é exigido, porque o pedido era "aberto a todos que
 * entrarem pelo SSO do Google". Mas sessão e suspensão barram.
 *
 * O modo de falha é conhecido, e já aconteceu: enquanto esses documentos moravam em
 * `public/`, arquivo estático NÃO passava pela resolução de identidade — e uma
 * pessoa SUSPENSA levava 403 em `/carteira` e lia o documento com 200. Meia
 * suspensão.
 *
 * Este portão pega a PRÓXIMA rota, a que alguém acrescenta em três meses copiando
 * a de cima e apagando a linha da identidade. Sem ela, a rota devolve 200 para
 * qualquer requisição que alcance o contêiner — e o sintoma não aparece em teste
 * nenhum, porque o documento continua abrindo para quem testa.
 *
 * A regra é por DIRETÓRIO, e não por lista: lista não cobre a próxima rota.
 * ═══════════════════════════════════════════════════════════════════════════════ */

test('toda rota de /docs resolve identidade antes de ler o arquivo', () => {
  const raiz = join(RAIZ, 'apps', 'web-internal', 'app', 'docs')
  const rotas: string[] = []
  const varrer = (d: string) => {
    for (const nome of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, nome.name)
      if (nome.isDirectory()) varrer(p)
      else if (nome.name === 'route.ts') rotas.push(p)
    }
  }
  varrer(raiz)
  assert.ok(rotas.length >= 2, `achei só ${rotas.length} rotas em /docs — o caminho mudou?`)

  const frouxas: string[] = []
  for (const rota of rotas) {
    const texto = readFileSync(rota, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    // Uma das duas: o helper comum, ou a checagem à mão que ele encapsula.
    const resolve =
      /await\s+exigirSessaoParaDocumento\(\)/.test(texto) || /await\s+identidade\(\)/.test(texto)
    // E ela tem de vir ANTES da leitura: checar depois de ler é ler para quem não
    // deveria, mesmo que a resposta seja descartada.
    const posGuarda = Math.max(
      texto.indexOf('exigirSessaoParaDocumento()'),
      texto.indexOf('identidade()'),
    )
    const posLeitura = Math.max(texto.indexOf('lerDocumento('), texto.indexOf('readFile('))
    if (!resolve) {
      frouxas.push(`${relative(RAIZ, rota)} — não resolve identidade`)
    } else if (posLeitura !== -1 && posGuarda > posLeitura) {
      frouxas.push(`${relative(RAIZ, rota)} — lê o arquivo ANTES de checar a sessão`)
    }
  }
  assert.deepEqual(
    frouxas,
    [],
    `\nrota de /docs sem a guarda de identidade:\n${frouxas.join('\n')}\n` +
      'A expressão da casa é `await exigirSessaoParaDocumento()` (ver app/docs/servir.ts),\n' +
      'e ela vem antes de qualquer leitura de disco.\n',
  )
})

