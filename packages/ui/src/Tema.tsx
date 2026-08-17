'use client'

import * as React from 'react'

import { cn } from './base'
import { FOCO } from './ds'

/**
 * Escolha de tema: claro, escuro ou o do sistema — num botão só.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ TRÊS ESTADOS, NÃO DOIS, e essa parte não mudou. "Sistema" é o padrão e não  │
 * │ é enfeite: quem usa o computador no escuro à noite e no claro de dia já     │
 * │ resolveu isso uma vez, no sistema operacional. Um alternador de dois        │
 * │ estados obriga essa pessoa a resolver de novo, aqui, duas vezes por dia —   │
 * │ e, pior, tira o caminho de VOLTAR para "sistema" depois de ter escolhido.   │
 * │                                                                            │
 * │ O QUE MUDOU É A FORMA: era um grupo segmentado com ícone e rótulo nos três  │
 * │ botões, e passou a ser um botão de ícone que cicla, como no Publi (§12       │
 * │ registra o alternador de lá como "3 estados e persistência"). Os rótulos    │
 * │ custavam ~110px na barra de topo de dezesseis telas para repetir o que o    │
 * │ ícone já diz — e a barra é justamente onde a largura briga com o nome da    │
 * │ tela, que foi truncado a "O…" por causa desse tipo de peso.                 │
 * │                                                                            │
 * │ O texto sai da TELA, não da acessibilidade: `aria-label` e `title` dizem em │
 * │ que tema se está E o que o próximo clique faz, porque num ciclo de três a   │
 * │ segunda metade não é adivinhável pelo ícone.                               │
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

/**
 * O CICLO, e a ordem dele.
 *
 * `sistema → claro → escuro → sistema`. Começa em "sistema" porque é o padrão, e
 * a ordem seguinte é a que a pessoa espera de um botão de tema: o primeiro clique
 * fixa o claro, o segundo o escuro, o terceiro devolve ao sistema. Sair do ciclo
 * pelo mesmo botão é o que impede o "não consigo mais voltar para automático" —
 * o defeito de todo alternador de dois estados que persiste a escolha.
 *
 * `proximo` está aqui e não embutido no clique para poder ser lido e testado: a
 * ordem de um ciclo é a regra inteira deste componente.
 */
const CICLO: readonly Tema[] = ['sistema', 'claro', 'escuro'] as const

export function proximoTema(atual: Tema): Tema {
  const i = CICLO.indexOf(atual)
  return CICLO[(i + 1) % CICLO.length]!
}

const NOME: Record<Tema, string> = {
  sistema: 'o do sistema',
  claro: 'claro',
  escuro: 'escuro',
}

/* Os três ícones do documento: sol, lua e monitor. Traço de 2px e 15px de lado,
   a medida de ícone dentro de controle (§05). */
const ICONE: Record<Tema, React.ReactNode> = {
  claro: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-[15px] w-[15px]">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  escuro: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-[15px] w-[15px]">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  ),
  sistema: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-[15px] w-[15px]">
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  ),
}

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

  const proximo = proximoTema(tema)
  const legenda = `Tema ${NOME[tema]} · clicar para ${NOME[proximo]}`

  return (
    /* ds-excecao: alvo de ÍCONE da barra de topo, irmão do sino, do reportar e do
       perfil, que são desenhados do mesmo jeito. Um <Btn> traria altura e fundo de
       botão de ação e desequilibraria a fileira inteira da direita. */
    <button
      type="button"
      onClick={() => {
        setTema(proximo)
        aplicar(proximo)
      }}
      title={legenda}
      aria-label={legenda}
      className={cn(
        // `w-[28px]` e não `w-control-xs`: o preset define os degraus de controle em
        // `height`/`minHeight` e NÃO em `width`, então a classe de largura compilaria
        // para nada e o botão sairia do tamanho do ícone. 28px é o mesmo control-xs.
        'inline-flex h-control-xs w-[28px] shrink-0 items-center justify-center rounded-md',
        'border border-line bg-surface text-ink-3 hover:bg-surface-2 hover:text-ink',
        FOCO,
        className,
      )}
    >
      {ICONE[tema]}
    </button>
  )
}

