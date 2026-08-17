import { clsx, type ClassValue } from 'clsx'
import type React from 'react'
import { twMerge } from 'tailwind-merge'

/**
 * Os componentes base do Alloyal — mesma API do `src/ui.tsx` do alloyal-publi.
 *
 * A assinatura é igual de propósito: quem já mexeu no Publi escreve tela no Pulse
 * sem consultar nada, e uma correção visual feita num lado é portável para o
 * outro por copiar e colar. Onde o Pulse precisa de algo que o Publi não tem — o
 * estado do dado, a faixa de saúde — o acréscimo fica em `Metric` e `Vazio`, e
 * não numa variante nova de `Card` ou `Badge`.
 */

/** Merge de classes Tailwind (padrão shadcn/Metas): a última vence. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const cx = cn

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  /* ┌─────────────────────────────────────────────────────────────────┐
     │ O CABEÇALHO QUEBRA EM LINHAS, e o bloco de ações pode encolher. │
     │                                                                  │
     │ Era `flex` sem quebra e um `<div>` sem `min-w-0` em volta das    │
     │ ações: no telefone, os cinco chips mais a busca da base de       │
     │ clientes empurravam o cabeçalho para 462px numa tela de 390 — e  │
     │ quem rolava de lado era a PÁGINA INTEIRA, não o card. Medido em  │
     │ 390px antes e depois.                                            │
     │                                                                  │
     │ `min-w-0` é a metade que se esquece: sem ele um item de flex se  │
     │ recusa a ficar menor que o próprio conteúdo, e `flex-wrap` no    │
     │ pai não resolve nada.                                            │
     └─────────────────────────────────────────────────────────────────┘ */
  return (
    <section className={cn('min-w-0 rounded-lg border border-line bg-surface shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-[18px] py-[14px]">
          <h2 className="text-cartao font-bold tracking-[-0.01em] text-ink">{title}</h2>
          <div className="flex min-w-0 flex-wrap gap-2">{actions}</div>
        </header>
      )}
      <div className="p-[18px]">{children}</div>
    </section>
  )
}

export function Btn({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled,
  name,
  value,
  title,
  className,
}: {
  children: React.ReactNode
  /**
   * Só vale dentro de componente de cliente — e é o que o Publi tem na mesma
   * assinatura. Estava faltando aqui porque a casca inteira era de servidor;
   * quando o painel do Radar chegou, o caminho sem isto era o botão cru, que é
   * exatamente o que `design-system.test.mjs` existe para impedir.
   */
  onClick?: () => void
  type?: 'button' | 'submit'
  variant?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
  /** `name`/`value` para o botão carregar a escolha no submit, sem JS. */
  name?: string
  value?: string
  title?: string
  className?: string
}) {
  const styles = {
    primary: 'bg-purple-500 text-white hover:bg-purple-700',
    ghost: 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
    danger: 'bg-red text-white hover:bg-red/90',
  }[variant]
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      name={name}
      value={value}
      title={title}
      className={cn(
        'inline-flex h-9 items-center justify-center gap-[7px] whitespace-nowrap rounded-sm px-[14px] text-corpo font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-[15px]',
        styles,
        className,
      )}
    >
      {children}
    </button>
  )
}

export const inputCls =
  'w-full rounded-sm border border-line-strong bg-surface px-3 text-corpo text-ink outline-none transition-colors placeholder:text-ink-4 focus:border-purple-500 focus:ring-2 focus:ring-purple-100'

export function Field({
  label,
  className,
  ...props
}: { label?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block text-corpo">
      {label && <span className="mb-1 block font-medium text-ink-2">{label}</span>}
      <input {...props} className={cn('h-9', inputCls, className)} />
    </label>
  )
}

export function Select({
  label,
  children,
  className,
  ...props
}: { label?: string; children: React.ReactNode } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block text-corpo">
      {label && <span className="mb-1 block font-medium text-ink-2">{label}</span>}
      <select {...props} className={cn('h-9', inputCls, className)}>
        {children}
      </select>
    </label>
  )
}

/**
 * O campo de texto longo, com o MESMO `inputCls` do `Field`.
 *
 * Existe porque os dois textarea que havia na app copiaram essas classes à mão e já
 * tinham divergido entre si — um em 13px com regra de placeholder, o outro em 13.5px
 * sem. Cópia à mão de token diverge; a única defesa é não haver cópia.
 *
 * `py-2` em vez da altura fixa do `Field`: aqui quem manda é o `rows`.
 */
export function TextArea({
  label,
  className,
  ...props
}: { label?: React.ReactNode } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block text-corpo">
      {label && <span className="mb-1 block font-medium text-ink-2">{label}</span>}
      <textarea {...props} className={cn('py-2', inputCls, className)} />
    </label>
  )
}

export function Table({
  cols,
  rows,
  vazio = 'sem registros',
  denso = false,
}: {
  cols: React.ReactNode[]
  rows: React.ReactNode[][]
  vazio?: React.ReactNode
  /** Tipo e respiro menores, para a folha A4 — onde a coluna é estreita. */
  denso?: boolean
}) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full', denso ? 'text-corpo' : 'text-cartao')}>
        <thead>
          <tr className="border-b border-line text-left text-tabela uppercase tracking-[0.08em] text-ink-3">
            {cols.map((c, i) => (
              <th key={i} className={cn('font-semibold', denso ? 'py-1.5 pr-3' : 'px-3 py-2')}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={cols.length} className="px-3 py-6 text-center text-ink-3">
                {vazio}
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr
              key={i}
              className={cn(
                'border-b border-line last:border-0',
                /* Sem hover na folha impressa: estado de mouse em papel não existe. */
                !denso && 'hover:bg-surface-2',
              )}
            >
              {r.map((c, j) => (
                <td
                  key={j}
                  className={cn('align-top text-ink', denso ? 'py-1.5 pr-3' : 'px-3 py-2.5')}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export type Tom = 'slate' | 'green' | 'red' | 'amber' | 'indigo' | 'pink' | 'orange' | 'blue'

export function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: Tom }) {
  const t = {
    slate: 'bg-surface-2 text-ink-2 ring-1 ring-inset ring-line',
    green: 'bg-green-50 text-green',
    red: 'bg-red-50 text-red',
    // `text-orange-700` e não `text-orange-700`: âmbar não tem degrau escuro na
    // paleta, então `amber-700` não compilava para NADA e o texto do selo herdava
    // a cor de quem estivesse em volta. O documento usa laranja aqui pelo mesmo
    // motivo — é o tom escuro que passa contraste sobre fundo âmbar.
    amber: 'bg-amber-50 text-orange-700',
    indigo: 'bg-purple-50 text-purple-700',
    pink: 'bg-pink-50 text-pink',
    orange: 'bg-orange-50 text-orange-700',
    blue: 'bg-blue-50 text-blue',
  }[tone]
  return (
    <span className={cn('inline-block rounded-full px-2 py-0.5 text-nota font-medium', t)}>
      {children}
    </span>
  )
}

/**
 * O tom de badge para cada faixa de saúde e prioridade.
 *
 * Num mapa só, e não escolhido tela por tela: risco alto pintado de laranja
 * numa tela e de vermelho na outra é como o time deixa de confiar na cor.
 */
export const TOM_POR_FAIXA: Record<string, Tom> = {
  saudavel: 'green',
  atencao: 'amber',
  risco: 'orange',
  critico: 'red',
  // Prioridade de item de trabalho.
  baixa: 'slate',
  media: 'amber',
  alta: 'orange',
  critica: 'red',
}

/** KPI — o número grande do topo da tela. */
/**
 * O KPI do design system (§06 "KPI com barra lateral").
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ESTAVA ERRADO AQUI, e de um jeito que muda o significado: o semáforo vivia  │
 * │ na COR DO VALOR. Um número vermelho lê-se como "este número está errado";   │
 * │ o que se quer dizer é "este indicador está ruim". São coisas diferentes, e  │
 * │ a segunda é a que a barra lateral diz sem tocar no número.                  │
 * │                                                                            │
 * │ O documento é específico: barra lateral de 4px carrega o semáforo, ROXO É   │
 * │ NEUTRO, e verde/vermelho só entram quando há regra objetiva de bom/ruim.    │
 * │ Sem regra objetiva, colorir é opinião disfarçada de dado.                   │
 * │                                                                            │
 * │ E o rótulo é 11px maiúsculo, não 10,5px: 10,5 é a medida do cabeçalho de    │
 * │ TABELA, que é outro papel.                                                 │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export function Kpi({
  rotulo,
  valor,
  nota,
  tom,
  delta,
}: {
  rotulo: React.ReactNode
  valor: React.ReactNode
  nota?: React.ReactNode
  /**
   * O semáforo da barra lateral. `undefined` = roxo, que é o neutro.
   *
   * Só use verde ou vermelho quando existir regra objetiva de bom/ruim — um
   * número que subiu não é bom por ter subido.
   */
  tom?: 'green' | 'amber' | 'red'
  /**
   * Variação contra o período anterior, em fração (0,12 = 12%).
   *
   * `null` é NOVO, que não é zero: significa que não há período anterior para
   * comparar. Zero é `0` e aparece como "estável".
   */
  delta?: number | null
}) {
  const barra = tom
    ? { green: 'bg-green', amber: 'bg-amber', red: 'bg-red' }[tom]
    : 'bg-purple-500'
  return (
    <div className="relative overflow-hidden rounded-lg border border-line bg-surface p-[18px] pl-[22px] shadow-sm">
      {/* A barra de 4px. `aria-hidden` porque o significado dela já está no
          texto do pé — cor sozinha não informa quem não a enxerga. */}
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1', barra)} />
      <div className="text-nota font-semibold uppercase tracking-[0.08em] text-ink-3">{rotulo}</div>
      <div className="mt-1.5 text-kpi tabular-nums text-ink">{valor}</div>
      {(delta !== undefined || nota) && (
        <div className="mt-1 flex flex-wrap items-baseline gap-1.5 text-meta text-ink-2">
          {delta !== undefined && <DeltaDoKpi valor={delta} />}
          {nota}
        </div>
      )}
    </div>
  )
}

/**
 * Os quatro estados do delta: ▲ subiu, ▼ caiu, ■ estável, e "novo".
 *
 * "novo" é o que separa ausência de estabilidade. Sem ele, quem não tinha período
 * anterior aparece como 0% — afirmando que nada mudou onde nada havia.
 */
function DeltaDoKpi({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="font-medium text-purple-700">novo</span>
  if (valor === 0) {
    return (
      <span className="text-ink-3">
        <span aria-hidden="true">■</span> estável
      </span>
    )
  }
  const sobe = valor > 0
  return (
    <span className={cn('font-medium tabular-nums', sobe ? 'text-green' : 'text-red')}>
      <span aria-hidden="true">{sobe ? '▲' : '▼'}</span>{' '}
      {Math.abs(valor * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
    </span>
  )
}

/** Aviso de faixa inteira — erro, sucesso ou alerta de dado. */
export function Aviso({
  children,
  tom = 'info',
  papel,
}: {
  children: React.ReactNode
  tom?: 'info' | 'ok' | 'alerta' | 'erro'
  papel?: 'alert' | 'status'
}) {
  /* ┌─────────────────────────────────────────────────────────────────────┐
     │ BARRA LATERAL DE 4px, e não borda inteira — §06, "Faixa de aviso".     │
     │                                                                        │
     │ Estava com borda em volta, o mesmo erro que o KPI tinha: a borda        │
     │ desenha uma caixa, e caixa é contêiner. A barra é um MARCADOR — ela diz │
     │ "isto aqui pede atenção" sem cercar o texto, e é a mesma linguagem do   │
     │ KPI, que é o ponto de terem a mesma medida.                            │
     │                                                                        │
     │ Âmbar avisa e deixa seguir; vermelho EXIGE ação. Por isso o vermelho    │
     │ nasce com `role="alert"` quando quem chama não diz o contrário: aviso   │
     │ que exige ação e não interrompe o leitor de tela não exigiu nada.       │
     └─────────────────────────────────────────────────────────────────────┘ */
  const t = {
    info: 'bg-surface-2 text-ink-2 before:bg-line-strong',
    ok: 'bg-green-50 text-green before:bg-green',
    alerta: 'bg-amber-50 text-orange-700 before:bg-amber',
    erro: 'bg-red-50 text-red before:bg-red',
  }[tom]
  return (
    /* `px-3 py-2` é a medida do `ErrorBox` do Publi, de quem este componente é a
       generalização em quatro tons. O `pl-4` abre espaço para a barra. */
    <div
      role={papel ?? (tom === 'erro' ? 'alert' : undefined)}
      className={cn(
        'relative overflow-hidden rounded-md py-2 pl-4 pr-3 text-corpo',
        'before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-[""]',
        t,
      )}
    >
      {children}
    </div>
  )
}
