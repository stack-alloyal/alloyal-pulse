/**
 * O recorte de tempo do quadro de cancelamento.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ MORA NO PACOTE porque a aritmética de trimestre quebra em silêncio.       │
 * │                                                                            │
 * │ Começo de trimestre, virada de ano e o "mesmo dia do ano passado" em 29 de │
 * │ fevereiro são três contas que parecem óbvias e erram sozinhas — e erram    │
 * │ escondendo cartão, que é a falha que ninguém reporta porque não há o que   │
 * │ reportar: a tela só mostra menos. A app não tem suíte; os portões vivem    │
 * │ nos pacotes. Então a conta mora aqui, com `hoje` injetável, e o teste      │
 * │ fixa as datas em vez de depender de quando ele roda.                       │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

export type IdDePeriodo = 'trimestre' | 'ano' | 'doze_meses' | 'tudo' | 'personalizado'

export const PERIODOS: ReadonlyArray<{ id: IdDePeriodo; rotulo: string }> = [
  { id: 'trimestre', rotulo: 'Este trimestre' },
  { id: 'ano', rotulo: 'Este ano' },
  { id: 'doze_meses', rotulo: 'Últimos 12 meses' },
  { id: 'tudo', rotulo: 'Todos' },
  { id: 'personalizado', rotulo: 'Período personalizado' },
]

/**
 * O padrão do quadro, e é escolha MEDIDA e não gosto.
 *
 * Com os 485 tickets do HubSpot carregados: `tudo` põe 432 cartões na tela e 345
 * deles numa coluna só; `trimestre` mostra 25 e — o que decide — ESCONDE 2
 * pedidos em andamento, os de 20/03 e 25/05, que são justamente os mais parados
 * de todos. `doze_meses` mostra 159 e não esconde nenhum em andamento.
 */
export const PERIODO_PADRAO: IdDePeriodo = 'doze_meses'

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Lista de permissão: o que vem da URL não é um `IdDePeriodo` até passar aqui. */
export function periodoConhecido(v: string | undefined): IdDePeriodo {
  return PERIODOS.find((p) => p.id === v)?.id ?? PERIODO_PADRAO
}

/** `AAAA-MM-DD` ou nada. Data que o navegador manda é entrada do usuário. */
export function dataConhecida(v: string | undefined): string | null {
  return v !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
    ? v
    : null
}

export interface FaixaDeTempo {
  /** Inclusive. `null` = sem limite. */
  readonly desde: string | null
  /** Inclusive. `null` = sem limite. */
  readonly ate: string | null
}

/**
 * A faixa de um período. `hoje` entra como argumento para o teste poder fixá-la
 * — a mesma razão pela qual `reter` aceita `hoje`: sem isso o teste passa num
 * dia e falha no seguinte sem ninguém mexer em nada.
 */
export function faixaDoPeriodo(
  periodo: IdDePeriodo,
  hoje: string,
  personalizado: FaixaDeTempo = { desde: null, ate: null },
): FaixaDeTempo {
  const d = new Date(hoje + 'T00:00:00Z')
  const ano = d.getUTCFullYear()
  const mes = d.getUTCMonth()

  switch (periodo) {
    case 'trimestre':
      // O mês 0-based faz a conta ser direta: 0,1,2 → 0; 3,4,5 → 3; …
      return { desde: iso(new Date(Date.UTC(ano, mes - (mes % 3), 1))), ate: null }
    case 'ano':
      return { desde: iso(new Date(Date.UTC(ano, 0, 1))), ate: null }
    case 'doze_meses':
      // `Date.UTC` normaliza sozinho: 29/02 de um ano bissexto vira 01/03 do
      // anterior em vez de virar data inválida.
      return { desde: iso(new Date(Date.UTC(ano - 1, mes, d.getUTCDate()))), ate: null }
    case 'tudo':
      return { desde: null, ate: null }
    case 'personalizado':
      // Duas datas invertidas viram a mesma faixa lida ao contrário, e não uma
      // faixa vazia: quem digita 30/09 e depois 01/09 quis setembro.
      if (personalizado.desde !== null && personalizado.ate !== null && personalizado.ate < personalizado.desde) {
        return { desde: personalizado.ate, ate: personalizado.desde }
      }
      return personalizado
  }
}

/** O que escrever embaixo do título, para o recorte nunca ser invisível. */
export function rotuloDaFaixa(periodo: IdDePeriodo, faixa: FaixaDeTempo): string {
  if (periodo !== 'personalizado') {
    return PERIODOS.find((p) => p.id === periodo)?.rotulo ?? ''
  }
  const br = (s: string) => s.split('-').reverse().join('/')
  if (faixa.desde !== null && faixa.ate !== null) return `de ${br(faixa.desde)} a ${br(faixa.ate)}`
  if (faixa.desde !== null) return `a partir de ${br(faixa.desde)}`
  if (faixa.ate !== null) return `até ${br(faixa.ate)}`
  return 'sem datas — mostrando todos'
}
