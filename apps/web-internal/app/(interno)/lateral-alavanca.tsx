'use client'

import { FOCO, cn } from '@pulse/ui'
import { ChevronsLeft } from 'lucide-react'
import * as React from 'react'

import { CHAVE_LATERAL, MARCA_MINIMIZADA } from './lateral'

/**
 * O botão que minimiza e devolve a lateral.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ NÃO GUARDA O ESTADO EM REACT — lê e escreve o atributo do <html>.          │
 * │                                                                            │
 * │ O estado real já está no DOM, posto pelo script inline antes da primeira    │
 * │ pintura (ver `lateral.ts`). Duplicá-lo aqui criaria duas fontes de verdade  │
 * │ que precisariam concordar, e a primeira renderização do cliente discordaria │
 * │ do HTML do servidor — exatamente o piscar que o script existe para evitar.  │
 * │                                                                            │
 * │ O `aria-pressed` é o único que precisa acompanhar, porque leitor de tela    │
 * │ não lê CSS. Ele começa em `false` e se acerta na montagem: um quadro de     │
 * │ diferença num atributo que ninguém vê, contra a tela inteira pulando.       │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export function AlavancaDaLateral() {
  const [minimizada, setMinimizada] = React.useState(false)

  React.useEffect(() => {
    setMinimizada(document.documentElement.getAttribute('data-menu') === MARCA_MINIMIZADA)
  }, [])

  const alternar = () => {
    const raiz = document.documentElement
    const agora = raiz.getAttribute('data-menu') === MARCA_MINIMIZADA
    if (agora) raiz.removeAttribute('data-menu')
    else raiz.setAttribute('data-menu', MARCA_MINIMIZADA)
    setMinimizada(!agora)
    try {
      if (agora) localStorage.removeItem(CHAVE_LATERAL)
      else localStorage.setItem(CHAVE_LATERAL, MARCA_MINIMIZADA)
    } catch {
      // Armazenamento bloqueado: a escolha vale para esta aba e não persiste.
      // Melhor que não deixar escolher.
    }
  }

  return (
    /* ds-excecao: é uma LINHA DE MENU que age como interruptor, e não um botão de
       ação — mesma altura, mesmo recuo e mesmo ícone à esquerda dos itens acima
       dela. Com um <Btn> a lateral terminaria num botão desenhado, que se lê
       como a ação principal da tela. */
    <button
      type="button"
      onClick={alternar}
      aria-pressed={minimizada}
      aria-label={minimizada ? 'Ampliar o menu' : 'Minimizar o menu'}
      title={minimizada ? 'Ampliar o menu' : 'Minimizar o menu'}
      className={cn(
        'lateral-item mt-2 flex h-8 w-full items-center gap-[11px] rounded-sm px-[10px] text-meta font-semibold text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink',
        FOCO,
      )}
    >
      <ChevronsLeft className="lateral-alavanca-seta h-[17px] w-[17px] shrink-0 transition-transform motion-reduce:transition-none" />
      <span className="lateral-rotulo truncate">Minimizar</span>
    </button>
  )
}
