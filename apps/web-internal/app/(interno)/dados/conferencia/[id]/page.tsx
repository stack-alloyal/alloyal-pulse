import { lerConferencia, todasAsFontes } from '@pulse/config'
import { Aviso, Badge, Btn, Card, Field, TextArea } from '@pulse/ui'
import { ArrowLeft, Database, Store, Wallet } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { decidirConferencia, reabrirConferencia } from '../acoes'
import { Corpo, Topo } from '../../../casca'
import { pool } from '../../../../../lib/db'
import { exigir } from '../../../../../lib/guarda'
import { uuidOu404 } from '../../../../../lib/parametro'

export const dynamic = 'force-dynamic'

/**
 * A ficha de uma divergência, com uma aba por fonte.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ As abas são `<details>` e não JavaScript. Três motivos, e o terceiro é o    │
 * │ que decide: funciona sem hidratar, funciona na impressão, e permite abrir   │
 * │ DUAS ao mesmo tempo — que é exatamente o que se faz ao comparar dois        │
 * │ cadastros. Uma aba clássica esconderia a outra na hora de comparar.         │
 * │                                                                            │
 * │ Os dados vêm da CÓPIA sincronizada, e não ao vivo — a web não decifra       │
 * │ segredo (0016), então não tem como falar com Lecupon ou Omie. Cada aba diz  │
 * │ quando foi sincronizada, para a idade do dado ficar visível.                │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

const ICONE = { pulse: Database, lecupon: Store, omie: Wallet } as const
const TITULO = {
  pulse: 'Pulse — o que está gravado hoje',
  lecupon: 'Lecupon — a fonte que vence (via C18)',
  omie: 'Omie — o financeiro (via C20)',
} as const

export default async function FichaDaConferencia({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ ok?: string; erro?: string }>
}) {
  await exigir((p) => p.configurar, 'fila de conferência')
  const { id } = await params
  const q = await searchParams

  const item = await lerConferencia(pool(), id)
  if (!item) notFound()

  const { rows } = await pool().query<{ brand_id: string }>(
    'SELECT brand_id FROM core.account WHERE id = $1',
    [uuidOu404(item.accountId)],
  )
  const fontes = await todasAsFontes(pool(), {
    id: item.accountId,
    brandId: String(rows[0]?.brand_id ?? ''),
    cnpj: item.cnpj,
  })

  const aberta = item.estado === 'aberta'

  return (
    <>
      <Topo
        href="/dados"
        titulo={item.conta}
        proposito={`divergência em ${item.campo}`}
        icone={Database}
        acoes={
          <span className="flex items-center gap-3 text-[13px]">
            {aberta ? (
              <Badge tone="amber">aguardando conferência</Badge>
            ) : item.estado === 'ignorada' ? (
              <Badge>ignorada</Badge>
            ) : (
              <Badge tone="green">conferida · vale {item.decisao}</Badge>
            )}
            <Link
              href="/dados/conferencia"
              className="inline-flex items-center gap-1 font-semibold text-purple-700 hover:text-purple-500"
            >
              <ArrowLeft className="h-[14px] w-[14px]" />
              Fila
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

        {/* ── O conflito, antes de tudo ── */}
        <Card title="O que diverge">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-purple-500 bg-purple-50 p-4">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-purple-700">
                Lecupon · valor em uso
              </div>
              <div className="mt-1 text-[22px] font-bold tabular-nums text-ink">
                {item.valorLecupon ?? '—'}
              </div>
            </div>
            <div className="rounded-lg border border-line bg-surface-2 p-4">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                Omie
              </div>
              <div className="mt-1 text-[22px] font-bold tabular-nums text-ink-2">
                {item.valorOmie ?? '—'}
              </div>
            </div>
          </div>
          <p className="mt-3 max-w-[80ch] text-[13px] leading-relaxed text-ink-2">
            CNPJ <strong className="font-semibold tabular-nums">{item.cnpj ?? '—'}</strong> ·
            detectado em {new Date(item.detectadoEm).toLocaleString('pt-BR')}. O valor da
            Lecupon é o que o Pulse usa hoje — conferir é decidir se ele descreve{' '}
            <em>este</em> cliente. As abas mostram a cópia sincronizada pelos ciclos, com a
            data de cada uma: a superfície web não fala com as APIs, por desenho.
          </p>
        </Card>

        {/* ── Uma aba por fonte ── */}
        <div className="grid gap-2">
          {fontes.map((f) => {
            const Icone = ICONE[f.fonte]
            return (
              <details
                key={f.fonte}
                open={f.fonte !== 'pulse'}
                className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm"
              >
                <summary className="flex cursor-pointer select-none items-center gap-2 border-b border-line bg-surface-2 px-[18px] py-[13px] text-[14px] font-bold text-ink">
                  <Icone className="h-[15px] w-[15px] text-purple-500" />
                  {TITULO[f.fonte]}
                  {!f.ok && <Badge tone="red">não respondeu</Badge>}
                  {f.ok && f.campos.length === 0 && <Badge tone="amber">sem cadastro</Badge>}
                  {f.ok && f.campos.length > 0 && (
                    <span className="ml-auto text-[11.5px] font-normal text-ink-3">
                      {f.campos.length} campos
                    </span>
                  )}
                </summary>
                <div className="px-[18px] py-[14px]">
                  {f.erro && (
                    /* O erro DITO, e não uma aba vazia: vazio se lê como "não existe
                       cadastro lá", e são coisas diferentes. */
                    <Aviso tom={f.ok ? 'alerta' : 'erro'}>{f.erro}</Aviso>
                  )}
                  {f.campos.length > 0 && (
                    <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                      {f.campos.map((c) => (
                        <div
                          key={c.rotulo}
                          className="flex flex-wrap items-baseline gap-2 border-b border-line py-1 last:border-0"
                        >
                          <dt className="min-w-[13em] text-[11.5px] font-semibold uppercase tracking-[0.05em] text-ink-3">
                            {c.rotulo}
                          </dt>
                          <dd className="m-0 flex-1 break-all text-[13px] tabular-nums text-ink">
                            {c.valor}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              </details>
            )
          })}
        </div>

        {/* ── A decisão ── */}
        {aberta ? (
          <Card title="Conferir">
            <form action={decidirConferencia} className="grid gap-3">
              <input type="hidden" name="id" value={item.id} />
              <TextArea
                label="O que você viu (fica no histórico)"
                name="nota"
                rows={3}
                placeholder="ex.: a ficha do Omie é de outra empresa do mesmo grupo — o id da Lecupon é o certo"
                className="leading-relaxed"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Btn type="submit" name="decisao" value="lecupon">
                  Vale o da Lecupon
                </Btn>
                <Btn type="submit" name="decisao" value="omie" variant="ghost">
                  Vale o do Omie
                </Btn>
                <Btn type="submit" name="decisao" value="nenhum" variant="ghost">
                  Nenhuma das duas
                </Btn>
              </div>
              <p className="max-w-[80ch] text-[12.5px] leading-relaxed text-ink-3">
                <strong className="font-semibold">Nenhuma das duas</strong> é resposta
                válida: quando os dois cadastros estão errados, escolher um deles gravaria
                um dado que ninguém conferiu. A conta fica sem vínculo até alguém
                descobrir o valor certo.
              </p>
            </form>

            <details className="mt-4 text-[12.5px]">
              <summary className="cursor-pointer select-none text-ink-3 hover:text-ink-2">
                não é para conferir — ignorar
              </summary>
              <form action={decidirConferencia} className="mt-2 grid gap-2">
                <input type="hidden" name="id" value={item.id} />
                <input type="hidden" name="decisao" value="nenhum" />
                <input type="hidden" name="ignorar" value="1" />
                <Field
                  label="Motivo (obrigatório)"
                  name="nota"
                  minLength={10}
                  required
                  placeholder="ex.: conta encerrada, não vale conferir"
                />
                <div>
                  <Btn type="submit" variant="danger">
                    Ignorar
                  </Btn>
                </div>
              </form>
            </details>
          </Card>
        ) : (
          <Card title="Conferida">
            <p className="text-[13.5px] leading-relaxed text-ink-2">
              {item.estado === 'ignorada' ? 'Ignorada' : `Decidido que vale o valor da ${item.decisao}`}{' '}
              por <strong className="font-semibold">{item.decididoPor}</strong> em{' '}
              {item.decididoEm ? new Date(item.decididoEm).toLocaleString('pt-BR') : '—'}.
            </p>
            {item.nota && (
              <p className="mt-2 rounded-md border border-line bg-surface-2 p-3 text-[13px] leading-relaxed text-ink-2">
                {item.nota}
              </p>
            )}
            <form action={reabrirConferencia} className="mt-3">
              <input type="hidden" name="id" value={item.id} />
              <Btn type="submit" variant="ghost">
                Reabrir
              </Btn>
            </form>
            <p className="mt-2 max-w-[80ch] text-[12.5px] text-ink-3">
              Reabrir não apaga a decisão anterior — ela fica na nota. Conferência que se
              corrige sem deixar rastro não sustenta a próxima dúvida.
            </p>
          </Card>
        )}
      </Corpo>
    </>
  )
}
