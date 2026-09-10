/**
 * `/cancelamento` — a Visão Geral.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O QUE ESTA PÁGINA RESPONDE: "quanto estamos perdendo, e sabemos por quê?" │
 * │                                                                            │
 * │ Os quatro KPI ficam como estavam — são o par de churns lado a lado, e a     │
 * │ prosa entre eles explica por que contas e receita não fecham no mesmo mês.  │
 * │                                                                            │
 * │ O gráfico é a parte nova, e ver `grafico.tsx` para por que a faixa "não     │
 * │ apurado" é o assunto dele e não sobra de desenho.                          │
 * │                                                                            │
 * │ A tabela de "últimos cancelamentos realizados" lê `estado = 'encerrado'`, e │
 * │ em 10/09/2026 tem ZERO linha — encerrar exige três confirmações humanas     │
 * │ (aviso, última cobrança, distrato) e ninguém percorreu o fluxo ainda. O     │
 * │ vazio dela aponta para a tabela que TEM dado: a de Dados, com as 794        │
 * │ contas que o faturamento viu sair.                                         │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
import {
  graficoDeCancelamento,
  listarSaidas,
  resumoChurn,
  rotuloDoMotivo,
} from '@pulse/success'
import { Aviso, Card, Kpi, KpiGrade, Table, Vazio } from '@pulse/ui'
import Link from 'next/link'

import { Grafico } from './grafico'
import { SubNav } from './subnav'
import { Corpo, Topo } from '../casca'
import { pool } from '../../../lib/db'
import { exigir, temEscopo } from '../../../lib/guarda'

export const dynamic = 'force-dynamic'

const REAIS = (c: string | null) =>
  c === null
    ? '—'
    : (Number(c) / 100).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
      })

const DIA = (iso: string | null) => (iso === null ? '—' : iso.split('-').reverse().join('/'))

export default async function VisaoGeral({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; erro?: string; janela?: string }>
}) {
  const q = await searchParams
  const id = await exigir((p) => temEscopo(p.contas), 'visão geral do cancelamento')
  /* 6 ou 12, e nada mais: janela livre por query seria consulta arbitrária vinda
     da URL. O padrão é 12 — a pergunta do gráfico é de tendência. */
  const janela: 6 | 12 = q.janela === '6' ? 6 : 12

  const hoje = new Date().toISOString().slice(0, 10)
  const comp = `${hoje.slice(0, 7)}-01`
  const veReceita = temEscopo(id.permissoes.receita)

  const [resumo, meses, saidas] = await Promise.all([
    veReceita ? resumoChurn(pool(), comp) : null,
    veReceita ? graficoDeCancelamento(pool(), janela) : Promise.resolve([]),
    listarSaidas(pool(), id),
  ])

  /* "Realizado" é `encerrado`, e só isso: os três desfechos que SALVAM o cliente
     (retido, desconto, renegociado) não são cancelamento — contá-los aqui
     afirmaria uma saída que não houve. */
  const realizados = saidas
    .filter((s) => s.estado === 'encerrado')
    .slice(0, 10)

  return (
    <>
      <Topo href="/cancelamento" />
      <Corpo className="grid gap-5">
        {q.erro && (
          <Aviso tom="erro" papel="alert">
            {q.erro}
          </Aviso>
        )}
        {q.ok && (
          <Aviso tom="ok" papel="status">
            {q.ok}
          </Aviso>
        )}

        <SubNav atual="geral" />

        {resumo && (
          <>
            {/* Os dois churns lado a lado. Ver juntos é o ponto: o mês em que as
                contas saem quase nunca é o mês em que a receita sai. */}
            <KpiGrade>
              <Kpi
                rotulo={`Churn de contas · ${resumo.competencia}`}
                valor={resumo.contasQueLevantaram}
                nota={
                  <>
                    {REAIS(resumo.mrrQueLevantouCentavos)} levantaram a mão
                    {resumo.retidasDepois > 0 && ` · ${resumo.retidasDepois} revertida(s) depois`}
                  </>
                }
              />
              <Kpi
                rotulo={`Churn de receita · ${resumo.competencia}`}
                valor={REAIS(resumo.mrrRealizadoCentavos)}
                nota={`${resumo.contasComEfeito} conta(s) saíram pelo fluxo`}
              />
              <Kpi
                rotulo="Saída comprometida"
                valor={REAIS(resumo.mrrComprometidoCentavos)}
                nota={`${resumo.contasComprometidas} conta(s) já perdidas ainda faturando`}
                {...(Number(resumo.mrrComprometidoCentavos) > 0 ? { tom: 'amber' as const } : {})}
              />
              <Kpi
                rotulo="Retido no mês"
                valor={REAIS(resumo.mrrRetidoCentavos)}
                nota={`${resumo.retidasNaCompetencia} saída(s) revertida(s)`}
              />
            </KpiGrade>

            <p className="max-w-[80ch] text-meta leading-relaxed text-ink-3">
              Contas e receita não fecham no mesmo mês, e a diferença é de propósito: um cliente que
              levanta a mão hoje entra no churn de contas hoje, mas continua faturando durante todo o
              aviso prévio. Reconhecer a perda no dia do anúncio subestima o trimestre; contar o
              cliente como ativo até a última fatura esconde uma perda que já aconteceu — e que
              ainda dava para reverter.
            </p>

            <Grafico meses={meses} janela={janela} />
          </>
        )}

        <Card title={`Últimos cancelamentos realizados (${realizados.length})`}>
          {realizados.length === 0 ? (
            <Vazio
              titulo="Nenhum cancelamento concluído pelo fluxo."
              porque="Encerrar exige três confirmações humanas — aviso prévio, último mês de cobrança e aprovação do distrato — e nenhum pedido percorreu o fluxo até o fim. O que o FATURAMENTO já viu sair está na página Dados, conta por conta."
              acao={{ texto: 'Ver os dados', href: '/cancelamento/dados' }}
              className="border-0 p-0"
            />
          ) : (
            <Table
              cols={['Conta', 'Levantou a mão', 'Receita parou em', 'MRR', 'Motivo', 'Origem']}
              rows={realizados.map((s) => [
                <Link
                  href={`/contas/${s.accountId}`}
                  prefetch={false}
                  className="font-medium text-purple-700 hover:underline"
                >
                  {s.conta}
                </Link>,
                <span className="whitespace-nowrap tabular-nums">{DIA(s.dataLevantada)}</span>,
                <span className="whitespace-nowrap tabular-nums">
                  {s.competenciaEfeitoReceita ?? '—'}
                </span>,
                <span className="tabular-nums">{REAIS(s.mrrCentavosNaLevantada)}</span>,
                <span>{s.motivo === null ? '—' : rotuloDoMotivo(s.motivo)}</span>,
                <span>{s.origem === 'alloyal' ? 'Alloyal (PDD)' : 'Cliente'}</span>,
              ])}
            />
          )}
        </Card>
      </Corpo>
    </>
  )
}
