import Link from 'next/link'

import { cn } from './base'

/**
 * Estado vazio que ENSINA (requisito D5).
 *
 * "Nenhum item na fila" com uma ilustração e ponto final é a forma mais barata
 * de fazer alguém achar que a ferramenta está quebrada. Todo vazio diz três
 * coisas: o que aconteceu, por que, e o que fazer agora.
 */
export interface VazioProps {
  readonly titulo: string
  readonly porque: string
  readonly acao?: { readonly texto: string; readonly href: string }
  /**
   * Qual dos quatro níveis do §06 este vazio é.
   *
   * `filtro` EXIGE `acao`, e é a regra que o documento põe no componente: um
   * vazio causado por filtro sem caminho de volta é um beco. Os outros níveis
   * não exigem, porque "não há dado no período" não tem saída a oferecer.
   *
   * `explicado` é o quarto nível: o vazio que PARECE defeito e não é — "nenhuma
   * organização inativa na base, e não é falha do filtro".
   */
  readonly nivel?: 'padrao' | 'filtro' | 'explicado'
  readonly className?: string
}

export function Vazio({ titulo, porque, acao, nivel = 'padrao', className }: VazioProps) {
  if (nivel === 'filtro' && !acao) {
    // Falha no desenvolvimento, e não em silêncio na tela: um vazio-por-filtro sem
    // saída só se descobre quando alguém fica preso nele.
    throw new Error(
      'Vazio nivel="filtro" exige `acao` — sem caminho de volta, o vazio por filtro vira beco (§06)',
    )
  }
  return (
    <div
      role="status"
      className={cn(
        'max-w-[70ch] rounded-lg border border-dashed border-line-strong bg-surface p-6',
        className,
      )}
    >
      <p className="text-cartao font-bold tracking-[-0.01em] text-ink">{titulo}</p>
      <p className="mt-1.5 text-corpo leading-relaxed text-ink-2">{porque}</p>
      {acao ? (
        <Link
          href={acao.href}
          className="mt-3 inline-block text-corpo font-semibold text-purple-700 hover:text-purple-500"
        >
          {acao.texto} →
        </Link>
      ) : null}
    </div>
  )
}
