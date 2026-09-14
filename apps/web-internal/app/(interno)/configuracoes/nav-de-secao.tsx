import { cn } from '@pulse/ui'

/**
 * A navegação ENTRE OS BOXES de uma página de Configurações.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ÂNCORA, E NÃO COMPONENTE DE CLIENTE — de propósito.                        │
 * │                                                                            │
 * │ O pedido foi "um submenu dentro da página para navegar melhor sobre os      │
 * │ boxes internos". A forma mais barata que faz isso é `<a href="#id">`: o      │
 * │ navegador rola sozinho, sem JavaScript, e por isso funciona sob a CSP que    │
 * │ recusa `unsafe-eval`. Um scroll-spy que acende o item ativo exigiria JS e    │
 * │ um IntersectionObserver — custo que não paga por marcar qual box está no     │
 * │ topo quando o clique já leva a pessoa até ele.                             │
 * │                                                                            │
 * │ O `scroll-mt` de cada `<section>` é o par disto: sem ele, a âncora           │
 * │ pararia SOB o `Topo` sticky de 62px e o título do box ficaria escondido.    │
 * │ Medido: 62px do Topo + a própria barra sticky.                             │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export function NavDeSecao({
  secoes,
  className,
}: {
  secoes: readonly { readonly id: string; readonly rotulo: string }[]
  className?: string
}) {
  if (secoes.length < 2) return null // uma seção só não é navegação
  return (
    <nav
      aria-label="Seções desta página"
      className={cn(
        // Gruda logo abaixo do Topo (h-[62px]) e fica acima do conteúdo ao rolar.
        'sticky top-[62px] z-10 -mx-4 flex flex-wrap gap-2 border-b border-line bg-bg/95 px-4 py-2.5 backdrop-blur md:-mx-8 md:px-8',
        className,
      )}
    >
      {secoes.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className="rounded-full border border-line-strong bg-surface px-3 py-1 text-meta font-medium text-ink-2 transition-colors hover:border-purple-500 hover:text-purple-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-purple-500"
        >
          {s.rotulo}
        </a>
      ))}
    </nav>
  )
}

/**
 * O box ancorável. Envolve o conteúdo com o `id` que a navegação aponta e o
 * `scroll-mt` que impede a âncora de parar embaixo do Topo.
 */
export function Secao({
  id,
  children,
  className,
}: {
  id: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section id={id} className={cn('scroll-mt-28', className)}>
      {children}
    </section>
  )
}
