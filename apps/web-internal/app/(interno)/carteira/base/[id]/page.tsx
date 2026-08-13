import { corDoCliente, fichaDoCliente, iniciaisDoCliente } from '@pulse/config'
import { Aviso, Badge, Card, Kpi, Table, Vazio } from '@pulse/ui'
import { ArrowLeft, Building2 } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Corpo, Topo } from '../../../casca'
import { pool } from '../../../../../lib/db'
import { exigir, temEscopo } from '../../../../../lib/guarda'
import { uuidOu404 } from '../../../../../lib/parametro'

export const dynamic = 'force-dynamic'

/**
 * A ficha do cliente: o que o Admin sabe, o que o Omie sabe, e todo o faturamento.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ TUDO VEM DO POSTGRES, e não das APIs — o oposto da tela de conferência, e   │
 * │ por dois motivos independentes:                                            │
 * │                                                                            │
 * │ 1. A web conecta como `pulse_api`, que tem SELECT por COLUNA em            │
 * │    `ops.segredo` — tudo menos `valor_cifrado`. Ela NÃO decifra segredo, de  │
 * │    propósito (0016): é a superfície exposta, e um furo aqui não pode virar  │
 * │    exfiltração das credenciais de integração. Logo não há como falar com o  │
 * │    Omie a partir daqui. Quem fala é o worker, no ciclo C20.                 │
 * │                                                                            │
 * │ 2. São 90.041 títulos na base. Mesmo com credencial, ninguém abre uma       │
 * │    página em cima de uma varredura de 15 minutos.                          │
 * │                                                                            │
 * │ O preço é que o dado tem IDADE, e a tela DIZ qual — o rodapé de cada bloco  │
 * │ mostra quando aquela fonte foi sincronizada. Um número sem data se lê como  │
 * │ "agora", e é assim que alguém cobra um cliente por um título já pago.       │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

const N = (v: number) => v.toLocaleString('pt-BR')

const BRL = (centavos: number | string) =>
  (Number(centavos) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const DOC = (d: string | null) => {
  const s = (d ?? '').replace(/\D/g, '')
  if (s.length === 14) return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`
  if (s.length === 11) return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`
  return d ?? '—'
}

const DATA = (d: Date | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—')

const MES = (m: string) => {
  const [a, mm] = m.split('-')
  return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(mm) - 1]}/${a?.slice(2)}`
}

/** Pares rótulo/valor. É a forma que uma ficha pede — não é tabela, é cadastro. */
function Campos({ pares }: { pares: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-0 sm:grid-cols-2">
      {pares.map(([r, v]) => (
        <div key={r} className="flex flex-wrap items-baseline gap-2 border-b border-line py-1.5 last:border-0">
          <dt className="min-w-[11em] text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-3">{r}</dt>
          <dd className="m-0 flex-1 break-words text-[13px] text-ink">{v || '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

const TOM_STATUS: Record<string, 'green' | 'amber' | 'red' | 'slate'> = {
  RECEBIDO: 'green',
  ATRASADO: 'red',
  CANCELADO: 'slate',
  ABERTO: 'amber',
  PAGO: 'green',
}

export default async function FichaDeCliente({ params }: { params: Promise<{ id: string }> }) {
  await exigir((p) => temEscopo(p.contas), 'ficha do cliente')
  const { id } = await params
  const f = await fichaDoCliente(pool(), uuidOu404(id))
  if (!f) notFound()

  const { conta, omie, vinculo, documentos, resumo, faturamento } = f
  const h = corDoCliente(conta.brandId ?? conta.id)

  // A janela do gráfico são os 24 meses ATÉ HOJE, e não os 24 últimos da série.
  //
  // Descoberto olhando a tela pronta da HINOVA: ela desenhava jul/39 a 2043,
  // porque a base tem parcelas contratadas com vencimento até lá e `slice(-24)`
  // pega o fim do CALENDÁRIO. O histórico que alguém abre esta tela para ver é o
  // recente; o futuro tem KPI próprio.
  const passado = resumo.porMes.filter((m) => !m.futuro)
  const ultimosMeses = passado.slice(-24)
  // Escala pelo maior mês da JANELA: escalar pelo maior da série inteira achataria
  // 24 meses reais contra um pico de 2043 que nem está desenhado.
  const maiorMes = Math.max(...ultimosMeses.map((m) => m.totalCentavos), 1)

  return (
    <>
      <Topo
        href="/carteira/base"
        titulo={conta.razaoSocial}
        proposito={`${DOC(conta.cnpj)} · o cadastro do Admin e o financeiro do Omie`}
        icone={Building2}
        acoes={
          <span className="flex items-center gap-3 text-[13px]">
            <Badge tone={conta.ativo ? 'green' : 'slate'}>{conta.ativo ? 'ativo' : 'inativo'}</Badge>
            <Link
              href="/carteira/base"
              className="inline-flex items-center gap-1 font-semibold text-purple-700 hover:text-purple-500"
            >
              <ArrowLeft className="h-[14px] w-[14px]" />
              Base
            </Link>
          </span>
        }
      />
      <Corpo className="grid gap-5">
        {/* ── Identificação ── */}
        <div className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="relative inline-flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl text-[17px] font-semibold"
            style={{ backgroundColor: `hsl(${h} 62% 92%)`, color: `hsl(${h} 55% 32%)` }}
          >
            {iniciaisDoCliente(conta.razaoSocial)}
            {conta.logoUrl ? (
              <img src={conta.logoUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full bg-white object-contain p-1" />
            ) : null}
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-bold text-ink">{omie?.nomeFantasia ?? conta.razaoSocial}</div>
            <div className="text-[12.5px] text-ink-2">
              {conta.paiRazaoSocial ? (
                <>
                  sub business de{' '}
                  <Link href={`/carteira/base/${conta.paiId}`} className="font-semibold text-purple-700 hover:text-purple-500">
                    {conta.paiRazaoSocial}
                  </Link>
                </>
              ) : conta.subs > 0 ? (
                `main business com ${N(conta.subs)} sub business`
              ) : (
                'sem vínculo de grupo'
              )}
            </div>
          </div>
        </div>

        {/* ── O financeiro, primeiro: é a pergunta que traz alguém aqui ── */}
        {vinculo === 'nenhum' ? (
          <Aviso tom="alerta">
            <strong className="font-semibold">Sem ficha no Omie para este documento.</strong> O CNPJ{' '}
            <span className="tabular-nums">{DOC(conta.cnpj)}</span> não aparece no Omie, nem exato nem pela raiz —
            então não há faturamento a mostrar. Isso não quer dizer que o cliente não paga: pode ser faturado sob
            outro documento do grupo, ou o cadastro do Omie estar com documento diferente.
          </Aviso>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {/* "Faturado" é o que JÁ VENCEU. O contratado à frente vai no KPI ao
                  lado, com o nome certo — somar os dois sob "faturado" multiplicava
                  o número por sete no maior cliente da base. */}
              <Kpi
                rotulo="Faturado até hoje"
                valor={BRL(resumo.vencidoCentavos)}
                nota={`${N(resumo.titulosVencidos)} títulos vencidos`}
              />
              <Kpi rotulo="Recebido" valor={BRL(resumo.pagoCentavos)} tom="green" nota={`último em ${DATA(resumo.ultimoPagamento)}`} />
              <Kpi
                rotulo="Em aberto"
                valor={BRL(resumo.abertoCentavos)}
                tom={resumo.abertoCentavos > 0 ? 'amber' : undefined}
                nota={resumo.abertoCentavos > 0 ? 'de títulos já vencidos' : 'nada vencido em aberto'}
              />
              {/* O MRR declarado volta ao lugar do KPI: a carteira futura saiu da tela
                  por decisão de 13/08 — aqui é histórico. */}
              <Kpi
                rotulo="MRR no Omie"
                valor={omie?.caracteristicas['MRR'] ? `R$ ${omie.caracteristicas['MRR']}` : '—'}
                nota={omie?.caracteristicas['MRR'] ? 'declarado no cadastro' : 'não preenchido no Omie'}
              />
            </div>

            {vinculo === 'raiz' && (
              <Aviso tom="alerta">
                <strong className="font-semibold">O financeiro é do grupo, não só desta conta.</strong> Não existe
                ficha no Omie com o CNPJ exato <span className="tabular-nums">{DOC(conta.cnpj)}</span>, então os
                números acima somam {documentos.length === 1 ? 'o CNPJ' : `os ${documentos.length} CNPJs`} de mesma
                raiz — a Alloyal fatura a matriz e atende as filiais. Cobrar esta conta pelo valor do grupo seria
                cobrar a mais.
              </Aviso>
            )}
          </>
        )}

        {/* ── As duas fontes, lado a lado ── */}
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Admin · o cadastro do programa">
            <Campos
              pares={[
                ['Razão social', conta.razaoSocial],
                ['CNPJ', <span className="tabular-nums">{DOC(conta.cnpj)}</span>],
                ['Business ID', <span className="font-mono text-[12.5px]">{conta.brandId}</span>],
                ['Branch ID', <span className="font-mono text-[12.5px]">{conta.branchId}</span>],
                ['HubSpot ID', <span className="font-mono text-[12.5px]">{conta.hubspotCompanyId}</span>],
                ['Situação', conta.statusCore],
                ['Porte · setor', [conta.porte, conta.setor].filter(Boolean).join(' · ')],
                ['CSM', conta.csmEmail],
                ['Comercial', conta.ownerComercialEmail],
                ['E-mail de contato', conta.contatoEmail],
                ['Usuários autorizados', <span className="tabular-nums">{N(conta.usuariosAutorizados)}</span>],
                ['Usuários cadastrados', <span className="tabular-nums">{N(conta.usuariosCadastrados)}</span>],
              ]}
            />
            <p className="mt-3 text-[11.5px] text-ink-3">
              Sincronizado do core em {DATA(conta.sincronizadoEm)} · ciclo C18.
            </p>
          </Card>

          <Card
            title="Omie · a ficha do financeiro"
            actions={
              omie ? (
                <Badge tone={omie.inativo ? 'slate' : 'green'}>{omie.inativo ? 'inativo' : 'ativo'}</Badge>
              ) : undefined
            }
          >
            {omie ? (
              <>
                <Campos
                  pares={[
                    ['Razão social', omie.razaoSocial],
                    ['Nome fantasia', omie.nomeFantasia],
                    ['Documento', <span className="tabular-nums">{DOC(omie.documento)}</span>],
                    ['Código Omie', <span className="font-mono text-[12.5px]">{omie.codigoOmie}</span>],
                    ['Tipo', omie.pessoaFisica ? 'pessoa física' : 'pessoa jurídica'],
                    ['Data do cadastro', DATA(omie.cadastradoEm)],
                    ['Última alteração', DATA(omie.alteradoEm)],
                    ['Contato', omie.contato],
                    ['E-mail', omie.email],
                    ['Telefone', omie.telefone],
                    ['Cidade · estado', [omie.cidade, omie.estado].filter(Boolean).join(' · ')],
                    [
                      'HubSpot ID',
                      omie.hubspotId ? (
                        <span className="font-mono text-[12.5px]">
                          {omie.hubspotId}
                          {conta.hubspotCompanyId && conta.hubspotCompanyId !== omie.hubspotId ? (
                            <> <Badge tone="red">difere do Admin</Badge></>
                          ) : null}
                        </span>
                      ) : null,
                    ],
                  ]}
                />
                {omie.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-3">Tags</span>
                    {omie.tags.map((t) => (
                      <Badge key={t} tone={t === 'Cliente' ? 'green' : 'slate'}>
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
                {Object.keys(omie.caracteristicas).length > 0 && (
                  <div className="mt-3">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-3">
                      Características
                    </div>
                    <Campos pares={Object.entries(omie.caracteristicas).map(([k, v]) => [k, v])} />
                  </div>
                )}
                <p className="mt-3 text-[11.5px] text-ink-3">
                  Sincronizado do Omie em {DATA(omie.sincronizadoEm)} · ciclo C20.
                </p>
              </>
            ) : (
              <Vazio
                titulo="Sem ficha no Omie."
                porque="Nenhum cadastro com este documento. O cliente pode ser faturado sob outro CNPJ do grupo."
              />
            )}
          </Card>
        </div>

        {/* ── O histórico por mês ── */}
        {ultimosMeses.length > 0 && (
          <Card
            title={`Faturamento por mês de vencimento · ${N(ultimosMeses.length)} de ${N(passado.length)} meses`}
          >
            <div className="overflow-x-auto">
              <div className="flex min-w-[560px] items-end gap-1" style={{ height: 132 }}>
                {ultimosMeses.map((m) => {
                  const alt = Math.max(Math.round((m.totalCentavos / maiorMes) * 112), 2)
                  const recebido = m.totalCentavos > 0 ? Math.min(m.pagoCentavos / m.totalCentavos, 1) : 0
                  return (
                    <div key={m.mes} className="flex flex-1 flex-col items-center justify-end gap-1">
                      {/* A parte cheia é o recebido; o restante, o que não entrou.
                          Duas barras lado a lado ocupariam o dobro para dizer o mesmo. */}
                      <span
                        title={`${MES(m.mes)} · faturado ${BRL(m.totalCentavos)} · recebido ${BRL(m.pagoCentavos)} · ${m.titulos} títulos`}
                        className="relative w-full rounded-t bg-purple-100"
                        style={{ height: alt }}
                      >
                        <span
                          className="absolute inset-x-0 bottom-0 rounded-t bg-purple-500"
                          style={{ height: `${Math.round(recebido * 100)}%` }}
                        />
                      </span>
                      <span className="whitespace-nowrap text-[9.5px] text-ink-3">{MES(m.mes)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
              A barra inteira é o faturado; a parte cheia, o recebido. Últimos{' '}
              {ultimosMeses.length} meses de {N(passado.length)} — o histórico completo está na tabela abaixo.
            </p>
          </Card>
        )}

        {/* ── Por categoria ── */}
        {resumo.categorias.length > 0 && (
          <Card title="Por categoria do Omie">
            <Table
              cols={['Categoria', 'Títulos', 'Valor']}
              rows={resumo.categorias.map((c) => [
                <span className="font-mono text-[12.5px] text-ink">{c.categoria}</span>,
                <span className="tabular-nums text-ink-2">{N(c.titulos)}</span>,
                <span className="tabular-nums font-semibold text-ink">{BRL(c.totalCentavos)}</span>,
              ])}
            />
            <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
              <strong className="font-semibold text-ink">1.01.02</strong> é a receita de assinatura — 76% dos títulos
              da base inteira. As demais separam setup, repasse e avulsos.
            </p>
          </Card>
        )}

        {/* ── Todo o histórico ── */}
        <Card title={`Histórico de faturamento · ${N(faturamento.length)} títulos`}>
          {faturamento.length === 0 ? (
            <Vazio
              titulo="Nenhum título."
              porque="Ou o cliente não tem faturamento no Omie, ou é faturado sob outro documento."
            />
          ) : (
            <>
              <Table
                cols={['Título', 'Categoria', 'Emissão', 'Vencimento', 'Pagamento', 'Valor', 'Recebido', 'Aberto', 'Situação']}
                rows={faturamento.map((t) => [
                  <span className="font-mono text-[11.5px] text-ink-3">{t.codigoTitulo}</span>,
                  <span className="font-mono text-[11.5px] text-ink-2">{t.categoria ?? '—'}</span>,
                  <span className="whitespace-nowrap tabular-nums text-[12px] text-ink-2">{DATA(t.emissao)}</span>,
                  <span className="whitespace-nowrap tabular-nums text-[12px] text-ink">{DATA(t.vencimento)}</span>,
                  <span className="whitespace-nowrap tabular-nums text-[12px] text-ink-2">{DATA(t.pagamento)}</span>,
                  <span className="whitespace-nowrap tabular-nums text-[12px] font-semibold text-ink">{BRL(t.valorCentavos)}</span>,
                  <span className="whitespace-nowrap tabular-nums text-[12px] text-ink-2">{BRL(t.pagoCentavos)}</span>,
                  <span className="whitespace-nowrap tabular-nums text-[12px] text-ink-2">
                    {Number(t.abertoCentavos) > 0 ? BRL(t.abertoCentavos) : '—'}
                  </span>,
                  <Badge tone={TOM_STATUS[t.status ?? ''] ?? 'slate'}>{t.status?.toLowerCase() ?? '—'}</Badge>,
                ])}
              />
              <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
                Todos os títulos já vencidos, do mais recente ao mais antigo, sem corte — uma lista truncada faria a
                soma da tela discordar dos totais acima.
                {resumo.titulosAVencer > 0 && (
                  <>
                    {' '}
                    <strong className="font-semibold text-ink">
                      {N(resumo.titulosAVencer)} parcelas ainda a vencer não entram aqui
                    </strong>{' '}
                    (até {DATA(resumo.ultimoVencimento)}, {BRL(resumo.aVencerCentavos)}): esta tela é do que já
                    aconteceu. Carteira contratada é outra pergunta.
                  </>
                )}
                {documentos.length > 1 && (
                  <>
                    {' '}
                    Somando {documentos.length} CNPJs de mesma raiz:{' '}
                    <span className="tabular-nums">{documentos.map(DOC).join(', ')}</span>.
                  </>
                )}
              </p>
            </>
          )}
        </Card>
      </Corpo>
    </>
  )
}
