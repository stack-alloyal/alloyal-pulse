/**
 * A corrente inteira do fluxo de saída, num navegador de verdade.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ EXISTE POR DOIS DEFEITOS SEGUIDOS, e os dois passaram por toda a suíte.    │
 * │                                                                            │
 * │ 1. `registrarPedido` foi escrita, testada e publicada sem NENHUM `<form>`   │
 * │    apontando para ela. Sem porta de entrada, `success.cancellation` ficou    │
 * │    em zero linha, e a tela subiu com os quatro KPI, o quadro, a lista e a    │
 * │    coorte em zero.                                                         │
 * │ 2. `anunciar` fazia `INSERT ... SELECT FROM core.contract` numa tabela        │
 * │    vazia. `SELECT` sem linha insere zero linhas e o `RETURNING` volta        │
 * │    vazio: o fluxo estava morto na porta desde que existia.                  │
 * │                                                                            │
 * │ Teste de unidade não pega nenhum dos dois: ele CHAMA a função com o         │
 * │ argumento pronto. O que faltava era provar que o FORMULÁRIO chega à função  │
 * │ e que a função grava — e depois que as quatro visões leem o que foi gravado.│
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ CONTRA BANCO DESCARTÁVEL, e isto não é opcional.                           │
 * │                                                                            │
 * │ Este arquivo SUBMETE formulário: ele abre pedido de cancelamento e define   │
 * │ meta. Rodá-lo contra a produção criaria churn que ninguém pediu, no quadro  │
 * │ que o board olha. Ele recusa BASE que não seja loopback, e a recusa é a     │
 * │ primeira coisa que faz.                                                    │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ CONTRA BUILD DE PRODUÇÃO (`next start`), e não `next dev`. MEDIDO.          │
 * │                                                                            │
 * │ A primeira versão rodava contra `next dev` e falhou em oito verificações,   │
 * │ com POST 500. A causa não era o produto: a CSP da app não permite           │
 * │ `unsafe-eval`, o bundler de DEV do Next usa `eval`, então a hidratação      │
 * │ nunca acontece em dev — nenhuma página é interativa ali. Sem hidratação, o  │
 * │ formulário cai no caminho sem JavaScript, e o Chromium manda `Origin: null` │
 * │ porque a app serve `Referrer-Policy: no-referrer`. O Next 15 faz            │
 * │ `new URL('null')` ao validar a origem da Server Action e devolve 500.       │
 * │                                                                            │
 * │ Contra `next start` a hidratação acontece, o POST vai com `Next-Action`,    │
 * │ sem `Origin`, e o Next aceita. Foi assim que se soube que o usuário real    │
 * │ está bem — e que a promessa de funcionar sem JavaScript, escrita em         │
 * │ `acoes.ts`, NÃO se cumpre. Medido com curl: Origin correto → 303, sem       │
 * │ Origin → 303, `Origin: null` → 500.                                        │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ESTE ARQUIVO ESTÁ VERMELHO NO PASSO 5, e é achado, não defeito do teste.    │
 * │                                                                            │
 * │ `avancarEtapa` recusa com violação de `cancellation_estado_check`. A        │
 * │ primeira leitura foi que a restrição não conhecia o estado `financeiro` —   │
 * │ e está ERRADA: medido em produção, o CHECK lista os oito estados, e a 0052  │
 * │ o atualizou corretamente.                                                   │
 * │                                                                            │
 * │ O que a linha recusada mostra é `estado` VAZIO. Ou seja, o valor do botão   │
 * │ não chega à ação: o formulário do quadro tem dois `<button type="submit"    │
 * │ name="para">` (financeiro e reversão), e `dados.get('para')` volta vazio.   │
 * │ O banco recusou certo — foi ele que impediu uma linha corrompida.           │
 * │                                                                            │
 * │ Duas coisas a consertar, e nenhuma foi feita ainda: a ação precisa VALIDAR  │
 * │ `para` contra as três etapas antes de tocar no banco (mensagem de produto,  │
 * │ não violação de restrição), e o formulário precisa entregar o valor do      │
 * │ botão que foi clicado.                                                     │
 * │                                                                            │
 * │ Fica commitado vermelho de propósito: não está no CI, e um teste que        │
 * │ encontra defeito real vale mais guardado do que apagado.                    │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Como rodar (o preparo inteiro, em ordem):
 *
 *   docker run -d --name pulse-pg-e2e -e POSTGRES_PASSWORD=teste \
 *     -e POSTGRES_DB=pulse -p 127.0.0.1:5457:5432 postgres:16
 *   DATABASE_URL_ADMIN=postgres://postgres:teste@127.0.0.1:5457/pulse \
 *     pnpm --filter @pulse/db migrate
 *   # massa: duas contas ativas, contrato numa, faturamento de 6 meses nas duas,
 *   # e uma linha em ops.user_role para o e-mail que vai operar
 *   pnpm build --filter @pulse/web-internal
 *   NODE_ENV=production PULSE_PROXY_SECRET=<qualquer> \
 *     DATABASE_URL=postgres://postgres:teste@127.0.0.1:5457/pulse \
 *     pnpm exec next start -p 3402
 *   BASE=http://127.0.0.1:3402 PULSE_PROXY_SECRET=<o mesmo> \
 *     node testes-navegador/saida-ponta-a-ponta.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3402'
const SEGREDO = process.env.PULSE_PROXY_SECRET
const EMAIL = process.env.PULSE_EMAIL ?? 'stack@alloyal.com.br'

// A trava, antes de qualquer coisa. Um endereço que não seja loopback é produção
// ou algo parecido com produção, e este arquivo escreve.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(BASE)) {
  console.error(
    `RECUSADO: BASE=${BASE} não é loopback. Este teste SUBMETE formulário e criaria ` +
      `pedido de cancelamento de verdade. Suba um Postgres descartável e um next dev local.`,
  )
  process.exit(2)
}

const navegador = await chromium.launch()
const ctx = await navegador.newContext({
  viewport: { width: 1440, height: 1000 },
  isMobile: false,
  // Os cabeçalhos que o oauth2-proxy injetaria. Com `next start` a identidade de
  // desenvolvimento não vale (ela exige NODE_ENV != production, e bem), então a
  // sessão vem por aqui.
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

/** O texto todo da aba, para procurar valor dentro. */
const textoDe = async (rota) => {
  await pg.goto(BASE + rota, { waitUntil: 'networkidle' })
  return (await pg.locator('body').innerText()).replace(/\s+/g, ' ')
}

// ─── 1. O ponto de partida: tudo em zero ────────────────────────────────────
{
  const t = await textoDe('/saidas')
  conferir(t.includes('Nenhum pedido registrado'), 'quadro começa vazio')
  conferir(t.includes('Registrar levantada de mão'), 'o formulário de cadastro está na tela')
}

// ─── 2. Cadastrar a levantada de mão ────────────────────────────────────────
{
  await pg.goto(BASE + '/saidas', { waitUntil: 'networkidle' })

  const opcoes = await pg.locator('select[name="accountId"] option').allInnerTexts()
  const aurora = opcoes.find((o) => o.includes('Transportadora Aurora'))
  conferir(Boolean(aurora), 'a conta com faturamento aparece no select', aurora?.trim())
  // O MRR do mês passado tem de vir junto do nome: é o que a pessoa confere
  // antes de escolher, e é o valor que `anunciar` vai congelar.
  conferir(
    Boolean(aurora && /R\$\s*12\.500,00\/mês/.test(aurora)),
    'o select mostra o MRR faturado da conta',
  )

  await pg.selectOption('select[name="accountId"]', { label: aurora })
  await pg.selectOption('select[name="pedido"]', 'cancelar')
  await pg.fill('input[name="avisoPrevioDias"]', '60')
  await pg.selectOption('select[name="canal"]', 'reuniao')
  await pg.selectOption('select[name="motivo"]', 'custo')
  await pg.fill('input[name="quemComunicou"]', 'Diretora financeira do cliente')

  await Promise.all([
    pg.waitForURL(/\/saidas/, { waitUntil: 'networkidle' }),
    pg.getByRole('button', { name: 'Registrar' }).click(),
  ])

  const t = (await pg.locator('body').innerText()).replace(/\s+/g, ' ')
  conferir(!/erro|não|falh/i.test(t.slice(0, 200)) || t.includes('pedido registrado'), 'o cadastro respondeu sem erro')
  conferir(t.includes('Transportadora Aurora'), 'o cliente aparece no quadro')
  conferir(!t.includes('Nenhum pedido registrado'), 'o quadro deixou de estar vazio')
  // MRR congelado do CONTRATO (R$ 12.500) e não do faturado — a conta tem os dois,
  // e o contrato vence na ordem de resolução de `anunciar`.
  conferir(/R\$\s*12\.500,00/.test(t), 'o MRR foi congelado na levantada')
}

// ─── 3. Os KPI param de mostrar zero ────────────────────────────────────────
{
  const t = await textoDe('/saidas')
  conferir(/Churn de contas[^0-9]*1\b/.test(t), 'o KPI de churn de contas conta 1')
  conferir(t.includes('levantaram a mão'), 'e diz quanto MRR levantou a mão')
}

// ─── 4. A coorte pendura o pedido no mês do ANÚNCIO ─────────────────────────
{
  const t = await textoDe('/saidas?aba=coorte')
  conferir(!t.includes('nenhuma levantada foi registrada ainda'), 'a coorte saiu do estado vazio')
  conferir(/60 d/.test(t), 'o aviso prévio médio é o que foi digitado')
  conferir(t.includes('Churn no efeito'), 'a coluna de efeito existe')
  conferir(!t.includes('Reativaram'), 'e reativação NÃO está aqui — é assunto de Receita')
}

// ─── 5. Avançar a etapa move a coluna do quadro ─────────────────────────────
{
  await pg.goto(BASE + '/saidas', { waitUntil: 'networkidle' })
  const botao = pg.getByRole('button', { name: '→ financeiro' }).first()
  conferir(await botao.isVisible(), 'o quadro oferece mover para Informações financeiras')
  await Promise.all([
    pg.waitForURL(/\/saidas/, { waitUntil: 'networkidle' }),
    botao.click(),
  ])
  const t = (await pg.locator('body').innerText()).replace(/\s+/g, ' ')
  conferir(
    /Informações financeiras 1 pedido/.test(t),
    'o pedido está agora na coluna de informações financeiras',
  )
}

// ─── 6. A meta e o realizado, do mesmo pipeline ─────────────────────────────
{
  await pg.goto(BASE + '/saidas?aba=meta', { waitUntil: 'networkidle' })
  const mes = new Date().toISOString().slice(0, 7)
  await pg.fill('input[name="competencia"]', mes)
  await pg.fill('input[name="meta"]', '50.000,00')
  await Promise.all([
    pg.waitForURL(/\/saidas/, { waitUntil: 'networkidle' }),
    pg.getByRole('button', { name: 'Definir' }).click(),
  ])
  const t = (await pg.locator('body').innerText()).replace(/\s+/g, ' ')
  conferir(/R\$\s*50\.000,00/.test(t), 'a meta gravou e aparece na tabela')
  conferir(!t.includes('Nenhuma meta definida no período'), 'e o aviso de "sem meta" saiu')
  // O realizado continua zero: o pedido está em etapa de trabalho, a receita
  // ainda entra. É a distinção que a tela existe para mostrar.
  conferir(
    /Sem meta|R\$ 0,00/.test(t),
    'o realizado do mês do anúncio é zero — a receita ainda não parou',
  )
}

await navegador.close()
console.log(
  falhas === 0
    ? '\na corrente inteira acende: formulário → anunciar → banco → as quatro visões'
    : `\n${falhas} verificações falharam`,
)
process.exit(falhas === 0 ? 0 : 1)
