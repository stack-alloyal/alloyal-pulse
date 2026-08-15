/**
 * Formatação de dado, número e data — §08 do design system do Publi.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ EXISTE PORQUE A REGRA ESTAVA ESPALHADA. Medido no Pulse antes deste        │
 * │ arquivo: 12 formatações de moeda, 8 de número e 10 de data escritas à mão  │
 * │ nas telas — e onze delas ARREDONDAVAM o dinheiro, o que o documento proíbe │
 * │ com uma frase que é um dado, não uma opinião: "arredondar escondeu         │
 * │ informação real; 86% dos pedidos tinham centavos".                         │
 * │                                                                            │
 * │ As três regras que este módulo carrega e que a cópia perdia:                │
 * │                                                                            │
 * │ · dinheiro SEMPRE com centavos;                                            │
 * │ · data SEMPRE com fuso explícito — sem isso o servidor em UTC mostra o dia  │
 * │   anterior depois das 21h de Brasília, e ninguém liga o defeito ao fuso;    │
 * │ · ausência é TRAVESSÃO, nunca zero e nunca célula vazia. Zero é um fato,    │
 * │   ausência é outro, e a tabela que os confunde afirma o que não sabe.       │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

/** O que se mostra quando não há dado. Nunca `0`, nunca vazio. */
export const VAZIO = '—'

const FUSO = 'America/Sao_Paulo'

const nulo = (v: unknown): boolean => v === null || v === undefined || v === ''

/**
 * Dinheiro, sempre com centavos.
 *
 * Recebe CENTAVOS, que é como o banco guarda: `fact.mrr_event`, `omie_titulo` e
 * `omie_contrato` são todos em centavos inteiros, justamente para não somar float.
 * Aceitar reais aqui convidaria a dividir por 100 em cada tela — e a errar em uma.
 */
export function moeda(centavos: number | string | null | undefined): string {
  if (nulo(centavos)) return VAZIO
  const n = Number(centavos)
  if (!Number.isFinite(n)) return VAZIO
  return (n / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/**
 * Dinheiro sem centavos, para EIXO DE GRÁFICO e só.
 *
 * O documento separa os dois de propósito: abreviar é legítimo onde o número é
 * uma posição no eixo, e é perda de informação onde ele é o valor.
 */
export function moedaCurta(centavos: number | string | null | undefined): string {
  if (nulo(centavos)) return VAZIO
  const n = Number(centavos)
  if (!Number.isFinite(n)) return VAZIO
  return `R$ ${abrev(n / 100)}`
}

/** Contagem. Inteiro na tabela — a abreviação é do eixo. */
export function num(v: number | string | null | undefined, casas = 0): string {
  if (nulo(v)) return VAZIO
  const n = Number(v)
  if (!Number.isFinite(n)) return VAZIO
  return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
}

/** Percentual com vírgula decimal. Recebe a FRAÇÃO (0,15), não 15. */
export function pct(fracao: number | null | undefined, casas = 2): string {
  if (nulo(fracao)) return VAZIO
  const n = Number(fracao)
  if (!Number.isFinite(n)) return VAZIO
  return `${(n * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`
}

/** Abreviação de eixo: 1,2k · 2,7M. Nunca em tabela. */
export function abrev(v: number | null | undefined): string {
  if (nulo(v)) return VAZIO
  const n = Number(v)
  if (!Number.isFinite(n)) return VAZIO
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}B`
  if (abs >= 1_000_000) return `${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}M`
  if (abs >= 1_000) return `${(n / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}

/**
 * Uma data só (`date` do Postgres) ancorada ao MEIO-DIA UTC.
 *
 * O Postgres devolve `date` como meia-noite UTC. Formatar isso em São Paulo
 * (UTC−3) devolve o DIA ANTERIOR — 2026-08-14 vira 13/08. Ancorar ao meio-dia dá
 * doze horas de folga para qualquer fuso do Brasil, e o defeito, que aparece
 * como "o vencimento está um dia atrasado", deixa de existir.
 */
function ancorar(d: Date): Date {
  const iso = d.toISOString()
  return iso.endsWith('T00:00:00.000Z') ? new Date(iso.replace('T00:00:00.000Z', 'T12:00:00.000Z')) : d
}

const comoData = (v: Date | string | null | undefined): Date | null => {
  if (nulo(v)) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : ancorar(d)
}

/** `14/08/26`. Com ano — contrato que vence no ano que vem existe. */
export function data(v: Date | string | null | undefined): string {
  const d = comoData(v)
  return d
    ? d.toLocaleDateString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: '2-digit' })
    : VAZIO
}

/** `14/08/2026 15:30 - Sex`. Dia da semana abreviado, no fim, capitalizado. */
export function dataHora(v: Date | string | null | undefined): string {
  const d = comoData(v)
  if (!d) return VAZIO
  const dia = d.toLocaleDateString('pt-BR', {
    timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric',
  })
  const hora = d.toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' })
  const semana = d.toLocaleDateString('pt-BR', { timeZone: FUSO, weekday: 'short' })
    .replace('.', '')
    .replace(/^./, (c) => c.toUpperCase())
  return `${dia} ${hora} - ${semana}`
}

/** `15:30`. */
export function hora(v: Date | string | null | undefined): string {
  const d = comoData(v)
  return d ? d.toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' }) : VAZIO
}

/**
 * Distância no tempo, em português e sem biblioteca: "há 3 dias", "em 2 meses".
 *
 * `agora` entra por parâmetro para o teste não depender do relógio — a função
 * fica pura, e uma data limítrofe deixa de falhar uma vez por dia.
 */
export function desde(v: Date | string | null | undefined, agora: Date = new Date()): string {
  const d = comoData(v)
  if (!d) return VAZIO
  const seg = Math.round((agora.getTime() - d.getTime()) / 1000)
  const passado = seg >= 0
  const s = Math.abs(seg)
  const escala: [number, string, string][] = [
    [60, 'segundo', 'segundos'],
    [3600, 'minuto', 'minutos'],
    [86400, 'hora', 'horas'],
    [2592000, 'dia', 'dias'],
    [31536000, 'mês', 'meses'],
    [Infinity, 'ano', 'anos'],
  ]
  const divisor = [1, 60, 3600, 86400, 2592000, 31536000]
  for (let i = 0; i < escala.length; i++) {
    const [limite, sing, plur] = escala[i]!
    if (s < limite) {
      const n = Math.max(Math.floor(s / divisor[i]!), 0)
      if (i === 0 && n < 30) return 'agora'
      return passado ? `há ${n} ${n === 1 ? sing : plur}` : `em ${n} ${n === 1 ? sing : plur}`
    }
  }
  return VAZIO
}
