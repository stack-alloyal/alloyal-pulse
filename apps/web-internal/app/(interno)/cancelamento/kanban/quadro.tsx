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
 * │ O CARTÃO DECLARA ONDE PODE CAIR, e é por isso que a regra não vive na tela.│
 * │                                                                            │
 * │ Cada `<article>` sai daqui com `data-alvos` — a lista de colunas que        │
 * │ `alvosDoCartao()` aprovou para ELE, calculada no servidor, com o estado, a  │
 * │ origem e a alçada de quem está olhando. O componente de cliente só lê esse  │
 * │ atributo para acender a coluna certa.                                       │
 * │                                                                            │
 * │ A alternativa era o cliente reimplementar a regra. Aí a tela acenderia uma  │
 * │ coluna que a ação recusa, e o defeito só apareceria para quem arrastasse.   │
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
import {
  alvosDoCartao,
  confirmacaoDoArraste,
  DIAS_PARA_ESTAGNAR,
  POSICOES,
  type PedidoNoQuadro,
  type PoderesDeArraste,
  rotuloDoMotivo,
} from '@pulse/success'
import Link from 'next/link'

import { Arraste, Coluna, type TextoDaConfirmacao } from './arrastar'

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
  financeiro: 'bg-blue',
  reversao: 'bg-purple-500',
  revertido: 'bg-green',
  desconto: 'bg-blue',
  renegociado: 'bg-amber-700',
  cancelamento: 'bg-red',
  pdd: 'bg-pink',
}

function Cartao({ p, poderes }: { p: PedidoNoQuadro; poderes: PoderesDeArraste }) {
  /* As colunas onde ESTE cartão pode cair, decididas pela mesma função que a
     ação de soltar consulta. Vazio = cartão parado: desfecho já registrado, ou
     alçada que não move nada. `draggable` segue a lista — não se oferece o
     gesto que a regra vai recusar inteiro. */
  const alvos = alvosDoCartao(p, poderes)

  return (
    <article
      data-saida={p.id}
      data-posicao={p.posicao}
      data-alvos={alvos.join(' ')}
      /* O nome e os dias viajam no cartão porque é o DIÁLOGO que os usa: o texto
         de confirmação vem do servidor com `{cliente}` e `{dias}`, e quem sabe
         qual cartão foi solto é o navegador. */
      data-nome={p.razaoSocial}
      data-aviso={p.avisoPrevioDias ?? ''}
      draggable={alvos.length > 0}
      title={
        alvos.length > 0
          ? 'Arraste para outra coluna'
          : 'Desfecho registrado: este cartão não se move mais'
      }
      className={`group min-w-0 rounded-md border border-line bg-surface p-2.5 shadow-e1 ${
        alvos.length > 0 ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
    >
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
      <div className="mt-1.5 flex min-w-0 items-baseline gap-2 pl-6 text-nota text-ink-2">
        {/* O MRR em `text-cartao font-semibold`, e não em `text-nota` como o
            resto da linha: é o número pelo qual se decide qual cartão trabalhar
            primeiro, e estava do mesmo tamanho do motivo e do tempo. Pedido do
            usuário depois de ver a tela. */}
        <span className="truncate text-cartao font-semibold tabular-nums text-ink">
          {BRL(p.mrrCentavos)}
        </span>
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

    </article>
  )
}

export function QuadroKanban({
  pedidos,
  poderes,
}: {
  pedidos: readonly PedidoNoQuadro[]
  poderes: PoderesDeArraste
}) {
  const porPosicao = new Map(POSICOES.map((p) => [p.id, [] as PedidoNoQuadro[]]))
  for (const p of pedidos) porPosicao.get(p.posicao)?.push(p)

  /* Os textos de confirmação, calculados UMA vez para as oito colunas. Vão como
     prop e não por import no componente de cliente: `confirmacaoDoArraste` mora
     no pacote de domínio, e importá-lo de dentro do `'use client'` levaria o
     domínio inteiro para o bundle do navegador. */
  const confirmacoes = Object.fromEntries(
    POSICOES.map((pos) => [pos.id, confirmacaoDoArraste(pos.id)]).filter(([, c]) => c !== null),
  ) as Readonly<Record<string, TextoDaConfirmacao>>

  return (
    <Arraste confirmacoes={confirmacoes}>
      {POSICOES.map((pos) => {
        const itens = porPosicao.get(pos.id) ?? []
        const soma = itens.reduce((s, p) => s + Number(p.mrrCentavos ?? 0), 0)
        return (
          <Coluna
            key={pos.id}
            id={pos.id}
            rotulo={pos.rotulo}
            explica={pos.explica}
            terminal={pos.tipo !== 'etapa'}
            ponto={PONTO[pos.id] ?? 'bg-ink-4'}
            contagem={itens.length}
            soma={soma > 0 ? BRL(String(soma)) : null}
          >
            {itens.map((p) => (
              <Cartao key={p.id} p={p} poderes={poderes} />
            ))}
          </Coluna>
        )
      })}
    </Arraste>
  )
}
