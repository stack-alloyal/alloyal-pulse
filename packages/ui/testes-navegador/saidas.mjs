/**
 * Régua de /saidas: as quatro abas e o formulário de levantada de mão.
 *
 * A pergunta é uma só, e é a que o repo já pagou para aprender: A PÁGINA ROLA DE
 * LADO? Em telefone, tablet e desktop, e com `isMobile: false` — com `isMobile` o
 * Chromium relata um `clientWidth` que não é o da página, e a medida vira ficção.
 *
 * O formulário de cadastro tem ONZE controles numa linha que quebra, e um
 * `<select>` de ~426 clientes. Nenhum dos dois foi estimado: o número de opções
 * sai do banco, e a régua é que diz se a linha cabe.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ NÃO ESTÁ NO CI, como os outros dois desta pasta: precisa da pilha de pé.    │
 * │                                                                            │
 * │ Contra o contêiner de produção, use BASE + PULSE_PROXY_SECRET como manda o  │
 * │ README. Contra um `next dev` local, basta BASE — a identidade de            │
 * │ desenvolvimento (PULSE_DEV_EMAIL) já responde, e não há proxy no caminho.   │
 * │                                                                            │
 * │   BASE=http://127.0.0.1:3399 node testes-navegador/saidas.mjs               │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Só GET. Nenhum formulário é submetido: a régua mede layout, e submeter abriria
 * pedido de cancelamento numa base real.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3399'
const SEGREDO = process.env.PULSE_PROXY_SECRET
const EMAIL = process.env.PULSE_EMAIL ?? 'stack@alloyal.com.br'

const LARGURAS = [
  { nome: 'telefone', width: 390, height: 844 },
  { nome: 'tablet', width: 820, height: 1180 },
  { nome: 'desktop', width: 1440, height: 900 },
]
const ROTAS = ['/saidas', '/saidas?aba=lista', '/saidas?aba=coorte', '/saidas?aba=meta']

const navegador = await chromium.launch()
let falhas = 0

for (const { nome, width, height } of LARGURAS) {
  const ctx = await navegador.newContext({
    viewport: { width, height },
    isMobile: false,
    ...(SEGREDO
      ? { extraHTTPHeaders: { 'x-pulse-proxy-secret': SEGREDO, 'x-auth-request-email': EMAIL } }
      : {}),
  })
  const pagina = await ctx.newPage()

  for (const rota of ROTAS) {
    const resposta = await pagina.goto(BASE + rota, { waitUntil: 'networkidle' })
    const m = await pagina.evaluate(() => {
      const raiz = document.documentElement
      /* Quem estoura é o elemento cujo retângulo passa da direita do viewport E
         não está dentro de um contêiner que ROLA.

         A primeira versão desta régua não olhava os ancestrais, e acusou a
         tabela da coorte em +535px nas três larguras. A tabela está dentro do
         `overflow-x-auto` que o `Table` do design system já põe — ou seja, o
         estouro é o comportamento PEDIDO: conteúdo largo rola no próprio
         contêiner, e a página não. A régua estava medindo a virtude como
         defeito, e é a quarta vez que uma régua minha erra neste repo. */
      const rolaSozinho = (e) => {
        for (let a = e.parentElement; a && a !== document.documentElement; a = a.parentElement) {
          const ox = getComputedStyle(a).overflowX
          if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true
        }
        return false
      }
      const estouram = [...document.querySelectorAll('body *')]
        .map((e) => ({ e, r: e.getBoundingClientRect() }))
        .filter(({ e, r }) => r.width > 0 && r.right > window.innerWidth + 1 && !rolaSozinho(e))
        .slice(0, 4)
        .map(
          ({ e, r }) =>
            `${e.tagName}.${String(e.className || '').split(' ')[0]} +${Math.round(r.right - window.innerWidth)}px`,
        )
      return {
        innerWidth: window.innerWidth,
        clientWidth: raiz.clientWidth,
        scrollWidth: raiz.scrollWidth,
        estouram,
        clientes: document.querySelectorAll('select[name="accountId"] option').length,
        controles: document.querySelectorAll('form input, form select').length,
      }
    })

    const rolaDeLado = m.scrollWidth > m.clientWidth + 1
    const ok = resposta?.status() === 200 && !rolaDeLado && m.estouram.length === 0
    if (!ok) falhas++
    console.log(
      `${ok ? 'ok   ' : 'FALHA'} ${nome.padEnd(9)} ${rota.padEnd(22)} ${resposta?.status()} · ` +
        `client ${m.clientWidth} scroll ${m.scrollWidth} · ${m.controles} controles` +
        (m.clientes ? ` · ${m.clientes} clientes no select` : '') +
        (m.estouram.length ? ` · ESTOURAM: ${m.estouram.join(', ')}` : ''),
    )
    // A asserção que este repo aprendeu a fazer sempre: se innerWidth e
    // clientWidth divergem, a régua está medindo outra coisa.
    if (m.innerWidth !== m.clientWidth) {
      console.log(`      aviso: innerWidth ${m.innerWidth} != clientWidth ${m.clientWidth}`)
      falhas++
    }
  }

  await ctx.close()
}

await navegador.close()
console.log(falhas === 0 ? '\nnenhuma rota rola de lado' : `\n${falhas} medições falharam`)
process.exit(falhas === 0 ? 0 : 1)
