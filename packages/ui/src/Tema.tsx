'use client'

import * as React from 'react'

import { cn } from './base'
import { FOCO } from './ds'

/**
 * Escolha de tema: claro, escuro ou o do sistema.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ TRÊS ESTADOS, NÃO DOIS. "Sistema" é o padrão e não é um enfeite: quem usa   │
 * │ o computador no escuro à noite e no claro de dia já resolveu isso uma vez,  │
 * │ no sistema operacional. Um seletor de dois estados obriga essa pessoa a     │
 * │ resolver de novo, aqui, duas vezes por dia.                                │
 * │                                                                            │
 * │ A escolha vira `data-theme` no <html>, que é o que o CSS já esperava (§02): │
 * │ explícito vence dos dois lados, e a ausência do atributo segue o            │
 * │ `prefers-color-scheme`.                                                    │
 * │                                                                            │
 * │ SEM ANIMAÇÃO na troca, por regra do §08: animar cor em centenas de          │
 * │ elementos deixa meio segundo com metade da tela em cada tema. Trocar seco   │
 * │ lê como instantâneo.                                                       │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

export type Tema = 'claro' | 'escuro' | 'sistema'

const CHAVE = 'pulse.tema'

/**
 * O script que roda ANTES da primeira pintura.
 *
 * Sem ele a página nasce no tema do sistema e troca depois que o React hidrata —
 * o "flash" de tema errado, que é pior que não ter tema escuro: a tela pisca
 * branco no escuro justamente para quem escolheu o escuro por incomodar-se com
 * luz. É inline no `<head>` por isso, e não num efeito.
 */
export const SCRIPT_DO_TEMA = `(function(){try{var t=localStorage.getItem('${CHAVE}');if(t==='claro'||t==='escuro'){document.documentElement.setAttribute('data-theme',t==='escuro'?'dark':'light')}}catch(e){}})()`

function aplicar(t: Tema) {
  const raiz = document.documentElement
  if (t === 'sistema') raiz.removeAttribute('data-theme')
  else raiz.setAttribute('data-theme', t === 'escuro' ? 'dark' : 'light')
  try {
    if (t === 'sistema') localStorage.removeItem(CHAVE)
    else localStorage.setItem(CHAVE, t)
  } catch {
    // Navegador com armazenamento bloqueado: a escolha vale para esta aba e não
    // persiste. Melhor que não deixar escolher.
  }
}

const OPCOES: { chave: Tema; rotulo: string; titulo: string; icone: React.ReactNode }[] = [
  {
    chave: 'claro',
    rotulo: 'Claro',
    titulo: 'Sempre no tema claro',
    icone: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-[15px] w-[15px]">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    ),
  },
  {
    chave: 'sistema',
    rotulo: 'Sistema',
    titulo: 'Segue a preferência do sistema operacional',
    icone: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-[15px] w-[15px]">
        <rect x="2" y="4" width="20" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
  },
  {
    chave: 'escuro',
    rotulo: 'Escuro',
    titulo: 'Sempre no tema escuro',
    icone: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-[15px] w-[15px]">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
    ),
  },
]

export function SeletorDeTema({ className }: { className?: string }) {
  const [tema, setTema] = React.useState<Tema>('sistema')

  // Lê o que já está valendo. `useEffect` e não estado inicial: no servidor não
  // há `localStorage`, e um valor chutado causaria divergência de hidratação.
  React.useEffect(() => {
    try {
      const guardado = localStorage.getItem(CHAVE)
      if (guardado === 'claro' || guardado === 'escuro') setTema(guardado)
    } catch {
      /* sem armazenamento: fica em "sistema" */
    }
  }, [])

  return (
    <div
      className={cn('inline-flex rounded-md border border-line bg-surface p-0.5', className)}
      role="group"
      aria-label="Tema"
    >
      {OPCOES.map((o) => {
        const ativo = tema === o.chave
        return (
          /* ds-excecao: controle SEGMENTADO — as três opções dividem uma borda e
             um fundo, e são um `role="group"` com `aria-pressed`. Um <Btn> traz a
             própria altura, o próprio arredondamento e a própria sombra, e o
             grupo viraria três botões soltos encostados. */
          <button
            key={o.chave}
            type="button"
            title={o.titulo}
            aria-label={o.titulo}
            aria-pressed={ativo}
            onClick={() => {
              setTema(o.chave)
              aplicar(o.chave)
            }}
            className={cn(
              'inline-flex h-control-xs items-center gap-1.5 rounded-[5px] px-2 text-meta font-medium',
              FOCO,
              ativo ? 'bg-purple-50 text-purple-700' : 'text-ink-3 hover:text-ink',
            )}
          >
            {o.icone}
            <span className="hidden sm:inline">{o.rotulo}</span>
          </button>
        )
      })}
    </div>
  )
}
