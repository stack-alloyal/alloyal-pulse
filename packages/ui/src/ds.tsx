import Link from 'next/link'
import * as React from 'react'

import { cn } from './base'

/**
 * Composições do design system do Publi (§05 "Composições — src/ds.tsx").
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ SEPARADO DOS PRIMITIVOS DE PROPÓSITO, como no documento: `base.tsx` é       │
 * │ estável, este arquivo ainda muda de forma conforme as telas migram.        │
 * │                                                                            │
 * │ Cada componente substitui uma composição que estava copiada nas telas, e o  │
 * │ que ele carrega no código é A REGRA QUE A CÓPIA PERDIA. Um `Chip` sem a     │
 * │ regra do zerado é um botão com contador; com ela, é a garantia de que       │
 * │ ninguém cai num beco.                                                      │
 * │                                                                            │
 * │ FOCO VISÍVEL EM TODO CONTROLE. O documento aponta isto como a maior lacuna  │
 * │ de acessibilidade (§11): as composições copiadas tinham só `hover:`, e quem │
 * │ navega por teclado não via onde estava. Aqui é padrão, não opção.           │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

/** O anel de foco do documento. Um lugar só, para não divergir por descuido. */
export const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1'

// ═══ Abas ════════════════════════════════════════════════════════════════════

export interface Aba {
  readonly chave: string
  readonly rotulo: React.ReactNode
  /** Contagem opcional ao lado do rótulo. */
  readonly conta?: number
}

/**
 * Barra de abas.
 *
 * A REGRA: a aba vive na QUERY STRING, não em estado local. Link compartilhado
 * abre onde a pessoa estava; recarregar não perde o lugar; e o botão de voltar do
 * navegador funciona. Estado local quebra os três.
 *
 * `href` recebe a chave e devolve o endereço — quem chama decide o nome do
 * parâmetro, porque em algumas telas ele convive com filtros.
 */
export function Abas({
  abas,
  atual,
  href,
  className,
}: {
  abas: readonly Aba[]
  atual: string
  href: (chave: string) => string
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 gap-1 overflow-x-auto border-b border-line', className)} role="tablist">
      {abas.map((a) => {
        const ativa = a.chave === atual
        return (
          <Link
            key={a.chave}
            href={href(a.chave)}
            role="tab"
            aria-selected={ativa}
            aria-current={ativa ? 'page' : undefined}
            className={cn(
              '-mb-px whitespace-nowrap rounded-t-sm border-b-2 px-3.5 py-2 text-corpo font-medium transition-colors',
              FOCO,
              ativa
                ? 'border-purple-500 text-purple-700'
                : 'border-transparent text-ink-2 hover:text-ink',
            )}
          >
            {a.rotulo}
            {a.conta !== undefined && (
              <span className={cn('ml-1.5 tabular-nums', ativa ? 'text-purple-500' : 'text-ink-3')}>
                {a.conta.toLocaleString('pt-BR')}
              </span>
            )}
          </Link>
        )
      })}
    </div>
  )
}

// ═══ Chip ════════════════════════════════════════════════════════════════════

export interface ChipProps {
  readonly rotulo: React.ReactNode
  readonly href: string
  readonly ativo?: boolean
  /** Contagem. `undefined` esconde; `0` aparece — ver a regra abaixo. */
  readonly conta?: number
  /**
   * Estado estrutural: continua visível mesmo zerado.
   *
   * A REGRA, do documento: "zerado não vira beco; `fixo` mantém estado estrutural
   * visível". Esconder o filtro "cancelado" só porque hoje não há nenhum faria
   * parecer que cancelar não existe — e quem procura por ele conclui que a tela
   * está quebrada. Já um filtro circunstancial zerado é ruído, e sai.
   */
  readonly fixo?: boolean
}

export function Chip({ rotulo, href, ativo = false, conta, fixo = false }: ChipProps) {
  /* ┌─────────────────────────────────────────────────────────────────────┐
     │ ZERADO FICA APAGADO E SEM CLIQUE — §06, e eu tinha escondido.          │
     │                                                                        │
     │ Sumir com o chip é justamente o beco que a regra evita: a pessoa filtra │
     │ por "cancelado", a contagem zera, o chip desaparece — e ela fica sem o  │
     │ caminho de volta, olhando uma lista vazia sem saber qual filtro a       │
     │ trouxe até ali.                                                        │
     │                                                                        │
     │ Apagado e sem clique diz as duas coisas ao mesmo tempo: o filtro existe │
     │ e não tem nada agora. O `title` explica, para não depender só da cor.   │
     └─────────────────────────────────────────────────────────────────────┘ */
  const vazio = conta === 0 && !ativo
  if (vazio && !fixo) {
    return (
      <span
        title="nenhum registro nesta situação com os filtros atuais"
        aria-disabled="true"
        className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-meta text-ink-4"
      >
        {rotulo}
        <span className="tabular-nums">0</span>
      </span>
    )
  }
  return (
    <Link
      href={href}
      aria-pressed={ativo}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-meta transition-colors',
        FOCO,
        ativo
          ? 'border-purple-500 bg-purple-50 font-semibold text-purple-700'
          : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
      )}
    >
      {rotulo}
      {conta !== undefined && (
        <span className={cn('tabular-nums', ativo ? 'text-purple-500' : 'text-ink-3')}>
          {conta.toLocaleString('pt-BR')}
        </span>
      )}
    </Link>
  )
}

/** Fila de chips, com o espaçamento do documento. */
export function Chips({ children, rotulo }: { children: React.ReactNode; rotulo?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {rotulo && <span className="mr-0.5 text-meta text-ink-3">{rotulo}</span>}
      {children}
    </div>
  )
}

// ═══ Preset ══════════════════════════════════════════════════════════════════

/**
 * Barra de período.
 *
 * A REGRA: escolha EXCLUSIVA de recorte, e SEM contagem. Preset não é filtro
 * acumulativo — é a janela sobre a qual todo o resto da tela é calculado. Pôr
 * contagem aqui convidaria a comparar dois recortes que nunca coexistem.
 */
export function Preset({
  opcoes,
  atual,
  href,
}: {
  opcoes: readonly { chave: string; rotulo: React.ReactNode }[]
  atual: string
  href: (chave: string) => string
}) {
  return (
    <div className="inline-flex rounded-md border border-line bg-surface p-0.5" role="group">
      {opcoes.map((o) => {
        const ativo = o.chave === atual
        return (
          <Link
            key={o.chave}
            href={href(o.chave)}
            aria-current={ativo ? 'true' : undefined}
            className={cn(
              'rounded-[5px] px-2.5 py-1 text-meta font-medium transition-colors',
              FOCO,
              ativo ? 'bg-purple-50 text-purple-700' : 'text-ink-2 hover:text-ink',
            )}
          >
            {o.rotulo}
          </Link>
        )
      })}
    </div>
  )
}

// ═══ Delta ═══════════════════════════════════════════════════════════════════

/**
 * Variação entre dois períodos.
 *
 * A REGRA, e ela é a razão do componente existir: `null` é "NOVO", que não é
 * zero. Um cliente que não existia no período anterior não variou 0% — ele não
 * tinha com o que variar. Mostrar 0% ali afirma estabilidade onde havia ausência.
 */
export function Delta({ valor, sufixo = '%' }: { valor: number | null; sufixo?: string }) {
  if (valor === null) {
    return <span className="text-meta font-medium text-purple-700">novo</span>
  }
  if (valor === 0) return <span className="text-meta text-ink-3">estável</span>
  const sobe = valor > 0
  return (
    <span className={cn('text-meta font-medium tabular-nums', sobe ? 'text-green' : 'text-red')}>
      {sobe ? '↑' : '↓'} {Math.abs(valor).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
      {sufixo}
    </span>
  )
}

// ═══ KpiGrade ════════════════════════════════════════════════════════════════

/**
 * A grade de KPIs.
 *
 * Existe porque a mesma `grid grid-cols-2 gap-3 lg:grid-cols-4` estava copiada em
 * treze telas, e cada cópia divergia num detalhe. Uma grade só, com o número de
 * colunas como opção.
 */
export function KpiGrade({
  children,
  colunas = 4,
}: {
  children: React.ReactNode
  colunas?: 2 | 3 | 4 | 6
}) {
  /* ┌─────────────────────────────────────────────────────────────────────────┐
     │ UMA COLUNA NO TELEFONE, e itens que podem encolher.                      │
     │                                                                           │
     │ Começava em duas colunas em qualquer largura. Um KPI tem valor de 22px —  │
     │ "17/08/2026, 07:10" na tela do Omie pede ~180px — e dois deles lado a     │
     │ lado numa tela de 390 levavam a GRADE a 555px: a página inteira rolava    │
     │ de lado. Medido.                                                          │
     │                                                                           │
     │ `min-w-0` NA PRÓPRIA GRADE é a outra metade, e a mais escorregadia: em    │
     │ 26 telas o <Corpo> é `grid`, então esta grade é item de grade — e item de │
     │ grade tem largura mínima AUTOMÁTICA, isto é, recusa-se a ficar menor que  │
     │ o próprio conteúdo. Era daí que vinham os 555px na tela do Omie e os      │
     │ 858px na de match, com o contêiner de 362.                                │
     │                                                                           │
     │ Tentei antes a variante `[&>*]:min-w-0`; ela NÃO é gerada pelo Tailwind    │
     │ desta versão — conferido no CSS compilado, onde só existe `.min-w-0`.     │
     │ Passou no build, passou no tipo, e não fez nada.                          │
     └─────────────────────────────────────────────────────────────────────────┘ */
  const cls = {
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
    6: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6',
  }[colunas]
  return <div className={cn('grid min-w-0 gap-3', cls)}>{children}</div>
}

// ═══ Ações em ícone ══════════════════════════════════════════════════════════

/**
 * Botão-ícone de linha de tabela.
 *
 * A REGRA: `titulo` é OBRIGATÓRIO. Ícone sem nome acessível é um alvo mudo para
 * leitor de tela e um enigma para quem passa o mouse — e numa linha de tabela com
 * três ícones, o enigma é triplo.
 */
export function AcaoIcone({
  titulo,
  href,
  children,
  tom = 'neutro',
}: {
  titulo: string
  href: string
  children: React.ReactNode
  tom?: 'neutro' | 'acao' | 'perigo'
}) {
  const cor = {
    neutro: 'text-ink-3 hover:bg-surface-2 hover:text-ink',
    acao: 'text-ink-3 hover:bg-purple-50 hover:text-purple-700',
    perigo: 'text-ink-3 hover:bg-red-50 hover:text-red',
  }[tom]
  return (
    <Link
      href={href}
      title={titulo}
      aria-label={titulo}
      className={cn('inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors', FOCO, cor)}
    >
      {children}
    </Link>
  )
}

/**
 * A célula que agrupa ações de uma linha.
 *
 * `Acoes.Espaco` existe para manter a grade quando uma linha não tem aquela ação:
 * sem ele, os ícones das outras linhas dançam de coluna e a tabela perde o
 * alinhamento vertical que faz uma lista ser varrida com os olhos.
 */
export function Acoes({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-0.5">{children}</span>
}
Acoes.Espaco = function Espaco() {
  return <span aria-hidden="true" className="inline-block h-7 w-7" />
}

// ═══ Busca ═══════════════════════════════════════════════════════════════════

/**
 * Campo de busca com lupa.
 *
 * A REGRA: botão de LIMPAR quando há texto. Sem ele, desfazer uma busca exige
 * apagar caractere por caractere ou saber que existe outro caminho — e a pessoa
 * que buscou errado fica presa no resultado errado.
 *
 * É `form` com GET, e não estado de cliente: a busca fica na URL, sobrevive a
 * recarregar e pode ser compartilhada. Mesmo princípio das abas.
 */
export function Busca({
  action,
  nome = 'q',
  valor = '',
  placeholder,
  ocultos,
  hrefLimpar,
  className,
}: {
  action: string
  nome?: string
  valor?: string
  placeholder?: string
  /** Campos que precisam sobreviver à busca — filtros já escolhidos. */
  ocultos?: Record<string, string>
  /** Para onde o "limpar" leva. Sem isto o botão não aparece. */
  hrefLimpar?: string
  className?: string
}) {
  return (
    <form action={action} className={cn('flex min-w-0 items-center gap-2', className)}>
      {Object.entries(ocultos ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <span className="relative min-w-0 flex-1 sm:flex-none">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="pointer-events-none absolute left-2.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-ink-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          name={nome}
          defaultValue={valor}
          placeholder={placeholder}
          aria-label={placeholder ?? 'Buscar'}
          className={cn(
            // 280px é a medida do documento, e vale onde cabe. No telefone o campo
            // passa a ocupar a linha: fixo em 280 ele estourava a tela, e quem
            // rolava de lado era a página inteira.
            'h-control w-full rounded-md border border-line-strong bg-surface pl-8 pr-3 text-corpo text-ink placeholder:text-ink-3 sm:w-[280px]',
            FOCO,
          )}
        />
      </span>
      <button
        type="submit"
        className={cn(
          'h-control rounded-md bg-purple-500 px-3.5 text-corpo font-semibold text-white transition-colors hover:bg-purple-700',
          FOCO,
        )}
      >
        Buscar
      </button>
      {valor && hrefLimpar && (
        <Link href={hrefLimpar} className={cn('rounded-md px-1 text-meta text-ink-3 hover:text-ink', FOCO)}>
          limpar
        </Link>
      )}
    </form>
  )
}

// ═══ TituloPagina ════════════════════════════════════════════════════════════

/**
 * Cabeçalho de página: título, subtítulo e ações.
 *
 * `flex-wrap` porque as ações da direita são muitas em algumas telas e, sem ele,
 * o título encolhe até virar reticências — o dado mais importante da tela cede
 * espaço para os botões.
 */
export function TituloPagina({
  titulo,
  subtitulo,
  acoes,
  icone: Icone,
}: {
  titulo: React.ReactNode
  subtitulo?: React.ReactNode
  acoes?: React.ReactNode
  icone?: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 items-center gap-2">
        {Icone && <Icone className="h-[18px] w-[18px] shrink-0 text-purple-500" />}
        <h1 className="truncate text-h1 text-ink">{titulo}</h1>
        {subtitulo && <span className="truncate text-corpo text-ink-3">· {subtitulo}</span>}
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-3">{acoes}</div>}
    </div>
  )
}
