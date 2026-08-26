import type { MesDaCarteira } from '@pulse/config'
import { cn } from '@pulse/ui'

/**
 * O gráfico do saldo em atraso — usado pela inadimplência E pela cascata.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ MÓDULO IRMÃO das duas telas, e não um componente em `@pulse/ui`.            │
 * │                                                                            │
 * │ Ele conhece a forma de `MesDaCarteira` e o significado de `preenchido` e     │
 * │ `origem` — é peça de Receita, não de biblioteca. Em `@pulse/ui` ele obrigaria │
 * │ a biblioteca a importar tipo de domínio, e a próxima pessoa iria procurá-lo  │
 * │ entre botões e badges.                                                     │
 * │                                                                            │
 * │ Vive AQUI, um nível acima das duas telas que o usam, porque a alternativa    │
 * │ era copiar 40 linhas de barras para a cascata — e duas cópias do mesmo       │
 * │ gráfico divergem no dia em que uma delas ganhar uma faixa nova.              │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O RÓTULO É PARÂMETRO, e isso não é frescura de API.                        │
 * │                                                                            │
 * │ A mesma barra tem dois nomes certos: na inadimplência ela é "a foto do dia   │
 * │ 1º de agosto"; em Receita, "o saldo no fim de julho". É o mesmo número.      │
 * │                                                                            │
 * │ Cada tela nomeia pelo eixo dela — a inadimplência pela competência da FOTO,  │
 * │ a cascata pela competência de RECEITA — porque nomear pelo eixo da outra     │
 * │ faria a barra que a pessoa acabou de escolher no filtro de mês aparecer com  │
 * │ o rótulo do mês seguinte. Um `deslocar: boolean` esconderia essa decisão     │
 * │ atrás de um booleano; a função de rótulo a deixa à vista de quem chama.      │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export function GraficoDoAtraso({
  serie,
  rotulo,
  destacar,
  diasCorrente,
  altura = 160,
}: {
  serie: readonly MesDaCarteira[]
  /** Como nomear cada barra. Ver o bloco acima. */
  rotulo: (m: MesDaCarteira) => string
  /** Competência da FOTO a destacar. A barra escolhida no filtro de mês. */
  destacar?: string
  /** O corte do "recente", só para o texto do rodapé bater com a barra escura. */
  diasCorrente: number
  altura?: number
}) {
  const maiorSaldo = Math.max(...serie.map((m) => Number(m.saldoFinalCentavos)), 1)
  const barra = altura - 32

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[600px] items-end gap-1" style={{ height: altura }}>
        {serie.map((m) => {
          const alt = Math.max(Math.round((Number(m.saldoFinalCentavos) / maiorSaldo) * barra), 2)
          const recente =
            Number(m.saldoFinalCentavos) > 0
              ? Math.min(Number(m.recenteCentavos) / Number(m.saldoFinalCentavos), 1)
              : 0
          const escolhida = destacar === m.competencia
          const titulo =
            `${rotulo(m)} · saldo ${BRL(m.saldoFinalCentavos)} · ${N(m.titulosFinal)} títulos · ` +
            `até ${diasCorrente} d ${BRL(m.recenteCentavos)} · foto ${m.origem}`
          return (
            <div key={m.competencia} className="flex flex-1 flex-col items-center justify-end gap-1">
              {/* A barra clara é a carteira toda; a escura, a parte de até 90 dias.
                  Ver as duas juntas é o que mostra que o saldo cresce pelo passivo
                  antigo e não pela cobrança recente. */}
              <span
                title={titulo}
                className={cn(
                  'relative w-full rounded-t bg-purple-100',
                  // A escolhida ganha um anel, e não outra cor: cor a mais aqui
                  // competiria com a leitura de claro/escuro que a barra já carrega.
                  escolhida && 'ring-2 ring-purple-500 ring-offset-1 ring-offset-surface',
                )}
                style={{ height: alt }}
              >
                <span
                  className="absolute inset-x-0 bottom-0 rounded-t bg-purple-500"
                  style={{ height: `${Math.round(recente * 100)}%` }}
                />
              </span>
              <span
                className={cn(
                  'whitespace-nowrap text-micro',
                  escolhida ? 'font-semibold text-purple-700' : 'text-ink-3',
                )}
              >
                {rotulo(m)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const BRL = (c: number | string) =>
  (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const N = (n: number) => n.toLocaleString('pt-BR')

/**
 * A competência da foto ANTERIOR à dada — o mês de receita que ela descreve.
 *
 * A foto do dia 1º de agosto conta o que aconteceu em julho. Esta função é o
 * deslocamento, e existe aqui para as duas telas usarem a mesma conta em vez de
 * cada uma fazer a sua com `Number(mes) - 1` e errar em janeiro.
 */
export function competenciaDeReceita(competenciaDaFoto: string): string {
  const [ano, mes] = competenciaDaFoto.split('-')
  const a = Number(ano)
  const m = Number(mes)
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`
}

/**
 * Entrou em atraso contra recuperado, mês a mês.
 *
 * O par de barras é o que explica o gráfico de saldo: enquanto o vermelho for
 * maior, a carteira cresce — e a causa é a ENTRADA, não a falta de pagamento. É
 * uma distinção que o saldo sozinho não carrega, e é por isso que os dois gráficos
 * andam juntos nas duas telas.
 *
 * Mesmo `rotulo` como parâmetro e mesmo `destacar` do `GraficoDoAtraso`, e pelo
 * mesmo motivo — ver o cabeçalho de lá.
 */
export function GraficoDoFluxo({
  serie,
  rotulo,
  destacar,
  altura = 140,
}: {
  serie: readonly MesDaCarteira[]
  rotulo: (m: MesDaCarteira) => string
  destacar?: string
  altura?: number
}) {
  // A escala é COMPARTILHADA entre entrada e recuperação: escalar cada uma pelo
  // próprio máximo faria as duas barras parecerem sempre do mesmo tamanho, e a
  // única coisa que este gráfico existe para mostrar é qual das duas é maior.
  const maior = Math.max(
    ...serie.flatMap((m) => [Number(m.entrouCentavos), Number(m.recuperadoCentavos)]),
    1,
  )
  const teto = altura - 32

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[600px] items-end gap-2" style={{ height: altura }}>
        {serie.map((m) => {
          const ent = Math.max(Math.round((Number(m.entrouCentavos) / maior) * teto), 1)
          const rec = Math.max(Math.round((Number(m.recuperadoCentavos) / maior) * teto), 1)
          const escolhida = destacar === m.competencia
          return (
            <div key={m.competencia} className="flex flex-1 flex-col items-center justify-end gap-1">
              <span
                className={cn(
                  'flex w-full items-end justify-center gap-0.5 rounded-t',
                  escolhida && 'ring-2 ring-purple-500 ring-offset-1 ring-offset-surface',
                )}
              >
                <span
                  title={`${rotulo(m)} · entrou ${BRL(m.entrouCentavos)} em ${N(m.entrouTitulos)} títulos`}
                  className="w-1/2 rounded-t bg-red"
                  style={{ height: ent }}
                />
                <span
                  title={`${rotulo(m)} · recuperado ${BRL(m.recuperadoCentavos)} em ${N(m.recuperadoTitulos)} títulos`}
                  className="w-1/2 rounded-t bg-purple-500"
                  style={{ height: rec }}
                />
              </span>
              <span
                className={cn(
                  'whitespace-nowrap text-micro',
                  escolhida ? 'font-semibold text-purple-700' : 'text-ink-3',
                )}
              >
                {rotulo(m)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
