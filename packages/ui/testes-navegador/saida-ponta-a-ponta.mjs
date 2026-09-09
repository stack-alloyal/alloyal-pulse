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
 * │ O PASSO 5 ESTEVE VERMELHO, e o diagnóstico inicial estava errado duas vezes.│
 * │                                                                            │
 * │ `avancarEtapa` recusava com violação de `cancellation_estado_check`. A       │
 * │ primeira leitura foi que a restrição não conhecia o estado `financeiro` —    │
 * │ errada: medido em produção, o CHECK lista os oito estados. A segunda foi     │
 * │ que "o formulário do quadro tem dois botões e `dados.get('para')` volta      │
 * │ vazio" — certa no sintoma, errada na causa. Não era o formulário: é que o    │
 * │ par name/value do botão que SUBMETE não entra no FormData de uma Server      │
 * │ Action. O HTML manda incluir; o React não inclui.                           │
 * │                                                                            │
 * │ Consertado em 09/09/2026: o destino vai LIGADO por `formAction={acao.bind    │
 * │ (null, e)}`, e a ação valida contra as três etapas antes de tocar no banco.  │
 * │ Provado pelos dois lados — com o código do HEAD o estado ficava              │
 * │ `anunciado`; com a correção, `financeiro`.                                  │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ SEIS FALHAS ERAM DO TESTE, e pareciam defeito de produto.                  │
 * │                                                                            │
 * │ 1. CAIXA. `innerText` devolve o texto RENDERIZADO, e o design system aplica │
 * │    `text-transform: uppercase`: no HTML "Churn no efeito", na tela          │
 * │    "CHURN NO EFEITO". Três asserções comparavam com a caixa da FONTE. Daí   │
 * │    `tem()` e `casa()`.                                                     │
 * │ 2. MOMENTO. Três asserções liam o `innerText` do instante do POST, antes de │
 * │    o quadro revalidar — e a da meta lia a aba errada, porque a Server        │
 * │    Action redireciona para `/saidas` sem o `?aba=meta`. Agora RELEEM.       │
 * │ 3. LAYOUT. `/Informações financeiras 1 pedido/` media um layout que a tela  │
 * │    não tem: cada coluna é "rótulo · descrição · N pedido(s)".               │
 * │                                                                            │
 * │ Vale registrar porque o custo delas foi real: seis falhas vermelhas fizeram │
 * │ o fluxo parecer quebrado quando três visões estavam corretas na tela.       │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Como rodar (o preparo inteiro, em ordem):
 *
 *   docker run -d --name pulse-pg-e2e -e POSTGRES_PASSWORD=teste \
 *     -e POSTGRES_DB=pulse -p 127.0.0.1:5457:5432 postgres:16
 *   export DATABASE_URL_ADMIN=postgres://postgres:teste@127.0.0.1:5457/pulse
 *   pnpm --filter @pulse/db build && pnpm --filter @pulse/db migrate
 *   node packages/db/dist/primeiro-admin-cli.js stack@alloyal.com.br
 *
 *   # A MASSA. Era prosa aqui ("duas contas ativas, contrato numa, …") e prosa
 *   # não roda: o teste espera nome e valor EXATOS. Ver infra/massa-saida-e2e.sql,
 *   # que também explica por que `make seed` NÃO basta (ele não popula Omie, e
 *   # `analytics.mrr_faturado_mes` é view sobre o Omie — sem isso o select do
 *   # cadastro fica vazio e sete asserções caem por falta de massa).
 *   docker exec -i pulse-pg-e2e psql -U postgres -d pulse -f - < infra/massa-saida-e2e.sql
 *
 *   pnpm build --filter @pulse/web-internal
 *   cd apps/web-internal && NODE_ENV=production PULSE_PROXY_SECRET=<qualquer> \
 *     DATABASE_URL=postgres://postgres:teste@127.0.0.1:5457/pulse \
 *     pnpm exec next start -p 3402
 *
 *   # ⚠ TABELA LIMPA a cada execução: o passo 1 afirma "quadro começa vazio".
 *   docker exec pulse-pg-e2e psql -U postgres -d pulse \
 *     -c 'TRUNCATE success.cancellation CASCADE; TRUNCATE success.meta_churn;'
 *   cd packages/ui && BASE=http://127.0.0.1:3402 PULSE_PROXY_SECRET=<o mesmo> \
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

/**
 * O texto todo da aba, para procurar valor dentro.
 *
 * ⚠ `innerText` devolve o texto RENDERIZADO, e o design system aplica
 * `text-transform: uppercase` nos rótulos e cabeçalhos: no HTML está "Churn no
 * efeito", na tela está "CHURN NO EFEITO". Três asserções deste arquivo
 * falhavam por isso e PARECIAM defeito de produto — medido em 09/09/2026, com a
 * coluna presente e correta na tela. Daí `tem()` e `casa()` abaixo, que
 * comparam sem caixa; comparar com a caixa do HTML é medir a fonte, não a tela.
 */
const textoDe = async (rota) => {
  await pg.goto(BASE + rota, { waitUntil: 'networkidle' })
  return (await pg.locator('body').innerText()).replace(/\s+/g, ' ')
}

/** Contém, sem caixa. */
const tem = (t, agulha) => t.toLowerCase().includes(agulha.toLowerCase())
/** Casa, sem caixa. */
const casa = (t, re) => new RegExp(re.source, re.flags.includes('i') ? re.flags : re.flags + 'i').test(t)

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

  const resposta = (await pg.locator('body').innerText()).replace(/\s+/g, ' ')
  conferir(!/erro|não|falh/i.test(resposta.slice(0, 200)) || tem(resposta, 'pedido registrado'), 'o cadastro respondeu sem erro')

  /* RELÊ a tela, em vez de medir o innerText do instante do POST. A resposta da
     Server Action chega antes de o quadro revalidar, então "Nenhum pedido
     registrado" ainda estava lá — e a asserção acusava um quadro vazio que, na
     recarga seguinte, já mostrava o pedido. Era o teste medindo o meio do
     caminho. */
  const t = await textoDe('/saidas')
  conferir(tem(t, 'Transportadora Aurora'), 'o cliente aparece no quadro')
  conferir(!tem(t, 'Nenhum pedido registrado'), 'o quadro deixou de estar vazio')
  // MRR congelado do CONTRATO (R$ 12.500) e não do faturado — a conta tem os dois,
  // e o contrato vence na ordem de resolução de `anunciar`.
  conferir(casa(t, /R\$\s*12\.500,00/), 'o MRR foi congelado na levantada')
}

// ─── 3. Os KPI param de mostrar zero ────────────────────────────────────────
{
  const t = await textoDe('/saidas')
  conferir(casa(t, /churn de contas[^0-9]*(?:\d{4}-\d{2})?[^0-9]*1\b/), 'o KPI de churn de contas conta 1')
  conferir(tem(t, 'levantaram a mão'), 'e diz quanto MRR levantou a mão')
}

// ─── 4. A coorte pendura o pedido no mês do ANÚNCIO ─────────────────────────
{
  const t = await textoDe('/saidas?aba=coorte')
  conferir(!tem(t, 'nenhuma levantada foi registrada ainda'), 'a coorte saiu do estado vazio')
  conferir(casa(t, /60 d/), 'o aviso prévio médio é o que foi digitado')
  conferir(tem(t, 'Churn no efeito'), 'a coluna de efeito existe')
  conferir(!tem(t, 'Reativaram'), 'e reativação NÃO está aqui — é assunto de Receita')
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
  /* Relê, pelo mesmo motivo do passo 2. E a contagem NÃO fica colada ao rótulo:
     cada coluna do quadro é "rótulo · descrição · N pedido(s)", então
     `/Informações financeiras 1 pedido/` nunca casaria — media um layout que a
     tela não tem. O que prova a movimentação é o par rótulo→contagem na MESMA
     coluna, com a descrição no meio. */
  const t = await textoDe('/saidas')
  conferir(
    casa(t, /informações financeiras[^·]*?\b1 pedido/),
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
  /* RELÊ `?aba=meta`. A Server Action redireciona para `/saidas` sem o parâmetro,
     então depois de gravar a aba visível é o Quadro — a tabela da meta continua
     no HTML e não está RENDERIZADA, e `innerText` não a vê. A meta havia
     gravado (conferido em success.meta_churn); o teste estava olhando a aba
     errada. */
  const t = await textoDe('/saidas?aba=meta')
  conferir(casa(t, /R\$\s*50\.000,00/), 'a meta gravou e aparece na tabela')
  conferir(!tem(t, 'Nenhuma meta definida no período'), 'e o aviso de "sem meta" saiu')
  // O realizado continua zero: o pedido está em etapa de trabalho, a receita
  // ainda entra. É a distinção que a tela existe para mostrar.
  conferir(
    casa(t, /Sem meta|R\$ 0,00/),
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
