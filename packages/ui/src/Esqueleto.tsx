import { cn } from './base'

/**
 * Esqueleto de carregamento — §11 do design system.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O pulso fica atrás de `motion-safe:` por regra do §08: é animação que se    │
 * │ repete indefinidamente, e é exatamente o que incomoda quem pediu para       │
 * │ reduzir movimento. Sem ele, o esqueleto pulsa para sempre na tela de quem   │
 * │ tem enjoo de movimento — e essa pessoa não tem como desligar.               │
 * │                                                                            │
 * │ `aria-hidden` e `role="status"` no contêiner: o leitor de tela anuncia      │
 * │ "carregando" uma vez, em vez de ler quinze retângulos vazios.               │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export function Esqueleto({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('block rounded-sm bg-surface-2 motion-safe:animate-pulse', className)}
    />
  )
}

/** Esqueleto de tabela: cabeçalho e linhas, na medida do `Table`. */
export function EsqueletoTabela({ linhas = 6, colunas = 5 }: { linhas?: number; colunas?: number }) {
  return (
    <div role="status" aria-label="Carregando" className="w-full">
      <div className="flex gap-3 border-b border-line px-3 py-2">
        {Array.from({ length: colunas }, (_, i) => (
          <Esqueleto key={i} className="h-2.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: linhas }, (_, l) => (
        <div key={l} className="flex gap-3 border-b border-line px-3 py-3 last:border-0">
          {Array.from({ length: colunas }, (_, c) => (
            <Esqueleto key={c} className={cn('h-3 flex-1', c === 0 && 'flex-[2]')} />
          ))}
        </div>
      ))}
    </div>
  )
}
