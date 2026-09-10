/**
 * `/cancelamento/dados` — a tabela conta por conta.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ DUAS COLUNAS PEDIDAS NÃO TÊM FONTE, e a tela diz isso em vez de fingir.   │
 * │                                                                            │
 * │ O pedido incluía "data de início do contrato". Medido em 10/09/2026:        │
 * │ `core.contract` tem ZERO linha e `contracts.document` também. Não existe    │
 * │ de onde tirar.                                                             │
 * │                                                                            │
 * │ O que existe é a PRIMEIRA COMPETÊNCIA FATURADA — 1.172 contas, a mais       │
 * │ antiga em 2021-01 — e a coluna se chama "1º faturamento", não "início do    │
 * │ contrato". Chamar de contrato o que é faturamento seria repetir o rótulo    │
 * │ "saíram do faturamento", que passou dias mentindo na tela de Saídas.        │
 * │                                                                            │
 * │ E "Desconto" e "Status do cancelamento" saem do pipeline, que tem zero      │
 * │ linha: chegam `null` e a tela mostra TRAVESSÃO, não zero. Zero afirma "não  │
 * │ houve"; travessão diz "não sei".                                           │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
import { dadosDeCancelamento } from '@pulse/success'
import { Badge, Card, Kpi, KpiGrade, Table, Vazio } from '@pulse/ui'
import Link from 'next/link'

import { SubNav } from '../subnav'
import { Corpo, Topo } from '../../casca'
import { pool } from '../../../../lib/db'
import { exigir, temEscopo } from '../../../../lib/guarda'

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
const MES = (iso: string | null) => (iso === null ? '—' : iso.slice(0, 7))

/** O estado do pedido em palavra de gente, e o tom que ele merece. */
const ESTADO: Record<string, { rotulo: string; tom: 'red' | 'amber' | 'green' | 'slate' }> = {
  anunciado: { rotulo: 'Pedido aberto', tom: 'amber' },
  financeiro: { rotulo: 'Em informações financeiras', tom: 'amber' },
  reversao: { rotulo: 'Em tentativa de reversão', tom: 'amber' },
  em_aviso: { rotulo: 'Aviso prévio correndo', tom: 'red' },
  retido: { rotulo: 'Revertido', tom: 'green' },
  desconto: { rotulo: 'Desconto', tom: 'green' },
  renegociado: { rotulo: 'Renegociado', tom: 'green' },
  encerrado: { rotulo: 'Cancelado', tom: 'red' },
}

export default async function Dados() {
  const id = await exigir((p) => temEscopo(p.contas), 'dados do cancelamento')
  const linhas = await dadosDeCancelamento(pool(), id)

  /* Os KPI em VOLUME e em VALOR, lado a lado — foi o pedido, e a razão é boa:
     "34 contas" e "R$ 1,08 mi" respondem perguntas diferentes, e uma conta de
     R$ 800 pesa igual a uma de R$ 40 mil na primeira. */
  const comRegistro = linhas.filter((l) => l.estado !== null)
  const semRegistro = linhas.filter((l) => l.estado === null)
  const soma = (xs: typeof linhas) => xs.reduce((s, l) => s + Number(l.mrrCentavos), 0)

  return (
    <>
      <Topo href="/cancelamento/dados" />
      <Corpo className="grid gap-5">
        <SubNav atual="dados" />

        <KpiGrade>
          <Kpi rotulo="Contas na tabela" valor={linhas.length} nota={REAIS(String(soma(linhas)))} />
          <Kpi
            rotulo="Com registro no fluxo"
            valor={comRegistro.length}
            nota={REAIS(String(soma(comRegistro)))}
          />
          <Kpi
            rotulo="Sem registro"
            valor={semRegistro.length}
            nota={REAIS(String(soma(semRegistro)))}
            {...(semRegistro.length > 0 ? { tom: 'amber' as const } : {})}
          />
          <Kpi
            rotulo="Já canceladas"
            valor={linhas.filter((l) => l.estado === 'encerrado').length}
            nota={`de ${linhas.filter((l) => l.competenciaQueParou !== null).length} que pararam de faturar`}
          />
        </KpiGrade>

        <Card title="Conta por conta">
          {linhas.length === 0 ? (
            <Vazio
              titulo="Nenhuma conta saindo ou saída."
              porque="A tabela traz quem tem pedido no fluxo ou parou de faturar. Vazia significa que ninguém saiu e ninguém está saindo — é o estado que se quer."
              className="border-0 p-0"
            />
          ) : (
            <>
              <Table
                cols={[
                  'Conta',
                  '1º faturamento',
                  'Levantou a mão',
                  'MRR',
                  'Desconto',
                  'Parou de faturar',
                  'Status',
                ]}
                rows={linhas.map((l) => [
                  <Link
                    href={`/contas/${l.accountId}`}
                    prefetch={false}
                    className="font-medium text-purple-700 hover:underline"
                  >
                    {l.razaoSocial}
                  </Link>,
                  <span className="whitespace-nowrap tabular-nums text-ink-3">
                    {MES(l.primeiroFaturamento)}
                  </span>,
                  <span className="whitespace-nowrap tabular-nums">{DIA(l.dataLevantada)}</span>,
                  <span className="tabular-nums">{REAIS(l.mrrCentavos)}</span>,
                  <span className="tabular-nums">{REAIS(l.descontoCentavos)}</span>,
                  <span className="whitespace-nowrap tabular-nums">
                    {MES(l.competenciaQueParou)}
                  </span>,
                  /* `whitespace-nowrap` porque o selo quebrava em duas linhas e
                     esticava a altura de cada linha da tabela — visto na
                     renderização, com 300 linhas na tela. */
                  <span className="whitespace-nowrap">
                    {l.estado === null ? (
                      <Badge tone="slate">sem registro</Badge>
                    ) : (
                      <Badge tone={ESTADO[l.estado]?.tom ?? 'slate'}>
                        {ESTADO[l.estado]?.rotulo ?? l.estado}
                      </Badge>
                    )}
                  </span>,
                ])}
              />
              <p className="mt-3 max-w-[80ch] text-meta leading-relaxed text-ink-3">
                <strong className="font-semibold text-ink">1º faturamento</strong>, e não início de
                contrato: `core.contract` e `contracts.document` estão vazias, então não existe fonte
                para a data de contrato — o que se tem é a primeira competência em que a conta
                faturou.{' '}
                <strong className="font-semibold text-ink">Travessão não é zero</strong>: as colunas
                de levantada, desconto e status vêm do fluxo, e travessão significa que ninguém
                registrou — não que não houve.
              </p>
            </>
          )}
        </Card>
      </Corpo>
    </>
  )
}
