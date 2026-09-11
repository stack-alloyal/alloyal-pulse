/**
 * O gráfico da Visão Geral: barra empilhada por mês, sem biblioteca e sem JS.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ CSS E NÃO BIBLIOTECA, por duas razões que se somam.                       │
 * │                                                                            │
 * │ A CSP da app não permite `unsafe-eval`, e o time trabalha nesta tela sem    │
 * │ depender de bundle carregar — é a mesma razão pela qual todo formulário     │
 * │ daqui funciona sem JavaScript. Doze barras empilhadas são doze `<div>` com  │
 * │ altura em porcentagem; uma dependência nova para isso seria peso sem troca. │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A FAIXA "NÃO APURADO" É O ASSUNTO DO GRÁFICO, e não sobra de desenho.     │
 * │                                                                            │
 * │ A altura da barra é o total MEDIDO no faturamento. As quatro faixas são o   │
 * │ que alguém REGISTROU no pipeline. Em 10/09/2026 o pipeline tem zero linha,  │
 * │ então a barra é inteira "não apurado" — e é exatamente essa a informação:   │
 * │ perdemos R$ 185 mil em janeiro e não sabemos por quê.                      │
 * │                                                                            │
 * │ Uma biblioteca de gráfico normalizaria as quatro séries para 100% e a barra │
 * │ ficaria cheia de nada. Aqui a lacuna é desenhada.                          │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
import { MESES_DE_MATURIDADE, type MesDoGrafico } from '@pulse/success'
import { Card, Chips, Chip } from '@pulse/ui'

/**
 * Um formato só, e COM CENTAVOS.
 *
 * Havia aqui um segundo helper arredondado, para o rótulo caber na coluna
 * estreita de doze meses. O portão `nenhuma tela arredonda dinheiro` recusou, e
 * a razão dele é dado e não estética: 86% dos pedidos têm centavos, e arredondar
 * fez a conferência contra o Omie não fechar. Rótulo apertado é problema de
 * layout — resolve-se com `text-nota` e `tabular-nums`, não escondendo dígito.
 */
const BRL = (c: string) =>
  (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })

const MES_CURTO = (iso: string) => {
  const [a, m] = iso.split('-')
  return `${['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m)]}/${a!.slice(2)}`
}

/**
 * DOIS grupos, e não uma pilha só. Ver o comentário de `MesDoGrafico`: um portão
 * provou que desconto e renegociação não cabem dentro do total de quem saiu —
 * esse cliente CONTINUA pagando, menos.
 */
const SAIU = [
  { chave: 'clienteCentavos', rotulo: 'Cancelamento Cliente', cor: 'bg-red' },
  { chave: 'pddCentavos', rotulo: 'Cancelamento PDD', cor: 'bg-pink' },
] as const

const REDUZIU = [
  { chave: 'renegociadoCentavos', rotulo: 'Renegociação Financeira', cor: 'bg-amber-700' },
  { chave: 'descontoCentavos', rotulo: 'Desconto', cor: 'bg-blue' },
] as const

export function Grafico({ meses, janela }: { meses: readonly MesDoGrafico[]; janela: 6 | 12 }) {
  const maduros = meses.filter((m) => m.maduro)
  /* ┌─────────────────────────────────────────────────────────────────────┐
     │ O TETO CONSIDERA AS TRÊS GRANDEZAS, e não só o total medido.          │
     │                                                                       │
     │ Mês dentro da janela de apuração tem total medido perto de zero e      │
     │ pode ter registro grande — setembro/2026 tem R$ 33.384,00 registrados  │
     │ e medida ainda aberta. Com o teto saindo só do medido, a faixa          │
     │ registrada estouraria a pista e vazaria para fora do gráfico.          │
     └─────────────────────────────────────────────────────────────────────┘ */
  const somaDe = (m: MesDoGrafico, campos: typeof SAIU | typeof REDUZIU) =>
    campos.reduce((x, f) => x + Number(m[f.chave]), 0)
  const teto = Math.max(
    1,
    ...meses.map((m) => Math.max(Number(m.totalCentavos), somaDe(m, SAIU), somaDe(m, REDUZIU))),
  )
  const somaTotal = maduros.reduce((s, m) => s + Number(m.totalCentavos), 0)
  const somaApurada = maduros.reduce(
    (s, m) => s + SAIU.reduce((x, f) => x + Number(m[f.chave]), 0),
    0,
  )
  const somaReduziu = maduros.reduce(
    (s, m) => s + REDUZIU.reduce((x, f) => x + Number(m[f.chave]), 0),
    0,
  )
  /** O que está registrado nos meses que a medida ainda não fechou. */
  const novos = meses.filter((m) => !m.maduro).reduce((s, m) => s + somaDe(m, SAIU), 0)

  return (
    <Card title="Cancelamento por mês">
      <Chips rotulo="Janela">
        <Chip rotulo="6 meses" href="/cancelamento?janela=6" ativo={janela === 6} fixo />
        <Chip rotulo="12 meses" href="/cancelamento?janela=12" ativo={janela === 12} fixo />
      </Chips>

      {/* ┌───────────────────────────────────────────────────────────────────┐
          │ A PISTA DA BARRA PRECISA DE ALTURA DEFINIDA. Medido na tela.       │
          │                                                                    │
          │ A primeira versão punha `items-end` na linha e a altura em % na    │
          │ barra. Resultado medido: linha 196px, coluna 39px, BARRA 0px com   │
          │ `height: 37.9%`. Com `items-end` a coluna não estica, então a       │
          │ porcentagem resolvia contra altura de conteúdo — que dependia da    │
          │ barra. Circular, colapsa, e nenhum erro em lugar nenhum.           │
          │                                                                    │
          │ Agora: linha com altura fixa, coluna `h-full`, e cada barra vive    │
          │ numa PISTA `flex-1`, cuja altura é definida depois do layout.       │
          └───────────────────────────────────────────────────────────────────┘ */}
      <div className="mt-4 flex h-64 gap-1.5 sm:gap-3">
        {meses.map((m) => {
          const total = Number(m.totalCentavos)
          const reduziu = REDUZIU.reduce((x, f) => x + Number(m[f.chave]), 0)
          const apurado = SAIU.reduce((x, f) => x + Number(m[f.chave]), 0)
          /* ┌─────────────────────────────────────────────────────────────┐
             │ UMA REGRA SÓ: a barra é do tamanho da MAIOR das duas camadas.│
             │                                                              │
             │ Antes havia três caminhos — maduro, não maduro, e total zero │
             │ — e cada um escondia um caso. O que o usuário viu foi o do    │
             │ meio; a captura depois mostrou o terceiro, com mês maduro de  │
             │ medida zero e registro cheio desenhando nada.                 │
             │                                                              │
             │ Com `base = max(medido, registrado)`: o cinza de "não apurado"│
             │ é a parte do medido que ninguém registrou, as faixas são o     │
             │ registrado, e nenhuma das duas camadas pode zerar a outra.     │
             └─────────────────────────────────────────────────────────────┘ */
          const base = Math.max(total, apurado)
          return (
            <div key={m.mes} className="flex h-full min-w-0 flex-1 flex-col items-center gap-1">
              {/* Mês maduro mostra o MEDIDO; mês em apuração mostra o
                  REGISTRADO, em cinza, porque é outra grandeza — e mostrar nada
                  era o defeito: o número existe e a tela o escondia. */}
              <span
                className={`text-nota tabular-nums ${m.maduro ? 'text-ink-3' : 'text-ink-4'}`}
                title={
                  m.maduro
                    ? 'Medido no faturamento'
                    : 'Só o que está registrado no fluxo — a medida do faturamento ainda não fechou'
                }
              >
                {m.maduro
                  ? total > 0
                    ? BRL(m.totalCentavos)
                    : ''
                  : apurado > 0
                    ? BRL(String(apurado))
                    : ''}
              </span>

              {/* A PISTA: `flex-1` dá a ela a altura que sobra, e é definida. */}
              <div className="flex w-full flex-1 items-end justify-center gap-0.5">
                {/* BARRA 1 — SAIU. A altura é o total medido no faturamento. */}
                <div
                  className="flex h-full w-full flex-col justify-end"
                  title={
                    m.maduro
                      ? `${MES_CURTO(m.mes)} · saiu ${BRL(m.totalCentavos)} em ${m.totalContas} conta(s)`
                      : apurado > 0
                        ? `${MES_CURTO(m.mes)} · ${BRL(String(apurado))} registrados no fluxo — a medida do faturamento fecha em ${MESES_DE_MATURIDADE} meses`
                        : `${MES_CURTO(m.mes)}: dentro da janela de apuração`
                  }
                >
                  <div
                    className="flex w-full flex-col justify-end rounded-t-sm"
                    /* ┌───────────────────────────────────────────────────┐
                       │ A ALTURA DO MÊS EM APURAÇÃO É O QUE ESTÁ            │
                       │ REGISTRADO, e não 100% de uma caixa vazia.         │
                       │                                                    │
                       │ Antes: `!maduro` desenhava só um contorno tracejado │
                       │ de altura cheia e DESCARTAVA as faixas. Com a base  │
                       │ carregada isso passou a esconder número de verdade: │
                       │ julho R$ 31.779,52, agosto R$ 55.350,00, setembro   │
                       │ R$ 33.384,00 registrados, e os três meses em branco │
                       │ na tela. Foi o que o usuário viu e perguntou.       │
                       │                                                    │
                       │ A imaturidade é da camada MEDIDA — três meses para  │
                       │ ter certeza de que a conta não voltou a faturar. A  │
                       │ camada REGISTRADA não espera nada: é decisão humana │
                       │ já tomada. Esconder uma por causa da outra é                                     │
                       │ justamente as duas camadas se contaminando.         │
                       └───────────────────────────────────────────────────┘ */
                    style={{ height: `${(base / teto) * 100}%` }}
                  >
                    {!m.maduro && apurado === 0 ? (
                      /* Nada medido e nada registrado: aí sim a caixa vazia, que
                         diz "ainda não sei" em vez de dizer zero. */
                      <div className="h-full w-full rounded-t-sm border border-dashed border-line-strong bg-surface-2" />
                    ) : base === 0 ? null : (
                      <>
                        {/* O DENOMINADOR é o que a barra mede: o total no mês
                            maduro, o apurado no mês em apuração. Dividir pelo
                            total num mês cuja medida ainda é zero daria
                            Infinity — e `height: Infinity%` não desenha nada,
                            sem erro nenhum em lugar nenhum. */}
                        {apurado < total && (
                          <div
                            className="w-full rounded-t-sm bg-line-strong"
                            style={{ height: `${((total - apurado) / base) * 100}%` }}
                            title={`não apurado: ${BRL(String(total - apurado))}`}
                          />
                        )}
                        {SAIU.map((f, i) => {
                          const v = Number(m[f.chave])
                          if (v === 0) return null
                          return (
                            <div
                              key={f.chave}
                              className={`w-full ${f.cor} ${
                                /* Topo tracejado no mês em apuração: a barra
                                   pode subir quando o faturamento fechar, e a
                                   borda aberta diz isso sem inventar altura. */
                                !m.maduro && i === 0 ? 'rounded-t-sm border-t-2 border-dashed border-ink-4' : ''
                              }`}
                              style={{ height: `${(v / base) * 100}%` }}
                              title={`${f.rotulo}: ${BRL(String(v))}`}
                            />
                          )
                        })}
                      </>
                    )}
                  </div>
                </div>

                {/* BARRA 2 — REDUZIU. Ao LADO, na mesma escala, e nunca dentro:
                    o cliente continua na base. Só existe quando há registro. */}
                {reduziu > 0 && (
                  <div
                    className="flex h-full w-full flex-col justify-end"
                    title={`${MES_CURTO(m.mes)} · reduziu ${BRL(String(reduziu))}`}
                  >
                    <div
                      className="flex w-full flex-col justify-end rounded-t-sm"
                      style={{ height: `${(reduziu / teto) * 100}%` }}
                    >
                      {REDUZIU.map((f) => {
                        const v = Number(m[f.chave])
                        if (v === 0) return null
                        return (
                          <div
                            key={f.chave}
                            className={`w-full ${f.cor}`}
                            style={{ height: `${(v / reduziu) * 100}%` }}
                            title={`${f.rotulo}: ${BRL(String(v))}`}
                          />
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              <span className="w-full truncate text-center text-nota tabular-nums text-ink-3">
                {MES_CURTO(m.mes)}
              </span>
            </div>
          )
        })}
      </div>

      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
        {[...SAIU, ...REDUZIU].map((f) => (
          <li key={f.chave} className="flex items-center gap-1.5 text-nota text-ink-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${f.cor}`} />
            {f.rotulo}
          </li>
        ))}
        <li className="flex items-center gap-1.5 text-nota text-ink-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-line-strong" />
          Não apurado
        </li>
        <li className="flex items-center gap-1.5 text-nota text-ink-3">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm border-t-2 border-dashed border-ink-4" />
          Medida em apuração
        </li>
      </ul>

      <p className="mt-3 max-w-[80ch] text-meta leading-relaxed text-ink-3">
        São <strong className="font-semibold text-ink">duas barras por mês</strong>, e somá-las
        seria erro: <strong className="font-semibold text-ink">saiu</strong> é quem parou de pagar;{' '}
        <strong className="font-semibold text-ink">reduziu</strong> é quem ficou pagando menos —
        desconto e renegociação mantêm o cliente na base, e contá-los como perda afirmaria uma saída
        que não houve.
        {somaReduziu > 0 && <> No período, {BRL(String(somaReduziu))} reduziram.</>}
      </p>
      <p className="mt-2 max-w-[80ch] text-meta leading-relaxed text-ink-3">
        A <strong className="font-semibold text-ink">altura</strong> da barra de saiu é o que o
        faturamento mediu: contas que pararam de receber, com três meses de maturidade e sem voltar. As{' '}
        <strong className="font-semibold text-ink">faixas</strong> são o que alguém registrou no
        fluxo.{' '}
        {somaApurada === 0 ? (
          <>
            No período maduro, <strong className="font-semibold text-ink">{BRL(String(somaTotal))}</strong>{' '}
            saíram e <strong className="font-semibold text-ink">nada foi apurado</strong> — a barra
            inteira é a pergunta que falta responder, e é o que a aba{' '}
            <strong className="font-semibold text-ink">Dados</strong> lista conta por conta.
          </>
        ) : (
          <>
            No período maduro: {BRL(String(somaTotal))} saíram, dos quais{' '}
            {BRL(String(somaApurada))} com motivo registrado.
          </>
        )}
      </p>

      {/* Os meses recentes existem no gráfico e são OUTRA coisa. Dizer isso
          embaixo evita a pergunta que o usuário fez olhando a tela: "não sei por
          que não puxou julho, agosto e setembro". */}
      {novos > 0 && (
        <p className="mt-2 max-w-[80ch] text-meta leading-relaxed text-ink-3">
          Os <strong className="font-semibold text-ink">{MESES_DE_MATURIDADE} últimos meses</strong>{' '}
          mostram só o que está <strong className="font-semibold text-ink">registrado no fluxo</strong>{' '}
          ({BRL(String(novos))}), com o topo aberto: a medida do faturamento precisa de{' '}
          {MESES_DE_MATURIDADE} meses para afirmar que a conta não voltou a receber, então a barra
          ainda pode subir.
        </p>
      )}
    </Card>
  )
}
