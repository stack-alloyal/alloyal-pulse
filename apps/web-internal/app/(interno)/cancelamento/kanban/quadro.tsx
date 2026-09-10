/**
 * O quadro, na estrutura do Kanban do Allvoice.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A DIFERENÇA CENTRAL do que eu tinha feito antes, e o motivo dela.          │
 * │                                                                            │
 * │ A minha primeira versão usava `lg:grid-cols-5`: cinco colunas que dividem  │
 * │ a largura e se APERTAM. O Allvoice usa `w-72 shrink-0` + `overflow-x-auto`  │
 * │ — coluna de largura FIXA e rolagem horizontal. E cada coluna tem altura de  │
 * │ viewport e rola por DENTRO.                                                │
 * │                                                                            │
 * │ A consequência não é estética: com grade, oito colunas ficam com 12% da     │
 * │ tela cada e o nome do cliente não cabe; e o teto de oito cartões esconde o  │
 * │ resto. Com largura fixa e rolagem, a coluna sempre tem 288px e mostra       │
 * │ TODOS os cartões — que é o que faz um kanban ser um kanban.                │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ AS MEDIDAS SÃO AS DE LÁ, extraídas do HTML que o usuário mandou:           │
 * │   quadro  flex gap-3 overflow-x-auto p-4 lg:p-5                            │
 * │   coluna  w-72 shrink-0 rounded-lg border · cabeça px-3 py-2.5             │
 * │           contagem: rounded-full px-2 py-0.5 font-mono text-[11px]         │
 * │           corpo: min-h-0 flex-1 gap-2 overflow-y-auto px-2 pb-2            │
 * │   cartão  rounded-md border p-2.5 shadow-sm · 3 linhas, `pl-6` sob o ícone │
 * │                                                                            │
 * │ As CORES são as do Pulse, não as de lá: `neutral-*` e `primary` são os      │
 * │ tokens do Allvoice, e o portão do design system recusa hex que não exista   │
 * │ em `estilo.css`. Estrutura copiada, paleta da casa.                        │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ DESFECHO É COLUNA TRACEJADA, como o Spam e a Lixeira de lá.               │
 * │                                                                            │
 * │ Não é analogia frouxa: `TRANSICOES` declara os quatro desfechos com array   │
 * │ VAZIO — o pedido para neles. Tracejado diz "aqui é fim de linha" com a      │
 * │ mesma gramática visual que o Allvoice já usa para as suas colunas           │
 * │ terminais, e sem inventar convenção nova.                                  │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
import { DIAS_PARA_ESTAGNAR, POSICOES, type PedidoNoQuadro, rotuloDoMotivo } from '@pulse/success'
import Link from 'next/link'

import { acaoAvancarEtapa } from '../../saidas/acoes'
import { CampoDeVolta } from '../../saidas/visoes'

const BRL = (c: string | null) =>
  c === null
    ? '—'
    : (Number(c) / 100).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
      })

/** "3d", "12h", "8m" — o mesmo formato curto da coluna de tempo de lá. */
const IDADE = (dias: number) => (dias >= 1 ? `${dias}d` : 'hoje')

/** O ponto de status da cabeça da coluna. Etapa é atenção, desfecho é fim. */
const PONTO: Record<string, string> = {
  pedido: 'bg-amber-700',
  financeiro: 'bg-blue-600',
  reversao: 'bg-purple-500',
  revertido: 'bg-green',
  desconto: 'bg-blue-600',
  renegociado: 'bg-amber-700',
  cancelamento: 'bg-red',
  pdd: 'bg-pink-600',
}

function Cartao({ p, volta }: { p: PedidoNoQuadro; volta: string }) {
  const etapa = POSICOES.find((x) => x.id === p.posicao)?.tipo === 'etapa'
  /* Os destinos possíveis: as três etapas menos a atual. Só em coluna de etapa —
     desfecho é terminal, e oferecer movimento dali seria oferecer o impossível. */
  const destinos = etapa
    ? (['anunciado', 'financeiro', 'reversao'] as const).filter(
        (e) => e !== (p.posicao === 'pedido' ? 'anunciado' : p.posicao),
      )
    : []

  return (
    <article className="group min-w-0 rounded-md border border-line bg-surface p-2.5 shadow-e1">
      {/* Linha 1: origem, nome, e o selo de estagnação onde o Allvoice põe a
          contagem de não lidas. */}
      <div className="flex min-w-0 items-start gap-2">
        <span
          title={p.pedido === 'desconto' ? 'Pedido de desconto' : 'Pedido de cancelamento'}
          className="mt-0.5 inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-surface-2 text-nota text-ink-3"
        >
          {p.pedido === 'desconto' ? '%' : '×'}
        </span>
        <Link
          href={`/contas/${p.accountId}`}
          prefetch={false}
          className="min-w-0 flex-1 truncate text-cartao font-medium text-ink group-hover:text-purple-700"
        >
          {p.razaoSocial}
        </Link>
      </div>

      {/* Linha 2: o motivo e o aviso prévio, em cinza pequeno. */}
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 pl-6">
        <span className="truncate text-nota text-ink-3">
          {p.motivo === null ? 'motivo a classificar' : rotuloDoMotivo(p.motivo)}
        </span>
        {p.avisoPrevioDias !== null && (
          <span className="text-nota text-ink-3">· {p.avisoPrevioDias}d de aviso</span>
        )}
        {!p.motivoConfirmado && p.motivo !== null && (
          <span className="text-nota text-amber-800" title="Motivo ainda não confirmado por outra pessoa">
            · a confirmar
          </span>
        )}
        {/* A estagnação vive AQUI, e não num selo vermelho no topo. Duas razões:
            o selo repetia o número que a linha 3 já mostra — informação duplicada
            no cartão mais apertado da tela —, e é nesta linha que o Allvoice põe
            o aviso de SLA. O selo vermelho de lá é contagem de mensagens não
            lidas, que não tem equivalente aqui; usá-lo para outra coisa seria
            pegar a forma e perder o significado. */}
        {p.estagnado && (
          <span
            className="inline-flex shrink-0 items-center gap-0.5 text-nota font-medium text-red"
            title={`O prazo é ${DIAS_PARA_ESTAGNAR} dias — menor que o menor aviso prévio praticado`}
          >
            <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            Parado {p.diasNaEtapa}d
          </span>
        )}
      </div>

      {/* Linha 3: dinheiro à esquerda, tempo à direita — como o dono e o tempo de lá. */}
      <div className="mt-1.5 flex min-w-0 items-center gap-2 pl-6 text-nota text-ink-2">
        <span className="truncate tabular-nums">{BRL(p.mrrCentavos)}</span>
        {/* O tempo só aparece quando NÃO está parado: no cartão parado, a linha
            2 já diz "Parado 24d" e repetir "24d" aqui gastaria o espaço mais
            escasso da tela com o mesmo número. No Allvoice as duas grandezas são
            diferentes — atraso de SLA e última atividade —, e aqui `diasNaEtapa`
            é a única que existe. */}
        {!p.estagnado && (
          <span className="ml-auto shrink-0 tabular-nums text-ink-3" title="Tempo nesta etapa">
            {IDADE(p.diasNaEtapa)}
          </span>
        )}
      </div>

      {/* Os destinos. Botão e não arrastar: a tela funciona sem JavaScript, e é
          a mesma razão de todo formulário daqui. */}
      {destinos.length > 0 && (
        <form className="mt-1.5 flex flex-wrap gap-1 pl-6">
          <input type="hidden" name="id" value={p.id} />
          <CampoDeVolta para={volta} />
          {destinos.map((e) => (
            /* ds-excecao: botão de SUBMIT com `formAction` próprio — `Btn` não o
               carrega, e um formulário por destino duplicaria o campo `id`. */
            <button
              key={e}
              type="submit"
              formAction={acaoAvancarEtapa.bind(null, e)}
              className="rounded border border-line px-1.5 py-0.5 text-nota text-ink-3 hover:border-purple-500 hover:text-purple-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-500"
            >
              → {e === 'anunciado' ? 'pedido' : e === 'financeiro' ? 'financeiro' : 'reversão'}
            </button>
          ))}
        </form>
      )}
    </article>
  )
}

export function QuadroKanban({
  pedidos,
  volta,
}: {
  pedidos: readonly PedidoNoQuadro[]
  volta: string
}) {
  const porPosicao = new Map(POSICOES.map((p) => [p.id, [] as PedidoNoQuadro[]]))
  for (const p of pedidos) porPosicao.get(p.posicao)?.push(p)

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4 md:p-5">
      {POSICOES.map((pos) => {
        const itens = porPosicao.get(pos.id) ?? []
        const terminal = pos.tipo !== 'etapa'
        const soma = itens.reduce((s, p) => s + Number(p.mrrCentavos ?? 0), 0)
        return (
          <section
            key={pos.id}
            className={`flex h-full w-72 shrink-0 flex-col rounded-lg border ${
              terminal ? 'border-dashed border-line bg-surface-2' : 'border-line bg-surface-2'
            }`}
          >
            <header className="flex shrink-0 items-start gap-2 px-3 py-2.5">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PONTO[pos.id] ?? 'bg-ink-4'}`} />
              {/* Duas LINHAS e não truncar. Os rótulos de lá são curtos ("Fila",
                  "Aberta"); os nossos são os nomes aprovados do pedido do usuário
                  — "Pedido de cancelamento ou desconto" tem 34 caracteres e
                  truncava em "Pedido de cancelamento …", que não distingue nada.
                  Inventar um segundo rótulo curto por coluna seria criar a lista
                  duplicada que este repositório passa o tempo consertando. */}
              <h3
                className="min-w-0 flex-1 text-cartao font-semibold leading-snug text-ink-2 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden"
                title={pos.explica}
              >
                {pos.rotulo}
              </h3>
              <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 font-mono text-nota text-ink-3">
                {itens.length}
              </span>
            </header>

            {soma > 0 && (
              <p className="shrink-0 px-3 pb-1.5 text-nota tabular-nums text-ink-3">{BRL(String(soma))}</p>
            )}

            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {itens.length === 0 ? (
                <p className="px-1 py-3 text-center text-nota text-ink-4">
                  {terminal ? 'nenhum desfecho aqui' : 'vazio'}
                </p>
              ) : (
                itens.map((p) => <Cartao key={p.id} p={p} volta={volta} />)
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
