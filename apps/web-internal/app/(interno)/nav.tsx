'use client'

import { FOCO, cn } from '@pulse/ui'
import { ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import * as React from 'react'

import { MENU, itemAtivo } from './menu'

/**
 * A escolha de recolher/ampliar, por grupo, guardada entre sessões.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ LIDA NUM EFEITO, E NÃO NO ESTADO INICIAL. No servidor não existe            │
 * │ `localStorage`, e chutar um valor faria o HTML e a primeira renderização do │
 * │ cliente discordarem — o React descarta a árvore inteira e a sidebar pisca.  │
 * │                                                                            │
 * │ O custo é honesto e pequeno: quem recolheu Configurações vê o grupo aberto  │
 * │ por um quadro antes de fechar. Diferente do tema, que reescreve a tela      │
 * │ inteira e por isso ganhou script inline no `<head>`, aqui o que se move são │
 * │ sete linhas dentro do menu.                                                │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
const CHAVE = 'pulse.menu.grupos'

function usarGrupos() {
  const [grupos, setGrupos] = React.useState<Record<string, boolean>>({})

  React.useEffect(() => {
    try {
      const guardado = localStorage.getItem(CHAVE)
      if (guardado) setGrupos(JSON.parse(guardado) as Record<string, boolean>)
    } catch {
      // Armazenamento bloqueado ou JSON estragado por uma versão anterior: o
      // menu volta ao padrão em vez de derrubar a navegação inteira.
    }
  }, [])

  const alternar = React.useCallback((href: string, aberto: boolean) => {
    setGrupos((antes) => {
      const novo = { ...antes, [href]: aberto }
      try {
        localStorage.setItem(CHAVE, JSON.stringify(novo))
      } catch {
        /* sem armazenamento: a escolha vale para esta aba */
      }
      return novo
    })
  }, [])

  return { grupos, alternar }
}

/**
 * Um filho do grupo, no submenu embutido E no flyout.
 *
 * Existe como componente porque os dois lugares renderizam a mesma lista: em
 * cópia, o `aria-current` do flyout ficaria desatualizado na primeira vez que
 * alguém mexesse só no de cima — e "onde eu estou" é exatamente o que o menu
 * minimizado tem menos condição de comunicar.
 */
function Filho({
  f,
  pai,
  pathname,
}: {
  f: { href: string; rotulo: string; proposito: string }
  pai: string
  pathname: string
}) {
  /* Ativo é o de href mais LONGO que casa: sem isso, "/configuracoes" ficaria
     aceso nas sete telas ao mesmo tempo. */
  const ativo = pathname === f.href || (f.href !== pai && pathname.startsWith(f.href + '/'))
  return (
    <Link
      href={f.href}
      title={f.proposito}
      aria-current={ativo ? 'page' : undefined}
      className={cn(
        'truncate rounded-sm px-2 py-1.5 text-meta transition-colors',
        FOCO,
        ativo ? 'font-semibold text-purple-700' : 'text-ink-3 hover:bg-surface-2 hover:text-ink-2',
      )}
    >
      {f.rotulo}
    </Link>
  )
}

/**
 * A navegação da sidebar — o único componente de cliente da casca.
 *
 * É cliente porque precisa do `pathname` para destacar o item ativo, e o
 * pathname não chega ao layout do App Router. Uma nav sem indicação de onde
 * você está é a economia errada: são ~1 kB de JS contra a pergunta "em que tela
 * eu estou" toda vez que alguém volta de uma aba.
 *
 * Mesma pintura do NavLink do alloyal-publi: `bg-purple-50 text-purple-700`
 * no ativo, ícone em roxo, o resto em `ink-2`.
 */
export function Nav({ variante = 'lateral' }: { variante?: 'lateral' | 'topo' }) {
  const pathname = usePathname()
  const ativo = itemAtivo(pathname)?.href
  const { grupos, alternar } = usarGrupos()

  if (variante === 'topo') {
    return (
      <div className="flex gap-1 overflow-x-auto border-b border-line bg-surface px-4 py-2 md:hidden">
        {MENU.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className={cn(
              'whitespace-nowrap rounded-sm px-2.5 py-1.5 text-meta font-semibold',
              m.href === ativo ? 'bg-purple-50 text-purple-700' : 'text-ink-2',
            )}
          >
            {m.rotulo}
          </Link>
        ))}
      </div>
    )
  }

  return (
    <nav className="flex flex-col gap-0.5">
      {MENU.map((m) => {
        const Icone = m.icone
        const isAtivo = m.href === ativo
        const dentro = pathname.startsWith(m.href)
        /* ┌────────────────────────────────────────────────────────────────────┐
           │ O PADRÃO É ABRIR ONDE SE ESTÁ; a escolha explícita vence o padrão.  │
           │                                                                     │
           │ Aberto sempre acrescentaria sete linhas ao menu de quem nunca entra │
           │ em Configurações; fechado sempre esconderia a seção onde a pessoa   │
           │ está. Então: abre sozinho ao entrar, e quem recolher fica recolhido │
           │ — inclusive depois de recarregar (§07: "grupos abertos/fechados,    │
           │ persistidos em localStorage").                                      │
           └────────────────────────────────────────────────────────────────────┘ */
        const escolha = grupos[m.href]
        const aberto = Boolean(m.filhos) && (escolha ?? dentro)
        return (
          /* `lateral-alvo` + `relative` é o que ancora o flyout da lateral
             minimizada. O flyout está SEMPRE no HTML e o CSS decide se existe —
             ver lateral.css. Renderizá-lo condicionalmente exigiria que este
             componente soubesse a largura da lateral, que é justamente o que o
             desenho por atributo no <html> evita. */
          <div key={m.href} className="lateral-alvo relative">
            <div className="flex items-center">
              <Link
                href={m.href}
                aria-current={isAtivo ? 'page' : undefined}
                className={cn(
                  'lateral-item flex min-w-0 flex-1 items-center gap-[11px] rounded-sm px-[10px] py-[9px] text-corpo font-semibold transition-colors',
                  FOCO,
                  isAtivo ? 'bg-purple-50 text-purple-700' : 'text-ink-2 hover:bg-surface-2',
                )}
              >
                <Icone
                  className={cn('h-[17px] w-[17px] shrink-0', isAtivo ? 'text-purple-500' : 'text-ink-3')}
                />
                <span className="lateral-rotulo truncate">{m.rotulo}</span>
              </Link>
              {/* BOTÃO SEPARADO do link, e não o link inteiro virando gatilho:
                  Configurações É uma tela (o Catálogo), e transformar o item em
                  interruptor tiraria o acesso a ela. Um navega, o outro recolhe. */}
              {m.filhos && (
                /* ds-excecao: alvo de ÍCONE colado ao link do menu, com 24px de
                   lado. Precisa da mesma altura da linha e de nenhum fundo — um
                   <Btn> traria altura de controle (36px) e quebraria a linha do
                   item ao meio. */
                <button
                  type="button"
                  onClick={() => alternar(m.href, !aberto)}
                  aria-expanded={aberto}
                  aria-label={`${aberto ? 'Recolher' : 'Ampliar'} ${m.rotulo}`}
                  title={`${aberto ? 'Recolher' : 'Ampliar'} ${m.rotulo}`}
                  className={cn(
                    'lateral-chevron ml-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink',
                    FOCO,
                  )}
                >
                  <ChevronDown
                    className={cn(
                      'h-[15px] w-[15px] transition-transform motion-reduce:transition-none',
                      aberto ? 'rotate-0' : '-rotate-90',
                    )}
                  />
                </button>
              )}
            </div>
            {aberto && m.filhos && (
              <div className="lateral-filhos ml-[26px] mt-0.5 flex flex-col gap-0.5 border-l border-line pl-2">
                {m.filhos.map((f) => (
                  <Filho key={f.href} f={f} pai={m.href} pathname={pathname} />
                ))}
              </div>
            )}

            {/* ─── O flyout da lateral minimizada ─────────────────────────────
                Devolve o rótulo que os 64px tiraram, e os filhos junto. Abre por
                :hover E por :focus-within (lateral.css): sem o segundo, quem
                navega por Tab percorreria dez ícones sem nome e os sete filhos
                de Configurações seriam inalcançáveis pelo teclado. */}
            <div className="lateral-flyout absolute left-full top-0 z-40 pl-2">
              <div className="min-w-[196px] rounded-md border border-line bg-surface p-1.5 shadow-pop">
                <Link
                  href={m.href}
                  className={cn(
                    'block truncate rounded-sm px-2 py-1.5 text-corpo font-semibold transition-colors',
                    FOCO,
                    isAtivo ? 'text-purple-700' : 'text-ink hover:bg-surface-2',
                  )}
                >
                  {m.rotulo}
                </Link>
                {m.filhos && (
                  <div className="mt-0.5 flex flex-col gap-0.5 border-t border-line pt-1">
                    {m.filhos.map((f) => (
                      <Filho key={f.href} f={f} pai={m.href} pathname={pathname} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </nav>
  )
}
