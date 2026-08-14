import { filaDeMatch, resumoDoMatch } from '@pulse/config'
import { Aviso, Badge, Card, Kpi, Table, Vazio } from '@pulse/ui'
import { ArrowLeft, GitMerge } from 'lucide-react'
import Link from 'next/link'

import { Corpo, Topo } from '../../casca'
import { pool } from '../../../../lib/db'
import { exigir, temEscopo } from '../../../../lib/guarda'

export const dynamic = 'force-dynamic'

/**
 * Match e merge: onde o cliente tem identidade que o sistema não ligou a ele.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O SINTOMA QUE CHEGA é "o faturamento da Swile está errado". Nunca chega     │
 * │ "falta um vínculo". Esta tela existe para traduzir um no outro sozinha.     │
 * │                                                                            │
 * │ ORDENADA POR DINHEIRO EM JOGO, não por nome nem por data. Medido: 779 contas │
 * │ sem vínculo nenhum e 140 com ficha de nome parecido. Uma lista desse tamanho │
 * │ em ordem alfabética é uma lista que ninguém termina — a primeira página tem  │
 * │ que ser onde o erro custa mais.                                            │
 * │                                                                            │
 * │ A tela NÃO vincula em lote, e é decisão. Cada vínculo muda o faturamento de  │
 * │ um cliente; um botão "aceitar todos" transformaria heurística de nome em     │
 * │ fato contábil de 140 clientes com um clique, sem ninguém olhar nenhum.      │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

const N = (v: number) => v.toLocaleString('pt-BR')
const BRL = (c: number | string) =>
  (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

const CNPJ = (c: string | null) => {
  const d = (c ?? '').replace(/\D/g, '')
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  return c ?? '—'
}

/** A evidência dita a cor: heurística de nome NUNCA parece confirmação. */
const EVIDENCIA: Record<string, { texto: string; tom: 'green' | 'amber' | 'slate' }> = {
  hubspot: { texto: 'mesmo HubSpot', tom: 'green' },
  raiz: { texto: 'mesma raiz', tom: 'amber' },
  nome: { texto: 'nome parecido', tom: 'slate' },
}

export default async function MatchEMerge() {
  await exigir((p) => temEscopo(p.contas), 'match e merge')
  const db = pool()
  const [resumo, linhas] = await Promise.all([resumoDoMatch(db), filaDeMatch(db, { limite: 120 })])

  return (
    <>
      <Topo
        href="/dados"
        titulo="Match e merge"
        proposito="clientes com identidade no Omie que ninguém ligou a eles"
        icone={GitMerge}
        acoes={
          <Link
            href="/dados"
            className="inline-flex items-center gap-1 text-corpo font-semibold text-purple-700 hover:text-purple-500"
          >
            <ArrowLeft className="h-[14px] w-[14px]" />
            Dados
          </Link>
        }
      />
      <Corpo className="grid gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi
            rotulo="Faturamento não atribuído"
            valor={BRL(resumo.valorPendenteCentavos)}
            tom={resumo.valorPendenteCentavos > 0 ? 'amber' : undefined}
            nota="já vencido, cada ficha contada uma vez"
          />
          <Kpi
            rotulo="Fichas sem dono"
            valor={N(resumo.fichasLivres)}
            nota={`reivindicadas por ${N(resumo.contasComCandidato)} conta(s)`}
          />
          <Kpi rotulo="Sem vínculo nenhum" valor={N(resumo.contasSemVinculo)} nota="nenhuma ficha do Omie ligada" />
          <Kpi
            rotulo="Ligadas só a ficha morta"
            valor={N(resumo.apontandoParaInativa)}
            tom={resumo.apontandoParaInativa > 0 ? 'red' : undefined}
            nota="existe ficha ativa sobrando"
          />
        </div>

        <Aviso tom="alerta">
          <strong className="font-semibold">O caso que criou esta tela.</strong> A Swile mostrava R$ 215 mil de
          faturamento. Ela tem duas fichas no Omie —{' '}
          <span className="tabular-nums">37.374.538/0001-76</span> (LTDA, inativa) e{' '}
          <span className="tabular-nums">26.401.688/0001-05</span> (S.A., ativa) — e as raízes não têm nada em comum. O
          casamento por CNPJ acertou a ficha morta; a viva, com R$ 1,5 milhão vencido, ficou de fora. Nenhuma regra
          automática liga as duas, e os <code className="font-mono text-meta">idHubspot</code> também diferem, porque
          upsell cria empresa nova. Por isso o vínculo é decidido por gente, com motivo e trilha.
        </Aviso>

        {linhas.length === 0 ? (
          <Vazio
            titulo="Nenhum candidato pendente."
            porque="Toda ficha do Omie que se parece com alguma conta já está vinculada a ela — ou a outra conta."
          />
        ) : (
          <Card title={`Onde olhar primeiro · ${N(linhas.length)} de ${N(resumo.contasComCandidato)}`}>
            <Table
              cols={['Cliente', 'CNPJ', 'Vinculado', 'Já atribuído', 'Pendente', 'Evidência', '']}
              rows={linhas.map((l) => [
                <span className="flex items-center gap-2">
                  <Link
                    href={`/carteira/base/${l.accountId}`}
                    className="font-semibold text-purple-700 hover:text-purple-500"
                  >
                    {l.conta}
                  </Link>
                  {!l.ativo && <Badge>inativa</Badge>}
                  {l.apontaParaInativa && <Badge tone="red">só ficha morta</Badge>}
                </span>,
                <span className="whitespace-nowrap tabular-nums text-meta text-ink-2">{CNPJ(l.cnpj)}</span>,
                <span className="tabular-nums text-meta text-ink-2">
                  {l.vinculosOmie === 0 ? <Badge tone="amber">nenhuma</Badge> : `${l.vinculosOmie} ficha(s)`}
                </span>,
                <span className="whitespace-nowrap tabular-nums text-meta text-ink-2">
                  {BRL(l.vinculadoValorCentavos)}
                </span>,
                <span className="whitespace-nowrap tabular-nums text-meta font-semibold text-ink">
                  {BRL(l.candidatoValorCentavos)}
                </span>,
                l.melhorEvidencia ? (
                  <Badge tone={EVIDENCIA[l.melhorEvidencia]?.tom ?? 'slate'}>
                    {EVIDENCIA[l.melhorEvidencia]?.texto ?? l.melhorEvidencia}
                  </Badge>
                ) : (
                  <span className="text-ink-3">—</span>
                ),
                <Link
                  href={`/carteira/base/${l.accountId}#identidades`}
                  className="whitespace-nowrap text-meta font-semibold text-purple-700 hover:text-purple-500"
                >
                  resolver →
                </Link>,
              ])}
            />
            <p className="mt-3 max-w-[90ch] text-meta leading-relaxed text-ink-3">
              <strong className="font-semibold text-ink">Pendente</strong> é o faturamento já vencido que está em fichas
              do Omie sem dono e que se parecem com esta conta. É o tamanho do erro, não uma promessa: aceitar um
              candidato de evidência <em>nome parecido</em> sem olhar é como o número errado nasce do outro lado.
              <br />
              Resolver acontece na ficha do cliente, onde as duas fontes estão à vista — decidir vínculo olhando só uma
              lista é decidir no escuro.
            </p>
          </Card>
        )}
      </Corpo>
    </>
  )
}
