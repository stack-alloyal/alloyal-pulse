import { listarConferencia, resumoDaFila } from '@pulse/config'
import { Aviso, Badge, Card, Table, Vazio } from '@pulse/ui'
import { ArrowLeft, ScanSearch } from 'lucide-react'
import Link from 'next/link'

import { Corpo, Topo } from '../../casca'
import { pool } from '../../../../lib/db'
import { exigir } from '../../../../lib/guarda'

export const dynamic = 'force-dynamic'

/**
 * A fila de conferência — onde duas fontes discordam sobre a mesma conta.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A regra "Lecupon vence" JÁ está aplicada ao valor gravado. Esta tela existe │
 * │ porque vencer não é o mesmo que estar certa: nas 44 divergências medidas, os│
 * │ dois lados apontam para empresas diferentes no HubSpot, e uma das duas está │
 * │ errada em cada caso.                                                       │
 * │                                                                            │
 * │ Sem a fila, a regra teria transformado 44 erros conhecidos em 44 erros      │
 * │ silenciosos — e ninguém procura o que não sabe que existe.                  │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export default async function Conferencia({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; erro?: string }>
}) {
  await exigir((p) => p.configurar, 'fila de conferência')
  const q = await searchParams
  const [itens, resumo] = await Promise.all([
    listarConferencia(pool()),
    resumoDaFila(pool()),
  ])

  const abertas = itens.filter((i) => i.estado === 'aberta')
  const fechadas = itens.filter((i) => i.estado !== 'aberta')

  return (
    <>
      <Topo
        href="/dados"
        titulo="Conferência de fontes"
        proposito="onde Lecupon e Omie discordam sobre a mesma conta"
        icone={ScanSearch}
        acoes={
          <span className="flex items-center gap-3 text-[13px]">
            <span className="text-ink-2">
              {resumo.abertas} aberta(s) · {resumo.resolvidas} conferida(s)
              {resumo.ignoradas > 0 && ` · ${resumo.ignoradas} ignorada(s)`}
            </span>
            <Link
              href="/dados"
              className="inline-flex items-center gap-1 font-semibold text-purple-700 hover:text-purple-500"
            >
              <ArrowLeft className="h-[14px] w-[14px]" />
              Dados
            </Link>
          </span>
        }
      />
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

        <p className="max-w-[80ch] text-[13px] leading-relaxed text-ink-2">
          O valor que o Pulse usa é o da <strong className="font-semibold">Lecupon</strong> —
          essa decisão já está aplicada. O que se confere aqui é se ela está{' '}
          <em>certa</em> em cada caso: os dois sistemas apontam para empresas diferentes no
          HubSpot, e conferir é olhar as duas fichas e decidir qual descreve este cliente.
        </p>

        {abertas.length === 0 ? (
          <Vazio
            titulo="Nenhuma divergência aberta."
            porque="Ou as fontes concordam, ou tudo já foi conferido. Divergência nova aparece aqui quando a sincronização roda e encontra dois valores diferentes para o mesmo campo."
          />
        ) : (
          <Card title={`Aguardando conferência · ${abertas.length}`}>
            <Table
              cols={['Conta', 'CNPJ', 'Situação', 'HubSpot na Lecupon', 'HubSpot no Omie', '']}
              rows={abertas.map((i) => [
                <Link
                  href={`/dados/conferencia/${i.id}`}
                  className="font-semibold text-purple-700 hover:text-purple-500"
                >
                  {i.conta}
                </Link>,
                <span className="tabular-nums text-[12.5px] text-ink-2">{i.cnpj ?? '—'}</span>,
                i.statusCore === 'active' ? (
                  <Badge tone="green">ativa</Badge>
                ) : (
                  <Badge tone="amber">{i.statusCore ?? '—'}</Badge>
                ),
                /* Os dois valores lado a lado na LISTA: em boa parte dos casos a
                   diferença é óbvia ao olhar, e obrigar a abrir a ficha para ver os
                   números seria um clique por nada. */
                <span className="tabular-nums text-[12.5px] font-semibold text-ink">
                  {i.valorLecupon ?? '—'}
                </span>,
                <span className="tabular-nums text-[12.5px] text-ink-2">{i.valorOmie ?? '—'}</span>,
                <Link
                  href={`/dados/conferencia/${i.id}`}
                  className="whitespace-nowrap text-[12.5px] font-semibold text-purple-700 hover:text-purple-500"
                >
                  conferir →
                </Link>,
              ])}
            />
          </Card>
        )}

        {fechadas.length > 0 && (
          <Card title={`Já conferidas · ${fechadas.length}`}>
            <Table
              cols={['Conta', 'Decisão', 'Quem', 'Quando', 'Nota']}
              rows={fechadas.map((i) => [
                <Link
                  href={`/dados/conferencia/${i.id}`}
                  className="font-semibold text-purple-700 hover:text-purple-500"
                >
                  {i.conta}
                </Link>,
                i.estado === 'ignorada' ? (
                  <Badge>ignorada</Badge>
                ) : i.decisao === 'nenhum' ? (
                  <Badge tone="red">nenhuma das duas</Badge>
                ) : (
                  <Badge tone="green">vale {i.decisao}</Badge>
                ),
                <span className="text-[12.5px] text-ink-2">{i.decididoPor?.split('@')[0] ?? '—'}</span>,
                <span className="whitespace-nowrap text-[12.5px] tabular-nums text-ink-3">
                  {i.decididoEm ? new Date(i.decididoEm).toLocaleDateString('pt-BR') : '—'}
                </span>,
                <span className="text-[12.5px] text-ink-2">{i.nota ?? '—'}</span>,
              ])}
            />
          </Card>
        )}
      </Corpo>
    </>
  )
}
