'use client'

import * as React from 'react'

import { cn } from './base'
import { FOCO } from './ds'

/**
 * As composições do design system que precisam de interação (§05).
 *
 * Arquivo separado por causa do App Router: `'use client'` aqui não contamina o
 * resto da biblioteca, que é servida sem JavaScript. As telas do Pulse são quase
 * todas server components, e essa é a razão de a maioria das composições viver em
 * `ds.tsx` sem estado.
 */

// ═══ Confirmar ═══════════════════════════════════════════════════════════════

export interface PedidoDeConfirmacao {
  /** O que VAI ACONTECER. É o título porque é a pergunta. */
  readonly titulo: string
  /** Por que importa — consequência, não repetição do título. */
  readonly corpo?: React.ReactNode
  /** A alternativa. O documento chama de `saida`: o que fazer em vez disso. */
  readonly saida?: React.ReactNode
  /**
   * A pergunta, que é o quarto elemento do padrão (§06).
   *
   * "Enviar mesmo assim?" — separada do título de propósito: o título diz O QUE
   * ACONTECE, e a pergunta é o que se responde. Num diálogo cujo título já é
   * pergunta ("Descartar o disparo 21?"), este campo fica de fora e o padrão
   * continua completo.
   */
  readonly pergunta?: string
  readonly confirmar?: string
  readonly cancelar?: string
  readonly destrutiva?: boolean
}

/**
 * O diálogo que substitui o `confirm()` nativo.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ DUAS REGRAS, e as duas estão na assinatura de propósito.                   │
 * │                                                                            │
 * │ 1. A ORDEM DO TEXTO: `titulo` é o que vai acontecer, `corpo` é por que      │
 * │    importa, `saida` é a alternativa. Um `confirm()` nativo só tem a         │
 * │    primeira, e por isso toda confirmação vira "tem certeza?" — que não      │
 * │    informa nada e ensina a clicar em OK sem ler.                           │
 * │                                                                            │
 * │ 2. O FOCO INICIAL vai no CANCELAR quando a ação é destrutiva. Enter         │
 * │    apressado não deve destruir. É uma linha de código e é a diferença entre │
 * │    um engano recuperável e um dado perdido.                                │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export function Confirmar({
  pedido,
  aberto,
  onConfirmar,
  onCancelar,
}: {
  pedido: PedidoDeConfirmacao | null
  aberto: boolean
  onConfirmar: () => void
  onCancelar: () => void
}) {
  const cancelarRef = React.useRef<HTMLButtonElement>(null)
  const confirmarRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    if (!aberto) return
    // O foco vai no Cancelar quando destrói; no Confirmar quando não.
    const alvo = pedido?.destrutiva ? cancelarRef.current : confirmarRef.current
    alvo?.focus()
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancelar()
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [aberto, pedido?.destrutiva, onCancelar])

  if (!aberto || !pedido) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirmar-titulo"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Overlay do documento: rgba(22,22,26,.55) com desfoque de 2px. */}
      <button
        type="button"
        aria-label="Fechar"
        onClick={onCancelar}
        className="absolute inset-0 bg-[rgba(22,22,26,0.55)] backdrop-blur-[2px]"
      />
      {/* §08: diálogo entra com fade + zoom-95 → 100 em 200ms. É a única animação
          do produto além do hover — interface de operação é lida às pressas, e
          animação que atrasa a leitura custa mais do que agrada. */}
      <div className="relative w-full max-w-lg rounded-lg bg-surface p-5 shadow-pop motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-200">
        <h2 id="confirmar-titulo" className="text-title text-ink">
          {pedido.titulo}
        </h2>
        {pedido.corpo && <div className="mt-2 text-corpo leading-relaxed text-ink-2">{pedido.corpo}</div>}
        {pedido.saida && (
          <div className="mt-2 rounded-md border border-line bg-surface-2 px-3 py-2 text-meta text-ink-2">
            {pedido.saida}
          </div>
        )}
        {pedido.pergunta && (
          <p className="mt-3 text-corpo font-semibold text-ink">{pedido.pergunta}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelarRef}
            type="button"
            onClick={onCancelar}
            className={cn(
              'h-control rounded-md border border-line-strong bg-surface px-3.5 text-corpo font-semibold text-ink hover:bg-surface-2',
              FOCO,
            )}
          >
            {pedido.cancelar ?? 'Cancelar'}
          </button>
          <button
            ref={confirmarRef}
            type="button"
            onClick={onConfirmar}
            className={cn(
              'h-control rounded-md px-3.5 text-corpo font-semibold text-white',
              FOCO,
              pedido.destrutiva ? 'bg-red hover:bg-red/90' : 'bg-purple-500 hover:bg-purple-700',
            )}
          >
            {pedido.confirmar ?? 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** O gancho que evita repetir o estado do diálogo em cada tela. */
export function useConfirmar() {
  const [pedido, setPedido] = React.useState<PedidoDeConfirmacao | null>(null)
  const resolver = React.useRef<((ok: boolean) => void) | null>(null)

  const perguntar = React.useCallback((p: PedidoDeConfirmacao) => {
    setPedido(p)
    return new Promise<boolean>((res) => {
      resolver.current = res
    })
  }, [])

  const responder = React.useCallback((ok: boolean) => {
    setPedido(null)
    resolver.current?.(ok)
    resolver.current = null
  }, [])

  const dialogo = (
    <Confirmar
      pedido={pedido}
      aberto={pedido !== null}
      onConfirmar={() => responder(true)}
      onCancelar={() => responder(false)}
    />
  )
  return { perguntar, dialogo }
}

// ═══ Gaveta ══════════════════════════════════════════════════════════════════

/**
 * Painel lateral.
 *
 * A REGRA: fecha no Esc E no backdrop. As duas cópias que existiam fechavam só no
 * botão — e quem abre uma gaveta por engano fica procurando o X.
 */
export function Gaveta({
  aberta,
  titulo,
  onFechar,
  children,
  largura = 'md',
}: {
  aberta: boolean
  titulo: React.ReactNode
  onFechar: () => void
  children: React.ReactNode
  largura?: 'sm' | 'md' | 'lg'
}) {
  React.useEffect(() => {
    if (!aberta) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar()
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [aberta, onFechar])

  if (!aberta) return null
  const w = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl' }[largura]

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Fechar"
        onClick={onFechar}
        className="absolute inset-0 bg-[rgba(22,22,26,0.55)] backdrop-blur-[2px]"
      />
      {/* §08: gaveta entra por `translate-x` em 200ms. */}
      <aside
        className={cn(
          'relative flex h-full w-full flex-col bg-surface shadow-pop',
          'motion-safe:animate-in motion-safe:slide-in-from-right motion-safe:duration-200',
          w,
        )}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-title text-ink">{titulo}</h2>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className={cn('rounded-md p-1 text-ink-3 hover:bg-surface-2 hover:text-ink', FOCO)}
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>
  )
}
