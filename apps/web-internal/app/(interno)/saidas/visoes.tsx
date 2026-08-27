import {
  DIAS_PARA_ESTAGNAR,
  MOTIVOS_SAIDA,
  POSICOES,
  type ContaParaSaida,
  type LinhaDaMeta,
  type MesDaCoorte,
  type PedidoNoQuadro,
} from '@pulse/success'
import { Badge, Btn, Card, Field, Select, Table, cn } from '@pulse/ui'
import Link from 'next/link'

import { acaoAvancarEtapa, acaoDefinirMeta, registrarPedido } from './acoes'

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
}: {
  contas: readonly ContaParaSaida[]
  hoje: string
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
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[22em] flex-1">
                <Select label="Cliente" name="accountId" required defaultValue="">
                  <option value="" disabled>
                    escolha o cliente…
                  </option>
                  {contas.map((c) => (
                    <option key={c.accountId} value={c.accountId}>
                      {c.razaoSocial}
                      {c.mrrCentavos === null ? ' · MRR a informar' : ` · ${BRL(c.mrrCentavos)}/mês`}
                    </option>
                  ))}
                </Select>
              </div>
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
export function Quadro({ pedidos }: { pedidos: readonly PedidoNoQuadro[] }) {
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
            <Coluna key={pos.id} pos={pos} itens={porPosicao.get(pos.id) ?? []} />
          ))}
        </div>
      </Card>

      <Card title="Desfechos">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {desfechos.map((pos) => (
            <Coluna key={pos.id} pos={pos} itens={porPosicao.get(pos.id) ?? []} />
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
}: {
  pos: (typeof POSICOES)[number]
  itens: readonly PedidoNoQuadro[]
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
              <form action={acaoAvancarEtapa} className="mt-1.5 flex flex-wrap gap-1.5">
                <input type="hidden" name="id" value={p.id} />
                {/* A posição de trabalho mapeia 1:1 no estado, e só `pedido` tem
                    nome diferente do dele (`anunciado`). O botão da etapa atual
                    não aparece: mover para onde já se está é um clique que não faz
                    nada, e um botão que não faz nada ensina a não clicar. */}
                {(['anunciado', 'financeiro', 'reversao'] as const)
                  .filter((e) => e !== (p.posicao === 'pedido' ? 'anunciado' : p.posicao))
                  .map((e) => (
                    /* ds-excecao: botão de SUBMIT com name e value próprios, que é
                       o que permite mover o pedido sem JavaScript. `Btn` não
                       carrega name nem value, e três formulários por cartão para
                       ter três destinos seria pior que este marcador. */
                    <button
                      key={e}
                      type="submit"
                      name="para"
                      value={e}
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
 * As duas coortes lado a lado, e a diferença entre elas dita em texto.
 *
 * A de ANÚNCIO começa vazia e é a que antecipa; a de EFEITO tem história e é a
 * que a cascata usa. Juntar numa coluna faria junho aparecer com saídas
 * anunciadas em abril — deslocadas pelo tamanho do aviso, que varia por contrato.
 */
export function Coorte({ meses }: { meses: readonly MesDaCoorte[] }) {
  const temAnuncio = meses.some((m) => m.anunciados > 0)
  const totalChurn = meses.reduce((s, m) => s + Number(m.churnEfeitoCentavos), 0)
  const totalRea = meses.reduce((s, m) => s + Number(m.reativouCentavos), 0)
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
            'Reativaram',
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
              <span className="tabular-nums">{BRL(m.churnEfeitoCentavos)}</span>
              <span className="mt-0.5 block text-nota text-ink-3">{N(m.churnEfeitoContas)} conta(s)</span>
            </>,
            <>
              <span className="tabular-nums">{BRL(m.reativouCentavos)}</span>
              <span className="mt-0.5 block text-nota text-ink-3">{N(m.reativouContas)} conta(s)</span>
            </>,
          ])}
        />
        <p className="mt-3 max-w-[80ch] text-meta leading-relaxed text-ink-3">
          São <strong className="font-semibold text-ink">duas coortes na mesma tabela</strong>, e a
          distância entre elas é o aviso prévio. À esquerda, o mês em que a{' '}
          <strong className="font-semibold text-ink">mão subiu</strong> — vem do pipeline, e é a que
          antecipa. À direita, o mês em que a{' '}
          <strong className="font-semibold text-ink">receita saiu</strong> — vem do ledger derivado
          do faturamento, e tem história.{' '}
          {!temAnuncio && (
            <>
              As colunas de anúncio estão vazias porque{' '}
              <strong className="font-semibold text-ink">nenhuma levantada foi registrada ainda</strong>
              : o ledger sabe quando a receita parou, não quando o cliente avisou. Elas se preenchem
              a partir do primeiro pedido cadastrado.
            </>
          )}{' '}
          A coluna de reativação existe porque uma coorte de saída que não mostra quem voltou conta
          metade da história: no período são {BRL(totalRea)} que retornaram contra {BRL(totalChurn)}{' '}
          que saíram.
        </p>
      </Card>
    </div>
  )
}

/* ─── Meta contra realizado ─────────────────────────────────────────────────── */

export function Meta({
  linhas,
  podeDefinir,
}: {
  linhas: readonly LinhaDaMeta[]
  podeDefinir: boolean
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
