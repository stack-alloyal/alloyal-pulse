import { categoriasDoOmie, estadoDaIntegracao } from '@pulse/config'
import { Abas, Aviso, Badge, Card, Kpi, KpiGrade, Table, Vazio } from '@pulse/ui'
import { ArrowLeft, Wallet } from 'lucide-react'
import Link from 'next/link'

import { Corpo, Topo } from '../../casca'
import { pool } from '../../../../lib/db'
import { exigir } from '../../../../lib/guarda'

export const dynamic = 'force-dynamic'

/**
 * Configurações → Omie: o estado da integração, em abas.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A pergunta é "posso confiar no número que acabei de ver?", e ela tem três    │
 * │ partes que se confundem: a última execução terminou bem, ela foi completa,  │
 * │ e o que está gravado é DAQUELA execução.                                    │
 * │                                                                            │
 * │ A terceira é a que engana. Uma varredura que falha na página 900 de 1.243   │
 * │ grava 900 e deixa o resto com o dado da véspera — e uma tela que só mostre  │
 * │ "última execução: ok" diz que está tudo sincronizado. Por isso o percentual │
 * │ de frescor por tabela, que é a coisa mais próxima de uma resposta honesta.  │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * As abas moram na URL (`?aba=`), como no Publi: sobrevivem a recarregar e podem
 * ser mandadas por link.
 */

const N = (v: number) => v.toLocaleString('pt-BR')
const BRL = (c: number | string) =>
  (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const QUANDO = (d: Date | null) =>
  d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'

const DURACAO = (s: number | null) =>
  s === null ? '—' : s < 90 ? `${s}s` : `${Math.floor(s / 60)}min ${s % 60}s`

const TOM_STATUS: Record<string, 'green' | 'amber' | 'red' | 'slate'> = {
  ok: 'green',
  inerte: 'amber',
  erro: 'red',
  falha: 'red',
  rodando: 'slate',
}

const ABAS = [
  { k: 'integracao', rotulo: 'Integração' },
  { k: 'execucoes', rotulo: 'Execuções' },
  { k: 'categorias', rotulo: 'Categorias' },
] as const

export default async function ConfiguracoesOmie({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; todas?: string }>
}) {
  await exigir((p) => p.configurar, 'configurações do Omie')
  const q = await searchParams
  const aba = ABAS.find((a) => a.k === q.aba)?.k ?? 'integracao'
  const db = pool()

  const [estado, categorias] = await Promise.all([
    estadoDaIntegracao(db),
    aba === 'categorias' ? categoriasDoOmie(db, { comMovimento: q.todas !== '1' }) : Promise.resolve([]),
  ])

  const u = estado.ultima
  const parcial = Boolean((u?.detalhe as Record<string, unknown> | null)?.['parcial'])
  const link = (extra: Record<string, string>) =>
    `/configuracoes/omie?${new URLSearchParams({ aba, ...extra }).toString()}`

  return (
    <>
      <Topo
        href="/configuracoes"
        titulo="Omie"
        proposito="a integração financeira: o que entrou, quando, e quanto está fresco"
        icone={Wallet}
        acoes={
          <span className="flex items-center gap-3 text-corpo">
            {estado.credencialCadastrada ? (
              <Badge tone="green">credencial cadastrada</Badge>
            ) : (
              <Badge tone="red">sem credencial</Badge>
            )}
            <Link
              href="/configuracoes"
              className="inline-flex items-center gap-1 font-semibold text-purple-700 hover:text-purple-500"
            >
              <ArrowLeft className="h-[14px] w-[14px]" />
              Configurações
            </Link>
          </span>
        }
      />
      <Corpo className="grid gap-5">
        {/* A barra de abas é do design system: a regra que ela carrega é que a aba
            vive na query string, e não em estado local. */}
        <Abas
          abas={ABAS.map((a) => ({ chave: a.k, rotulo: a.rotulo }))}
          atual={aba}
          href={(k) => `/configuracoes/omie?aba=${k}`}
        />

        {!estado.credencialCadastrada && (
          <Aviso tom="erro">
            <strong className="font-semibold">A integração está inerte.</strong> Faltam{' '}
            <code className="font-mono text-meta">omie.app_key</code> e{' '}
            <code className="font-mono text-meta">omie.app_secret</code> em{' '}
            <Link href="/configuracoes/segredos" className="font-semibold text-purple-700 hover:text-purple-500">
              Configurações → Segredos
            </Link>
            . O ciclo roda, não lê nada e registra <em>inerte</em> — que não é sucesso.
          </Aviso>
        )}

        {estado.totalDeFalhasSeguidas > 0 && (
          <Aviso tom="erro" papel="alert">
            <strong className="font-semibold">
              {estado.totalDeFalhasSeguidas} execução(ões) seguida(s) falharam.
            </strong>{' '}
            Os números das telas de cliente são de antes disso. O erro da última está na aba Execuções.
          </Aviso>
        )}

        {/* ═══ Integração ═══ */}
        {aba === 'integracao' && (
          <>
            <KpiGrade>
              <Kpi
                rotulo="Última execução"
                valor={<span className="text-[19px]">{QUANDO(u?.iniciadoEm ?? null)}</span>}
                tom={u?.status === 'ok' ? 'green' : u?.status ? 'red' : undefined}
                nota={u ? `${u.status} · ${DURACAO(u.duracaoSegundos)}` : 'nunca rodou'}
              />
              <Kpi
                rotulo="Registros lidos"
                valor={N(u?.linhasLidas ?? 0)}
                nota={`${N(u?.linhasGravadas ?? 0)} gravados`}
              />
              <Kpi
                rotulo="Varredura"
                valor={parcial ? 'parcial' : u?.status === 'ok' ? 'completa' : '—'}
                tom={parcial ? 'red' : u?.status === 'ok' ? 'green' : undefined}
                nota={parcial ? 'parou no meio — há dado da véspera' : 'todas as páginas'}
              />
              <Kpi
                rotulo="Agenda"
                valor={<span className="text-[19px]">04:10</span>}
                nota={`diária · ${estado.agenda}`}
              />
            </KpiGrade>

            <Card title="Quanto de cada tabela veio da última execução">
              <Table
                cols={['Tabela', 'Linhas', 'Da última execução', '%', 'Sincronizado em']}
                rows={estado.frescor.map((t) => [
                  <span className="font-medium text-ink">{t.tabela}</span>,
                  <span className="tabular-nums text-ink-2">{N(t.linhas)}</span>,
                  <span className="tabular-nums text-ink-2">{N(t.atualizadas)}</span>,
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
                      <span
                        className={`block h-full rounded-full ${t.percentual >= 99 ? 'bg-green' : t.percentual >= 80 ? 'bg-amber' : 'bg-red'}`}
                        style={{ width: `${Math.max(t.percentual, 1)}%` }}
                      />
                    </span>
                    <span className="tabular-nums text-meta font-semibold text-ink">{t.percentual}%</span>
                  </span>,
                  <span className="whitespace-nowrap tabular-nums text-meta text-ink-3">
                    {QUANDO(t.maisRecente)}
                  </span>,
                ])}
              />
              <p className="mt-3 max-w-[92ch] text-meta leading-relaxed text-ink-3">
                <strong className="font-semibold text-ink">O percentual é a pergunta que importa.</strong> &quot;Última
                execução: ok&quot; não garante que tudo foi atualizado — uma varredura que falha na página 900 de 1.243
                grava 900 e deixa o resto com o dado da véspera. Abaixo de 100%, alguma linha é de antes.
              </p>
            </Card>
          </>
        )}

        {/* ═══ Execuções ═══ */}
        {aba === 'execucoes' && (
          <Card title={`Histórico de execuções · ${N(estado.execucoes.length)}`}>
            {estado.execucoes.length === 0 ? (
              <Vazio titulo="Nenhuma execução." porque="O ciclo C20 ainda não rodou nesta base." />
            ) : (
              <Table
                cols={['Início', 'Status', 'Duração', 'Lidas', 'Gravadas', 'Detalhe']}
                rows={estado.execucoes.map((e) => [
                  <span className="whitespace-nowrap tabular-nums text-meta text-ink">{QUANDO(e.iniciadoEm)}</span>,
                  <Badge tone={TOM_STATUS[e.status] ?? 'slate'}>{e.status}</Badge>,
                  <span className="whitespace-nowrap tabular-nums text-meta text-ink-2">
                    {DURACAO(e.duracaoSegundos)}
                  </span>,
                  <span className="tabular-nums text-meta text-ink-2">{N(e.linhasLidas ?? 0)}</span>,
                  <span className="tabular-nums text-meta text-ink-2">{N(e.linhasGravadas ?? 0)}</span>,
                  <span className="text-meta text-ink-2">
                    {e.erro ? (
                      <span className="text-red">{e.erro.slice(0, 140)}</span>
                    ) : e.detalhe ? (
                      Object.entries(e.detalhe)
                        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                        .join(' · ')
                    ) : (
                      '—'
                    )}
                  </span>,
                ])}
              />
            )}
            <p className="mt-3 max-w-[92ch] text-meta leading-relaxed text-ink-3">
              <strong className="font-semibold text-ink">inerte</strong> não é sucesso: é o ciclo tendo rodado e não
              lido nada por falta de credencial. Aparece separado de <strong className="font-semibold">ok</strong> de
              propósito — como &quot;ok&quot;, a tela diria &quot;última execução bem-sucedida&quot; para uma
              integração que nunca leu uma linha.
            </p>
          </Card>
        )}

        {/* ═══ Categorias ═══ */}
        {aba === 'categorias' && (
          <Card
            title={`Categorias do Omie · ${N(categorias.length)}`}
            actions={
              <Link
                href={link({ todas: q.todas === '1' ? '0' : '1' })}
                className="text-meta font-semibold text-purple-700 hover:text-purple-500"
              >
                {q.todas === '1' ? 'só as que têm movimento' : 'mostrar todas as 225'}
              </Link>
            }
          >
            {categorias.length === 0 ? (
              <Vazio
                titulo="Nenhuma categoria sincronizada."
                porque="O ciclo C20 traz o plano de categorias do Omie. Se ele nunca rodou com credencial, esta lista fica vazia."
              />
            ) : (
              <>
                <Table
                  cols={['Código', 'Nome', 'Natureza', 'Títulos', 'Faturado']}
                  rows={categorias.map((c) => [
                    <span className="whitespace-nowrap font-mono text-meta text-ink-3">{c.codigo}</span>,
                    <span className="text-corpo font-medium text-ink">
                      {c.descricao}
                      {c.totalizadora && (
                        <>
                          {' '}
                          <Badge>totalizadora</Badge>
                        </>
                      )}
                      {c.inativa && (
                        <>
                          {' '}
                          <Badge tone="red">inativa</Badge>
                        </>
                      )}
                    </span>,
                    <span className="text-meta text-ink-2">{c.natureza ?? '—'}</span>,
                    <span className="tabular-nums text-meta text-ink-2">
                      {c.titulos > 0 ? N(c.titulos) : '—'}
                    </span>,
                    <span className="whitespace-nowrap tabular-nums text-meta font-semibold text-ink">
                      {c.valorCentavos > 0 ? BRL(c.valorCentavos) : '—'}
                    </span>,
                  ])}
                />
                <p className="mt-3 max-w-[92ch] text-meta leading-relaxed text-ink-3">
                  Ordenadas por valor, e não por código: em ordem de código,{' '}
                  <strong className="font-semibold text-ink">1.01.02 (MRR)</strong> — que responde por três quartos dos
                  títulos da base — ficaria entre duas categorias vazias. O código continua na primeira coluna para
                  conferir no Omie; nas telas de cliente aparece o nome.
                </p>
              </>
            )}
          </Card>
        )}
      </Corpo>
    </>
  )
}
