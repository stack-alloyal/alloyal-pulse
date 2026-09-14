import { faturamentoPorMes, type MesDeFaturamento } from '@pulse/success'
import { Card, Chip, Chips, Kpi, KpiGrade, Table } from '@pulse/ui'

import { Corpo, Topo } from '../../casca'
import { pool } from '../../../../lib/db'
import { exigir } from '../../../../lib/guarda'

export const dynamic = 'force-dynamic'

const BRL = (c: string | null) =>
  c === null
    ? '—'
    : (Number(c) / 100).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
      })

/** "2026-03-01" → "mar/26". */
const MES = (iso: string) => {
  const d = new Date(iso + 'T00:00:00Z')
  const m = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  return `${m[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}`
}

const HOJE_MES = new Date().toISOString().slice(0, 7)

type Base = 'competencia' | 'caixa' | 'ambas'

/**
 * Faturamento — o que foi COBRADO (competência) e o que ENTROU (caixa).
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POR QUE UMA ABA PRÓPRIA, E NÃO UM FILTRO NA CASCATA.                       │
 * │                                                                            │
 * │ A Cascata é MRR — receita recorrente, competência por definição; não existe │
 * │ "MRR em caixa". Enfiar um alternador de base ali misturaria dois regimes, e  │
 * │ misturar caixa com competência é exatamente o erro que gera número errado.   │
 * │ Aqui o assunto É a diferença entre os dois — o gap é inadimplência + timing. │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Competência ancora no VENCIMENTO — o mês do serviço, e o mesmo que a Carteira e
 * a inadimplência já usam, para os números baterem entre as telas. O universo é o
 * de CLIENTE (o mesmo de `analytics.mrr_faturado_mes`): sem ele, o total incluiria
 * Fornecedor e Investidor e diria R$ 9 mi onde a receita de cliente é R$ 1,3 mi.
 */
export default async function Faturamento({
  searchParams,
}: {
  searchParams: Promise<{ base?: string }>
}) {
  await exigir((p) => p.receita === 'base' || p.configurar, 'faturamento')
  const q = await searchParams
  const base: Base =
    q.base === 'caixa' ? 'caixa' : q.base === 'competencia' ? 'competencia' : 'ambas'

  const meses = await faturamentoPorMes(pool(), 12)

  /* Os fechados: meses passados (não o corrente, que ainda recebe pagamento).
     A soma e o KPI só olham eles — o mês em curso tem caixa pela metade e
     inflaria a diferença com um atraso que é só o calendário. */
  const fechados = meses.filter((m) => m.competencia.slice(0, 7) < HOJE_MES && m.caixaCentavos !== null)
  const somaComp = fechados.reduce((s, m) => s + Number(m.competenciaCentavos), 0)
  const somaCaixa = fechados.reduce((s, m) => s + Number(m.caixaCentavos ?? 0), 0)
  const gap = somaComp - somaCaixa
  const taxa = somaComp > 0 ? (somaCaixa / somaComp) * 100 : null

  const link = (b: Base) => `/receita/faturamento?base=${b}`

  return (
    <>
      <Topo
        href="/receita/faturamento"
        titulo="Faturamento"
        proposito="o que foi cobrado (competência) e o que entrou (caixa)"
      />
      <Corpo className="grid gap-5">
        <p className="max-w-[80ch] text-corpo leading-relaxed text-ink-2">
          <strong className="font-semibold">Competência</strong> conta o título no mês do{' '}
          <strong className="font-semibold">vencimento</strong> — o que foi cobrado.{' '}
          <strong className="font-semibold">Caixa</strong> conta no mês do{' '}
          <strong className="font-semibold">pagamento</strong> — o que entrou. A diferença entre os
          dois é inadimplência e timing; somá-los ou trocar um pelo outro dá número errado. Universo
          de cliente, ancorado no vencimento — os mesmos da Carteira.
        </p>

        {fechados.length > 0 && (
          <KpiGrade colunas={4}>
            <Kpi
              rotulo="Cobrado · meses fechados"
              valor={BRL(String(somaComp))}
              nota={`${fechados.length} mês(es) por competência`}
            />
            <Kpi rotulo="Recebido · meses fechados" valor={BRL(String(somaCaixa))} nota="por caixa" />
            <Kpi
              rotulo="Ainda não entrou"
              valor={BRL(String(gap))}
              nota="cobrado e não recebido — inadimplência + timing"
              {...(gap > 0 ? { tom: 'amber' as const } : {})}
            />
            <Kpi
              rotulo="Taxa de recebimento"
              valor={taxa === null ? '—' : `${taxa.toFixed(1)}%`}
              nota="do que foi cobrado, quanto entrou"
              tom="green"
            />
          </KpiGrade>
        )}

        <Chips rotulo="base:">
          <Chip rotulo="Ambas" href={link('ambas')} ativo={base === 'ambas'} fixo />
          <Chip rotulo="Competência" href={link('competencia')} ativo={base === 'competencia'} fixo />
          <Chip rotulo="Caixa" href={link('caixa')} ativo={base === 'caixa'} fixo />
        </Chips>

        <Card title="Faturamento por mês">
          <Table
            cols={
              base === 'competencia'
                ? ['Mês', 'Competência (cobrado)']
                : base === 'caixa'
                  ? ['Mês', 'Caixa (recebido)']
                  : ['Mês', 'Competência (cobrado)', 'Caixa (recebido)', 'Diferença']
            }
            rows={meses.map((m) => linhaDaTabela(m, base))}
          />
        </Card>
      </Corpo>
    </>
  )
}

/** Uma linha da tabela, no formato que a base escolhida pede. */
function linhaDaTabela(m: MesDeFaturamento, base: Base): React.ReactNode[] {
  const futuro = m.competencia.slice(0, 7) > HOJE_MES
  const emCurso = m.competencia.slice(0, 7) === HOJE_MES
  const mes = (
    <span className="whitespace-nowrap tabular-nums">
      {MES(m.competencia)}
      {emCurso && <span className="ml-1 text-nota text-ink-4">· em curso</span>}
      {futuro && <span className="ml-1 text-nota text-ink-4">· a vencer</span>}
    </span>
  )
  const comp = <span className="tabular-nums">{BRL(m.competenciaCentavos)}</span>
  const caixa = <span className="tabular-nums text-ink-2">{BRL(m.caixaCentavos)}</span>

  if (base === 'competencia') return [mes, comp]
  if (base === 'caixa') return [mes, caixa]

  /* A diferença só faz sentido onde caixa existe: no futuro/em curso ela é o
     calendário, não inadimplência, então mostra travessão em vez de um número
     que assustaria à toa. */
  const dif =
    m.caixaCentavos === null ? (
      <span className="text-ink-4">—</span>
    ) : (
      <Diferenca competencia={m.competenciaCentavos} caixa={m.caixaCentavos} />
    )
  return [mes, comp, caixa, dif]
}

function Diferenca({ competencia, caixa }: { competencia: string; caixa: string }) {
  const d = Number(competencia) - Number(caixa)
  if (Math.abs(d) < 100) return <span className="text-ink-4">=</span>
  return (
    <span className="whitespace-nowrap tabular-nums font-semibold text-amber-800" title="Cobrado − Recebido">
      {BRL(String(d))}
    </span>
  )
}
