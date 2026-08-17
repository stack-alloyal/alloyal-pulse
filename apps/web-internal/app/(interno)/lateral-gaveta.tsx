'use client'

import { AlloyalLogo, FOCO, cn } from '@pulse/ui'
import { Menu, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import * as React from 'react'

import { Nav } from './nav'

/**
 * O drawer do telefone — a última peça do §07 ("Drawer mobile · 268px / máx.
 * 82% · abaixo de md; backdrop escuro, transição de 200ms").
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ SUBSTITUI a fileira horizontal que havia sob o cabeçalho, e não convive    │
 * │ com ela. Duas navegações para o mesmo lugar na mesma tela é o defeito que  │
 * │ Configurações já teve em triplicata; e a fileira ainda tinha um problema   │
 * │ próprio: rolava de lado, então os últimos itens do menu simplesmente não   │
 * │ apareciam, e nada na tela dizia que existiam.                             │
 * │                                                                            │
 * │ Aqui vai o MESMO `<Nav>` da lateral — mesmo item ativo, mesmo submenu de   │
 * │ Configurações, mesma escolha de recolhido. Um menu de telefone escrito à   │
 * │ parte divergiria do de computador na primeira tela nova.                   │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * As três coisas que fecham: Esc, o backdrop, e NAVEGAR. A terceira é a que se
 * esquece — sem ela, tocar num item deixa a gaveta aberta por cima da tela que
 * acabou de abrir, e a pessoa precisa fechá-la para ver o que pediu.
 */
export function GavetaDaLateral() {
  const [aberta, setAberta] = React.useState(false)
  const pathname = usePathname()
  const gatilho = React.useRef<HTMLButtonElement>(null)
  const painel = React.useRef<HTMLElement>(null)

  // Navegar fecha. `pathname` na dependência e não um `onClick` em cada link:
  // são dez itens mais sete filhos, e um `onClick` esquecido em um deles seria
  // um defeito que só aparece naquele item.
  React.useEffect(() => {
    setAberta(false)
  }, [pathname])

  React.useEffect(() => {
    if (!aberta) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberta(false)
    }
    document.addEventListener('keydown', aoTeclar)
    // A página atrás não rola enquanto a gaveta está aberta: sem isto, arrastar
    // dentro do menu rola o conteúdo por baixo, e ao fechar a pessoa está em
    // outro ponto da tela sem ter pedido.
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    painel.current?.focus()
    return () => {
      document.removeEventListener('keydown', aoTeclar)
      document.body.style.overflow = antes
    }
  }, [aberta])

  const fechar = () => {
    setAberta(false)
    // O foco volta para o botão que abriu. Sem isso ele cai no início do
    // documento, e quem usa teclado recomeça a tabular do topo da página.
    gatilho.current?.focus()
  }

  return (
    <>
      {/* ds-excecao: alvo de ÍCONE do cabeçalho, irmão do sino e do perfil, que
          são desenhados do mesmo jeito. Um <Btn> traria fundo e altura de botão
          de ação e desequilibraria a fileira do topo. */}
      <button
        ref={gatilho}
        type="button"
        onClick={() => setAberta(true)}
        aria-label="Abrir o menu"
        aria-expanded={aberta}
        title="Abrir o menu"
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink md:hidden',
          FOCO,
        )}
      >
        <Menu className="h-[18px] w-[18px]" />
      </button>

      {aberta && (
        <div role="dialog" aria-modal="true" aria-label="Menu" className="fixed inset-0 z-50 md:hidden">
          {/* Overlay do §06: rgba(22,22,26,.55) com desfoque de 2px, 200ms. */}
          {/* ds-excecao: é o BACKDROP, não um botão — ocupa a tela inteira e não
              tem rótulo visível. É `<button>` e não `<div onClick>` justamente
              para "fechar" existir para leitor de tela e para o teclado. */}
          <button
            type="button"
            aria-label="Fechar o menu"
            onClick={fechar}
            className="absolute inset-0 bg-[rgba(22,22,26,0.55)] backdrop-blur-[2px] motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
          />
          {/* 268px, no máximo 82% — a folga da direita é o que mostra que há tela
              atrás e que o backdrop é tocável. Ocupar a largura toda faria a
              gaveta parecer uma página, e ninguém procura como sair de uma página. */}
          <aside
            ref={painel}
            tabIndex={-1}
            className="relative flex h-full w-[268px] max-w-[82%] flex-col overflow-y-auto border-r border-line bg-surface px-[14px] py-[18px] shadow-pop outline-none motion-safe:animate-in motion-safe:slide-in-from-left motion-safe:duration-200"
          >
            <div className="flex items-center justify-between px-2 pb-[18px] pt-1.5">
              <Link href="/" aria-label="Início">
                <AlloyalLogo className="h-6" />
              </Link>
              {/* ds-excecao: alvo de ícone do cabeçalho da própria gaveta, do
                  mesmo tamanho e peso do botão que a abriu. */}
              <button
                type="button"
                onClick={fechar}
                aria-label="Fechar o menu"
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink',
                  FOCO,
                )}
              >
                <X className="h-[17px] w-[17px]" />
              </button>
            </div>
            <Nav />
            <div className="mt-auto px-2 pt-4 text-nota leading-relaxed text-ink-4">
              Alloyal Pulse · ferramentas de operação
            </div>
          </aside>
        </div>
      )}
    </>
  )
}
