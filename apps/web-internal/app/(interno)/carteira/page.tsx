import { carregarCarteira, resumir, type ContaDaCarteira } from '@pulse/success'
import { Aviso, Badge, Card, Chip, Chips, Kpi, KpiGrade, TOM_POR_FAIXA, Table, Vazio, cn } from '@pulse/ui'
import Link from 'next/link'

import { Corpo, Topo } from '../casca'
import { pool } from '../../../lib/db'
import { exigir, temEscopo } from '../../../lib/guarda'

export const dynamic = 'force-dynamic'

/**
 * T3 — A carteira. A tela do "onde eu olho".
 *
 * A fila mostra 12 itens; a carteira tem 30 contas. As 18 que não geraram item hoje
 * não são invisíveis — são o trabalho que ainda não virou urgente, e é olhando para
 * elas que se evita que virem.
 *
 * A ordem é risco × receita, e é a decisão de produto desta tela: por faixa só, o
 * CSM começa por uma conta crítica de R$ 800 e deixa uma em risco de R$ 40 mil para
 * depois; por MRR só, começa pela maior mesmo saudável.
 */

const REAIS = (c: string | null) =>
  c === null
    ? '—'
    : (Number(c) / 100).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      })

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
/** "2026-08-01" → "1º/ago". A data da foto tem de caber na nota de um KPI. */
const MES_CURTO = (iso: string) => {
  const [, m] = iso.split('-')
  return `1º/${MESES_CURTOS[Number(m) - 1] ?? m}`
}

const PCT = (v: number | null) =>
  v === null ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`

/**
 * As faixas que a carteira SEMPRE mostra, na ordem do pior para o melhor.
 *
 * `sem_sinal` entra por último e é a única condicional: ela existe quando há conta
 * sem sinal calculado, e some quando todas têm — aí ela é ruído, não estado.
 */
const FAIXAS_FIXAS = ['critico', 'risco', 'atencao', 'saudavel'] as const

const FAIXA: Record<string, string> = {
  critico: 'Crítico',
  risco: 'Risco',
  atencao: 'Atenção',
  saudavel: 'Saudável',
  sem_sinal: 'Sem sinal',
}

const FAIXA_ATRASO = (d: number | null) =>
  d === null ? '—' : d === 0 ? 'em dia' : d < 31 ? '1–30 d' : d < 61 ? '31–60 d' : d < 91 ? '61–90 d' : '90+ d'

/** O nome da faixa e o tom, com o caso `null` tratado como o que é: desconhecido. */
function faixaDe(c: ContaDaCarteira) {
  const k = c.faixa ?? 'sem_sinal'
  return { rotulo: FAIXA[k] ?? k, tom: TOM_POR_FAIXA[k] ?? ('slate' as const) }
}

export default async function Carteira({
  searchParams,
}: {
  searchParams: Promise<{ faixa?: string }>
}) {
  const id = await exigir((p) => temEscopo(p.contas), 'carteira')
  const q = await searchParams

  /* ┌───────────────────────────────────────────────────────────────────────┐
     │ DOIS CARREGAMENTOS, e é o que corrige o defeito: os KPIs e as contagens  │
     │ vêm da carteira INTEIRA, a lista vem da filtrada.                        │
     │                                                                          │
     │ Antes, filtrar por "crítico" recalculava tudo sobre o recorte — e os      │
     │ quatro KPIs viravam um só. O painel some justamente quando a pessoa está  │
     │ olhando um pedaço e mais precisa do todo para saber o tamanho dele.       │
     │                                                                          │
     │ É também o que dá contagem aos chips: sem o total, o chip mostraria o     │
     │ número do próprio recorte, que é sempre igual ao que está na tela.        │
     └───────────────────────────────────────────────────────────────────────┘ */
  const [carteiraToda, carteira] = await Promise.all([
    carregarCarteira(pool(), id),
    q.faixa ? carregarCarteira(pool(), id, { faixa: q.faixa }) : null,
  ])
  const lista = carteira ?? carteiraToda
  const rTodos = resumir(carteiraToda)
  const r = resumir(lista)

  return (
    <>
      <Topo
        href="/carteira"
        titulo={carteiraToda.visaoDaBase ? 'Base de clientes' : 'Minha carteira'}
        acoes={
          <span className="tabular-nums text-corpo text-ink-2">
            {r.total} conta(s) · {REAIS(r.mrrTotalCentavos)}/mês
          </span>
        }
      />
      <Corpo className="grid gap-5">
        {carteiraToda.semSinal > 0 && (
          /* Conta sem sinal não é conta saudável: é conta sobre a qual não se sabe
             nada. Somá-la ao verde faria a carteira parecer melhor do que é. */
          <Aviso tom="alerta">
            {carteiraToda.semSinal} conta(s) sem sinal calculado. Elas não são saudáveis — são
            desconhecidas, e por isso pesam como atenção na ordem desta lista.
          </Aviso>
        )}

        {/* AS QUATRO FAIXAS SEMPRE, mesmo zeradas — mesma regra do chip `fixo`:
            faixa de saúde é estado ESTRUTURAL do produto. `resumir` devolve só as
            que têm conta, e mostrar o que ele devolve fazia a carteira aparecer com
            um KPI só, como se as outras faixas não existissem. Zero é um fato;
            ausência da faixa é outra coisa, e a tela afirmava a segunda. */}
        <KpiGrade>
          {FAIXAS_FIXAS.map((chave) => {
            const f = rTodos.porFaixa.find((x) => x.faixa === chave) ?? {
              faixa: chave,
              contas: 0,
              mrrCentavos: '0',
            }
            return (
              <Kpi
                key={chave}
              rotulo={FAIXA[f.faixa] ?? f.faixa}
              valor={f.contas}
              nota={`${REAIS(f.mrrCentavos)}/mês`}
              {...(f.faixa === 'critico' || f.faixa === 'risco'
                ? { tom: 'red' as const }
                : f.faixa === 'atencao' || f.faixa === 'sem_sinal'
                  ? { tom: 'amber' as const }
                  : { tom: 'green' as const })}
              />
            )
          })}
        </KpiGrade>

        {/* ┌───────────────────────────────────────────────────────────────────┐
            │ SEGUNDA FILEIRA, e não mais quatro KPI na primeira.                  │
            │                                                                     │
            │ A de cima é a faixa de SAÚDE — cinco estados de um mesmo eixo, e a   │
            │ leitura dela é a distribuição. Misturar atraso ali faria oito caixas  │
            │ onde três respondem a outra pergunta, e a distribuição deixaria de    │
            │ ser legível de uma vez.                                             │
            │                                                                     │
            │ E hoje há um motivo a mais: as cinco de cima estão quase todas em     │
            │ zero, porque `metrics.signal` está vazia — o sinal depende dos ciclos │
            │ C2/C3/C8, declarados e não implementados. Estes três são, por           │
            │ enquanto, os únicos KPI desta tela com dado. Empilhá-los junto        │
            │ esconderia essa diferença.                                          │
            └───────────────────────────────────────────────────────────────────┘ */}
        {rTodos.contasEmAtraso > 0 && (
          <>
            <KpiGrade colunas={3}>
            <Kpi
              rotulo="Contas em atraso"
              valor={rTodos.contasEmAtraso}
              /* A DATA DA FOTO no rótulo, e não é detalhe: a tela de inadimplência
                 calcula HOJE e dá outro número. As duas estão certas — medido em
                 26/08, R$ 304.726 na foto de 1º/ago contra R$ 391.924 hoje, que são
                 25 dias de vencimento novo. Sem a data, a diferença parece defeito. */
              nota={`${REAIS(rTodos.abertoTotalCentavos)} em títulos vencidos${
                rTodos.fotoDoAtraso ? ` · foto de ${MES_CURTO(rTodos.fotoDoAtraso)}` : ''
              }`}
              tom="red"
            />
            <Kpi
              rotulo="Em atraso até 90 dias"
              valor={REAIS(rTodos.abertoRecenteCentavos)}
              nota={`${rTodos.contasEmAtrasoRecente} conta(s) — a parte que responde a cobrança`}
              {...(Number(rTodos.abertoRecenteCentavos) > 0 ? { tom: 'amber' as const } : {})}
            />
            {/* A razão, e não mais um valor absoluto: é ela que diz o tamanho do
                atraso PARA ESTA carteira. R$ 200 mil numa carteira de R$ 1 milhão
                é outra conversa que os mesmos R$ 200 mil numa de R$ 50 mil. */}
            <Kpi
              rotulo="Atraso sobre o MRR da carteira"
              valor={
                Number(rTodos.mrrTotalCentavos) > 0
                  ? `${(
                      Number(rTodos.abertoTotalCentavos) / Number(rTodos.mrrTotalCentavos)
                    ).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}×`
                  : '—'
              }
              nota={`meses de MRR parados · maior atraso ${rTodos.maiorAtrasoDias} dias`}
            />
            </KpiGrade>
            <p className="text-meta leading-relaxed text-ink-3">
              O atraso vem da <strong className="font-semibold text-ink">foto mensal</strong>, como
              adesão, cobertura e sinal — é o modelo desta tela. A{' '}
              <Link href="/receita/inadimplencia" className="text-purple-700 hover:underline">
                inadimplência
              </Link>{' '}
              calcula <strong className="font-semibold text-ink">hoje</strong> e conta por CNPJ, então
              dá outro número: 21 CNPJ em atraso não têm vínculo com conta nenhuma, e o vencimento
              novo do mês corrente ainda não está na foto. As duas estão certas em datas diferentes.
            </p>
          </>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Chips rotulo="Filtrar:">
            <Chip rotulo="todas" href="/carteira" ativo={!q.faixa} conta={rTodos.total} fixo />
            {['critico', 'risco', 'atencao', 'saudavel'].map((f) => (
              <Chip
                key={f}
                rotulo={FAIXA[f] ?? f}
                href={`/carteira?faixa=${f}`}
                ativo={q.faixa === f}
                conta={rTodos.porFaixa.find((x) => x.faixa === f)?.contas ?? 0}
                /* `fixo`: faixa de saúde é estado ESTRUTURAL. Some "crítico"
                   porque hoje não há nenhum e a carteira parece não ter essa
                   dimensão — some o mapa do produto. */
                fixo
              />
            ))}
          </Chips>
          <span className="ml-auto text-meta text-ink-3">
            {r.semItem} sem item aberto
            {r.parciais > 0 && ` · ${r.parciais} com dado parcial`}
            {r.comClausulaProposta > 0 && ` · ${r.comClausulaProposta} com cláusula não conferida`}
          </span>
        </div>

        <Card title={q.faixa ? `Faixa: ${FAIXA[q.faixa] ?? q.faixa}` : 'Ordenada por risco × receita'}>
          {lista.contas.length === 0 ? (
            <Vazio
              titulo={q.faixa ? 'Nenhuma conta nesta faixa.' : 'Nenhuma conta na sua lista.'}
              porque={
                q.faixa
                  ? 'O filtro não achou nada. Volte para "todas" para ver a carteira inteira — pode ser que a faixa esteja vazia hoje, e isso é boa notícia.'
                  : 'A carteira vem do campo de CSM em cada conta. Se você deveria ter contas aqui, é o cadastro que precisa de ajuste — não a tela.'
              }
              acao={{ texto: 'Ver a fila de trabalho', href: '/' }}
              className="border-0 p-0"
            />
          ) : (
            <Table
              cols={['Cliente', 'MRR', 'Faixa', 'Adesão', 'Cobertura', 'Atraso', 'Contato', 'Fila']}
              rows={lista.contas.map((c) => {
                const f = faixaDe(c)
                return [
                  <>
                    <Link
                      href={`/contas/${c.id}`}
                      className="font-semibold text-purple-700 hover:text-purple-500"
                    >
                      {c.razaoSocial}
                    </Link>
                    <span className="mt-0.5 block text-nota text-ink-3">
                      {[c.setor, c.porte].filter(Boolean).join(' · ')}
                      {carteiraToda.visaoDaBase && c.csmEmail && ` · ${c.csmEmail}`}
                      {/* Dado parcial marcado na linha: o número dela não é
                          comparável ao das outras, e não dizer isso convida à
                          comparação errada. */}
                      {c.competencia !== null && !c.completo && (
                        <span className="text-orange-700"> · dado parcial</span>
                      )}
                      {c.clausulasPropostas > 0 && (
                        <span className="text-orange-700">
                          {' · '}
                          {c.clausulasPropostas} cláusula(s) não conferida(s)
                        </span>
                      )}
                    </span>
                  </>,
                  <span className="tabular-nums">{REAIS(c.mrrCentavos)}</span>,
                  <>
                    <Badge tone={f.tom}>{f.rotulo}</Badge>
                    {c.scoreComposto !== null && (
                      <span className="mt-0.5 block tabular-nums text-nota text-ink-3">
                        {c.scoreComposto}
                        {c.scoreParcial && ' parcial'}
                      </span>
                    )}
                  </>,
                  <span className="tabular-nums">{PCT(c.adesao30d)}</span>,
                  <span className="tabular-nums">{PCT(c.coberturaCadastral)}</span>,
                  <span
                    className={cn(
                      'tabular-nums',
                      (c.diasAtrasoMax ?? 0) >= 90
                        ? 'font-semibold text-red'
                        : (c.diasAtrasoMax ?? 0) > 0
                          ? 'text-orange-700'
                          : 'text-ink-3',
                    )}
                  >
                    {FAIXA_ATRASO(c.diasAtrasoMax)}
                    {/* O valor sob os dias: "90+ d" diz que é antigo e não diz se
                        são R$ 300 ou R$ 30 mil, e é o valor que decide se vale a
                        ligação. O dado já vinha carregado e era descartado aqui. */}
                    {Number(c.abertoCentavos ?? 0) > 0 && (
                      <span className="mt-0.5 block text-nota tabular-nums text-ink-3">
                        {REAIS(c.abertoCentavos)}
                      </span>
                    )}
                  </span>,
                  <span
                    className={cn(
                      'tabular-nums',
                      (c.diasDesdeUltimoContato ?? 0) > 60 ? 'text-orange-700' : 'text-ink-3',
                    )}
                  >
                    {c.diasDesdeUltimoContato === null ? '—' : `${c.diasDesdeUltimoContato} d`}
                  </span>,
                  c.itensAbertos > 0 ? (
                    <Link href="/" className="tabular-nums font-semibold text-purple-700">
                      {c.itensAbertos}
                    </Link>
                  ) : (
                    <span className="tabular-nums text-ink-4">—</span>
                  ),
                ]
              })}
            />
          )}
        </Card>

        <p className="max-w-[80ch] text-corpo leading-relaxed text-ink-2">
          A ordem é <strong className="font-semibold">risco × receita</strong>. Por faixa só, uma
          conta crítica de R$ 800 apareceria antes de uma em risco de R$ 40 mil; por MRR só, a maior
          apareceria primeiro mesmo saudável. Nenhuma das duas responde &ldquo;qual conversa eu
          tenho hoje&rdquo;. As {r.semItem} contas sem item aberto são o que a fila não mostra:
          metade está bem, e a outra metade é onde o próximo problema nasce.
        </p>
      </Corpo>
    </>
  )
}
