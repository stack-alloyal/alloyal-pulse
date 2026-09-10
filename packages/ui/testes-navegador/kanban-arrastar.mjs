/**
 * O arraste do quadro, num navegador de verdade.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POR QUE ISTO NÃO É TESTE DE UNIDADE.                                      │
 * │                                                                            │
 * │ `saida-arraste.test.ts` já cobre a REGRA por força bruta: 8 estados × 2     │
 * │ origens × 8 colunas. O que ele não consegue provar é a CORRENTE: que o      │
 * │ cartão sai do servidor com `data-alvos` escrito, que o `dragstart` chega ao │
 * │ provedor, que a Server Action é chamada com o id certo, que o estado muda   │
 * │ no banco, e — o ponto da queixa — que a URL NÃO MUDA.                       │
 * │                                                                            │
 * │ A queixa foi esta: "quando clico para movimentar o card ele volta para a    │
 * │ Visão Geral e tenho que ficar voltando para a aba Kanban". A asserção que   │
 * │ corresponde a ela é a da URL, e ela é a razão deste arquivo existir.        │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ CONTRA `next start`, e nunca `next dev`. Já medido e registrado em         │
 * │ `saida-ponta-a-ponta.mjs`: a CSP da app não permite `unsafe-eval` e o       │
 * │ bundler de dev do Next usa `eval`, então NADA hidrata em dev. Um arraste     │
 * │ sem hidratação não é um arraste — é um teste que mede o vazio.              │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ REFAZER A MASSA A CADA EXECUÇÃO, e isto não é higiene: é correção.        │
 * │                                                                            │
 * │ O teste ARRASTA, então ele MUDA o estado dos cartões. Na segunda execução   │
 * │ sem refazer a massa, o passo 6 falhou — e falhou mentindo: "a Clínica não é │
 * │ arrastável" é verdade depois de o próprio teste tê-la levado ao desfecho.   │
 * │ O `TRUNCATE` mora em `infra/massa-arrasto.sql` e roda antes.                │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Como rodar (o preparo do banco e da app está em `saida-ponta-a-ponta.mjs`):
 *
 *   docker exec -i pulse-pg-e2e psql -U postgres -d pulse -f - \
 *     < infra/massa-arrasto.sql
 *   cd packages/ui && BASE=http://127.0.0.1:3402 PULSE_PROXY_SECRET=<o mesmo> \
 *     node testes-navegador/kanban-arrastar.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3402'
const SEGREDO = process.env.PULSE_PROXY_SECRET
const EMAIL = process.env.PULSE_EMAIL ?? 'stack@alloyal.com.br'
const FOTOS = process.env.FOTOS ?? '.'

// A trava, antes de tudo: este arquivo MOVE cartão, e mover cartão grava estado.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(BASE)) {
  console.error(
    `RECUSADO: BASE=${BASE} não é loopback. Este teste ARRASTA cartão e gravaria ` +
      `transição de verdade no fluxo de cancelamento.`,
  )
  process.exit(2)
}

/**
 * 2400 DE LARGURA, e o motivo é medida e não gosto.
 *
 * As oito colunas somam 8 × 252px de largura fixa + 7 × 12px de vão + 40px de
 * respiro = 2100px. Num viewport de 1600 a coluna `pdd` fica em x=2107, fora da
 * tela — MEDIDO: `dragTo` para lá não completa, e a asserção falha por rolagem,
 * não por regra. O navegador rola sozinho quando o cursor chega à borda durante
 * um arraste, então a pessoa real alcança; um teste que dependesse disso mediria
 * o auto-scroll do Chromium em vez do produto.
 *
 * As fotos, no fim, voltam para 1600 — que é a tela de verdade.
 */
const navegador = await chromium.launch()
const ctx = await navegador.newContext({
  viewport: { width: 2400, height: 950 },
  ...(SEGREDO
    ? { extraHTTPHeaders: { 'x-pulse-proxy-secret': SEGREDO, 'x-auth-request-email': EMAIL } }
    : {}),
})
const pg = await ctx.newPage()

let falhas = 0
const conferir = (ok, oque, detalhe = '') => {
  if (!ok) falhas++
  console.log(`${ok ? 'ok   ' : 'FALHA'} ${oque}${detalhe ? ` · ${detalhe}` : ''}`)
}

const KANBAN = '/cancelamento/kanban'
const abrir = async () => {
  await pg.goto(BASE + KANBAN, { waitUntil: 'networkidle' })
  await pg.waitForSelector('[data-alvo="pedido"]')
}

/** O cartão pelo nome do cliente — o `<article>`, não o link de dentro. */
const cartao = (nome) => pg.locator(`article[data-saida]:has-text("${nome}")`).first()
/** A coluna pelo id da posição. */
const coluna = (id) => pg.locator(`[data-alvo="${id}"]`)
/** Em que coluna o cartão está agora. */
const posicaoDe = async (nome) => await cartao(nome).getAttribute('data-posicao')
/** A faixa de resposta do arraste. */
const recado = async () => (await pg.locator('[aria-live="polite"]').innerText()).replace(/\s+/g, ' ').trim()

/**
 * Arrasta e espera a resposta MUDAR.
 *
 * Esperar por um texto fixo passa verde com o recado do passo anterior ainda na
 * tela — o mesmo tipo de falso positivo que já apareceu neste diretório: duas
 * asserções do e2e de saída passaram com a TABELA VAZIA porque o trecho casava
 * com o próprio formulário.
 */
const dialogo = () => pg.locator('[role="dialog"]')

/**
 * Arrasta para uma coluna de DESFECHO, que abre o diálogo do design system.
 *
 * Nasceu do caso da conta Zanzar: alguém do time moveu um cartão para `retido`
 * — ponto final — e só descobriu depois que não havia volta. Etapa é livre;
 * desfecho pergunta. As duas metades desta assimetria são medidas aqui.
 */
const arrastarConfirmando = async (nome, para, { confirmar }) => {
  const antes = await recado()
  await cartao(nome).dragTo(coluna(para))
  await dialogo().waitFor({ state: 'visible', timeout: 10000 })
  const texto = (await dialogo().innerText()).replace(/\s+/g, ' ').trim()
  if (!confirmar) {
    await dialogo().getByRole('button', { name: /cancelar|não/i }).click()
    await dialogo().waitFor({ state: 'hidden', timeout: 10000 })
    return { texto, recado: await recado() }
  }
  await dialogo().getByRole('button', { name: /registrar|confirmar|conceder/i }).click()
  await pg.waitForFunction(
    (a) => {
      const t = (document.querySelector('[aria-live="polite"]')?.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim()
      return t !== '' && t !== a && !/movendo/i.test(t)
    },
    antes,
    { timeout: 20000 },
  )
  return { texto, recado: await recado() }
}

const arrastar = async (nome, para) => {
  const antes = await recado()
  await cartao(nome).dragTo(coluna(para))
  await pg.waitForFunction(
    (a) => {
      const t = (document.querySelector('[aria-live="polite"]')?.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim()
      return t !== '' && t !== a && !/movendo/i.test(t)
    },
    antes,
    { timeout: 20000 },
  )
  return await recado()
}

// ─── 1. O servidor escreve os alvos no cartão ────────────────────────────────
{
  await abrir()
  const padaria = await cartao('Padaria Bela Vista').getAttribute('data-alvos')
  conferir(padaria !== null && padaria !== '', 'cartão em etapa sai com data-alvos', padaria)
  // Com aviso prévio gravado, a coluna de perda é alcançável; desconto e pdd não.
  conferir(padaria.includes('cancelamento'), 'a coluna de perda está entre os alvos')
  conferir(!padaria.includes('desconto'), 'desconto NÃO está entre os alvos')
  conferir(!padaria.includes('pdd'), 'pdd NÃO está entre os alvos')

  const semAviso = await cartao('Distribuidora Norte').getAttribute('data-alvos')
  conferir(
    !semAviso.includes('cancelamento'),
    'sem aviso prévio, a coluna de perda sai da lista de alvos',
    semAviso,
  )

  // Desfecho registrado: cartão parado, e o atributo `draggable` diz isso.
  const trevo = await cartao('Oficina Trevo').getAttribute('data-alvos')
  conferir(trevo === '', 'cartão em desfecho sai sem alvo nenhum', `"${trevo}"`)
  conferir(
    (await cartao('Oficina Trevo').getAttribute('draggable')) !== 'true',
    'cartão em desfecho não é arrastável',
  )
  conferir(
    (await cartao('Padaria Bela Vista').getAttribute('draggable')) === 'true',
    'cartão em etapa é arrastável',
  )
}

// ─── 2. Arrastar entre etapas, e a URL não muda ──────────────────────────────
{
  await abrir()
  conferir((await posicaoDe('Padaria Bela Vista')) === 'pedido', 'a padaria começa em Pedido')

  const r = await arrastar('Padaria Bela Vista', 'financeiro')
  conferir(
    (await posicaoDe('Padaria Bela Vista')) === 'financeiro',
    'o cartão foi para Informações financeiras',
  )
  // Etapa é LIVRE: não abriu diálogo nenhum no caminho.
  conferir(!(await dialogo().isVisible()), 'mover entre etapas não pede confirmação')
  conferir(/movido para Informações financeiras/i.test(r), 'a resposta diz para onde foi', r)

  /* ⚠ A ASSERÇÃO DA QUEIXA. Antes, cada movimento terminava em `redirect` e a
     pessoa aterrissava na Visão Geral. */
  conferir(new URL(pg.url()).pathname === KANBAN, 'a URL continua no kanban', pg.url())
}

// ─── 3. Arrastar de VOLTA, que a tabela de transições não permitia ───────────
{
  await arrastar('Padaria Bela Vista', 'pedido')
  conferir((await posicaoDe('Padaria Bela Vista')) === 'pedido', 'o cartão volta para Pedido')
  conferir(new URL(pg.url()).pathname === KANBAN, 'a URL continua no kanban depois de voltar')
}

// ─── 4. A coluna que recusa devolve o MOTIVO, e não o silêncio ───────────────
{
  const r = await arrastar('Padaria Bela Vista', 'desconto')
  conferir(/MRR novo/i.test(r), 'soltar em Desconto explica o que falta', r)
  conferir((await posicaoDe('Padaria Bela Vista')) === 'pedido', 'e o cartão não se mexeu')
}

// ─── 5. A origem decide qual coluna de perda aceita ──────────────────────────
{
  const r = await arrastar('Padaria Bela Vista', 'pdd')
  conferir(/origem deste pedido é o cliente/i.test(r), 'soltar em PDD fala da origem', r)
  conferir((await posicaoDe('Padaria Bela Vista')) === 'pedido', 'e o cartão não se mexeu')
}

// ─── 6. O desfecho PERGUNTA, e cancelar não grava nada ───────────────────────
{
  const c = await arrastarConfirmando('Clinica Sao Rafael', 'revertido', { confirmar: false })
  conferir(/Registrar a retenção de Clinica Sao Rafael/i.test(c.texto), 'o diálogo nomeia o cliente')
  conferir(/PONTO FINAL/i.test(c.texto), 'o diálogo diz que a retenção não tem volta')
  conferir(/três primeiras colunas/i.test(c.texto), 'o diálogo oferece a alternativa')
  conferir(!/tem certeza/i.test(c.texto), 'o diálogo não cai no "tem certeza"')
  conferir(
    (await posicaoDe('Clinica Sao Rafael')) === 'reversao',
    'CANCELAR não gravou nada — o cartão ficou onde estava',
  )
}

// ─── 6b. E confirmando, grava ────────────────────────────────────────────────
{
  const c = await arrastarConfirmando('Clinica Sao Rafael', 'revertido', { confirmar: true })
  conferir(
    (await posicaoDe('Clinica Sao Rafael')) === 'revertido',
    'a reversão virou retenção pelo arraste confirmado',
  )
  conferir(/retenção/i.test(c.recado), 'e a resposta diz o que foi gravado', c.recado)
  // Agora ela é desfecho: parou de ser arrastável.
  conferir(
    (await cartao('Clinica Sao Rafael').getAttribute('draggable')) !== 'true',
    'depois do desfecho o cartão para de ser arrastável',
  )
}

// ─── 7. O aviso correndo só aceita a retenção ────────────────────────────────
{
  const lumen = await cartao('Editora Lumen').getAttribute('data-alvos')
  conferir(lumen === 'revertido', 'cartão em aviso corrido só tem Revertido como alvo', `"${lumen}"`)

  /* Soltar na PRÓPRIA coluna não faz nada e não diz nada — gesto abortado não é
     pedido, e uma faixa de aviso a cada arraste desistido seria ruído. A regra
     tem a recusa escrita ("o cartão já está nesta coluna") e ela serve para
     EXCLUIR a coluna da lista de alvos; a tela não precisa dizê-la em voz alta. */
  const antes = await recado()
  await cartao('Editora Lumen').dragTo(coluna('cancelamento'))
  await pg.waitForTimeout(1500)
  conferir((await recado()) === antes, 'soltar na própria coluna fica em silêncio', await recado())
  conferir(!(await dialogo().isVisible()), 'e não abre diálogo')
  conferir(
    (await posicaoDe('Editora Lumen')) === 'cancelamento',
    'e o cartão continua onde estava',
  )
}

// ─── 8. A foto ───────────────────────────────────────────────────────────────
{
  // A tela de verdade, e não a largura que o teste precisou para alcançar a
  // oitava coluna.
  await pg.setViewportSize({ width: 1600, height: 950 })
  await abrir()
  await pg.screenshot({ path: `${FOTOS}/kanban-arrasto.png`, fullPage: false })
  // E o quadro no meio de um arraste, com a coluna válida acesa e a inválida
  // apagada — o estado que nenhuma foto estática mostra.
  const origem = cartao('Metalurgica Horizonte')
  const caixa = await origem.boundingBox()
  const destino = await coluna('revertido').boundingBox()
  await pg.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2)
  await pg.mouse.down()
  await pg.mouse.move(destino.x + destino.width / 2, destino.y + 120, { steps: 12 })
  await pg.screenshot({ path: `${FOTOS}/kanban-arrasto-em-voo.png`, fullPage: false })
  await pg.mouse.up()

  // E o diálogo do desfecho, que é a trava que este arquivo passou a guardar.
  await abrir()
  await cartao('Padaria Bela Vista').dragTo(coluna('revertido'))
  await dialogo().waitFor({ state: 'visible', timeout: 10000 })
  await pg.screenshot({ path: `${FOTOS}/kanban-confirmar-desfecho.png`, fullPage: false })
  await dialogo().getByRole('button', { name: /cancelar|não/i }).click()

  console.log(`fotos em ${FOTOS}/kanban-arrasto*.png e ${FOTOS}/kanban-confirmar-desfecho.png`)
}

await navegador.close()
console.log(falhas === 0 ? '\nTODAS AS VERIFICAÇÕES PASSARAM' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
