/**
 * As telas servidas pelo oauth2-proxy, renderizadas pelo motor de template DELE.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POR QUE ESTE ARQUIVO, quando já existe portão em design-system.test.mjs.   │
 * │                                                                            │
 * │ O portão lê o HTML como TEXTO: confere cor contra `estilo.css`, a frase do  │
 * │ CSRF contra a versão da imagem, e se cada ramo tem título, ação e tag       │
 * │ fechada. O que ele não pode fazer é EXECUTAR o template — `error.html` é    │
 * │ Go `html/template`, e quem decide se `{{ if $expirou }}` casa é um binário  │
 * │ Go, não uma expressão regular.                                             │
 * │                                                                            │
 * │ Um `{{ eq .StatusCode "403" }}` (com a string em vez do int) passaria por   │
 * │ todo portão de texto e cairia sempre no ramo genérico. Só renderizando de   │
 * │ verdade se vê.                                                             │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ NÃO TOCA EM PRODUÇÃO — ao contrário dos outros arquivos desta pasta.       │
 * │                                                                            │
 * │ Sobe um oauth2-proxy DESCARTÁVEL na 4199, com a mesma imagem do compose e   │
 * │ um upstream `static://200`, apontando `--custom-templates-dir` para a pasta  │
 * │ do repositório. Nenhum banco, nenhum segredo de verdade, nenhuma sessão.    │
 * │ Derruba o contêiner no fim, inclusive se falhar.                           │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * COBERTURA: dois dos cinco ramos por status. Os outros três (401, 403 sem ser
 * de tempo, 404) não são alcançáveis por requisição — `/oauth2/<desconhecido>`
 * cai na tela de entrada e `/oauth2/auth` responde 401 sem corpo. Para esses, o
 * portão de texto é o que há.
 *
 *   cd packages/ui && node testes-navegador/telas-do-proxy.mjs
 *
 * ⚠ O oauth2-proxy carrega os templates NA PARTIDA. Editar o arquivo e recarregar
 * a página mostra a versão ANTERIOR — foi o que me enganou em 09/09/2026, e a
 * razão de este arquivo subir um contêiner novo em vez de reaproveitar um de pé.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..', '..')
const TEMPLATES = join(RAIZ, 'infra', 'oauth2-templates')
/* FORA do repositório por padrão: `roadmap.mjs` grava na raiz e deixa PNG solto
   no `git status` de quem rodar. `TIROS=...` para escolher outro lugar. */
const TIROS = process.env['TIROS'] ?? join(tmpdir(), 'pulse-telas-do-proxy')
const NOME = 'proxy-telas-prova'
const PORTA = 4199

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' })
/** O mesmo, engolindo o "No such container" da limpeza preventiva. */
const dockerQuieto = (...args) => {
  try {
    return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
}

/** A imagem é a do compose, e não uma fixada aqui: template é contrato de versão. */
function imagemDoCompose() {
  const compose = readFileSync(join(RAIZ, 'infra', 'docker-compose.yml'), 'utf8')
  const m = compose.match(/image:\s*(quay\.io\/oauth2-proxy\/oauth2-proxy:\S+)/)
  assert.ok(m, 'não achei a imagem do oauth2-proxy no compose')
  return m[1]
}

function subir(imagem) {
  dockerQuieto('rm', '-f', NOME)
  docker(
    'run', '-d', '--name', NOME, '-p', `127.0.0.1:${PORTA}:4180`,
    '-v', `${TEMPLATES}:/templates:ro`, imagem,
    '--provider=google', '--client-id=prova', '--client-secret=prova',
    '--cookie-secret=0123456789abcdef0123456789abcdef',
    '--email-domain=alloyal.com.br', '--upstream=static://200',
    '--http-address=0.0.0.0:4180', '--reverse-proxy=true',
    '--custom-templates-dir=/templates',
  )
}

async function esperar(url, tentativas = 40) {
  for (let i = 0; i < tentativas; i++) {
    try {
      // Qualquer resposta serve: o que se espera é o processo aceitar conexão.
      await fetch(url)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  // Template com erro de sintaxe faz `loadTemplates` falhar e o contêiner MORRER.
  // O log é o diagnóstico, e sem ele o erro seria "timeout" sem causa.
  throw new Error(`o proxy não subiu em 10s. Log:\n${docker('logs', NOME)}`)
}

const CASOS = [
  {
    nome: 'erro-tempo',
    fim: 'class="rodape"',
    // Um `state` na forma `nonce:destino` chega ao ponto do CSRF; sem cookie, 403.
    caminho: '/oauth2/callback?state=abc%3Ahttps%3A%2F%2Fpulse.alloyal.com.br%2F&code=xyz',
    status: 403,
    titulo: 'O tempo para entrar esgotou',
    // O ramo certo tem de mandar para /start (um clique até o Google), e não
    // para /sign_in (dois). É a diferença que o usuário pediu.
    acao: '/oauth2/start',
    diagnostico: 'Unable to find a valid CSRF token',
  },
  {
    nome: 'erro-generico',
    fim: 'class="rodape"',
    // `state` sem os dois pontos nem chega ao CSRF: quebra antes, em 500.
    caminho: '/oauth2/callback?state=abc&code=xyz',
    status: 500,
    titulo: 'Algo deu errado ao entrar',
    acao: '/oauth2/sign_in',
    diagnostico: 'Something went wrong',
  },
  {
    nome: 'entrada',
    fim: 'class="papel"',
    caminho: '/oauth2/sign_in',
    status: 200,
    titulo: 'Entrar no Alloyal Pulse',
    // No `sign_in.html` o <h1> é a chamada do painel de marca; o título é o <h2>.
    seletor: 'h2',
    acao: '/oauth2/start',
    diagnostico: null,
  },
]

const imagem = imagemDoCompose()
console.log(`imagem: ${imagem}`)
mkdirSync(TIROS, { recursive: true })
subir(imagem)

const navegador = await chromium.launch()
let falhas = 0
try {
  await esperar(`http://127.0.0.1:${PORTA}/oauth2/sign_in`)
  const pagina = await navegador.newPage()
  await pagina.setViewportSize({ width: 1280, height: 800 })

  for (const caso of CASOS) {
    const r = await pagina.goto(`http://127.0.0.1:${PORTA}${caso.caminho}`, { waitUntil: 'load' })
    try {
      assert.equal(r.status(), caso.status, `${caso.nome}: status`)

      /* Antes de procurar seletor: a página CHEGOU INTEIRA?
         O `html/template` do Go, ao errar em tempo de execução, escreve o que já
         tinha e PARA — sem status de erro. Um `{{ eq .StatusCode "403" }}`, com a
         string onde vai o int, produz exatamente isso: 403 com corpo cortado
         antes do <h1>. Sem esta asserção, o teste ficava 30s num `textContent`
         que nunca resolve e falhava dizendo só "Timeout", que não é diagnóstico.
         Medido em 09/09/2026, mutando essa comparação.

         `fim` é o ÚLTIMO elemento de cada tela, e tem de ser: a primeira versão
         procurava um `</div>` qualquer e passou pela mutação — o `eq` aborta
         depois do painel da marca, que já fechou uma div. Só o último elemento
         prova que o template correu até o fim. */
      const corpo = await pagina.evaluate(() => document.body?.innerHTML ?? '')
      assert.ok(
        corpo.includes(caso.fim),
        `${caso.nome}: o corpo chegou cortado (${corpo.length} bytes) — template com erro ` +
          `de EXECUÇÃO, que o Go não reporta como falha. Log do proxy:\n${dockerQuieto('logs', '--tail', '5', NOME)}`,
      )

      const titulo = await pagina.textContent(caso.seletor ?? 'h1', { timeout: 3000 })
      assert.ok(
        titulo?.includes(caso.titulo),
        `${caso.nome}: esperava o título "${caso.titulo}", li "${titulo?.trim()}"`,
      )

      const acoes = await pagina.$$eval('a.botao', (as) => as.map((a) => a.getAttribute('href')))
      assert.ok(
        acoes.some((h) => h?.startsWith(caso.acao)),
        `${caso.nome}: nenhuma ação leva a ${caso.acao} — as href são ${JSON.stringify(acoes)}`,
      )

      if (caso.diagnostico) {
        // Sem clicar: o <details> tem de trazer o texto no HTML, porque o
        // template embutido do proxy só o revelava por JavaScript.
        const diag = await pagina.textContent('details.diag')
        assert.ok(
          diag?.includes(caso.diagnostico),
          `${caso.nome}: o diagnóstico não traz "${caso.diagnostico}"`,
        )
        await pagina.evaluate(() => document.querySelector('details')?.setAttribute('open', ''))
      }

      // A régua: nada vaza na horizontal, nem no desktop nem no celular.
      for (const [largura, altura, sufixo] of [[1280, 800, ''], [390, 780, '-celular']]) {
        await pagina.setViewportSize({ width: largura, height: altura })
        const vaza = await pagina.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        )
        assert.equal(vaza, 0, `${caso.nome}: vazam ${vaza}px na horizontal em ${largura}px`)
        await pagina.screenshot({ path: join(TIROS, `${caso.nome}${sufixo}.png`) })
      }
      await pagina.setViewportSize({ width: 1280, height: 800 })
      console.log(`  ok  ${caso.nome}`)
    } catch (erro) {
      falhas++
      console.error(`  FALHOU  ${caso.nome}: ${erro.message}`)
    }
  }
} finally {
  await navegador.close()
  dockerQuieto('rm', '-f', NOME)
}

console.log(falhas === 0 ? `\n${CASOS.length} telas conferidas. Tiros em ${TIROS}` : `\n${falhas} falha(s)`)
process.exit(falhas === 0 ? 0 : 1)
