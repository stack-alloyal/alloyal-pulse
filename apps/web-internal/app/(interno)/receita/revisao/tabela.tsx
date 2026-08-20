import { cn } from '@pulse/ui'
import Link from 'next/link'

/**
 * A tabela ordenável desta tela — uma implementação para as cinco visões.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ EXISTE PORQUE "ORDENAR EM TODOS OS CABEÇALHOS" SÃO 27 COLUNAS. Escritas à   │
 * │ mão, seriam 27 links quase iguais, e o 28º nasceria sem ordenação sem que    │
 * │ ninguém percebesse — a coluna que não ordena não avisa que não ordena.      │
 * │                                                                            │
 * │ Cada coluna declara COMO se ordena, e é isso que a torna correta: `chave`    │
 * │ devolve o valor de comparação, que não é o mesmo que o valor exibido.        │
 * │ "R$ 1.370.779,57" ordenado como texto põe R$ 999 acima de R$ 1 milhão, e     │
 * │ "ago/26" ordenado como texto põe agosto antes de dezembro. Por isso o        │
 * │ comparador recebe número ou data crua, e a célula formata à parte.          │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export interface Coluna<T> {
  /** Identificador na URL. Curto: ele aparece em `?ord=`. */
  readonly id: string
  readonly rotulo: string
  /** O que a célula mostra. */
  readonly celula: (linha: T) => React.ReactNode
  /** Por que valor se ordena. Ausente = coluna não ordenável (ícone, ação). */
  readonly chave?: (linha: T) => string | number
  /** `desc` primeiro nas colunas de número: quem quer ver dinheiro quer o maior. */
  readonly inicial?: 'asc' | 'desc'
  readonly alinhar?: 'direita'
}

export function ordenar<T>(
  dados: readonly T[],
  colunas: readonly Coluna<T>[],
  ord: string,
  dir: 'asc' | 'desc',
): T[] {
  const c = colunas.find((x) => x.id === ord && x.chave)
  if (!c?.chave) return [...dados]
  const chave = c.chave
  const sinal = dir === 'asc' ? 1 : -1
  return [...dados].sort((a, b) => {
    const x = chave(a)
    const y = chave(b)
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sinal
    // `localeCompare` com pt-BR: sem ele, "Átila" cai depois de "Zeta" porque a
    // comparação binária ordena por código de caractere, não por alfabeto.
    return String(x).localeCompare(String(y), 'pt-BR') * sinal
  })
}

export function TabelaOrdenavel<T>({
  dados,
  colunas,
  ord,
  dir,
  href,
  vazio,
  chaveDaLinha,
}: {
  dados: readonly T[]
  colunas: readonly Coluna<T>[]
  ord: string
  dir: 'asc' | 'desc'
  /** Para onde o cabeçalho aponta. Recebe a coluna e a direção que o clique pede. */
  href: (id: string, dir: 'asc' | 'desc') => string
  vazio: string
  chaveDaLinha: (linha: T) => string
}) {
  const linhas = ordenar(dados, colunas, ord, dir)
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-0 text-cartao">
        <thead>
          <tr className="border-b border-line text-left text-tabela uppercase tracking-[0.08em] text-ink-3">
            {colunas.map((c) => {
              const ativa = c.id === ord && Boolean(c.chave)
              // Clicar na coluna ATIVA inverte; clicar em outra começa na direção
              // natural dela. Sem isso, ordenar por dinheiro começava no menor.
              const proxima: 'asc' | 'desc' = ativa
                ? dir === 'asc'
                  ? 'desc'
                  : 'asc'
                : (c.inicial ?? 'asc')
              return (
                <th
                  key={c.id}
                  aria-sort={ativa ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={cn('px-3 py-2 font-semibold', c.alinhar === 'direita' && 'text-right')}
                >
                  {c.chave ? (
                    <Link
                      href={href(c.id, proxima)}
                      className={cn(
                        'inline-flex items-center gap-1',
                        ativa ? 'font-semibold text-purple-700' : 'text-ink-3 hover:text-ink',
                      )}
                    >
                      {c.rotulo}
                      {/* A seta só na coluna ativa: cinco setas acesas não dizem
                          qual manda. */}
                      {ativa && <span aria-hidden="true">{dir === 'asc' ? '↑' : '↓'}</span>}
                    </Link>
                  ) : (
                    c.rotulo
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {linhas.length === 0 ? (
            <tr>
              <td colSpan={colunas.length} className="px-3 py-6 text-corpo text-ink-3">
                {vazio}
              </td>
            </tr>
          ) : (
            linhas.map((l) => (
              <tr key={chaveDaLinha(l)} className="border-b border-line last:border-0 hover:bg-surface-2">
                {colunas.map((c) => (
                  <td
                    key={c.id}
                    className={cn('px-3 py-2.5 align-middle', c.alinhar === 'direita' && 'text-right')}
                  >
                    {c.celula(l)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
