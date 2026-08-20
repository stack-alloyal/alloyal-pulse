import {
  candidatosDaConta,
  corDoCliente,
  diagnosticoDaConta,
  fichaDoCliente,
  historicoDeVinculos,
  iniciaisDoCliente,
  buscarNoOmie,
  vinculosDaConta,
} from '@pulse/config'
import { Aviso, Badge, Btn, Busca, Card, Chip, Chips, Field, Kpi, KpiGrade, Table, TextArea, Vazio } from '@pulse/ui'
import { ArrowLeft, Building2, ExternalLink, GitMerge } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { desvincularIdentidade, vincularIdentidade } from './acoes'

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

/**
 * O endereço da conta no painel da Alloyal — o Admin de verdade.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A CHAVE DO PAINEL É O CNPJ SEM PONTUAÇÃO, não o Business ID nem o id       │
 * │ interno: `dashboard.alloyal.com.br/business/34254084000101/configuracao`.   │
 * │                                                                            │
 * │ Devolve `null` sem CNPJ, e a tela não desenha o botão. Um link para         │
 * │ `/business//configuracao` levaria a uma tela de erro do painel, o que é     │
 * │ pior que não ter link: parece que o Pulse está quebrado.                    │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
const PAINEL = (cnpj: string | null) => {
  const d = (cnpj ?? '').replace(/\D/g, '')
  return d ? `https://dashboard.alloyal.com.br/business/${d}/configuracao` : null
}

const DOC = (d: string | null) => {
  const s = (d ?? '').replace(/\D/g, '')
  if (s.length === 14) return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`
  if (s.length === 11) return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`
  return d ?? '—'
}

const DATA = (d: Date | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—')

/**
 * O status do programa no Admin, com o nome e a cor que ele merece.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ SÃO QUATRO ESTADOS, e o booleano `ativo` funde três deles. Medido em        │
 * │ 17/08/2026: active 2.157, suspended_by_overdue 592, inactive 454,           │
 * │ suspended 11. "Suspenso por atraso" e "inativo" pedem ações opostas — um é  │
 * │ cobrança, o outro é churn — e um selo que diga "inativo" para os dois manda  │
 * │ 592 contas para a fila errada.                                             │
 * │                                                                            │
 * │ O CASO QUE NÃO ESTÁ NO CAMPO: 55 contas têm `status_core = 'active'` com     │
 * │ `ativo = false`. Não é contradição do painel — é o sincronizador: cliente    │
 * │ que não vem na carga do core passa a `ativo = false` ("cliente sai de        │
 * │ circulação por ativo = false", em sincronizar-core). Pintar de verde diria   │
 * │ que está tudo bem numa conta que DESAPARECEU da origem, e número alto ali é  │
 * │ sinal de mudança de escopo da credencial, não de churn.                     │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
const STATUS_ADMIN: Record<string, { texto: string; tom: 'green' | 'amber' | 'slate' }> = {
  active: { texto: 'ativo', tom: 'green' },
  suspended_by_overdue: { texto: 'suspenso por atraso', tom: 'amber' },
  suspended: { texto: 'suspenso', tom: 'amber' },
  inactive: { texto: 'inativo', tom: 'slate' },
}

function SeloDoAdmin({ status, ativo }: { status: string | null; ativo: boolean }) {
  if (!ativo && status === 'active')
    return (
      <span title="O painel diz ativo, mas esta conta não veio na última carga do core">
        <Badge tone="red">fora da carga do core</Badge>
      </span>
    )
  const s = status ? STATUS_ADMIN[status] : undefined
  if (s) return <Badge tone={s.tom}>{s.texto}</Badge>
  // Status novo no core: mostra o código cru em vez de chutar uma cor. Inventar
  // "ativo" para um valor desconhecido é o erro que não aparece em revisão.
  return <Badge tone="slate">{status ?? 'sem situação'}</Badge>
}

const MES = (m: string) => {
  const [a, mm] = m.split('-')
  return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(mm) - 1]}/${a?.slice(2)}`
}

/** `aaaa-mm-01` de N meses atrás. O dia 1 porque a série é mensal. */
function mesesAtras(n: number): string {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - (n - 1))
  return d.toISOString().slice(0, 10)
}

/** O link do filtro, preservando o que já estava selecionado. */
/**
 * Para onde um controle desta ficha navega — e ONDE a página para depois.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A ÂNCORA É PARÂMETRO OBRIGATÓRIO porque a ficha tem DUAS seções com        │
 * │ controles próprios, e antes havia um `#faturamento` fixo aqui para as duas.│
 * │                                                                            │
 * │ O efeito medido: com o gráfico no topo da tela (scrollY 3622), clicar no    │
 * │ eixo "emissão" levava a página para 4201 — o topo do card do HISTÓRICO. A   │
 * │ pessoa trocava o eixo do gráfico e tinha de rolar de volta para cima para   │
 * │ ver o gráfico que acabou de mudar. Valia para os seis controles do gráfico: │
 * │ eixo, período, "tudo", limpar datas e as duas visões.                       │
 * │                                                                            │
 * │ Obrigatória e não com valor padrão: um padrão é justamente o que fez o      │
 * │ defeito passar despercebido em seis lugares. Controle novo agora não        │
 * │ compila sem dizer a que seção pertence.                                    │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
type Secao = 'grafico' | 'faturamento' | 'identidades' | 'omie'

const comFiltro = (
  id: string,
  q: Record<string, string | undefined>,
  secao: Secao,
) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) {
    // `ok` e `erro` são mensagens de uma ação que já aconteceu: carregá-las no
    // filtro faria o aviso reaparecer a cada clique, como se tivesse acabado de
    // acontecer de novo.
    if (v && v !== 'todas' && k !== 'ok' && k !== 'erro') p.set(k, v)
  }
  const s = p.toString()
  return `/carteira/base/${id}${s ? `?${s}` : ''}#${secao}`
}

/** Pares rótulo/valor. É a forma que uma ficha pede — não é tabela, é cadastro. */
function Campos({ pares }: { pares: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-0 sm:grid-cols-2">
      {pares.map(([r, v]) => (
        <div key={r} className="flex flex-wrap items-baseline gap-2 border-b border-line py-1.5 last:border-0">
          <dt className="min-w-[11em] text-nota font-semibold uppercase tracking-[0.05em] text-ink-3">{r}</dt>
          <dd className="m-0 flex-1 break-words text-corpo text-ink">{v || '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A situação normalizada da 0040 — seis textos do Omie viram cinco estados. */
const TOM_SITUACAO: Record<string, 'green' | 'amber' | 'red' | 'slate'> = {
  recebido: 'green',
  atrasado: 'red',
  a_vencer: 'amber',
  cancelado: 'slate',
  previsao: 'slate',
}
const ROTULO_SITUACAO: Record<string, string> = {
  recebido: 'recebido',
  atrasado: 'atrasado',
  a_vencer: 'a vencer',
  cancelado: 'cancelado',
  previsao: 'previsão',
}
/** Os três eixos de data. Cada um responde outra pergunta sobre a mesma base. */
const EIXOS = [
  { chave: 'vencimento' as const, rotulo: 'vencimento' },
  { chave: 'emissao' as const, rotulo: 'emissão' },
  { chave: 'pagamento' as const, rotulo: 'pagamento' },
]

/** A cor de cada situação na barra empilhada — a mesma dos selos da tabela. */
const COR_SITUACAO: Record<string, string> = {
  recebido: 'bg-green',
  a_vencer: 'bg-amber',
  atrasado: 'bg-red',
  cancelado: 'bg-ink-4',
}

const SITUACOES = ['todas', 'recebido', 'a_vencer', 'atrasado', 'cancelado', 'previsao'] as const

export default async function FichaDeCliente({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    ok?: string; erro?: string; sit?: string; cat?: string
    eixo?: string; meses?: string; de?: string; ate?: string; vis?: string
    /** Termo da busca manual de ficha no Omie. */
    omie?: string
  }>
}) {
  const identidade = await exigir((p) => temEscopo(p.contas), 'ficha do cliente')
  const { id } = await params
  const q = await searchParams
  const conta_id = uuidOu404(id)
  const filtro = {
    ...(q.sit && q.sit !== 'todas' ? { situacao: q.sit } : {}),
    ...(q.cat && q.cat !== 'todas' ? { categoria: q.cat } : {}),
    incluirPrevisao: q.sit === 'previsao',
  }
  /* A janela do gráfico: 24 meses é o padrão, e o "tudo" existe porque a série
     completa é a pergunta de quem confere contra o Omie. Datas soltas vencem dos
     presets — quem digitou uma data quis aquela. */
  const eixo = (['vencimento', 'emissao', 'pagamento'] as const).find((e) => e === q.eixo) ?? 'vencimento'
  const meses = q.de || q.ate ? null : Number(q.meses ?? 24)
  /**
   * A vista atual em querystring, para viajar com as ações de servidor.
   *
   * As ações de identidade REDIRECIONAM, e um redirect monta a URL do zero — não
   * há como ele "preservar" o que estava na tela. Sem isto, vincular ou
   * desvincular uma identidade devolvia a ficha com eixo, período, visão e os
   * dois filtros do histórico todos no padrão. Então a tela manda o que está
   * valendo, e a ação devolve junto do `ok`/`erro`.
   */
  const vistaAtual = new URLSearchParams(
    Object.entries(q).filter(
      ([k, v]) => v && k !== 'ok' && k !== 'erro',
    ) as [string, string][],
  ).toString()
  const desde =
    q.de ?? (meses && Number.isFinite(meses) ? mesesAtras(meses) : null)
  const f = await fichaDoCliente(pool(), conta_id, filtro, {
    eixo,
    desde,
    ate: q.ate ?? null,
  })
  if (!f) notFound()

  const [identidades, candidatos, diagnostico, historico, achadosNoOmie] = await Promise.all([
    vinculosDaConta(pool(), conta_id),
    candidatosDaConta(pool(), conta_id),
    diagnosticoDaConta(pool(), conta_id),
    historicoDeVinculos(pool(), conta_id),
    // Só busca quando há termo: `buscarNoOmie` recusa abaixo de 3 caracteres, e
    // pedir a consulta em toda abertura de ficha seria uma varredura por nada.
    q.omie ? buscarNoOmie(pool(), q.omie) : Promise.resolve([]),
  ])
  const podeEditar = identidade.permissoes.configurar
  const livres = candidatos.filter((c) => !c.jaVinculadaA)

  const { conta, omie, vinculo, documentos, resumo, faturamento } = f
  const h = corDoCliente(conta.brandId ?? conta.id)

  // A janela do gráfico são os 24 meses ATÉ HOJE, e não os 24 últimos da série.
  //
  // Descoberto olhando a tela pronta da HINOVA: ela desenhava jul/39 a 2043,
  // porque a base tem parcelas contratadas com vencimento até lá e `slice(-24)`
  // pega o fim do CALENDÁRIO. O histórico que alguém abre esta tela para ver é o
  // recente; o futuro tem KPI próprio.
  // `porMes` já exclui previsão na consulta (0040): o que sobra é faturamento
  // emitido, e aí os últimos 24 meses da série SÃO os últimos 24 meses reais.
  const passado = resumo.porMes
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
          <span className="flex items-center gap-3 text-corpo">
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

        {/* ── O DIAGNÓSTICO, antes de qualquer número ──
            O sintoma que chega é "o faturamento está errado", nunca "falta um
            vínculo". Se há dinheiro pendurado em ficha não vinculada, dizer isso
            ANTES dos KPIs — senão a pessoa lê o número errado e vai embora. */}
        {diagnostico.candidatos > 0 && (
          <Aviso tom={diagnostico.apontaParaInativa || diagnostico.candidatoForte ? 'erro' : 'alerta'}>
            <strong className="font-semibold">
              {diagnostico.apontaParaInativa
                ? 'Esta conta está ligada só a ficha inativa do Omie, e existe uma ativa sobrando.'
                : `Há ${diagnostico.candidatos} ficha(s) do Omie que parecem ser deste cliente e não estão vinculadas.`}
            </strong>{' '}
            Somam <strong className="font-semibold tabular-nums">{BRL(diagnostico.candidatoValorCentavos)}</strong> de
            faturamento já vencido que NÃO entra nos números abaixo.{' '}
            <a href="#identidades" className="font-semibold text-purple-700 hover:text-purple-500">
              Ver e resolver ↓
            </a>
          </Aviso>
        )}

        {/* ── Identificação ── */}
        <div className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="relative inline-flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl text-title font-semibold"
            style={{ backgroundColor: `hsl(${h} 62% 92%)`, color: `hsl(${h} 55% 32%)` }}
          >
            {iniciaisDoCliente(conta.razaoSocial)}
            {conta.logoUrl ? (
              <img src={conta.logoUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full bg-white object-contain p-1" />
            ) : null}
          </span>
          <div className="min-w-0">
            <div className="text-secao font-bold text-ink">{omie?.nomeFantasia ?? conta.razaoSocial}</div>
            <div className="text-meta text-ink-2">
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

        {/* A âncora do card do Omie: o "limpar" da busca manual aponta para cá,
            e sem ela a navegação simplesmente não rolaria — foi o portão de
            âncoras que pegou, escrito para exatamente este descuido. */}
        <div id="omie" className="scroll-mt-24" />

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
            <KpiGrade>
              {/* FATURADO é tudo que foi EMITIDO — recebido, cancelado, a vencer e
                  atrasado. Previsão fica fora e tem espaço próprio abaixo: são 66 mil
                  títulos na base que nunca foram faturados, e somá-los aqui
                  multiplicaria o número da Swile por sete. */}
              <Kpi
                rotulo="Faturado"
                valor={BRL(resumo.totalCentavos)}
                nota={`${N(resumo.titulos)} títulos emitidos`}
              />
              <Kpi
                rotulo="Recebido"
                valor={BRL(resumo.recebidoCentavos)}
                tom="green"
                nota={
                  resumo.ultimoPagamento
                    ? `${N(resumo.recebidoTitulos)} títulos · último em ${DATA(resumo.ultimoPagamento)}`
                    : `${N(resumo.recebidoTitulos)} títulos`
                }
              />
              <Kpi
                rotulo="Em aberto"
                valor={BRL(resumo.atrasadoCentavos + resumo.aVencerCentavos)}
                tom={resumo.atrasadoCentavos > 0 ? 'red' : resumo.aVencerCentavos > 0 ? 'amber' : undefined}
                nota={
                  resumo.atrasadoCentavos > 0
                    ? `${N(resumo.atrasadoTitulos)} atrasado(s) · ${N(resumo.aVencerTitulos)} a vencer`
                    : `${N(resumo.aVencerTitulos)} a vencer`
                }
              />
              <Kpi
                rotulo="Cancelado"
                valor={BRL(resumo.canceladoCentavos)}
                tom={resumo.canceladoCentavos > 0 ? 'amber' : undefined}
                nota={`${N(resumo.canceladoTitulos)} títulos faturados e cancelados`}
              />
            </KpiGrade>

            {resumo.previsaoCentavos > 0 && (
              <p className="text-meta leading-relaxed text-ink-3">
                Fora dos números acima:{' '}
                <strong className="font-semibold text-ink-2">{BRL(resumo.previsaoCentavos)}</strong> em{' '}
                {N(resumo.previsaoTitulos)} títulos de <strong className="font-semibold">previsão</strong> — a
                recorrência que o Omie projeta e ainda NÃO emitiu, até {DATA(resumo.ultimoVencimento)}. Não é
                faturamento; é o que se espera faturar.
              </p>
            )}

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
          <Card
          title="Admin · o cadastro do programa"
          /* Simétrico ao card do Omie, que já trazia o seu. A assimetria era o
             defeito: o card do ERP dizia o status num selo e o do nosso painel
             deixava a resposta escondida no meio de treze campos. */
          actions={
            <>
              <SeloDoAdmin status={conta.statusCore} ativo={conta.ativo} />
              {/* ┌───────────────────────────────────────────────────────────────┐
                  │ POR QUE NÃO HÁ BOTÃO DE ATIVAR/INATIVAR AQUI, e o que falta     │
                  │ para haver.                                                     │
                  │                                                                 │
                  │ Sondei a API do Admin sem tocar em conta nenhuma — com o id      │
                  │ 999999999, que não existe:                                       │
                  │                                                                 │
                  │   GET   /businesses/:id   → 404 "Registro não encontrado"        │
                  │   PATCH /businesses/:id   → 403 "Acesso negado"                  │
                  │   POST  .../activate      → 404 "Not Found"                      │
                  │                                                                 │
                  │ A leitura: `PATCH /businesses/:id` É a rota de escrita — se não   │
                  │ existisse, devolveria 404 como as outras. E o 403 num id que não  │
                  │ existe prova que a autorização é checada ANTES do registro: o     │
                  │ nosso token não escreve.                                        │
                  │                                                                 │
                  │ Então o bloqueio é de credencial, não de código. Um botão aqui    │
                  │ prometeria uma ação que falha em 403 — pior que não ter botão.    │
                  │ Quando existir um token com escopo de escrita, a ação são poucas  │
                  │ linhas: PATCH nessa rota, confirmação destrutiva e trilha em      │
                  │ ops.mudanca. Até lá, o caminho é o painel.                       │
                  └───────────────────────────────────────────────────────────────┘ */}
              {PAINEL(conta.cnpj) && (
                <a
                  href={PAINEL(conta.cnpj)!}
                  target="_blank"
                  rel="noreferrer"
                  title="Abre a configuração desta conta no painel, onde se ativa e inativa o cliente"
                  className="inline-flex items-center gap-1 text-corpo font-semibold text-purple-700 hover:text-purple-500"
                >
                  ativar/inativar no painel
                  <ExternalLink className="h-[13px] w-[13px]" />
                </a>
              )}
            </>
          }
        >
          <Aviso tom="alerta">
            <strong className="font-semibold">
              Ativar e inativar daqui depende de um token de escrita no Admin.
            </strong>{' '}
            A rota existe — <code className="font-mono text-meta">PATCH /businesses/:id</code>{' '}
            — e a credencial que o Pulse usa recebe{' '}
            <strong className="font-semibold">403 &quot;Acesso negado&quot;</strong> nela. Conferido
            sem alterar nenhuma conta, com um id inexistente: o mesmo id devolve 404 no{' '}
            <code className="font-mono text-meta">GET</code> e 403 no{' '}
            <code className="font-mono text-meta">PATCH</code>, o que prova que a permissão é
            checada antes do registro. Com um token de escrita em{' '}
            <Link href="/configuracoes/segredos" className="font-semibold text-purple-700 hover:text-purple-500">
              Segredos
            </Link>
            , o botão passa a existir aqui — com confirmação e trilha de quem mudou. Até então, o
            link acima abre o painel.
          </Aviso>

            <Campos
              pares={[
                ['Razão social', conta.razaoSocial],
                ['CNPJ', <span className="tabular-nums">{DOC(conta.cnpj)}</span>],
                ['Business ID', <span className="font-mono text-meta">{conta.brandId}</span>],
                ['Branch ID', <span className="font-mono text-meta">{conta.branchId}</span>],
                ['HubSpot ID', <span className="font-mono text-meta">{conta.hubspotCompanyId}</span>],
                // O CÓDIGO cru, em mono, como Business ID e HubSpot ID: é o valor
                // que veio da API, e é por ele que se confere no core. A leitura em
                // português é o selo do cabeçalho — repetir a mesma palavra em prosa
                // aqui seria dizer duas vezes a mesma coisa.
                ['Situação', <span className="font-mono text-meta">{conta.statusCore}</span>],
                ['Porte · setor', [conta.porte, conta.setor].filter(Boolean).join(' · ')],
                ['CSM', conta.csmEmail],
                ['Comercial', conta.ownerComercialEmail],
                ['E-mail de contato', conta.contatoEmail],
                ['Usuários autorizados', <span className="tabular-nums">{N(conta.usuariosAutorizados)}</span>],
                ['Usuários cadastrados', <span className="tabular-nums">{N(conta.usuariosCadastrados)}</span>],
              ]}
            />
            <p className="mt-3 text-nota text-ink-3">
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
                    ['Código Omie', <span className="font-mono text-meta">{omie.codigoOmie}</span>],
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
                        <span className="font-mono text-meta">
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
                    <span className="text-nota font-semibold uppercase tracking-[0.05em] text-ink-3">Tags</span>
                    {omie.tags.map((t) => (
                      <Badge key={t} tone={t === 'Cliente' ? 'green' : 'slate'}>
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
                {Object.keys(omie.caracteristicas).length > 0 && (
                  <div className="mt-3">
                    <div className="mb-1 text-nota font-semibold uppercase tracking-[0.05em] text-ink-3">
                      Características
                    </div>
                    <Campos pares={Object.entries(omie.caracteristicas).map(([k, v]) => [k, v])} />
                  </div>
                )}
                <p className="mt-3 text-nota text-ink-3">
                  Sincronizado do Omie em {DATA(omie.sincronizadoEm)} · ciclo C20.
                </p>
              </>
            ) : (
              <Vazio
                titulo="Sem ficha no Omie."
                porque="Nenhum cadastro com este documento. O cliente pode ser faturado sob outro CNPJ do grupo — busque abaixo pelo nome que o financeiro usa."
              />
            )}

            {/* ┌──────────────────────────────────────────────────────────────┐
                │ A BUSCA MANUAL, e por que ela é necessária mesmo existindo a   │
                │ lista de candidatos automática.                                │
                │                                                                │
                │ `candidatosDaConta` só sugere com evidência forte — HubSpot     │
                │ igual, raiz de CNPJ igual, ou primeiro termo raro. É o que      │
                │ impede a tela de propor "Banco Afro" para toda conta que        │
                │ comece com "Banco". O preço é que o caso legítimo SEM           │
                │ evidência não aparece: a conta "Playhub" e a ficha "LCI         │
                │ TELECOM" são o mesmo cliente, e nenhuma regra vai adivinhar.    │
                │ Aí quem sabe é a pessoa — e ela precisa de um campo, não de     │
                │ uma sugestão.                                                   │
                │                                                                │
                │ Fica no card do Omie e não no de identidades porque é aqui que  │
                │ a pergunta nasce: quem abre a ficha e vê "sem ficha no Omie"    │
                │ quer procurar agora, não rolar até o fim da página.             │
                └──────────────────────────────────────────────────────────────┘ */}
            <div className="mt-4 border-t border-line pt-4">
              {/* Empilha até `lg`: este card é a coluna direita de uma grade de
                  duas, e em 1024px o campo de 280px mais o botão e o "limpar" não
                  cabiam ao lado do texto — o "limpar" saía 43px além da tela e a
                  página passava a rolar de lado. */}
              <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between">
                <div className="min-w-0">
                  <p className="text-cartao font-bold tracking-[-0.01em] text-ink">
                    Procurar a ficha no Omie
                  </p>
                  <p className="mt-0.5 text-meta text-ink-3">
                    Por nome da organização ou por CNPJ — o financeiro costuma cadastrar
                    com a razão social, que raramente é o nome do programa.
                  </p>
                </div>
                <Busca
                  className="min-w-0"
                  action={`/carteira/base/${conta.id}`}
                  nome="omie"
                  valor={q.omie ?? ''}
                  placeholder="razão social, nome fantasia ou CNPJ"
                  ocultos={Object.fromEntries(
                    Object.entries(q).filter(
                      ([k, v]) => v && k !== 'omie' && k !== 'ok' && k !== 'erro',
                    ) as [string, string][],
                  )}
                  hrefLimpar={comFiltro(conta.id, { ...q, omie: '' }, 'omie')}
                />
              </div>

              {q.omie && q.omie.trim().length >= 3 && (
                <div className="mt-4">
                  {achadosNoOmie.length === 0 ? (
                    <Aviso tom="alerta">
                      <strong className="font-semibold">
                        Nada no Omie para &quot;{q.omie}&quot;.
                      </strong>{' '}
                      Nem por nome, nem por documento. Se o cliente paga, a cobrança sai por
                      outro cadastro — tente a razão social do grupo, ou o CNPJ que aparece
                      no boleto. Se não achar nada, é provável que o financeiro não tenha o
                      cadastro, e aí a pergunta é outra: por que a conta está ativa no
                      painel.
                    </Aviso>
                  ) : (
                    /* ┌─────────────────────────────────────────────────────────┐
                       │ LISTA e não tabela, e a razão é medida: este card é a      │
                       │ coluna DIREITA de uma grade de duas, com ~570px. Uma       │
                       │ tabela de seis colunas ali era recortada — "Títulos"       │
                       │ aparecia como "Títul" e o botão de vincular ficava fora    │
                       │ da tela, o que torna a busca inútil justamente no passo    │
                       │ que importa.                                              │
                       │                                                           │
                       │ Empilhado, cada achado usa a largura que tem: nome em      │
                       │ cima, procedência embaixo, e a ação à direita.             │
                       └─────────────────────────────────────────────────────────┘ */
                    <ul className="grid gap-2">
                      {achadosNoOmie.map((c) => (
                        <li
                          key={c.chave + c.detalhe}
                          /* EMPILHADO, não lado a lado: o card é a coluna direita
                             de uma grade de duas, com ~570px. Com a ação ao lado, o
                             campo de motivo e o botão vazavam para fora da tela —
                             medido duas vezes, primeiro como tabela e depois como
                             linha. Vertical cabe em qualquer largura. */
                          className="grid gap-2 rounded-md border border-line bg-surface-2 p-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-corpo font-semibold text-ink">{c.rotulo}</p>
                            <p className="mt-0.5 truncate text-nota text-ink-3">{c.detalhe}</p>
                            <p className="mt-1 flex flex-wrap items-center gap-2 text-meta text-ink-2">
                              <span className="tabular-nums">{DOC(c.chave)}</span>
                              <span className="text-ink-4">·</span>
                              <span className="tabular-nums">
                                {N(c.titulos)} {c.titulos === 1 ? 'título' : 'títulos'}
                              </span>
                              <span className="text-ink-4">·</span>
                              <span className="tabular-nums font-semibold text-ink">
                                {BRL(c.valorCentavos)}
                              </span>
                              {c.inativo && <Badge tone="slate">inativo</Badge>}
                              {c.jaVinculadaA && <Badge tone="amber">de {c.jaVinculadaA}</Badge>}
                            </p>
                          </div>
                          {/* A ação só existe onde vincular é POSSÍVEL. Ficha que já é
                              de outra conta diz de quem — vincular ali derrubaria o
                              faturamento da outra, e a ação recusa mesmo. Dizer antes é
                              melhor que deixar tentar e explicar depois. */}
                          {c.jaVinculadaA ? (
                            <span className="text-meta text-ink-4">
                              Já é de outra conta — vincular aqui derrubaria o faturamento dela.
                            </span>
                          ) : podeEditar ? (
                            <form action={vincularIdentidade} className="flex flex-wrap items-center gap-2">
                              <input type="hidden" name="accountId" value={conta.id} />
                              <input type="hidden" name="vista" value={vistaAtual} />
                              <input type="hidden" name="fonte" value="omie" />
                              <input type="hidden" name="chave" value={c.chave} />
                              {/* ds-excecao: campo EM LINHA dentro de um item de lista.
                                  O <Field> monta rótulo em bloco e empurraria cada
                                  achado para três alturas; o rótulo vive no aria-label
                                  e a instrução, no placeholder. */}
                              <input
                                name="motivo"
                                minLength={10}
                                required
                                placeholder="por que é o mesmo cliente"
                                aria-label="Por que é o mesmo cliente (obrigatório)"
                                className="h-control-xs min-w-0 flex-1 rounded-sm border border-line-strong bg-surface px-2 text-meta text-ink placeholder:text-ink-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              />
                              <Btn type="submit" variant="ghost">Vincular</Btn>
                            </form>
                          ) : (
                            <span className="shrink-0 self-center text-meta text-ink-4">
                              sem permissão
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* ── O histórico por mês ── */}
        {/* A âncora do gráfico, que faltava: os controles dele apontavam para a do
            histórico. `scroll-mt-24` porque o cabeçalho é `sticky` de 62px — sem a
            margem, o navegador para com o título do card debaixo da barra. */}
        <div id="grafico" className="scroll-mt-24" />
        {passado.length > 0 && (
          <Card
            title={`Faturamento por mês · ${N(ultimosMeses.length)} ${ultimosMeses.length === 1 ? 'mês' : 'meses'}`}
            actions={
              <Chips rotulo="eixo:">
                {EIXOS.map((e) => (
                  <Chip
                    key={e.chave}
                    rotulo={e.rotulo}
                    href={comFiltro(conta.id, { ...q, eixo: e.chave }, 'grafico')}
                    ativo={eixo === e.chave}
                    fixo
                  />
                ))}
              </Chips>
            }
          >
            {/* ┌───────────────────────────────────────────────────────────────┐
                │ TRÊS EIXOS, e cada um responde outra pergunta sobre a MESMA     │
                │ base: por VENCIMENTO é "quando era para entrar"; por EMISSÃO é  │
                │ "quando cobramos"; por PAGAMENTO é "quando entrou de fato".     │
                │ Chamar qualquer um deles de "faturamento por mês" sem dizer     │
                │ qual é o que faz duas pessoas discordarem olhando a mesma tela. │
                └───────────────────────────────────────────────────────────────┘ */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
              <Chips rotulo="período:">
                {[6, 12, 24].map((m) => (
                  <Chip
                    key={m}
                    rotulo={`${m} meses`}
                    href={comFiltro(conta.id, { ...q, meses: String(m), de: '', ate: '' }, 'grafico')}
                    ativo={!q.de && !q.ate && Number(q.meses ?? 24) === m}
                    fixo
                  />
                ))}
                <Chip
                  rotulo="tudo"
                  href={comFiltro(conta.id, { ...q, meses: '999', de: '', ate: '' }, 'grafico')}
                  ativo={!q.de && !q.ate && Number(q.meses ?? 24) === 999}
                  fixo
                />
              </Chips>
              {/* Datas soltas: quem digitou uma data quis aquela, e ela vence do
                  preset. O `form` é GET, então o recorte fica na URL como os chips. */}
              {/* O `#grafico` no `action` é o que faz "aplicar" parar no gráfico: submissão
                      GET reescreve a QUERY do action e preserva o fragmento. Sem ele o
                      formulário era o único controle do card que voltava ao topo da página. */}
                  <form
                    action={`/carteira/base/${conta.id}#grafico`}
                    className="flex items-center gap-1.5"
                  >
                {q.sit && <input type="hidden" name="sit" value={q.sit} />}
                {q.cat && <input type="hidden" name="cat" value={q.cat} />}
                <input type="hidden" name="eixo" value={eixo} />
                {/* A VISÃO vem junto: sem ela, aplicar um intervalo devolvia o
                    gráfico para "valor" sem ninguém ter pedido. `meses` fica de
                    fora DE PROPÓSITO — quem digitou uma data quis aquela, e ela
                    vence do preset; é a única omissão intencional aqui. */}
                {q.vis && <input type="hidden" name="vis" value={q.vis} />}
                {/* ds-excecao: par de datas EM LINHA, com o rótulo ao lado e não acima.
                    O <Field> monta rótulo em bloco e ocupa a largura toda — aqui os dois
                    campos e o botão "aplicar" precisam caber numa linha do cabeçalho. */}
                <label className="text-meta text-ink-3" htmlFor="de">de</label>
                <input
                  id="de" type="date" name="de" defaultValue={q.de ?? ''}
                  className="h-control-xs rounded-sm border border-line-strong bg-surface px-2 text-meta text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {/* ds-excecao: o par do campo acima — mesma linha, mesmo motivo. */}
                <label className="text-meta text-ink-3" htmlFor="ate">até</label>
                <input
                  id="ate" type="date" name="ate" defaultValue={q.ate ?? ''}
                  className="h-control-xs rounded-sm border border-line-strong bg-surface px-2 text-meta text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Btn type="submit" variant="ghost">
                  aplicar
                </Btn>
                {(q.de || q.ate) && (
                  <Link
                    href={comFiltro(conta.id, { ...q, de: '', ate: '' }, 'grafico')}
                    className="px-1 text-meta text-ink-3 hover:text-ink"
                  >
                    limpar
                  </Link>
                )}
              </form>
            </div>

            <div className="mb-2 flex flex-wrap items-center gap-3">
              <Chips rotulo="visão:">
                <Chip rotulo="valor" href={comFiltro(conta.id, { ...q, vis: 'valor' }, 'grafico')} ativo={q.vis !== 'situacao'} fixo />
                <Chip rotulo="situação" href={comFiltro(conta.id, { ...q, vis: 'situacao' }, 'grafico')} ativo={q.vis === 'situacao'} fixo />
              </Chips>
            </div>

            <div className="overflow-x-auto">
              <div className="flex min-w-[560px] items-end gap-1" style={{ height: 150 }}>
                {ultimosMeses.map((m) => {
                  const alt = Math.max(Math.round((m.totalCentavos / maiorMes) * 112), 2)
                  const recebido = m.totalCentavos > 0 ? Math.min(m.pagoCentavos / m.totalCentavos, 1) : 0
                  const titulo = `${MES(m.mes)} · faturado ${BRL(m.totalCentavos)} · recebido ${BRL(m.pagoCentavos)} · ${m.titulos} títulos`
                  return (
                    <div key={m.mes} className="flex flex-1 flex-col items-center justify-end gap-1">
                      {/* A VARIAÇÃO CONTRA O MÊS ANTERIOR fica sobre a barra. É o
                          upsell/downsell lido de uma vez: quatro meses iguais e um
                          com −49% contam a história que a altura sozinha esconde
                          quando a escala é grande. */}
                      <span className="text-micro tabular-nums">
                        {m.deltaPct === null ? (
                          <span className="text-ink-4">—</span>
                        ) : m.deltaPct === 0 ? (
                          <span className="text-ink-3">0%</span>
                        ) : (
                          <span className={m.deltaPct > 0 ? 'font-semibold text-green' : 'font-semibold text-red'}>
                            {m.deltaPct > 0 ? '+' : ''}
                            {(m.deltaPct * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%
                          </span>
                        )}
                      </span>
                      {q.vis === 'situacao' ? (
                        /* Empilhado por situação: a mesma barra, repartida pelo que
                           aconteceu com os títulos daquele mês. */
                        <span title={titulo} className="flex w-full flex-col-reverse overflow-hidden rounded-t" style={{ height: alt }}>
                          {(['recebido', 'a_vencer', 'atrasado', 'cancelado'] as const).map((sit) => {
                            const n = m.porSituacao[sit] ?? 0
                            if (!n) return null
                            return (
                              <span
                                key={sit}
                                className={COR_SITUACAO[sit]}
                                style={{ height: `${(n / m.titulos) * 100}%` }}
                              />
                            )
                          })}
                        </span>
                      ) : (
                        <span title={titulo} className="relative w-full rounded-t bg-purple-100" style={{ height: alt }}>
                          <span
                            className="absolute inset-x-0 bottom-0 rounded-t bg-purple-500"
                            style={{ height: `${Math.round(recebido * 100)}%` }}
                          />
                        </span>
                      )}
                      <span className="whitespace-nowrap text-micro text-ink-3">{MES(m.mes)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
            <p className="mt-3 text-meta leading-relaxed text-ink-3">
              {q.vis === 'situacao' ? (
                <>
                  Cada barra é repartida pela <strong className="font-semibold text-ink">situação</strong> dos
                  títulos do mês: <span className="text-green">recebido</span>,{' '}
                  <span className="text-orange-700">a vencer</span>, <span className="text-red">atrasado</span> e{' '}
                  <span className="text-ink-2">cancelado</span>.
                </>
              ) : (
                'A barra inteira é o faturado; a parte cheia, o recebido.'
              )}{' '}
              O número acima de cada barra é a variação contra o mês anterior da série — é o upsell ou o
              downsell, lido de uma vez.
            </p>
          </Card>
        )}

        {/* ── Por categoria ── */}
        {resumo.categorias.length > 0 && (
          <Card title="Por categoria do Omie">
            <Table
              cols={['Categoria', 'Títulos', 'Valor']}
              rows={resumo.categorias.map((c) => [
                <span className="text-meta font-medium text-ink">
                  {c.nome}
                  {/* O código sai da coluna e vira legenda: quem conversa sobre receita
                      fala "MRR", não "1.01.02". O código continua à vista para quem
                      precisa conferir no Omie. */}
                  <span className="ml-1.5 font-mono text-tabela text-ink-3">{c.categoria}</span>
                </span>,
                <span className="tabular-nums text-ink-2">{N(c.titulos)}</span>,
                <span className="tabular-nums font-semibold text-ink">{BRL(c.totalCentavos)}</span>,
              ])}
            />
            <p className="mt-3 text-meta leading-relaxed text-ink-3">
              Os nomes vêm do plano de categorias do Omie, sincronizado pelo C20 — 225 categorias.{' '}
              <strong className="font-semibold text-ink">MRR</strong> (1.01.02) é a receita de assinatura e responde
              por 76% dos títulos da base inteira; <strong className="font-semibold text-ink">UPFRONT</strong> e{' '}
              <strong className="font-semibold text-ink">SETUP</strong> são 1.01.01 e 1.01.03.
            </p>
          </Card>
        )}

        {/* ── Todo o histórico ── */}
        <div id="faturamento" className="scroll-mt-24" />
        <Card
          title={`Histórico de faturamento · ${N(faturamento.length)} títulos`}
          actions={
            /* Filtro por LINK e não por JavaScript: o estado mora na URL, sobrevive a
               recarregar, e pode ser mandado por mensagem para outra pessoa olhar
               exatamente o mesmo recorte. É o mesmo padrão do `?abrir=` da Base. */
            <Chips rotulo="situação:">
              {SITUACOES.map((sit) => (
                <Chip
                  key={sit}
                  rotulo={sit === 'todas' ? 'todas' : (ROTULO_SITUACAO[sit] ?? sit)}
                  href={comFiltro(conta.id, { ...q, sit }, 'faturamento')}
                  ativo={(q.sit ?? 'todas') === sit}
                  /* `fixo`: a situação é estado ESTRUTURAL. Sumir com "cancelado"
                     porque este cliente não tem nenhum faria parecer que cancelar
                     não existe — a regra do Chip no design system. */
                  fixo
                />
              ))}
            </Chips>
          }
        >
          {resumo.categorias.length > 1 && (
            <div className="mb-3 border-b border-line pb-3">
              <Chips rotulo="categoria:">
                <Chip
                  rotulo="todas"
                  href={comFiltro(conta.id, { ...q, cat: 'todas' }, 'faturamento')}
                  ativo={(q.cat ?? 'todas') === 'todas'}
                  fixo
                />
                {resumo.categorias.map((c) => (
                  <Chip
                    key={c.categoria}
                    rotulo={c.nome}
                    href={comFiltro(conta.id, { ...q, cat: c.categoria }, 'faturamento')}
                    ativo={q.cat === c.categoria}
                    conta={c.titulos}
                  />
                ))}
              </Chips>
            </div>
          )}
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
                  <span className="font-mono text-nota text-ink-3">{t.codigoTitulo}</span>,
                  <span className="text-nota text-ink-2">
                    {t.categoriaNome ?? t.categoria ?? '—'}
                  </span>,
                  <span className="whitespace-nowrap tabular-nums text-meta text-ink-2">{DATA(t.emissao)}</span>,
                  <span className="whitespace-nowrap tabular-nums text-meta text-ink">{DATA(t.vencimento)}</span>,
                  <span className="whitespace-nowrap tabular-nums text-meta text-ink-2">{DATA(t.pagamento)}</span>,
                  <span className="whitespace-nowrap tabular-nums text-meta font-semibold text-ink">{BRL(t.valorCentavos)}</span>,
                  <span className="whitespace-nowrap tabular-nums text-meta text-ink-2">{BRL(t.pagoCentavos)}</span>,
                  <span className="whitespace-nowrap tabular-nums text-meta text-ink-2">
                    {Number(t.abertoCentavos) > 0 ? BRL(t.abertoCentavos) : '—'}
                  </span>,
                  <Badge tone={TOM_SITUACAO[t.situacao] ?? 'slate'}>{ROTULO_SITUACAO[t.situacao] ?? t.status?.toLowerCase() ?? '—'}</Badge>,
                ])}
              />
              <p className="mt-3 text-meta leading-relaxed text-ink-3">
                {q.sit || q.cat ? (
                  <>
                    Filtrado. <Link href={comFiltro(conta.id, {}, 'faturamento')} className="font-semibold text-purple-700">
                      limpar filtros
                    </Link>{' '}
                    para ver os {N(resumo.titulos)} títulos emitidos.
                  </>
                ) : (
                  'Todos os títulos emitidos, do mais recente ao mais antigo, sem corte — uma lista truncada faria a soma da tela discordar dos totais acima.'
                )}
                {resumo.previsaoTitulos > 0 && q.sit !== 'previsao' && (
                  <>
                    {' '}
                    <strong className="font-semibold text-ink">
                      {N(resumo.previsaoTitulos)} títulos de previsão não entram aqui
                    </strong>{' '}
                    ({BRL(resumo.previsaoCentavos)}) — recorrência projetada e não emitida.{' '}
                    <Link href={comFiltro(conta.id, { ...q, sit: 'previsao' }, 'faturamento')} className="font-semibold text-purple-700">
                      ver a previsão
                    </Link>
                    .
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

        {/* ── Identidades: match, merge e a história ── */}
        <Card
          title="Identidades do cliente"
          actions={
            <Link
              href="/dados/match"
              className="inline-flex items-center gap-1 text-meta font-semibold text-purple-700 hover:text-purple-500"
            >
              <GitMerge className="h-[14px] w-[14px]" />
              área de match
            </Link>
          }
        >
          <div id="identidades" className="scroll-mt-24" />
          <p className="mb-3 max-w-[90ch] text-corpo leading-relaxed text-ink-2">
            Um cliente tem <strong className="font-semibold">mais de uma</strong> identidade em cada sistema: no Omie
            porque a empresa troca de CNPJ e o cadastro antigo fica, no HubSpot porque ganho, upsell e downsell criam
            empresa nova. Isso é história comercial, não erro — e é por isso que os números desta tela somam todas as
            identidades ligadas, e não uma só.
          </p>

          {identidades.length === 0 ? (
            <Aviso tom="alerta">
              Nenhuma identidade vinculada. O faturamento mostrado acima, se houver, vem da raiz do CNPJ — que é
              heurística de exibição, não vínculo decidido.
            </Aviso>
          ) : (
            <Table
              cols={['Fonte', 'Identidade', 'Descrição', 'Origem', 'Faturamento', '']}
              rows={identidades.map((v) => [
                <Badge tone={v.fonte === 'omie' ? 'indigo' : 'slate'}>{v.fonte}</Badge>,
                <span className="whitespace-nowrap tabular-nums text-meta font-semibold text-ink">
                  {v.fonte === 'omie' ? DOC(v.chave) : v.chave}
                </span>,
                <span className="text-meta text-ink-2">
                  {v.rotulo ?? '—'}
                  {v.inativo === true && (
                    <>
                      {' '}
                      <Badge tone="red">inativa no Omie</Badge>
                    </>
                  )}
                </span>,
                <span className="text-meta text-ink-3">
                  {v.origem}
                  {v.origem === 'manual' && v.motivo ? (
                    <span className="block max-w-[36ch] text-nota">{v.motivo}</span>
                  ) : null}
                  <span className="block text-nota">
                    {v.criadoPor.split('@')[0]} · {DATA(v.criadoEm)}
                  </span>
                </span>,
                <span className="whitespace-nowrap tabular-nums text-meta text-ink">
                  {v.fonte === 'omie' ? `${BRL(v.valorCentavos)} · ${N(v.titulos)} tít.` : '—'}
                </span>,
                podeEditar ? (
                  <details>
                    <summary className="cursor-pointer select-none whitespace-nowrap text-meta text-ink-3 hover:text-ink-2">
                      desvincular
                    </summary>
                    <form action={desvincularIdentidade} className="mt-2 grid gap-2">
                      <input type="hidden" name="accountId" value={conta.id} />
                      <input type="hidden" name="vista" value={vistaAtual} />
                      <input type="hidden" name="fonte" value={v.fonte} />
                      <input type="hidden" name="chave" value={v.chave} />
                      <Field
                        label="Motivo (obrigatório)"
                        name="motivo"
                        minLength={10}
                        required
                        placeholder="ex.: esta ficha é de outra empresa do grupo, faturada em conta própria"
                      />
                      <div>
                        <Btn type="submit" variant="danger">
                          Desvincular
                        </Btn>
                      </div>
                    </form>
                  </details>
                ) : (
                  <span className="text-meta text-ink-3">—</span>
                ),
              ])}
            />
          )}

          {/* ── Candidatos ── */}
          {livres.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 text-nota font-semibold uppercase tracking-[0.06em] text-ink-3">
                Candidatos · {N(livres.length)}
              </div>
              <Table
                cols={['Identidade', 'Descrição', 'Por que apareceu', 'Faturamento', '']}
                rows={livres.map((c) => [
                  <span className="whitespace-nowrap tabular-nums text-meta font-semibold text-ink">
                    {DOC(c.chave)}
                  </span>,
                  <span className="text-meta text-ink-2">
                    {c.rotulo}
                    {c.inativo && (
                      <>
                        {' '}
                        <Badge>inativa</Badge>
                      </>
                    )}
                  </span>,
                  <span className="text-meta text-ink-2">
                    <Badge tone={c.evidencia === 'hubspot' ? 'green' : c.evidencia === 'raiz' ? 'amber' : 'slate'}>
                      {c.evidencia === 'hubspot' ? 'mesmo HubSpot' : c.evidencia === 'raiz' ? 'mesma raiz' : 'nome parecido'}
                    </Badge>
                    <span className="mt-0.5 block max-w-[44ch] text-nota text-ink-3">{c.detalhe}</span>
                  </span>,
                  <span className="whitespace-nowrap tabular-nums text-meta font-semibold text-ink">
                    {BRL(c.valorCentavos)}
                    <span className="block text-nota font-normal text-ink-3">{N(c.titulos)} títulos</span>
                  </span>,
                  podeEditar ? (
                    <details>
                      <summary className="cursor-pointer select-none whitespace-nowrap text-meta font-semibold text-purple-700 hover:text-purple-500">
                        vincular
                      </summary>
                      <form action={vincularIdentidade} className="mt-2 grid gap-2">
                        <input type="hidden" name="accountId" value={conta.id} />
                        <input type="hidden" name="vista" value={vistaAtual} />
                        <input type="hidden" name="fonte" value="omie" />
                        <input type="hidden" name="chave" value={c.chave} />
                        <TextArea
                          label="Por que é o mesmo cliente (obrigatório)"
                          name="motivo"
                          rows={2}
                          minLength={10}
                          required
                          placeholder="ex.: mesma empresa; o CNPJ antigo era da LTDA e a operação passou para a S.A."
                        />
                        <div>
                          <Btn type="submit">Vincular a esta conta</Btn>
                        </div>
                      </form>
                    </details>
                  ) : (
                    <span className="text-meta text-ink-3">—</span>
                  ),
                ])}
              />
              <p className="mt-2 max-w-[90ch] text-meta leading-relaxed text-ink-3">
                <strong className="font-semibold text-ink">A evidência vem junto de propósito.</strong>{' '}
                <em>Mesmo HubSpot</em> é forte: a ficha do Omie declara um id que esta conta reivindica, e isso atravessa
                a troca de CNPJ. <em>Nome parecido</em> é fraca e existe porque foi a única que encontraria a Swile —
                aceitar sem olhar é como o número errado nasce do outro lado.
              </p>
            </div>
          )}

          {candidatos.some((c) => c.jaVinculadaA) && (
            <p className="mt-4 max-w-[90ch] text-meta leading-relaxed text-ink-3">
              Outras fichas parecidas já pertencem a outra conta e não aparecem como candidatas:{' '}
              {candidatos
                .filter((c) => c.jaVinculadaA)
                .slice(0, 4)
                .map((c) => `${DOC(c.chave)} (${c.jaVinculadaA})`)
                .join(', ')}
              . Uma identidade pertence a uma conta só — em duas, o mesmo faturamento seria contado duas vezes.
            </p>
          )}

          {/* ── A trilha ── */}
          {historico.length > 0 && (
            <details className="mt-5">
              <summary className="cursor-pointer select-none text-meta font-semibold text-ink-2 hover:text-ink">
                Histórico de vínculos · {N(historico.length)}
              </summary>
              <div className="mt-2">
                <Table
                  cols={['Quando', 'Ação', 'Identidade', 'Quem', 'Motivo']}
                  rows={historico.map((e) => [
                    <span className="whitespace-nowrap tabular-nums text-meta text-ink-3">{DATA(e.quando)}</span>,
                    <Badge tone={e.acao === 'vinculou' ? 'green' : 'red'}>{e.acao}</Badge>,
                    <span className="whitespace-nowrap tabular-nums text-meta text-ink">
                      {e.fonte === 'omie' ? DOC(e.chave) : e.chave}
                    </span>,
                    <span className="text-meta text-ink-2">{e.quem.split('@')[0]}</span>,
                    <span className="text-meta text-ink-2">{e.motivo ?? e.origem ?? '—'}</span>,
                  ])}
                />
                <p className="mt-2 max-w-[90ch] text-meta text-ink-3">
                  A trilha não se corrige — desvincular entra como evento novo. É o que responde &quot;por que o
                  faturamento deste cliente mudou de valor?&quot; três meses depois.
                </p>
              </div>
            </details>
          )}
        </Card>
      </Corpo>
    </>
  )
}
