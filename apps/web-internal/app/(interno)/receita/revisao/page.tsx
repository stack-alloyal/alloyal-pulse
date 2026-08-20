import {
  contasQuePararamDeFaturar,
  contasSemVinculoComOmie,
  revisaoDoReajuste,
  JANELA_DO_REAJUSTE,
  MESES_DE_CARENCIA,
} from '@pulse/config'
import { Aviso, Badge, Card, Kpi, KpiGrade, Table, Vazio } from '@pulse/ui'
import { ExternalLink } from 'lucide-react'
import Link from 'next/link'

import { Corpo, Topo } from '../../casca'
import { pool } from '../../../../lib/db'
import { exigir, temEscopo } from '../../../../lib/guarda'

export const dynamic = 'force-dynamic'

/**
 * Revisão de faturamento: onde o faturamento e o cadastro discordam.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ NÃO É "/relatorios", e a distinção importa: aquela tela é o que o CLIENTE    │
 * │ recebe, congelado no envio. Esta é auditoria nossa, e o número dela muda a   │
 * │ cada sincronização — mostrar as duas no mesmo lugar faria alguém mandar      │
 * │ para o cliente uma lista de cobranças que deixamos de fazer.                │
 * │                                                                            │
 * │ As três seções estão na ordem do dinheiro que está em jogo, e cada uma tem   │
 * │ uma ação diferente do outro lado. É por isso que são três listas.            │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

const N = (v: number) => v.toLocaleString('pt-BR')
/**
 * Dinheiro COM centavos, inclusive nos KPIs.
 *
 * A tabela da base arredonda porque tem onze colunas e duas delas são dinheiro —
 * ali os centavos custam a coluna Cliente. Aqui não: são poucas colunas, e o
 * número desta tela vai para uma reunião. "R$ 64.094,65 deixaram de entrar" se
 * defende; "R$ 64.095" convida a perguntar de onde saiu o arredondamento.
 *
 * O portão do §08 acusou a primeira versão desta tela, que arredondava. Ele
 * estava certo.
 */
const BRL = (c: number) =>
  (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MES = (r: string | null) => {
  if (!r) return '—'
  const [a, m] = r.split('-')
  return `${MESES[Number(m) - 1] ?? m}/${(a ?? '').slice(2)}`
}
const DOC = (d: string | null) => {
  const s = (d ?? '').replace(/\D/g, '')
  if (s.length === 14) return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`
  if (s.length === 11) return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`
  return d ?? '—'
}
/** A configuração da conta no painel. A chave é o CNPJ sem pontuação. */
const PAINEL = (cnpj: string | null) => {
  const d = (cnpj ?? '').replace(/\D/g, '')
  return d ? `https://dashboard.alloyal.com.br/business/${d}/configuracao` : null
}

function NoPainel({ cnpj }: { cnpj: string | null }) {
  const url = PAINEL(cnpj)
  if (!url) return <span className="text-ink-4">—</span>
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title="Abre a configuração desta conta no painel"
      aria-label="Abrir no painel"
      className="inline-flex items-center text-purple-700 hover:text-purple-500"
    >
      <ExternalLink className="h-[14px] w-[14px]" />
    </a>
  )
}

export default async function RevisaoDeFaturamento() {
  await exigir((p) => temEscopo(p.contas), 'revisão de faturamento')
  const db = pool()
  const [pararam, reajuste, semVinculo] = await Promise.all([
    contasQuePararamDeFaturar(db),
    revisaoDoReajuste(db),
    contasSemVinculoComOmie(db),
  ])

  const mrrQueSumiu = pararam.reduce((s, c) => s + c.mrrAnterior, 0)
  const mrrParado = reajuste.semReajusteVencidos.reduce((s, c) => s + c.mrrMensal, 0)
  const comCandidato = semVinculo.filter((c) => c.temCandidatoNoOmie).length

  return (
    <>
      <Topo
        href="/receita/revisao"
        titulo="Revisão de faturamento"
        proposito="onde o faturamento e o cadastro discordam"
      />
      <Corpo className="grid gap-5">
        <KpiGrade colunas={4}>
          <Kpi
            rotulo="Pararam e seguem ativos"
            valor={N(pararam.length)}
            nota={`${BRL(mrrQueSumiu)}/mês que deixaram de entrar`}
            tom="red"
          />
          <Kpi
            rotulo="Sem reajuste, aniversário vencido"
            valor={N(reajuste.semReajusteVencidos.length)}
            nota={`${BRL(mrrParado)}/mês na base antiga`}
            tom="amber"
          />
          <Kpi
            rotulo="Perda acumulada desde março"
            valor={BRL(reajuste.perdaAcumulada)}
            nota={`${BRL(reajuste.perdaMensal)}/mês × ${reajuste.mesesDesdeOReajuste} meses fechados`}
            tom="red"
          />
          <Kpi
            rotulo="Contas sem vínculo com o Omie"
            valor={N(semVinculo.length)}
            nota={`${N(comCandidato)} com CNPJ igual esperando ligação`}
          />
        </KpiGrade>

        <Aviso tom="alerta">
          <strong className="font-semibold">Os três números não se somam, e é de propósito.</strong>{' '}
          As <strong className="font-semibold">{N(semVinculo.length)}</strong> contas sem vínculo com
          o Omie estão fora das outras duas listas — sobre elas não se pode afirmar nem que pararam
          nem que faltou reajuste, porque não há faturamento nosso ligado a elas. Encolher essa fila
          é o que torna as duas primeiras confiáveis.
        </Aviso>

        {/* ── 1 ── */}
        <Card title={`Pararam de faturar e seguem ativos no painel · ${N(pararam.length)}`}>
          <Table
            cols={['Cliente', 'ID', 'Último mês', 'Parado há', 'MRR que sumiu', 'Cadastrados', '']}
            rows={pararam.map((c) => [
              <span key="n" className="block min-w-0 max-w-[24ch] lg:max-w-[32ch]">
                <Link
                  href={`/carteira/base/${c.accountId}`}
                  className="block truncate font-medium text-ink hover:text-purple-700 hover:underline"
                >
                  {c.razaoSocial}
                </Link>
                <span className="block text-nota text-ink-3">{DOC(c.cnpj)}</span>
              </span>,
              <span key="b" className="font-mono text-meta text-ink-2">{c.brandId ?? '—'}</span>,
              <span key="m" className="whitespace-nowrap tabular-nums text-ink-2">{MES(c.ultimoMes)}</span>,
              <Badge key="p" tone={c.mesesParado >= 12 ? 'red' : 'amber'}>
                {c.mesesParado} {c.mesesParado === 1 ? 'mês' : 'meses'}
              </Badge>,
              <span key="v" className="whitespace-nowrap tabular-nums text-ink">
                {c.mrrAnterior > 0 ? BRL(c.mrrAnterior) : <span className="text-ink-4">—</span>}
              </span>,
              <span key="u" className="tabular-nums text-ink-2">{N(c.usuariosCadastrados)}</span>,
              <NoPainel key="l" cnpj={c.cnpj} />,
            ])}
            vazio="Nenhuma conta ativa parou de faturar."
          />
          <p className="mt-3 text-meta leading-relaxed text-ink-3">
            <strong className="font-semibold text-ink">O corte é de {MESES_DE_CARENCIA} meses
            cheios</strong> sem título faturado. Menos que isso marcaria como parado todo cliente que
            vence dia 20, todo dia 1º — e fila falsa é ignorada em duas semanas.{' '}
            <strong className="font-semibold text-ink">MRR que sumiu</strong> é a média dos três
            últimos meses em que ele faturou, não do último: o último costuma ser justamente o mês
            parcial em que a cobrança já estava caindo. O status é o do painel
            (<code className="font-mono text-meta">status_core = active</code>), e não o booleano
            <code className="font-mono text-meta"> ativo</code> — este também fica falso quando a
            conta não vem na carga do core, que é ausência de dado e não decisão de ninguém.
          </p>
        </Card>

        {/* ── 2 ── */}
        <Card
          title={`Sem o reajuste, com aniversário vencido · ${N(reajuste.semReajusteVencidos.length)}`}
          actions={
            <span className="text-corpo text-ink-2">
              taxa de referência{' '}
              <strong className="font-semibold text-ink">{reajuste.taxaPct}%</strong>
            </span>
          }
        >
          <Aviso tom="info">
            <strong className="font-semibold">A taxa foi lida do dado, não digitada.</strong> É a
            moda dos aumentos observados entre{' '}
            {MES(JANELA_DO_REAJUSTE.antesDe.slice(0, 7))} e {MES(JANELA_DO_REAJUSTE.depoisDe.slice(0, 7))}:{' '}
            <strong className="font-semibold">{N(reajuste.clientesNaTaxa)}</strong> dos{' '}
            {N(reajuste.clientesQueSubiram)} clientes que subiram estão exatamente em{' '}
            {reajuste.taxaPct}%. Março fica fora das duas janelas de comparação porque o mês do
            reajuste carrega cobrança extra e retroativo — medido, o MRR de março foi R$ 1,85 milhão
            contra ~R$ 1,2 milhão nos meses vizinhos, e comparar contra ele inventaria aumento em
            quem não teve nenhum.
          </Aviso>
          <div className="mt-4">
            <Table
              cols={['Cliente', 'Documento', 'Contrato desde', 'Aniversários', 'MRR hoje', 'Deixa de entrar', '']}
              rows={reajuste.semReajusteVencidos.map((c) => [
                <span key="n" className="block min-w-0 max-w-[24ch] lg:max-w-[32ch]">
                  {c.accountId ? (
                    <Link
                      href={`/carteira/base/${c.accountId}`}
                      className="block truncate font-medium text-ink hover:text-purple-700 hover:underline"
                    >
                      {c.razaoSocial}
                    </Link>
                  ) : (
                    <span className="block truncate font-medium text-ink">{c.razaoSocial}</span>
                  )}
                </span>,
                <span key="d" className="whitespace-nowrap tabular-nums text-meta text-ink-2">{DOC(c.documento)}</span>,
                <span key="c" className="whitespace-nowrap tabular-nums text-ink-2">
                  {c.contratoDesde ? c.contratoDesde.split('-').reverse().join('/') : '—'}
                </span>,
                <span key="a" className="tabular-nums text-ink-2">{c.aniversarios}</span>,
                <span key="m" className="whitespace-nowrap tabular-nums text-ink">{BRL(c.mrrMensal)}</span>,
                <span key="p" className="whitespace-nowrap tabular-nums font-semibold text-red">
                  {BRL(c.perdaMensal)}
                </span>,
                <NoPainel key="l" cnpj={c.documento} />,
              ])}
              vazio="Todo contrato com aniversário vencido já foi reajustado."
            />
          </div>
          <p className="mt-3 text-meta leading-relaxed text-ink-3">
            <strong className="font-semibold text-ink">{N(reajuste.clientesSemMudanca)}</strong>{' '}
            clientes não tiveram mudança de MRR entre as duas janelas. Destes,{' '}
            <strong className="font-semibold text-ink">{N(reajuste.semReajusteVencidos.length)}</strong>{' '}
            têm contrato iniciado há 12 meses ou mais — aniversário vencido, reajuste não aplicado — e{' '}
            {N(reajuste.semReajusteNaoDevidos)} têm contrato novo demais, corretamente sem reajuste.{' '}
            A soma fecha com o total, e é assim que se confere esta tela.
            <br />
            <strong className="font-semibold text-ink">A perda acumulada</strong> é{' '}
            {BRL(reajuste.perdaMensal)} por mês × {reajuste.mesesDesdeOReajuste} meses FECHADOS ={' '}
            {BRL(reajuste.perdaAcumulada)}. O mês corrente não entra: ele ainda está sendo faturado,
            e contá-lo inflaria o número com um mês que não terminou.
          </p>
        </Card>

        {/* ── 3 ── */}
        <Card title={`Contas ativas sem vínculo com o Omie · ${N(semVinculo.length)}`}>
          {semVinculo.length === 0 ? (
            <Vazio
              titulo="Toda conta ativa tem vínculo com o Omie."
              porque="Então as duas listas acima cobrem a base inteira — nenhum cliente ativo está fora do alcance desta revisão."
            />
          ) : (
            <Table
              cols={['Cliente', 'ID', 'HubSpot ID', 'Cadastrados', 'Candidato no Omie', '']}
              rows={semVinculo.map((c) => [
                <span key="n" className="block min-w-0 max-w-[24ch] lg:max-w-[32ch]">
                  <Link
                    href={`/carteira/base/${c.accountId}`}
                    className="block truncate font-medium text-ink hover:text-purple-700 hover:underline"
                  >
                    {c.razaoSocial}
                  </Link>
                  <span className="block text-nota text-ink-3">{DOC(c.cnpj)}</span>
                </span>,
                <span key="b" className="font-mono text-meta text-ink-2">{c.brandId ?? '—'}</span>,
                <span key="h" className="font-mono text-meta text-ink-2">{c.hubspotCompanyId ?? '—'}</span>,
                <span key="u" className="tabular-nums text-ink-2">{N(c.usuariosCadastrados)}</span>,
                c.temCandidatoNoOmie ? (
                  <Badge key="c" tone="green">mesmo CNPJ no Omie</Badge>
                ) : (
                  <span key="c" className="text-meta text-ink-4">não existe lá</span>
                ),
                <NoPainel key="l" cnpj={c.cnpj} />,
              ])}
              vazio="—"
            />
          )}
          <p className="mt-3 text-meta leading-relaxed text-ink-3">
            <strong className="font-semibold text-ink">Candidato no Omie</strong> separa duas filas
            com ações opostas: <em>mesmo CNPJ no Omie</em> é ligação que falta fazer — e são apenas{' '}
            {N(comCandidato)} —, enquanto <em>não existe lá</em> é conta que o financeiro nunca
            cadastrou, e aí a pergunta é se ela deveria estar ativa no painel. Sem essa coluna as{' '}
            {N(semVinculo.length)} viram um monte só e ninguém sabe por onde começar.
          </p>
        </Card>
      </Corpo>
    </>
  )
}
