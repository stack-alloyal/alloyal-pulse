import {
  DIAS_PARA_ESTAGNAR,
  MOTIVOS_SAIDA,
  POSICOES,
  type ContaParaSaida,
  type LinhaDaMeta,
  type MesDaCoorte,
  type PedidoNoQuadro,
  COLUNAS_DO_FUNIL,
  type ContaNoFunil,
  type MesObservado,
  type SaidaSemRegistro,
} from '@pulse/success'
import { Badge, Btn, Card, Field, Select, Table, Vazio, cn } from '@pulse/ui'
import Link from 'next/link'

import { acaoAvancarEtapa, acaoDefinirMeta, registrarPedido } from './acoes'
import { EscolherConta } from './escolher-conta'
import { CAMPO_DE_VOLTA } from './volta'

/**
 * O campo escondido que diz para onde a ação devolve.
 *
 * Existe como componente para o nome do campo aparecer em UM lugar: dez
 * formulários com a string à mão é a lista duplicada que diverge no primeiro
 * rename. O valor é validado contra lista de permissão em `acoes.ts` — ver o
 * comentário de `TELAS_DO_FLUXO` para por que não se sanitiza.
 */
export function CampoDeVolta({ para }: { para: string }) {
  return <input type="hidden" name={CAMPO_DE_VOLTA} value={para} />
}

/**
 * As três visões do fluxo de saída: o quadro, a coorte e a meta.
 *
 * Arquivo próprio porque a tela de saídas já tem 353 linhas com os KPI, a lista e
 * cinco formulários. Empilhar três visões ali dentro faria um arquivo em que
 * ninguém acha nada — e as três são independentes entre si.
 */

const BRL = (c: string | number | null) =>
  c === null ? '—' : (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const N = (n: number) => n.toLocaleString('pt-BR')
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MES = (iso: string) => {
  const [a, m] = iso.split('-')
  return `${MESES[Number(m) - 1] ?? m}/${a?.slice(2)}`
}

/* ─── Cadastro da levantada de mão ──────────────────────────────────────────── */

/**
 * O formulário que abre um pedido de saída — a porta de entrada do fluxo todo.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ESTE FORMULÁRIO NÃO EXISTIA, e é por isso que a tela estava zerada.         │
 * │                                                                            │
 * │ A ação de servidor `registrarPedido` foi escrita, testada e publicada sem    │
 * │ nada que a chamasse: nenhum `<form>` na app apontava para ela. Com a única   │
 * │ porta de entrada ausente, `success.cancellation` ficou em zero linha, e daí  │
 * │ saíram TODOS os zeros da tela — os quatro KPI, o quadro, a lista e o lado    │
 * │ do anúncio na coorte. Ação sem formulário é função morta, e função morta     │
 * │ passa em todo teste de unidade.                                            │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A DATA DA LEVANTADA É OBRIGATÓRIA e o MRR não é.                            │
 * │                                                                            │
 * │ `anunciar` recusa origem `cliente` sem data, porque a data do anúncio É o    │
 * │ churn de contas — sem ela a coorte não tem em que mês pendurar o pedido. O   │
 * │ MRR, ao contrário, ele resolve sozinho: contrato, depois faturado dos dois   │
 * │ últimos meses. O campo só aparece pedindo valor quando as duas fontes não    │
 * │ têm resposta, e aí ele é obrigatório — sem MRR congelado não há churn de     │
 * │ receita, só uma linha no quadro.                                           │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export function Registrar({
  contas,
  hoje,
  volta,
}: {
  contas: readonly ContaParaSaida[]
  hoje: string
  volta: string
}) {
  const semMrr = contas.filter((c) => c.mrrCentavos === null).length
  return (
    <Card title="Registrar levantada de mão">
      {contas.length === 0 ? (
        <p className="text-corpo leading-relaxed text-ink-2">
          Nenhuma conta disponível para abrir pedido. A lista traz as contas ativas que faturaram
          nos últimos doze meses e ainda não têm saída em andamento — se está vazia, ou todas já
          estão no quadro, ou o faturamento não foi carregado.
        </p>
      ) : (
        <>
          <form action={registrarPedido} className="grid gap-3">
            <CampoDeVolta para={volta} />
            {/* O cliente em LINHA PRÓPRIA. Com o campo de busca mais a lista ele
                ficou três vezes mais alto que um select comum, e no `items-end`
                da mesma linha empurrava "Pedido" e "Origem" para o pé dele —
                visto na renderização. */}
            <div className="max-w-[34em]">
              <EscolherConta contas={contas} />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Select label="Pedido" name="pedido" defaultValue="cancelar" className="w-44">
                <option value="cancelar">Cancelamento</option>
                <option value="desconto">Desconto</option>
              </Select>
              <Select label="Origem" name="origem" defaultValue="cliente" className="w-40">
                <option value="cliente">O cliente pediu</option>
                <option value="alloyal">Alloyal (PDD)</option>
              </Select>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <Field
                label="Data da levantada"
                name="dataLevantada"
                type="date"
                required
                max={hoje}
                defaultValue={hoje}
                className="w-44"
              />
              <Field
                label="Aviso prévio (dias)"
                name="avisoPrevioDias"
                type="number"
                min={0}
                max={365}
                placeholder="30"
                className="w-40"
              />
              <Field
                label="MRR (R$, se a lista pedir)"
                name="mrr"
                type="text"
                inputMode="decimal"
                placeholder="4.500,00"
                className="w-48"
              />
              <Select label="Canal" name="canal" defaultValue="" className="w-40">
                <option value="">não informado</option>
                <option value="email">E-mail</option>
                <option value="reuniao">Reunião</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="telefone">Telefone</option>
                <option value="formulario">Formulário</option>
              </Select>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <Select label="Motivo" name="motivo" defaultValue="" className="w-56">
                <option value="">a classificar</option>
                {MOTIVOS_SAIDA.map((m) => (
                  <option key={m.valor} value={m.valor}>
                    {m.rotulo}
                  </option>
                ))}
              </Select>
              <div className="min-w-[14em] flex-1">
                <Field
                  label="Quem comunicou"
                  name="quemComunicou"
                  type="text"
                  placeholder="nome de quem avisou, do lado do cliente"
                />
              </div>
              <div className="min-w-[14em] flex-1">
                <Field label="Detalhe do motivo" name="motivoDetalhe" type="text" placeholder="obrigatório em Outro" />
              </div>
              <Btn type="submit">Registrar</Btn>
            </div>
          </form>

          <p className="mt-3 max-w-[80ch] text-meta leading-relaxed text-ink-3">
            O <strong className="font-semibold text-ink">aviso prévio</strong> é digitado porque nem o
            Omie nem o cadastro guardam prazo de aviso — e é ele que decide em que mês a receita
            para. Sem ele, o pedido entra no quadro e fica sem data de fim.
            {semMrr > 0 && (
              <>
                {' '}
                {semMrr === 1 ? 'Uma conta da lista' : `${N(semMrr)} contas da lista`} não faturaram
                nos últimos dois meses e aparecem como{' '}
                <strong className="font-semibold text-ink">MRR a informar</strong>: para essas, o
                valor tem de ser digitado, senão não há o que congelar.
              </>
            )}
          </p>
        </>
      )}
    </Card>
  )
}

/* ─── O quadro ──────────────────────────────────────────────────────────────── */

/**
 * As oito posições em colunas, e o tipo de cada uma dito no cabeçalho.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ETAPA E DESFECHO SÃO PINTADOS DIFERENTE porque são coisas diferentes.       │
 * │                                                                            │
 * │ As três primeiras colunas são trabalho: elas devem esvaziar. As cinco       │
 * │ últimas são registro: elas só crescem. Pintá-las igual faria o quadro       │
 * │ parecer cheio de trabalho quando está cheio de história — e é assim que um   │
 * │ quadro deixa de ser olhado.                                                │
 * │                                                                            │
 * │ Nenhuma coluna é verde. Reversão é a vitória do time, e mesmo ela não é     │
 * │ verde: no design system verde significa "saudável", e um cliente que pediu   │
 * │ para sair e ficou não é o mesmo que um cliente que nunca pensou em sair.     │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export function Quadro({ pedidos, volta }: { pedidos: readonly PedidoNoQuadro[]; volta: string }) {
  const porPosicao = new Map(POSICOES.map((p) => [p.id, [] as PedidoNoQuadro[]]))
  for (const p of pedidos) porPosicao.get(p.posicao)?.push(p)

  const etapas = POSICOES.filter((p) => p.tipo === 'etapa')
  const desfechos = POSICOES.filter((p) => p.tipo !== 'etapa')
  const estagnados = pedidos.filter((p) => p.estagnado).length

  return (
    <div className="grid gap-5">
      {estagnados > 0 && (
        <Card title={`Parados há ${DIAS_PARA_ESTAGNAR} dias ou mais · ${N(estagnados)}`}>
          <p className="text-corpo leading-relaxed text-ink-2">
            Um pedido parado numa etapa é um cancelamento que ninguém quis anunciar. O prazo é de{' '}
            <strong className="font-semibold text-ink">{DIAS_PARA_ESTAGNAR} dias</strong> porque é
            menor que o menor aviso prévio praticado — o pedido aparece aqui enquanto ainda há tempo
            de agir.
          </p>
          <ul className="mt-3 grid gap-2">
            {pedidos
              .filter((p) => p.estagnado)
              .map((p) => (
                <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2 last:border-0">
                  <Link href={`/contas/${p.accountId}`} className="font-medium text-purple-700 hover:underline">
                    {p.razaoSocial}
                  </Link>
                  <span className="text-cartao tabular-nums text-ink-2">
                    {N(p.diasNaEtapa)} dias em{' '}
                    {POSICOES.find((x) => x.id === p.posicao)?.rotulo.toLowerCase()} ·{' '}
                    <strong className="font-semibold text-ink">{BRL(p.mrrCentavos)}</strong>
                  </span>
                </li>
              ))}
          </ul>
        </Card>
      )}

      <Card title="Em trabalho">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {etapas.map((pos) => (
            <Coluna key={pos.id} pos={pos} itens={porPosicao.get(pos.id) ?? []} volta={volta} />
          ))}
        </div>
      </Card>

      <Card title="Desfechos">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {desfechos.map((pos) => (
            <Coluna key={pos.id} pos={pos} itens={porPosicao.get(pos.id) ?? []} volta={volta} />
          ))}
        </div>
        <p className="mt-3 text-meta leading-relaxed text-ink-3">
          <strong className="font-semibold text-ink">Três desfechos salvam o cliente</strong> —
          revertido, desconto e renegociação — e apenas os dois últimos são perda. No ledger de
          receita, desconto entra como <strong className="font-semibold text-ink">contração</strong>{' '}
          e não como churn: somá-lo ao churn contaria como perdido um cliente que está na base.
        </p>
      </Card>
    </div>
  )
}

const TOM_DA_POSICAO = {
  etapa: 'border-l-purple-500',
  salvo: 'border-l-purple-700',
  perda: 'border-l-red',
} as const

function Coluna({
  pos,
  itens,
  volta,
}: {
  pos: (typeof POSICOES)[number]
  itens: readonly PedidoNoQuadro[]
  volta: string
}) {
  const soma = itens.reduce((s, p) => s + Number(p.mrrCentavos ?? 0), 0)
  return (
    <div className={cn('min-w-0 rounded-lg border border-line border-l-4 bg-surface-2 p-3', TOM_DA_POSICAO[pos.tipo])}>
      <h4 className="text-cartao font-semibold leading-snug text-ink">{pos.rotulo}</h4>
      <p className="mt-0.5 text-nota leading-relaxed text-ink-3">{pos.explica}</p>
      <p className="mt-2 text-meta tabular-nums text-ink-2">
        {N(itens.length)} {itens.length === 1 ? 'pedido' : 'pedidos'}
        {soma > 0 && <> · {BRL(soma)}</>}
      </p>
      <ul className="mt-2 grid gap-2">
        {itens.slice(0, 8).map((p) => (
          <li key={p.id} className="rounded border border-line bg-surface p-2">
            <Link href={`/contas/${p.accountId}`} className="block truncate text-cartao font-medium text-purple-700 hover:underline">
              {p.razaoSocial}
            </Link>
            <span className="mt-0.5 block text-nota tabular-nums text-ink-3">
              {BRL(p.mrrCentavos)}
              {p.mrrNovoCentavos && <> → {BRL(p.mrrNovoCentavos)}</>}
              {p.dataLevantada && <> · {p.dataLevantada.split('-').reverse().join('/')}</>}
            </span>
            {p.estagnado && (
              <span className="mt-1 block text-nota text-red">parado há {N(p.diasNaEtapa)} dias</span>
            )}
            {pos.tipo === 'etapa' && (
              <form className="mt-1.5 flex flex-wrap gap-1.5">
                <input type="hidden" name="id" value={p.id} />
                <CampoDeVolta para={volta} />
                {/* A posição de trabalho mapeia 1:1 no estado, e só `pedido` tem
                    nome diferente do dele (`anunciado`). O botão da etapa atual
                    não aparece: mover para onde já se está é um clique que não faz
                    nada, e um botão que não faz nada ensina a não clicar. */}
                {(['anunciado', 'financeiro', 'reversao'] as const)
                  .filter((e) => e !== (p.posicao === 'pedido' ? 'anunciado' : p.posicao))
                  .map((e) => (
                    /* O destino vai LIGADO no `formAction`, e não em `name="para"`:
                       o par do botão que submete não entra no FormData de uma
                       Server Action. Ver o comentário de `acaoAvancarEtapa`.

                       ds-excecao: botão de SUBMIT com `formAction` próprio — `Btn`
                       não carrega formAction, e um formulário por destino
                       duplicaria o campo `id` em cada cartão. */
                    <button
                      key={e}
                      type="submit"
                      formAction={acaoAvancarEtapa.bind(null, e)}
                      className="rounded border border-line-strong bg-surface px-1.5 py-0.5 text-nota text-ink-2 hover:border-purple-500 hover:text-purple-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-500"
                    >
                      → {e === 'anunciado' ? 'pedido' : e === 'financeiro' ? 'financeiro' : 'reversão'}
                    </button>
                  ))}
              </form>
            )}
          </li>
        ))}
        {itens.length > 8 && (
          <li className="text-nota text-ink-3">e mais {N(itens.length - 8)} — ver na lista abaixo</li>
        )}
      </ul>
    </div>
  )
}

/* ─── A coorte ──────────────────────────────────────────────────────────────── */

/**
 * As duas coortes lado a lado, e a distância entre elas é o aviso prévio.
 *
 * A de ANÚNCIO é o mês em que a mão subiu; a de EFEITO é o mês em que a receita
 * para. Juntar numa coluna faria junho aparecer com saídas anunciadas em abril —
 * deslocadas pelo tamanho do aviso, que varia por contrato.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ AS DUAS VÊM DO MESMO PIPELINE, e antes não vinham.                         │
 * │                                                                            │
 * │ A coluna de efeito lia `fact.mrr_event`, o ledger derivado do faturamento   │
 * │ do Omie. Dava história de cinco anos e uma tabela que misturava duas        │
 * │ definições de churn: o ledger sabe que a receita parou, não POR QUÊ, e      │
 * │ cliente que passou a pagar trimestralmente entra lá como saída. Numa coorte │
 * │ de saída as duas colunas têm de ser o MESMO caso nos dois lados, senão a    │
 * │ distância entre elas não é aviso prévio nenhum.                            │
 * │                                                                            │
 * │ O preço é começar vazia e preencher conforme o time usa o pipeline. É o     │
 * │ preço certo: coorte que já vem cheia de um número que ninguém registrou     │
 * │ ensina a confiar no número errado.                                         │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
/**
 * ─── O funil: o kanban que se preenche sozinho ───────────────────────────────
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ DUAS CAMADAS, e a de baixo nunca inventa decisão humana.                   │
 * │                                                                            │
 * │ A COLUNA afirma o que o dinheiro fez — atrasou, encolheu, parou. O SELO    │
 * │ afirma o que alguém registrou, e só existe quando existe registro. É o que  │
 * │ deixa o quadro nascer cheio sem afirmar um aviso que ninguém deu.           │
 * │                                                                            │
 * │ Medido em 10/09/2026: 398 contas, R$ 1.432.203,00, zero selos. O `null` do  │
 * │ selo é honesto — significa "ninguém disse nada", não "está tudo bem".       │
 * │                                                                            │
 * │ Ver `funilDeSaida` para por que as colunas não podem ser as do pipeline.    │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
const SELO: Record<string, string> = {
  anunciado: 'pedido registrado',
  financeiro: 'em informações financeiras',
  reversao: 'em tentativa de reversão',
  em_aviso: 'aviso prévio correndo',
}

/** Quantos cartões por coluna antes de resumir. O mesmo do quadro do pipeline. */
const CARTOES_POR_COLUNA = 8

function CartaoDoFunil({ c }: { c: ContaNoFunil }) {
  return (
    /* `min-w-0` AQUI TAMBÉM, e não só na coluna: o `<ul>` é grid, então o `<li>`
       é item de grid e herda `min-width: auto` — ele cresce até caber o
       `min-content` do nome, que com `white-space: nowrap` do `truncate` é o
       texto INTEIRO. Pôr `min-w-0` só na coluna não bastou: medido na
       renderização, 32 nomes seguiam vazando a borda do cartão. */
    <li className="min-w-0 rounded-md border border-line bg-surface p-2">
      <Link
        href={`/contas/${c.accountId}`}
        prefetch={false}
        className="block truncate font-medium text-cartao text-purple-700 hover:underline"
      >
        {c.razaoSocial}
      </Link>
      <span className="mt-0.5 block text-nota tabular-nums text-ink-2">{BRL(c.mrrCentavos)}/mês</span>

      {/* O SINAL da coluna, em número. "Em atraso" sem dizer quanto e há quantos
          dias manda a pessoa abrir a conta para descobrir se é R$ 0,02 ou
          R$ 31 mil — e medido, uma das 55 é de dois centavos. */}
      {c.diasEmAtraso !== null && (
        <span className="mt-0.5 block text-nota tabular-nums text-amber-800">
          {BRL(c.abertoCentavos)} vencidos · {N(c.diasEmAtraso)} dias
        </span>
      )}
      {Number(c.quedaCentavos) > 0 && (
        <span className="mt-0.5 block text-nota tabular-nums text-ink-3">
          caiu {BRL(c.quedaCentavos)}
        </span>
      )}

      {/* A camada de cima. Ausente é o caso comum, e não se desenha nada: um
          selo "sem registro" em 398 cartões seria ruído em todo o quadro. */}
      {c.estadoNoPipeline !== null && (
        <span className="mt-1 block">
          <Badge tone="indigo">{SELO[c.estadoNoPipeline] ?? c.estadoNoPipeline}</Badge>
        </span>
      )}
    </li>
  )
}

export function Funil({ contas }: { contas: readonly ContaNoFunil[] }) {
  const porColuna = new Map(COLUNAS_DO_FUNIL.map((c) => [c.id, [] as ContaNoFunil[]]))
  for (const c of contas) porColuna.get(c.coluna)?.push(c)
  const comSelo = contas.filter((c) => c.estadoNoPipeline !== null).length
  const total = contas.reduce((s, c) => s + Number(c.mrrCentavos), 0)
  /* As colunas que pedem ação hoje — todas menos "sem sinal". É o número que
     responde "quanto do meu faturamento está dando sinal de saída". */
  const emRisco = contas.filter((c) => c.coluna !== 'saudavel')

  return (
    <div className="grid gap-5">
      <Card title="Funil de saída">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {COLUNAS_DO_FUNIL.map((col) => {
            const itens = porColuna.get(col.id) ?? []
            const soma = itens.reduce((s, c) => s + Number(c.mrrCentavos), 0)
            return (
              <div
                key={col.id}
                className={cn(
                  /* `min-w-0` porque a trilha `1fr` do grid é `minmax(auto, 1fr)`:
                     sem ele o conteúdo alarga a coluna e o `truncate` do nome não
                     tem largura definida para cortar. Visto na renderização —
                     "HINOVA MOBILE SERVICOS LT" vazava a borda sem elipse. */
                  'min-w-0 rounded-md border-l-2 bg-surface-2 p-3',
                  col.tom === 'red'
                    ? 'border-l-red'
                    : col.tom === 'amber'
                      ? 'border-l-amber-700'
                      : 'border-l-green',
                )}
              >
                <h4 className="text-cartao font-semibold leading-snug text-ink">{col.rotulo}</h4>
                <p className="mt-0.5 text-nota leading-snug text-ink-3">{col.proposito}</p>
                <p className="mt-1.5 text-nota tabular-nums text-ink-2">
                  {N(itens.length)} {itens.length === 1 ? 'conta' : 'contas'}
                  {soma > 0 && <> · {BRL(String(soma))}</>}
                </p>
                <ul className="mt-2 grid gap-2">
                  {itens.slice(0, CARTOES_POR_COLUNA).map((c) => (
                    <CartaoDoFunil key={c.accountId} c={c} />
                  ))}
                  {itens.length > CARTOES_POR_COLUNA && (
                    <li className="text-nota text-ink-3">
                      e mais {N(itens.length - CARTOES_POR_COLUNA)}
                    </li>
                  )}
                </ul>
              </div>
            )
          })}
        </div>

        <p className="mt-4 max-w-[80ch] text-meta leading-relaxed text-ink-3">
          As colunas vêm do <strong className="font-semibold text-ink">faturamento</strong>: elas
          dizem o que o dinheiro fez — atrasou, encolheu, parou. O{' '}
          <strong className="font-semibold text-ink">selo</strong> do cartão diz o que alguém
          registrou no fluxo, e só aparece quando há registro.{' '}
          {comSelo === 0 ? (
            <>
              Hoje <strong className="font-semibold text-ink">nenhuma das {N(contas.length)}</strong>{' '}
              tem registro — e cartão sem selo significa &ldquo;ninguém disse nada&rdquo;, não
              &ldquo;está tudo bem&rdquo;.
            </>
          ) : (
            <>
              {N(comSelo)} de {N(contas.length)} têm registro no fluxo.
            </>
          )}{' '}
          Coluna nenhuma afirma levantada de mão: levantar a mão é alguém{' '}
          <strong className="font-semibold text-ink">avisando</strong>, e acontece antes de o
          dinheiro parar — o faturamento não vê isso, e inventá-lo aqui seria pior que deixar
          vazio.
        </p>
        <p className="mt-2 max-w-[80ch] text-meta leading-relaxed text-ink-3">
          {N(emRisco.length)} de {N(contas.length)} contas dando algum sinal, somando{' '}
          <strong className="font-semibold text-ink">
            {BRL(String(emRisco.reduce((s, c) => s + Number(c.mrrCentavos), 0)))}
          </strong>{' '}
          de {BRL(String(total))} da base ativa. Quem já passou da janela de apuração não está
          aqui: virou saída confirmada, e vive na aba{' '}
          <strong className="font-semibold text-ink">Reconciliação</strong>.
        </p>
      </Card>
    </div>
  )
}

/**
 * ─── Reconciliação: o que o faturamento mostra e o fluxo não registrou ───────
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POR QUE ESTA ABA EXISTE, e por que ela não é "a coorte com outro nome".   │
 * │                                                                            │
 * │ A coorte conta PEDIDOS: quem levantou a mão, quando, e por quê. É manual e │
 * │ começa vazia — foi a decisão de 28/08, e o preço estava escrito.           │
 * │                                                                            │
 * │ Esta conta CONTAS: de quem o dinheiro parou de entrar. Vem do faturamento, │
 * │ é automática, e não sabe o motivo. As duas juntas respondem a pergunta que │
 * │ nenhuma responde sozinha — "de quem paramos de receber sem saber por quê?" │
 * │                                                                            │
 * │ Medido em 10/09/2026, e é o número que justifica a aba: 794 contas pararam │
 * │ de faturar somando R$ 2.178.523,85, e ZERO tinham registro. Dessas, 165    │
 * │ seguem marcadas como ATIVAS no cadastro. O formulário existia, funcionava e │
 * │ estava vazio — porque ninguém sabia quem registrar.                        │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export function Reconciliacao({
  meses,
  contas,
  maturidade,
}: {
  meses: readonly MesObservado[]
  contas: readonly SaidaSemRegistro[]
  maturidade: number
}) {
  const maduros = meses.filter((m) => m.maduro)
  const totalContas = maduros.reduce((x, m) => x + m.contas, 0)
  const totalReais = maduros.reduce((x, m) => x + Number(m.receitaPerdidaCentavos), 0)
  const totalRegistrado = maduros.reduce((x, m) => x + m.comRegistro, 0)
  const ativas = contas.filter((c) => c.aindaAtiva).length
  /* O total vem da consulta, não do tamanho da página: são 794 em produção e a
     página mostra 200. Contar o array diria 200 com cara de total. */
  const total = contas[0]?.total ?? 0

  return (
    <div className="grid gap-5">
      <Card title="Churn observado no faturamento">
        <Table
          cols={['Mês', 'Contas', 'Receita que parou', 'Com registro no fluxo', 'Sem registro']}
          rows={meses.map((m) => [
            <span className="whitespace-nowrap font-semibold tabular-nums">{MES(m.mes)}</span>,
            /* Mês dentro da carência mostra "em apuração", NUNCA zero. Zero é uma
               afirmação — diria que ninguém saiu, quando a verdade é que ainda não
               se sabe: medido, ~11% das contas voltam a faturar em até 3 meses. */
            m.maduro ? (
              <span className="tabular-nums">{m.contas === 0 ? '—' : N(m.contas)}</span>
            ) : (
              <Badge tone="slate">em apuração</Badge>
            ),
            <span className="tabular-nums">
              {m.maduro && m.contas > 0 ? BRL(m.receitaPerdidaCentavos) : '—'}
            </span>,
            <span className="tabular-nums">{m.maduro ? m.comRegistro || '—' : '—'}</span>,
            <span className="tabular-nums">
              {m.maduro && m.contas - m.comRegistro > 0 ? (
                <strong className="font-semibold text-amber-800">{N(m.contas - m.comRegistro)}</strong>
              ) : (
                '—'
              )}
            </span>,
          ])}
        />
        <p className="mt-3 max-w-[80ch] text-meta leading-relaxed text-ink-3">
          Este número vem do <strong className="font-semibold text-ink">faturamento</strong>, e não
          do fluxo: ele sabe <strong className="font-semibold text-ink">quando o dinheiro parou</strong>{' '}
          de entrar, e não sabe por quê. Os últimos {N(maturidade)} meses ficam{' '}
          <strong className="font-semibold text-ink">em apuração</strong> de propósito — medido, uma
          conta em cada nove volta a faturar dentro de três meses, e chamar isso de saída seria
          afirmar o que ainda não se sabe.{' '}
          {totalContas > 0 && (
            <>
              No período maduro: {N(totalContas)} conta(s) e {BRL(String(totalReais))}, das quais{' '}
              {totalRegistrado === 0 ? (
                <strong className="font-semibold text-ink">nenhuma</strong>
              ) : (
                N(totalRegistrado)
              )}{' '}
              com registro no fluxo.
            </>
          )}
        </p>
      </Card>

      <Card
        title={
          total > contas.length
            ? `Sem registro no fluxo (${N(contas.length)} de ${N(total)})`
            : `Sem registro no fluxo (${N(total)})`
        }
      >
        {contas.length === 0 ? (
          <Vazio
            titulo="Todo churn do faturamento tem registro."
            porque="Cada conta que parou de faturar tem um pedido no fluxo dizendo por quê. É o estado que esta aba existe para alcançar."
            className="border-0 p-0"
          />
        ) : (
          <>
            <Table
              cols={['Mês', 'Conta', 'Receita que parou', 'Cadastro']}
              rows={contas.map((c) => [
                <span className="whitespace-nowrap tabular-nums">{MES(c.competencia)}</span>,
                /* `/contas/<id>`, e NÃO `/carteira/<id>`: a primeira versão desta
                   linha apontava para uma rota que não existe, e devolvia 404 —
                   achado pelo navegador, porque `curl` na página não segue link.
                   `/carteira/base/<id>` é o cadastro; `/contas/<id>` é a página
                   onde se age, e responde em 147ms contra 330ms.

                   `prefetch={false}` porque são até 200 linhas: com o padrão, o
                   Next pré-carrega toda conta que entra na janela — 200 páginas
                   de conta para quem só quer ler a lista. É o mesmo defeito que o
                   `/docs` do menu tinha, em escala maior. */
                <Link
                  href={`/contas/${c.accountId}`}
                  prefetch={false}
                  className="font-medium text-purple-700 hover:underline"
                >
                  {c.razaoSocial}
                </Link>,
                <span className="tabular-nums">{BRL(c.receitaPerdidaCentavos)}</span>,
                /* "Ainda ativa" é o caso que mais custa: o painel AFIRMA que a
                   conta está na base, e o dinheiro dela parou há meses. Ver a
                   memória do vazamento do C18 — a escrita do cadastro nunca
                   remove, então `ativo` sobrevive ao cliente. */
                c.aindaAtiva ? (
                  <Badge tone="amber">ainda ativa no cadastro</Badge>
                ) : (
                  <span className="text-ink-3">inativa</span>
                ),
              ])}
            />
            <p className="mt-3 max-w-[80ch] text-meta leading-relaxed text-ink-3">
              De quem paramos de receber sem ninguém dizer por quê. Cada linha é um pedido de saída
              que falta registrar — e é registrando que a coorte, a meta e o quadro saem do zero.
              {ativas > 0 && (
                <>
                  {' '}
                  <strong className="font-semibold text-amber-800">
                    {N(ativas)} continua(m) marcada(s) como ativa(s) no cadastro
                  </strong>{' '}
                  — o painel afirma que estão na base, e o faturamento diz que pararam.
                </>
              )}
            </p>
          </>
        )}
      </Card>
    </div>
  )
}

export function Coorte({ meses }: { meses: readonly MesDaCoorte[] }) {
  const temAnuncio = meses.some((m) => m.anunciados > 0)
  const totalChurn = meses.reduce((s, m) => s + Number(m.churnEfeitoCentavos), 0)
  const totalAnunciado = meses.reduce((s, m) => s + Number(m.mrrAnunciadoCentavos), 0)
  return (
    <div className="grid gap-5">
      <Card title="Coorte por mês">
        <Table
          cols={[
            'Mês',
            'Anunciados',
            'MRR anunciado',
            'Aviso médio',
            'Revertidos',
            'Desconto',
            'Renegociados',
            'Cancelados',
            'Churn no efeito',
          ]}
          rows={meses.map((m) => [
            <span className="whitespace-nowrap font-semibold tabular-nums">{MES(m.mes)}</span>,
            <span className="tabular-nums">{m.anunciados === 0 ? '—' : N(m.anunciados)}</span>,
            <span className="tabular-nums">{m.anunciados === 0 ? '—' : BRL(m.mrrAnunciadoCentavos)}</span>,
            <span className="tabular-nums">
              {m.avisoPrevioMedioDias === null ? '—' : `${N(m.avisoPrevioMedioDias)} d`}
            </span>,
            <span className="tabular-nums">{m.revertidos || '—'}</span>,
            <span className="tabular-nums">{m.comDesconto || '—'}</span>,
            <span className="tabular-nums">{m.renegociados || '—'}</span>,
            <span className="tabular-nums">{m.cancelados || '—'}</span>,
            <>
              <span className="tabular-nums">
                {m.churnEfeitoContas === 0 ? '—' : BRL(m.churnEfeitoCentavos)}
              </span>
              {m.churnEfeitoContas > 0 && (
                <span className="mt-0.5 block text-nota text-ink-3">
                  {N(m.churnEfeitoContas)} conta(s)
                </span>
              )}
            </>,
          ])}
        />
        <p className="mt-3 max-w-[80ch] text-meta leading-relaxed text-ink-3">
          São <strong className="font-semibold text-ink">duas coortes na mesma tabela</strong>, e a
          distância entre elas é o aviso prévio. À esquerda, o mês em que a{' '}
          <strong className="font-semibold text-ink">mão subiu</strong>. À direita, o mês em que a{' '}
          <strong className="font-semibold text-ink">receita para</strong> — apurado pelo próprio
          fluxo, com as duas confirmações humanas, e não adivinhado do faturamento. O que o faturamento
          mostra está na aba <strong className="font-semibold text-ink">Reconciliação</strong>.{' '}
          {temAnuncio ? (
            <>
              No período: {BRL(totalAnunciado)} levantaram a mão e {BRL(totalChurn)} saíram do
              faturamento. Os dois números não fecham no mesmo mês de propósito.
            </>
          ) : (
            <>
              A tabela está vazia porque{' '}
              <strong className="font-semibold text-ink">nenhuma levantada foi registrada ainda</strong>
              , e ela mede o que o time registra — não o que se deduz do faturamento. Preenche a
              partir do primeiro pedido cadastrado no quadro.
            </>
          )}
        </p>
      </Card>
    </div>
  )
}

/* ─── Meta contra realizado ─────────────────────────────────────────────────── */

export function Meta({
  linhas,
  podeDefinir,
  volta,
}: {
  linhas: readonly LinhaDaMeta[]
  podeDefinir: boolean
  volta: string
}) {
  const semMeta = linhas.every((l) => l.metaCentavos === null)
  const ultima = linhas[linhas.length - 1]
  return (
    <div className="grid gap-5">
      <Card
        title="Meta contra realizado"
        actions={
          ultima?.diferencaCentavos !== null && ultima?.diferencaCentavos !== undefined ? (
            <Badge tone={Number(ultima.diferencaCentavos) < 0 ? 'red' : 'indigo'}>
              acumulado: {BRL(ultima.diferencaCentavos)}
            </Badge>
          ) : undefined
        }
      >
        <Table
          cols={[
            'Competência',
            'Meta do mês',
            'Meta acumulada',
            'MRR churn',
            'Churn acumulado',
            'Diferença',
          ]}
          rows={linhas.map((l) => [
            <span className="whitespace-nowrap font-semibold tabular-nums">{MES(l.competencia)}</span>,
            <span className="tabular-nums">{l.metaCentavos === null ? '—' : BRL(l.metaCentavos)}</span>,
            <span className="tabular-nums text-ink-2">
              {l.metaAcumuladaCentavos === null ? '—' : BRL(l.metaAcumuladaCentavos)}
            </span>,
            <span className="tabular-nums">{BRL(l.churnCentavos)}</span>,
            <span className="tabular-nums text-ink-2">{BRL(l.churnAcumuladoCentavos)}</span>,
            l.diferencaCentavos === null ? (
              <span className="text-ink-4">—</span>
            ) : (
              <span
                className={cn(
                  'tabular-nums font-semibold',
                  Number(l.diferencaCentavos) < 0 ? 'text-red' : 'text-ink',
                )}
              >
                {BRL(l.diferencaCentavos)}
              </span>
            ),
          ])}
        />
        <p className="mt-3 max-w-[80ch] text-meta leading-relaxed text-ink-3">
          <strong className="font-semibold text-ink">Diferença negativa é churn acima da meta</strong>{' '}
          — quanto mais negativo, pior. O sinal está escrito aqui porque em receita o sinal de um
          número de perda é a primeira coisa que alguém lê errado, e cor sozinha não informa quem não
          a enxerga.
        </p>
        <p className="mt-2 max-w-[80ch] text-meta leading-relaxed text-ink-3">
          A coluna que decide é a <strong className="font-semibold text-ink">acumulada</strong>. Um
          mês bom sozinho não diz nada: ele pode ter melhorado a diferença do ano sem resolvê-la, e é
          só no acumulado que isso aparece. A meta conta{' '}
          <strong className="font-semibold text-ink">só cancelamento e PDD</strong> — desconto e
          renegociação são contração, e somá-los aqui faria esta tabela deixar de ser de churn.
        </p>
        {semMeta && (
          <p className="mt-2 max-w-[80ch] text-meta leading-relaxed text-ink-3">
            Nenhuma meta definida no período. A coluna acumulada fica vazia de propósito: um
            acumulado que soma zero por falta de meta afirmaria meta zero, que é uma meta legítima e
            diferente de não ter meta.
          </p>
        )}
      </Card>

      {podeDefinir && (
        <Card title="Definir a meta de um mês">
          <form action={acaoDefinirMeta} className="flex flex-wrap items-end gap-2">
            <CampoDeVolta para={volta} />
            <Field label="Competência" name="competencia" type="month" required className="w-40" />
            <Field
              label="Meta de churn (R$)"
              name="meta"
              type="text"
              inputMode="decimal"
              placeholder="100.000,00"
              required
              className="w-40"
            />
            <div className="min-w-[16em] flex-1">
              <Field label="Nota (opcional)" name="nota" type="text" placeholder="de onde veio o número" />
            </div>
            <Btn type="submit" variant="ghost">
              Definir
            </Btn>
          </form>
          <p className="mt-3 text-meta leading-relaxed text-ink-3">
            Definir de novo o mesmo mês <strong className="font-semibold text-ink">corrige</strong> a
            meta e registra quem mudou — meta não se apaga, porque a pergunta "quem combinou isso" é
            a que aparece três meses depois.
          </p>
        </Card>
      )}
    </div>
  )
}
