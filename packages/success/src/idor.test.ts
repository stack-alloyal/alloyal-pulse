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
import { existsSync, readFileSync, readdirSync } from 'node:fs'
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


/**
 * ─── O destino de volta das ações do fluxo não pode ser um OPEN REDIRECT ─────
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POR QUE ISTO PASSOU A EXISTIR EM 10/09/2026.                              │
 * │                                                                            │
 * │ O fluxo de cancelamento ganhou tela própria (`/cancelamento` opera,        │
 * │ `/saidas` analisa), e as dez ações precisaram devolver para a tela de onde  │
 * │ foram chamadas. O destino passou a vir de um CAMPO DE FORMULÁRIO.          │
 * │                                                                            │
 * │ Server Action é endpoint público: quem posta não é obrigado a ser a tela    │
 * │ que desenhou o botão. `redirect(dados.get('voltarPara'))` mandaria uma      │
 * │ pessoa autenticada para onde o atacante escrevesse — e o link sairia de     │
 * │ dentro do Pulse, com a sessão viva.                                        │
 * │                                                                            │
 * │ A defesa é LISTA DE PERMISSÃO, e não saneamento de string: `//evil.com`,   │
 * │ `https:evil.com` e `/\evil.com` passam por quase toda regex de "começa com │
 * │ barra". Este portão guarda as três propriedades que sustentam isso.         │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
const VOLTA = join(RAIZ, 'apps', 'web-internal', 'app', '(interno)', 'saidas', 'volta.ts')
const ACOES_DO_FLUXO = join(RAIZ, 'apps', 'web-internal', 'app', '(interno)', 'saidas', 'acoes.ts')

test('o destino de volta é comparado com uma lista, e nunca sanitizado', () => {
  const volta = readFileSync(VOLTA, 'utf8')

  // 1. A lista existe e só tem caminho interno simples.
  const bloco = volta.match(/TELAS_DO_FLUXO = \[([^\]]*)\]/)
  assert.ok(bloco, 'não achei TELAS_DO_FLUXO em volta.ts')
  const telas = [...bloco[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
  assert.ok(telas.length >= 1, 'a lista de telas está vazia')
  for (const t of telas) {
    assert.match(t, /^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/, `"${t}" não é caminho interno simples`)
  }

  // 2. A comparação é por PERTENCIMENTO. `startsWith`, `replace` ou `match` aqui
  //    seriam saneamento — e é assim que `//evil.com` entra.
  assert.match(
    volta,
    /\.includes\(pedido\)/,
    'a escolha do destino deixou de ser comparação com a lista',
  )
  for (const proibido of ['startsWith', 'replace(', 'match(', 'decodeURI']) {
    assert.ok(
      !volta.includes(proibido),
      `volta.ts usa "${proibido}": destino de redirecionamento se compara com lista, não se conserta`,
    )
  }

  // 3. O padrão é um membro da lista, e não o que veio no campo.
  assert.match(
    volta,
    /:\s*TELAS_DO_FLUXO\[0\]/,
    'o caso de falha não cai num destino da lista',
  )

  /* 4. A lista também é um TIPO.
     ┌────────────────────────────────────────────────────────────────────────┐
     │ ESTE PORTÃO FICOU VERDE COM O DEFEITO NA TELA, em 10/09/2026.          │
     │                                                                         │
     │ Quando o kanban virou `/cancelamento/kanban`, o caminho não entrou na    │
     │ lista. `destinoDeVolta` fez o que devia — caiu no primeiro membro —, e o │
     │ usuário viveu isto: "quando clico para movimentar o card ele volta para  │
     │ a Visão Geral e tenho que ficar voltando para a aba Kanban".             │
     │                                                                         │
     │ O portão não pegou porque ele conferia que o formulário CARREGA o campo, │
     │ nunca que o VALOR do campo está na lista. Conferir o valor exigiria      │
     │ resolver constante de outro arquivo; o TIPO resolve de graça — com        │
     │ `TelaDoFluxo`, caminho fora da lista não compila. O que resta ao portão   │
     │ é garantir que o tipo continue existindo. */
  assert.match(
    volta,
    /export type TelaDoFluxo = \(typeof TELAS_DO_FLUXO\)\[number\]/,
    'a lista deixou de ser um tipo — sem ele, destino fora da lista volta a compilar',
  )
})

test('toda tela do fluxo está na lista de destinos', () => {
  /* O complemento do tipo, e é ele que pega o caso de 10/09 pelo outro lado: o
     tipo recusa o valor que não está na lista, e isto recusa a TELA que existe e
     ficou de fora. Aba nova sem entrada na lista é um redirecionamento que
     aterrissa na aba errada — o defeito exato que o usuário reportou. */
  const volta = readFileSync(VOLTA, 'utf8')
  const telas = [...volta.match(/TELAS_DO_FLUXO = \[([^\]]*)\]/)![1]!.matchAll(/'([^']+)'/g)].map(
    (m) => m[1]!,
  )
  const INTERNO = join(RAIZ, 'apps', 'web-internal', 'app', '(interno)')

  const rotas: string[] = []
  const varrer = (d: string, url: string) => {
    for (const n of readdirSync(d, { withFileTypes: true })) {
      if (!n.isDirectory()) continue
      // Segmento dinâmico não é destino de volta: `[id]` não é uma tela, é uma
      // família de telas, e nenhuma ação do fluxo devolve para uma delas.
      if (n.name.startsWith('[') || n.name.startsWith('(')) continue
      const filho = join(d, n.name)
      const rota = `${url}/${n.name}`
      if (existsSync(join(filho, 'page.tsx'))) rotas.push(rota)
      varrer(filho, rota)
    }
  }
  for (const raiz of ['cancelamento', 'saidas']) {
    const d = join(INTERNO, raiz)
    if (!existsSync(d)) continue
    if (existsSync(join(d, 'page.tsx'))) rotas.push(`/${raiz}`)
    varrer(d, `/${raiz}`)
  }

  assert.ok(rotas.length >= 3, `varri só ${rotas.length} telas do fluxo — o caminho mudou?`)
  assert.deepEqual(
    rotas.filter((r) => !telas.includes(r)),
    [],
    'tela do fluxo que não está em TELAS_DO_FLUXO',
  )
})

test('nenhuma ação do fluxo redireciona com valor de formulário cru', () => {
  const acoes = readFileSync(ACOES_DO_FLUXO, 'utf8')
  /* O `redirect` só pode receber o que saiu de `destinoDeVolta`. Interpolar
     `dados.get(...)` num destino é exatamente o defeito que a lista evita, e é
     fácil de reintroduzir "só para levar o id de volta". */
  for (const m of acoes.matchAll(/redirect\(([^)]*)\)/g)) {
    assert.ok(
      !m[1]!.includes('dados.get'),
      `redirect() recebeu valor de formulário direto: ${m[0]}`,
    )
  }
  assert.match(acoes, /destinoDeVolta/, 'as ações deixaram de usar a lista de permissão')
})

test('todo formulário que chama ação do fluxo carrega o campo de volta', () => {
  /* Formulário sem o campo não quebra: cai no primeiro da lista. Mas cai na tela
     ERRADA, e é o tipo de defeito que ninguém reporta — a pessoa só acha que a
     ferramenta é confusa. Então se confere, e não se confia. */
  const dir = join(RAIZ, 'apps', 'web-internal', 'app', '(interno)')
  const arquivos: string[] = []
  const varrer = (d: string) => {
    for (const n of readdirSync(d, { withFileTypes: true })) {
      if (n.isDirectory()) varrer(join(d, n.name))
      else if (n.name.endsWith('.tsx')) arquivos.push(join(d, n.name))
    }
  }
  varrer(dir)

  const faltando: string[] = []
  for (const a of arquivos) {
    const src = readFileSync(a, 'utf8')
    /* SÓ os arquivos que importam as ações DO FLUXO. A primeira versão deste
       portão varria todo `<form action={acao…}>` da app e deu DEZ falsos
       positivos — biblioteca, contratos, relatórios e renovações têm ações
       próprias, que redirecionam para a própria tela com destino fixo e não
       têm o problema das duas casas. Portão que acusa o inocente é portão que
       alguém desliga. */
    if (!/from '(\.\.\/)?saidas\/acoes'|from '\.\/acoes'/.test(src)) continue
    if (!src.includes('saidas/acoes') && !a.includes('saidas')) continue

    // Cada `<form action={acao…}>` e seu conteúdo até o `</form>`.
    for (const m of src.matchAll(/<form action=\{(acao\w+|registrarPedido)\}[\s\S]*?<\/form>/g)) {
      if (!m[0].includes('CampoDeVolta')) {
        faltando.push(`${relative(RAIZ, a)} — <form action={${m[1]}}>`)
      }
    }
  }
  assert.ok(arquivos.length > 20, 'não varri a app — o caminho mudou?')
  assert.deepEqual(faltando, [], 'formulário de ação sem CampoDeVolta')
})
