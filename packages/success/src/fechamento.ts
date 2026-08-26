import type pg from 'pg'

/**
 * Fechamento mensal — a cascata de receita.
 *
 * A cascata responde "de onde veio e para onde foi o MRR neste mês":
 *
 *   MRR inicial + novo + expansão + reativação + ajuste
 *              − contração − churn pedido − churn por inadimplência
 *              + NÃO ATRIBUÍDO
 *   = MRR final
 *
 * O termo que faz esta função valer alguma coisa é o último. O MRR final é
 * OBSERVADO na base de contratos, não somado a partir dos eventos: são duas
 * fontes independentes, e a diferença entre elas é o resíduo. Empurrar o
 * resíduo para churn faria o gráfico fechar sempre — e um número que fecha por
 * construção é um número que ninguém consegue auditar. Aqui ele aparece com
 * nome próprio, e resíduo grande é sinal de captação faltando, não de churn.
 *
 * NRR e GRR excluem cliente NOVO de propósito: incluí-lo infla o indicador e
 * esconde contração na base que já existia.
 */

export interface Cascata {
  competencia: string
  mrrInicialCentavos: string
  novoCentavos: string
  expansaoCentavos: string
  contracaoCentavos: string
  churnPedidoCentavos: string
  churnInadimplenciaCentavos: string
  reativacaoCentavos: string
  ajusteCentavos: string
  naoAtribuidoCentavos: string
  mrrFinalCentavos: string
  contasIniciais: number
  /** Observado no fim do mês. Nulo em competência fechada antes da 0051. */
  contasFinais: number | null
  contasNovas: number
  contasPerdidas: number
  nrr: number | null
  grr: number | null
  estado: 'aberta' | 'congelada'
  congeladoPor: string | null
  congeladoEm: string | null
  geradoEm: string | null
}

export class CompetenciaCongeladaError extends Error {
  constructor(competencia: string) {
    super(
      `a competência ${competencia.slice(0, 7)} está congelada — a correção é um ajuste na competência corrente, com nota, nunca uma reescrita desta`,
    )
    this.name = 'CompetenciaCongeladaError'
  }
}

/** Primeiro dia do mês anterior, em ISO. */
export function competenciaAnterior(competencia: string): string {
  const [ano, mes] = competencia.split('-').map(Number) as [number, number]
  return mes === 1
    ? `${ano - 1}-12-01`
    : `${ano}-${String(mes - 1).padStart(2, '0')}-01`
}

/**
 * NRR e GRR sobre a coorte que já existia no início.
 *
 * Devolve `null` quando o MRR inicial é zero: dividir por zero e mostrar 0% ou
 * ∞ faz o primeiro mês de operação parecer catástrofe ou milagre.
 */
export function indicadores(c: {
  mrrInicial: number
  expansao: number
  reativacao: number
  contracao: number
  churnTotal: number
}): { nrr: number | null; grr: number | null } {
  if (c.mrrInicial <= 0) return { nrr: null, grr: null }
  const retido = c.mrrInicial - c.contracao - c.churnTotal
  return {
    // Cliente NOVO fica de fora dos dois: ele inflaria o indicador e esconderia
    // contração na base que já existia.
    nrr: Number(((retido + c.expansao + c.reativacao) / c.mrrInicial).toFixed(4)),
    grr: Number((retido / c.mrrInicial).toFixed(4)),
  }
}

interface Movimentos {
  novo: string
  expansao: string
  contracao: string
  churn_pedido: string
  churn_inadimplencia: string
  reativacao: string
  ajuste: string
  contas_novas: string
  contas_perdidas: string
}

/**
 * Calcula e grava a cascata de uma competência.
 *
 * Recusa competência congelada. É a mesma invariante que o trigger do banco
 * impõe, repetida aqui só para que a recusa chegue como frase legível em vez de
 * como violação de trigger no meio de um ciclo noturno.
 */
export async function fechar(
  db: pg.Pool,
  competencia: string,
): Promise<Cascata> {
  const comp = competencia.slice(0, 7) + '-01'
  const anterior = competenciaAnterior(comp)
  const cliente = await db.connect()

  try {
    await cliente.query('BEGIN')

    const { rows: existente } = await cliente.query<{ estado: string }>(
      'SELECT estado FROM analytics.monthly_close WHERE competencia = $1::date FOR UPDATE',
      [comp],
    )
    if (existente[0]?.estado === 'congelada') throw new CompetenciaCongeladaError(comp)

    // ── MRR inicial ──
    // Preferência absoluta pelo fechamento anterior: encadear as competências é
    // o que garante que a soma do ano bate com a soma dos meses. Recalcular da
    // base de contratos a cada mês faria buracos aparecerem e sumirem sozinhos.
    const { rows: ant } = await cliente.query<{ mrr: string; contas: string }>(
      `SELECT mrr_final_centavos::text mrr,
              (contas_iniciais + contas_novas - contas_perdidas)::text contas
         FROM analytics.monthly_close WHERE competencia = $1::date`,
      [anterior],
    )
    const { rows: base } = await cliente.query<{ mrr: string; contas: string }>(
      // Contratos vigentes no ÚLTIMO DIA do mês anterior — o retrato de abertura.
      //
      // ┌───────────────────────────────────────────────────────────────────────┐
      // │ CAI PARA O FATURADO quando `core.contract` está VAZIA, e ela está.      │
      // │                                                                        │
      // │ Medido em 26/08/2026: zero linhas, e nada a alimenta — o ciclo C5, que  │
      // │ traria os contratos do HubSpot, está declarado e não implementado. Com  │
      // │ a tabela vazia, esta consulta devolvia 0 e a cascata inteira era zero.  │
      // │                                                                        │
      // │ A preferência é do CONTRATO, e é deliberada: quando o C5 ligar, a       │
      // │ cascata volta a se apoiar na base contratual sem que ninguém mexa aqui, │
      // │ e os testes que inserem contrato continuam medindo o que mediam.        │
      // │                                                                        │
      // │ O CUSTO de cair para o faturado: o resíduo "não atribuído" perde metade │
      // │ do sentido. Ele existe para comparar DUAS fontes independentes — ledger │
      // │ contra base de contratos. Com as duas saindo do faturamento, ele passa  │
      // │ a checar só a aritmética dos meus deltas, o que ainda vale (pega bug de │
      // │ derivação) mas não é conferência de negócio. Está dito na tela.          │
      // └───────────────────────────────────────────────────────────────────────┘
      `SELECT CASE WHEN EXISTS (SELECT 1 FROM core.contract)
                   THEN (SELECT COALESCE(sum(mrr_centavos),0) FROM core.contract
                          WHERE inicio <= ($1::date - 1)
                            AND COALESCE(encerrado_em, vigencia_fim, 'infinity'::date) >= ($1::date - 1))
                   ELSE (SELECT COALESCE(sum(mrr_centavos),0) FROM analytics.mrr_faturado_mes
                          WHERE competencia = ($1::date - interval '1 month')::date)
              END::text mrr,
              CASE WHEN EXISTS (SELECT 1 FROM core.contract)
                   THEN (SELECT count(*) FROM core.contract
                          WHERE inicio <= ($1::date - 1)
                            AND COALESCE(encerrado_em, vigencia_fim, 'infinity'::date) >= ($1::date - 1))
                   ELSE (SELECT count(*) FROM analytics.mrr_faturado_mes
                          WHERE competencia = ($1::date - interval '1 month')::date)
              END::text contas`,
      [comp],
    )
    const mrrInicial = Number(ant[0]?.mrr ?? base[0]?.mrr ?? 0)
    const contasIniciais = Number(ant[0]?.contas ?? base[0]?.contas ?? 0)

    // ── Movimentos do ledger ──
    const { rows: mv } = await cliente.query<Movimentos>(
      `SELECT
         COALESCE(sum(valor_centavos) FILTER (WHERE tipo='novo'),0)::text        novo,
         COALESCE(sum(valor_centavos) FILTER (WHERE tipo='expansao'),0)::text    expansao,
         -- O FILTER pertence ao sum, não ao abs: abs não é agregado. Com o
         -- parêntese no lugar errado o Postgres recusa a consulta inteira.
         COALESCE(abs(sum(valor_centavos) FILTER (WHERE tipo='contracao')),0)::text contracao,
         COALESCE(abs(sum(valor_centavos) FILTER (WHERE tipo='churn_pedido')),0)::text churn_pedido,
         COALESCE(abs(sum(valor_centavos) FILTER (WHERE tipo='churn_inadimplencia')),0)::text churn_inadimplencia,
         COALESCE(sum(valor_centavos) FILTER (WHERE tipo='reativacao'),0)::text  reativacao,
         COALESCE(sum(valor_centavos) FILTER (WHERE tipo='ajuste'),0)::text      ajuste,
         count(*) FILTER (WHERE tipo='novo')::text                               contas_novas,
         count(*) FILTER (WHERE tipo IN ('churn_pedido','churn_inadimplencia'))::text contas_perdidas
       FROM fact.mrr_event WHERE competencia = $1::date`,
      [comp],
    )
    const m = mv[0]!
    const n = (k: keyof Movimentos) => Number(m[k])

    // ── MRR final OBSERVADO ──
    // Segunda fonte, independente do ledger. É o que dá sentido ao resíduo.
    //
    // O recorte é por DATA, nunca por `status_vigencia`. Status é estado
    // CORRENTE: filtrar por ele aqui faria o MRR final de julho mudar no dia em
    // que alguém encerrasse um contrato — um mês já apresentado passaria a
    // contar outra história, que é a mesma falha corrigida no resumo de churn.
    //
    // `encerrado_em` vem antes de `vigencia_fim` porque saída antecipada é a
    // regra e não a exceção: o contrato ia até 2028 e a receita parou em agosto.
    // Mesma queda para o faturado da abertura, e pelo mesmo motivo: ver o bloco
    // acima. Sem ela o observado era 0 e o resíduo virava o MRR inteiro negativo.
    const { rows: fim } = await cliente.query<{ mrr: string }>(
      `SELECT CASE WHEN EXISTS (SELECT 1 FROM core.contract)
                   THEN (SELECT COALESCE(sum(mrr_centavos),0) FROM core.contract
                          WHERE inicio <= ($1::date + INTERVAL '1 month - 1 day')
                            AND COALESCE(encerrado_em, vigencia_fim, 'infinity'::date)
                                >= ($1::date + INTERVAL '1 month - 1 day'))
                   ELSE (SELECT COALESCE(sum(mrr_centavos),0) FROM analytics.mrr_faturado_mes
                          WHERE competencia = $1::date)
              END::text mrr`,
      [comp],
    )
    const mrrFinal = Number(fim[0]?.mrr ?? 0)

    /* ┌─────────────────────────────────────────────────────────────────────┐
       │ A CONTAGEM DE CONTAS É OBSERVADA, e não somada dos movimentos.        │
       │                                                                      │
       │ `contas_iniciais + contas_novas − contas_perdidas` ignora REATIVAÇÃO,  │
       │ porque `contas_novas` conta só o tipo `novo`. Cada par churn →         │
       │ reativação decrementa para sempre, e em 67 competências a tela chegou  │
       │ a mostrar 161 contas onde havia 348. O valor em reais estava certo —    │
       │ reativação soma no MRR —, e é por isso que ninguém viu: o número        │
       │ grande fechava e o pequeno, ao lado, mentia.                           │
       │                                                                      │
       │ Mesma fonte do MRR final observado, pela mesma razão: as duas          │
       │ respondem "o que havia no fim do mês" olhando a base, em vez de somar  │
       │ movimento. Ver a migração 0051.                                        │
       └─────────────────────────────────────────────────────────────────────┘ */
    const { rows: nf } = await cliente.query<{ n: string }>(
      `SELECT CASE WHEN EXISTS (SELECT 1 FROM core.contract)
                   THEN (SELECT count(*) FROM core.contract
                          WHERE inicio <= ($1::date + INTERVAL '1 month - 1 day')
                            AND COALESCE(encerrado_em, vigencia_fim, 'infinity'::date)
                                >= ($1::date + INTERVAL '1 month - 1 day'))
                   ELSE (SELECT count(*) FROM analytics.mrr_faturado_mes
                          WHERE competencia = $1::date)
              END::text n`,
      [comp],
    )
    const contasFinais = Number(nf[0]?.n ?? 0)

    const explicado =
      mrrInicial + n('novo') + n('expansao') + n('reativacao') + n('ajuste') -
      n('contracao') - n('churn_pedido') - n('churn_inadimplencia')
    const naoAtribuido = mrrFinal - explicado

    const churnTotal = n('churn_pedido') + n('churn_inadimplencia')
    const { nrr, grr } = indicadores({
      mrrInicial,
      expansao: n('expansao'),
      reativacao: n('reativacao'),
      contracao: n('contracao'),
      churnTotal,
    })

    const { rows } = await cliente.query<Cascata>(
      `INSERT INTO analytics.monthly_close
         (competencia, mrr_inicial_centavos, novo_centavos, expansao_centavos,
          contracao_centavos, churn_pedido_centavos, churn_inadimplencia_centavos,
          reativacao_centavos, ajuste_centavos, nao_atribuido_centavos,
          mrr_final_centavos, contas_iniciais, contas_novas, contas_perdidas,
          contas_finais, nrr, grr, gerado_em)
       VALUES ($1::date,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$17,$15,$16,now())
       ON CONFLICT (competencia) DO UPDATE SET
         mrr_inicial_centavos = EXCLUDED.mrr_inicial_centavos,
         novo_centavos = EXCLUDED.novo_centavos,
         expansao_centavos = EXCLUDED.expansao_centavos,
         contracao_centavos = EXCLUDED.contracao_centavos,
         churn_pedido_centavos = EXCLUDED.churn_pedido_centavos,
         churn_inadimplencia_centavos = EXCLUDED.churn_inadimplencia_centavos,
         reativacao_centavos = EXCLUDED.reativacao_centavos,
         ajuste_centavos = EXCLUDED.ajuste_centavos,
         nao_atribuido_centavos = EXCLUDED.nao_atribuido_centavos,
         mrr_final_centavos = EXCLUDED.mrr_final_centavos,
         contas_iniciais = EXCLUDED.contas_iniciais,
         contas_novas = EXCLUDED.contas_novas,
         contas_perdidas = EXCLUDED.contas_perdidas,
         contas_finais = EXCLUDED.contas_finais,
         nrr = EXCLUDED.nrr, grr = EXCLUDED.grr, gerado_em = now()
       RETURNING ${COLUNAS}`,
      [
        comp, mrrInicial, n('novo'), n('expansao'), n('contracao'),
        n('churn_pedido'), n('churn_inadimplencia'), n('reativacao'), n('ajuste'),
        naoAtribuido, mrrFinal, contasIniciais, n('contas_novas'), n('contas_perdidas'),
        nrr, grr, contasFinais,
      ],
    )
    await cliente.query('COMMIT')
    return normalizar(rows[0]!)
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    cliente.release()
  }
}

const COLUNAS = `
  to_char(competencia,'YYYY-MM-DD')            AS competencia,
  mrr_inicial_centavos::text                   AS "mrrInicialCentavos",
  novo_centavos::text                          AS "novoCentavos",
  expansao_centavos::text                      AS "expansaoCentavos",
  contracao_centavos::text                     AS "contracaoCentavos",
  churn_pedido_centavos::text                  AS "churnPedidoCentavos",
  churn_inadimplencia_centavos::text           AS "churnInadimplenciaCentavos",
  reativacao_centavos::text                    AS "reativacaoCentavos",
  ajuste_centavos::text                        AS "ajusteCentavos",
  nao_atribuido_centavos::text                 AS "naoAtribuidoCentavos",
  mrr_final_centavos::text                     AS "mrrFinalCentavos",
  contas_iniciais                              AS "contasIniciais",
  contas_novas                                 AS "contasNovas",
  contas_perdidas                              AS "contasPerdidas",
  contas_finais                                AS "contasFinais",
  nrr, grr, estado,
  congelado_por AS "congeladoPor", congelado_em AS "congeladoEm",
  gerado_em AS "geradoEm"`

function normalizar(c: Cascata): Cascata {
  return {
    ...c,
    nrr: c.nrr === null ? null : Number(c.nrr),
    grr: c.grr === null ? null : Number(c.grr),
  }
}

/**
 * Congela a competência. A partir daqui os números não mudam mais.
 *
 * O congelamento é regra de banco e não combinado de processo porque a
 * alternativa é alguém recalcular um mês já apresentado ao board e ninguém
 * descobrir. Correção depois do congelamento existe, mas é ajuste na
 * competência CORRENTE, com nota — nunca reescrita da anterior.
 */
export async function congelar(
  db: pg.Pool,
  competencia: string,
  quem: string,
): Promise<void> {
  const comp = competencia.slice(0, 7) + '-01'
  const { rowCount } = await db.query(
    `UPDATE analytics.monthly_close
        SET estado = 'congelada', congelado_por = $2, congelado_em = now()
      WHERE competencia = $1::date AND estado = 'aberta'`,
    [comp, quem],
  )
  if (rowCount === 0) throw new CompetenciaCongeladaError(comp)
}

export async function lerCascata(db: pg.Pool, competencia: string): Promise<Cascata | null> {
  const { rows } = await db.query<Cascata>(
    `SELECT ${COLUNAS} FROM analytics.monthly_close WHERE competencia = $1::date`,
    [competencia.slice(0, 7) + '-01'],
  )
  return rows[0] ? normalizar(rows[0]) : null
}

export async function listarCascatas(db: pg.Pool, meses = 12): Promise<Cascata[]> {
  const { rows } = await db.query<Cascata>(
    `SELECT ${COLUNAS} FROM analytics.monthly_close
      ORDER BY competencia DESC LIMIT $1`,
    [meses],
  )
  return rows.map(normalizar)
}

/**
 * De onde o MRR observado está saindo hoje.
 *
 * Existe para a TELA não afirmar o que não é. O texto da cascata dizia "o MRR
 * final é observado na base de contratos; os movimentos vêm do ledger — são duas
 * fontes independentes", e isso deixou de ser verdade no dia em que o observado
 * passou a cair para o faturado: com as duas pontas saindo do faturamento, o
 * resíduo confere a minha aritmética e não o negócio.
 *
 * Uma frase errada numa tela de receita é pior que uma tela sem frase: ela ensina
 * a confiar num número por um motivo que não existe.
 */
export async function fonteDoMrr(db: pg.Pool): Promise<'contrato' | 'faturamento'> {
  const { rows } = await db.query<{ tem: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM core.contract) AS tem',
  )
  return rows[0]?.tem ? 'contrato' : 'faturamento'
}
