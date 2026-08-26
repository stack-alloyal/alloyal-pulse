import {
  DIAS_CORRENTE,
  coorteDoAtraso,
  inadimplenciaDaCompetencia,
  serieDaCarteira,
  type MesDaCarteira,
} from '@pulse/config'
import { fonteDoMrr, listarCascatas, type Cascata } from '@pulse/success'
import { Aviso, Badge, Card, Chip, Chips, Kpi, KpiGrade, Table, Vazio, cn } from '@pulse/ui'
import Link from 'next/link'

import {
  GraficoDaCoorte,
  GraficoDoAtraso,
  GraficoDoFluxo,
  competenciaDeReceita,
} from './grafico-atraso'
import { Corpo, Topo } from '../casca'
import { pool } from '../../../lib/db'
import { exigir } from '../../../lib/guarda'

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
/** "2026-03-01" → "mar/26". O chip precisa caber; a competência inteira não cabe. */
const MES = (iso: string) => {
  const [a, m] = iso.split('-')
  return `${MESES[Number(m) - 1] ?? m}/${a?.slice(2)}`
}

export const dynamic = 'force-dynamic'

/**
 * Cascata de receita e fechamento mensal.
 *
 * A cascata responde "de onde veio e para onde foi o MRR". A linha que faz esta
 * tela valer alguma coisa é a do NÃO ATRIBUÍDO: o MRR final é observado na base
 * de contratos, e os movimentos vêm do ledger — duas fontes independentes. O que
 * sobra entre elas aparece com nome próprio em vez de ser empurrado para churn,
 * porque um gráfico que fecha sempre é um gráfico que ninguém audita.
 *
 * Resíduo grande não é churn escondido: é captação faltando.
 */

const REAIS = (c: string) =>
  (Number(c) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })

const PCT = (v: number | null) =>
  v === null ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

/**
 * A partir de quanto o resíduo deixa de ser arredondamento e vira problema.
 *
 * 0,5% do MRR inicial: abaixo disso é ruído de contrato entrando no meio do mês;
 * acima, alguma captação não está gravando evento, e o número da cascata passa a
 * depender de uma fonte só.
 */
const TOLERANCIA_RESIDUO = 0.005

function residuoPreocupa(c: Cascata): boolean {
  const ini = Number(c.mrrInicialCentavos)
  if (ini <= 0) return false
  return Math.abs(Number(c.naoAtribuidoCentavos)) / ini > TOLERANCIA_RESIDUO
}

/** Uma linha da cascata, com o sinal explícito. */
function Passo({
  rotulo,
  valor,
  sinal,
  destaque,
}: {
  rotulo: string
  valor: string
  sinal: '+' | '−' | ''
  destaque?: 'residuo' | 'total'
}) {
  const zero = Number(valor) === 0
  return (
    <tr
      className={cn(
        'border-b border-line last:border-0',
        // Linha zerada fica atenuada: numa cascata a maioria dos movimentos é
        // zero em qualquer mês, e destacá-los todos apaga o que de fato se moveu.
        zero && 'text-ink-4',
        destaque === 'residuo' && 'border-t border-dashed border-line-strong',
        destaque === 'total' && 'border-t-2 border-ink font-semibold',
      )}
    >
      <td className="w-full px-3 py-2">{rotulo}</td>
      <td className="px-2 py-2 text-right tabular-nums text-ink-3">{sinal}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{REAIS(valor)}</td>
    </tr>
  )
}

export default async function Receita({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>
}) {
  // Receita não tem carteira: quem vê, vê a base inteira. A identidade não é
  // usada depois — o recorte desta tela é tudo ou nada.
  await exigir((p) => p.receita === 'base' || p.configurar, 'cascata de receita')
  const q = await searchParams

  /* ┌───────────────────────────────────────────────────────────────────────┐
     │ 24 MESES E NÃO 12, e a tela ESCOLHE qual mostrar.                       │
     │                                                                        │
     │ Antes eram 12 carregados e UM renderizado: os outros onze iam para uma  │
     │ tabela de resumo e o detalhe deles não existia em lugar nenhum. Quem     │
     │ quisesse a cascata de março tinha de acreditar no MRR final e no NRR da  │
     │ linha, sem ver de onde vieram.                                          │
     │                                                                        │
     │ `mes` inválido cai no mais recente em vez de devolver vazio: parâmetro   │
     │ de URL é colado por gente, e tela vazia sem explicação parece defeito.   │
     └───────────────────────────────────────────────────────────────────────┘ */
  const [cascatas, fonte, serieDoAtraso, coorte] = await Promise.all([
    listarCascatas(pool(), 24),
    fonteDoMrr(pool()),
    // A série do atraso vem junto para a tabela de 24 meses poder mostrar os DOIS
    // eixos na mesma linha. 25 e não 24: a foto que descreve o mês C é a de C+1,
    // então o mês mais antigo da cascata precisa da foto seguinte.
    serieDaCarteira(pool(), 25),
    // A coorte é indexada pelo mês de VENCIMENTO, que já é o mês de receita — 24
    // aqui casa com os 24 da cascata sem deslocamento nenhum.
    coorteDoAtraso(pool(), 24),
  ])
  const escolhido = q.mes ? cascatas.find((c) => c.competencia.slice(0, 7) === q.mes) : undefined
  const atual = escolhido ?? cascatas[0]

  const atraso = atual ? await inadimplenciaDaCompetencia(pool(), atual.competencia) : null

  /* A média SÓ das maduras. Incluir as novas puxaria a média para baixo por um
     motivo que não é recuperação ruim — é que ainda não deu tempo de pagar. */
  const maduras = coorte.filter((c) => c.madura)
  const mediaMadura =
    maduras.length > 0 ? maduras.reduce((s, c) => s + c.pagoPct, 0) / maduras.length : null

  /* O atraso indexado pela competência de RECEITA que ele descreve, e não pela
     competência da própria foto: a foto do dia 1º de agosto conta o que aconteceu
     em julho. O deslocamento é resolvido em `inadimplenciaDaCompetencia`, e aqui
     ele é repetido no índice do mapa por um motivo só — a tabela precisa cruzar as
     duas séries sem chamar o banco 24 vezes. */
  const atrasoPorMes = new Map<string, MesDaCarteira>(
    serieDoAtraso.map((m) => [competenciaDeReceita(m.competencia), m]),
  )

  if (!atual) {
    return (
      <>
        <Topo href="/receita" />
        <Corpo>
          <Vazio
            titulo="Nenhuma competência fechada ainda."
            porque="A cascata é calculada pelo ciclo mensal a partir do ledger de eventos de MRR e da base de contratos. Enquanto o ciclo C5 do HubSpot não estiver ligado, o ledger só recebe os eventos gerados aqui — encerramentos aprovados no fluxo de saídas."
            acao={{ texto: 'Ver o pipeline de dados', href: '/dados' }}
          />
        </Corpo>
      </>
    )
  }

  return (
    <>
      <Topo
        href="/receita"
        acoes={
          atual.estado === 'congelada' ? (
            <Badge tone="green">congelada por {atual.congeladoPor}</Badge>
          ) : (
            <Badge tone="amber">aberta — os números ainda podem mudar</Badge>
          )
        }
      />
      <Corpo className="grid gap-5">
        <KpiGrade>
          <Kpi
            rotulo="MRR final"
            valor={REAIS(atual.mrrFinalCentavos)}
            /* A contagem OBSERVADA, não a somada dos movimentos: a soma ignora
               reativação e derivava para baixo um par churn/reativação por vez —
               chegou a dizer 161 contas onde havia 348. Ver a migração 0051. O
               `??` cobre competência fechada antes dela. */
            nota={`${atual.contasFinais ?? atual.contasIniciais + atual.contasNovas - atual.contasPerdidas} contas · ${atual.competencia.slice(0, 7)}`}
          />
          <Kpi
            rotulo="NRR"
            valor={PCT(atual.nrr)}
            nota="coorte inicial, sem cliente novo"
            {...(atual.nrr !== null ? { tom: atual.nrr >= 1 ? ('green' as const) : ('amber' as const) } : {})}
          />
          <Kpi rotulo="GRR" valor={PCT(atual.grr)} nota="sem o efeito de expansão" />
          <Kpi
            rotulo="Não atribuído"
            valor={REAIS(atual.naoAtribuidoCentavos)}
            nota={
              residuoPreocupa(atual)
                ? 'acima da tolerância — captação faltando'
                : 'dentro da tolerância'
            }
            {...(residuoPreocupa(atual) ? { tom: 'red' as const } : {})}
          />
        </KpiGrade>

        <Chips rotulo="competência:">
          {cascatas.map((c) => (
            <Chip
              key={c.competencia}
              rotulo={MES(c.competencia)}
              href={`/receita?mes=${c.competencia.slice(0, 7)}`}
              ativo={c.competencia === atual.competencia}
              fixo
            />
          ))}
        </Chips>

        <Card title={`Cascata de ${atual.competencia.slice(0, 7)}`} className="max-w-[36em]">
          <table className="w-full text-corpo">
            <tbody>
              <Passo rotulo="MRR inicial" valor={atual.mrrInicialCentavos} sinal="" />
              <Passo rotulo="Novo" valor={atual.novoCentavos} sinal="+" />
              <Passo rotulo="Expansão" valor={atual.expansaoCentavos} sinal="+" />
              <Passo rotulo="Reativação" valor={atual.reativacaoCentavos} sinal="+" />
              <Passo rotulo="Contração" valor={atual.contracaoCentavos} sinal="−" />
              {/* Os dois churns separados: um é insatisfação, o outro é crédito, e
                  somá-los no mesmo balde apaga a diferença entre as duas conversas. */}
              <Passo rotulo="Churn pedido" valor={atual.churnPedidoCentavos} sinal="−" />
              <Passo
                rotulo="Churn por inadimplência"
                valor={atual.churnInadimplenciaCentavos}
                sinal="−"
              />
              <Passo rotulo="Ajuste" valor={atual.ajusteCentavos} sinal="+" />
              <Passo
                rotulo="Não atribuído"
                valor={atual.naoAtribuidoCentavos}
                sinal="+"
                destaque="residuo"
              />
              <Passo rotulo="MRR final" valor={atual.mrrFinalCentavos} sinal="" destaque="total" />
            </tbody>
          </table>
        </Card>

        {/* ┌───────────────────────────────────────────────────────────────────┐
            │ O ATRASO NÃO É UM PASSO DA CASCATA, e por isso está num card à parte.│
            │                                                                     │
            │ A cascata é COMPETÊNCIA: ela conta o que foi contratado e cobrado no  │
            │ mês, tenha entrado ou não. A inadimplência é RECEBÍVEL: o que foi     │
            │ cobrado e não entrou. Somar um no outro daria um MRR que já desconta  │
            │ inadimplência — e aí o churn e o atraso passariam a contar o mesmo    │
            │ cliente duas vezes, uma como receita perdida e outra como receita     │
            │ atrasada.                                                            │
            │                                                                     │
            │ O que junta os dois é a RAZÃO, não a soma: quantos meses de MRR estão │
            │ parados em atraso. É a única frase que precisa das duas telas.        │
            └───────────────────────────────────────────────────────────────────┘ */}
        {atraso && (
          <Card
            title={`Inadimplência e recuperação em ${atual.competencia.slice(0, 7)}`}
            /* SEM `max-w`: com 52em e quatro colunas, cada KPI ficava com ~170px e
               "R$ 1.971.571,80" aparecia como "R$ 1.971.571,8" — o card recorta e
               o número perde o último dígito sem avisar. A grade de KPI do topo da
               página é de largura cheia e cabe; esta passa a ser também. */
            actions={
              <Link
                href="/receita/inadimplencia"
                className="text-nota text-purple-700 hover:underline"
              >
                ver a carteira em atraso
              </Link>
            }
          >
            <KpiGrade colunas={4}>
              <Kpi
                rotulo="Em atraso no fim do mês"
                valor={REAIS(atraso.saldoFimCentavos)}
                nota={`${atraso.titulosFim.toLocaleString('pt-BR')} títulos`}
                tom="red"
              />
              <Kpi
                rotulo="Entrou em atraso"
                valor={REAIS(atraso.entrouCentavos)}
                nota="venceu no mês e não foi pago"
              />
              <Kpi
                rotulo="Recuperado"
                valor={REAIS(atraso.recuperadoCentavos)}
                nota="título antigo que foi quitado"
              />
              <Kpi
                rotulo="Delta"
                valor={REAIS(atraso.deltaCentavos)}
                nota={
                  Number(atraso.deltaCentavos) > 0
                    ? 'entrou mais do que voltou — a carteira cresceu'
                    : 'voltou mais do que entrou — a carteira encolheu'
                }
                {...(Number(atraso.deltaCentavos) > 0 ? { tom: 'red' as const } : {})}
              />
            </KpiGrade>
            {/* O MESMO gráfico da inadimplência, nomeado pelo eixo desta tela: a
                barra é o saldo no FIM de cada competência de receita, e a do mês
                escolhido no filtro ganha o anel. É o que responde "o mês que estou
                olhando é fora da curva ou é a curva?" — pergunta que só existe
                numa tela que tem filtro de mês. */}
            {serieDoAtraso.length > 1 && (
              <div className="mt-5">
                <GraficoDoAtraso
                  serie={serieDoAtraso}
                  rotulo={(m) => MES(competenciaDeReceita(m.competencia) + '-01')}
                  /* A competência da FOTO, achada pelo mapa: passar a de receita
                     destacaria a barra do mês seguinte — que é exatamente o erro
                     de um mês que `competenciaDeReceita` existe para evitar. */
                  {...(() => {
                    const f = atrasoPorMes.get(atual.competencia.slice(0, 7))
                    return f ? { destacar: f.competencia } : {}
                  })()}
                  diasCorrente={DIAS_CORRENTE}
                  altura={140}
                />
              </div>
            )}
            {/* O SEGUNDO gráfico é o que explica o primeiro: o saldo cresce porque
                entra mais do que volta, e não porque ninguém paga. Sem ele, a
                barra de saldo subindo é um fato sem causa — e é a causa que decide
                se o trabalho é cobrar melhor ou cobrar antes. */}
            {serieDoAtraso.length > 1 && (
              <div className="mt-4">
                <div className="mb-2 flex flex-wrap items-center gap-4 text-nota text-ink-2">
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-red" />
                    entrou em atraso
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-purple-500" />
                    recuperado
                  </span>
                </div>
                <GraficoDoFluxo
                  serie={serieDoAtraso}
                  rotulo={(m) => MES(competenciaDeReceita(m.competencia) + '-01')}
                  {...(() => {
                    const f = atrasoPorMes.get(atual.competencia.slice(0, 7))
                    return f ? { destacar: f.competencia } : {}
                  })()}
                  altura={120}
                />
              </div>
            )}
            {/* ┌───────────────────────────────────────────────────────────────┐
                │ A COORTE É O QUE SEPARA ATRASO DE PERDA, e é a razão de ela estar │
                │ numa tela de receita: os dois gráficos acima mostram a carteira    │
                │ crescendo, e sozinhos sugerem que o dinheiro sumiu. A coorte diz    │
                │ que 84% a 93% do que atrasa volta — então o que os outros dois      │
                │ medem é atraso, e a perda é a fração que não fecha.                │
                │                                                                   │
                │ O eixo aqui é o mês de VENCIMENTO, que já é o de receita: o anel    │
                │ casa direto com a competência escolhida, sem o deslocamento de um   │
                │ mês que os outros dois precisam.                                   │
                └───────────────────────────────────────────────────────────────┘ */}
            {coorte.length > 1 && (
              <div className="mt-5">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-nota text-ink-2">
                    De tudo que venceu no mês e atrasou, quanto por cento do valor já voltou
                  </span>
                  {mediaMadura !== null && (
                    <Badge tone="indigo">
                      coortes maduras:{' '}
                      {mediaMadura.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                    </Badge>
                  )}
                </div>
                <GraficoDaCoorte
                  coorte={coorte}
                  rotulo={(c) => MES(c.mes)}
                  destacar={`${atual.competencia.slice(0, 7)}-01`}
                  altura={130}
                />
              </div>
            )}
            <p className="mt-4 text-meta leading-relaxed text-ink-3">
              {Number(atual.mrrFinalCentavos) > 0 && (
                <>
                  São{' '}
                  <strong className="font-semibold text-ink">
                    {(
                      Number(atraso.saldoFimCentavos) / Number(atual.mrrFinalCentavos)
                    ).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}{' '}
                    meses de MRR
                  </strong>{' '}
                  parados em atraso.{' '}
                </>
              )}
              No primeiro gráfico, o claro é a carteira inteira e o escuro é o que tem até 90 dias —
              a parte que ainda responde a cobrança. No segundo, enquanto o{' '}
              <strong className="font-semibold text-ink">vermelho</strong> for maior que o{' '}
              <strong className="font-semibold text-ink">roxo</strong>, a carteira cresce — e a causa
              é a entrada, não a falta de pagamento.
              {mediaMadura !== null && (
                <>
                  {' '}
                  E o terceiro é o que separa atraso de perda: nas coortes maduras volta{' '}
                  <strong className="font-semibold text-ink">
                    {mediaMadura.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                  </strong>{' '}
                  do que atrasou, o que põe a perda estrutural em torno de{' '}
                  <strong className="font-semibold text-ink">
                    {(100 - mediaMadura).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                  </strong>
                  . Barra clara é coorte nova — a taxa baixa ali só diz que ainda não deu tempo.
                </>
              )}{' '}
              A cascata acima é de{' '}
              <strong className="font-semibold text-ink">competência</strong> —
              o que foi cobrado no mês, tenha entrado ou não. Isto é{' '}
              <strong className="font-semibold text-ink">recebível</strong>: do que foi cobrado, o
              que não entrou. Os dois números não se somam, e o que os liga é a razão entre eles.
              {atraso.origem === 'reconstruido' && (
                <>
                  {' '}
                  Esta foto é <strong className="font-semibold text-ink">reconstruída</strong> das
                  datas de vencimento e pagamento: o saldo está certo, mas ela não sabe o estado do
                  painel de então nem em que mês um título foi cancelado.
                </>
              )}
            </p>
          </Card>
        )}

        {/* ┌─────────────────────────────────────────────────────────────────┐
            │ A FRASE DEPENDE DA FONTE, e antes não dependia — ela afirmava      │
            │ "duas fontes independentes" mesmo quando as duas pontas saem do    │
            │ mesmo faturamento. Frase errada numa tela de receita é pior que    │
            │ tela sem frase: ensina a confiar num número por um motivo que não  │
            │ existe.                                                            │
            └─────────────────────────────────────────────────────────────────┘ */}
        {fonte === 'contrato' ? (
          <p className="max-w-[80ch] text-corpo leading-relaxed text-ink-2">
            O MRR final é observado na base de contratos; os movimentos vêm do ledger. São duas
            fontes independentes, e o <strong className="font-semibold">não atribuído</strong> é a
            diferença entre elas — ele existe para aparecer. Empurrá-lo para churn faria a cascata
            fechar sempre, e um número que fecha por construção é um número que ninguém consegue
            auditar. Resíduo grande é sinal de captação faltando, não de churn escondido.
          </p>
        ) : (
          <Aviso tom="alerta">
            <strong className="font-semibold">Este MRR é o FATURADO, não o contratado.</strong>{' '}
            <code className="rounded bg-surface-2 px-1">core.contract</code> está vazia — o ciclo
            que a alimentaria (C5, do HubSpot) não está ligado —, então tanto os movimentos quanto o
            MRR final saem do faturamento do Omie, que é a única fonte que corresponde ao que
            entra. Duas consequências: o <strong className="font-semibold">não atribuído</strong>{' '}
            fica em R$ 0,00 por construção e confere só a aritmética dos deltas, não o negócio; e
            um cliente que renegociou para pagar trimestralmente aparece como churn e reativação. A
            view corrige as duas distorções de <em>cobrança</em> que dariam eventos falsos — mês em
            branco e mês dobrado —, e nada além disso.
          </Aviso>
        )}

        {cascatas.length > 1 && (
          <>
            <Card title={`Últimos ${cascatas.length} meses`}>
              <Table
                cols={[
                  'Competência',
                  'MRR final',
                  'NRR',
                  'GRR',
                  'Churn',
                  'Não atribuído',
                  // Os dois eixos na mesma linha: o mês em que a receita foi
                  // reconhecida, e quanto dela ficou em atraso no fim dele.
                  'Em atraso',
                  'Recuperado',
                  'Estado',
                ]}
                rows={cascatas.map((c) => [
                  // A linha do histórico agora ABRE o detalhe daquele mês. Antes
                  // era texto morto: a tabela mostrava NRR e resíduo de onze meses
                  // cujos movimentos não existiam em tela nenhuma.
                  <Link
                    href={`/receita?mes=${c.competencia.slice(0, 7)}`}
                    className="tabular-nums font-semibold hover:text-purple-700 hover:underline"
                  >
                    {c.competencia.slice(0, 7)}
                  </Link>,
                  <span className="tabular-nums">{REAIS(c.mrrFinalCentavos)}</span>,
                  <span className="tabular-nums">{PCT(c.nrr)}</span>,
                  <span className="tabular-nums">{PCT(c.grr)}</span>,
                  <>
                    <span className="tabular-nums">
                      {REAIS(
                        String(
                          Number(c.churnPedidoCentavos) + Number(c.churnInadimplenciaCentavos),
                        ),
                      )}
                    </span>
                    <span className="mt-0.5 block text-nota text-ink-3">
                      {c.contasPerdidas} conta(s)
                    </span>
                  </>,
                  <span
                    className={cn('tabular-nums', residuoPreocupa(c) && 'font-semibold text-red')}
                  >
                    {REAIS(c.naoAtribuidoCentavos)}
                  </span>,
                  (() => {
                    const a = atrasoPorMes.get(c.competencia.slice(0, 7))
                    return a ? (
                      <>
                        <span className="tabular-nums">{REAIS(a.saldoFinalCentavos)}</span>
                        <span className="mt-0.5 block text-nota text-ink-3">
                          {a.titulosFinal} título(s)
                        </span>
                      </>
                    ) : (
                      <span className="text-ink-4">—</span>
                    )
                  })(),
                  (() => {
                    const a = atrasoPorMes.get(c.competencia.slice(0, 7))
                    return a ? (
                      <>
                        <span className="tabular-nums">{REAIS(a.recuperadoCentavos)}</span>
                        <span className="mt-0.5 block text-nota text-ink-3">
                          entrou {REAIS(a.entrouCentavos)}
                        </span>
                      </>
                    ) : (
                      <span className="text-ink-4">—</span>
                    )
                  })(),
                  c.estado === 'congelada' ? (
                    <Badge tone="green">congelada</Badge>
                  ) : (
                    <Badge tone="amber">aberta</Badge>
                  ),
                ])}
              />
            </Card>
            <p className="max-w-[80ch] text-corpo leading-relaxed text-ink-2">
              Competência congelada não se corrige: a correção é um ajuste na competência corrente,
              com nota. É restrição de banco, e não combinado de processo, porque a alternativa é
              alguém recalcular um mês já apresentado ao board e ninguém descobrir.
            </p>
          </>
        )}
      </Corpo>
    </>
  )
}
