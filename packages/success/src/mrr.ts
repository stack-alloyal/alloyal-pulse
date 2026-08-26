import type pg from 'pg'

/**
 * O ledger de MRR derivado do faturamento — o que preenche a cascata.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POR QUE ISTO EXISTE, medido em 26/08/2026.                                 │
 * │                                                                            │
 * │ `fact.mrr_event` tinha ZERO linhas, e `analytics.monthly_close` tinha uma    │
 * │ competência com todos os valores em zero. O ledger só recebia eventos do     │
 * │ fluxo de saídas — que também não tinha nenhum — porque o ciclo C5, que traria │
 * │ os eventos do HubSpot, está declarado e não implementado.                   │
 * │                                                                            │
 * │ Resultado na tela: a cascata em `/receita` mostrava R$ 0,00 em toda linha, e │
 * │ a coluna de MRR da carteira vinha em branco (de `core.contract`, também       │
 * │ vazia). Duas telas de operação sem número nenhum.                            │
 * │                                                                            │
 * │ Este módulo deriva os eventos do único MRR que existe nesta base: o           │
 * │ FATURADO, em `analytics.mrr_faturado_mes`. A view já corrige as duas          │
 * │ distorções de operação de cobrança — buraco de um mês e mês dobrado —, e sem  │
 * │ elas a cascata inventaria ~10 churns por mês e uma expansão de R$ 860 mil     │
 * │ que não houve (ver as migrações 0049 e 0050).                                │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O QUE ESTE LEDGER NÃO CONSEGUE DIZER, e é melhor estar escrito:             │
 * │                                                                            │
 * │ · POR QUE a conta saiu. Do faturamento se vê que parou, não o motivo. Todo   │
 * │   churn derivado entra como `churn_pedido`; `churn_inadimplencia` continua    │
 * │   vindo só do fluxo de saídas, onde alguém CLASSIFICA a saída. Adivinhar o    │
 * │   motivo pela existência de título vencido seria inventar a linha mais lida   │
 * │   de um relatório de receita.                                               │
 * │                                                                            │
 * │ · A diferença entre CONTRATO e COBRANÇA. Um cliente que renegociou para      │
 * │   pagar trimestralmente aparece como churn e reativação. A view trata o       │
 * │   buraco de um mês; três meses ela não trata, e nem deveria — aí a receita    │
 * │   realmente não entrou naquele mês.                                         │
 * │                                                                            │
 * │ O evento derivado é marcado `reconstruido = true`, e é assim que a tela e o   │
 * │ próximo leitor distinguem o que foi observado do que foi inferido.            │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

export interface EventosGerados {
  readonly competencia: string
  readonly novo: number
  readonly expansao: number
  readonly contracao: number
  readonly churn: number
  readonly reativacao: number
  readonly total: number
}

/** O prefixo da chave natural. É por ele que se apaga só o que foi derivado. */
const PREFIXO = 'faturamento:'

/**
 * Gera os eventos de UMA competência, comparando com a anterior.
 *
 * IDEMPOTENTE: apaga os eventos derivados da competência e regrava. Apaga só os
 * derivados — evento de cancelamento aprovado por gente tem `chave_natural`
 * começando em `cancelamento:` e fica onde está. Sem essa separação, rodar o
 * ciclo de novo apagaria a baixa de receita que alguém aprovou na tela.
 */
export async function gerarEventosDeMrr(
  db: pg.Pool,
  competencia: string,
): Promise<EventosGerados> {
  const comp = competencia.slice(0, 7) + '-01'
  const cliente = await db.connect()
  try {
    await cliente.query('BEGIN')

    // Competência congelada não se reescreve: o mês já foi ao board.
    const { rows: fechada } = await cliente.query<{ estado: string }>(
      'SELECT estado FROM analytics.monthly_close WHERE competencia = $1::date',
      [comp],
    )
    if (fechada[0]?.estado === 'congelada') {
      await cliente.query('ROLLBACK')
      return { competencia: comp, novo: 0, expansao: 0, contracao: 0, churn: 0, reativacao: 0, total: 0 }
    }

    await cliente.query(
      `DELETE FROM fact.mrr_event
        WHERE competencia = $1::date AND chave_natural LIKE $2`,
      [comp, PREFIXO + '%'],
    )

    const { rows } = await cliente.query<{ tipo: string; n: string }>(
      `WITH atual AS (
         SELECT account_id, mrr_centavos FROM analytics.mrr_faturado_mes
          WHERE competencia = $1::date
       ),
       anterior AS (
         SELECT account_id, mrr_centavos FROM analytics.mrr_faturado_mes
          WHERE competencia = ($1::date - interval '1 month')::date
       ),
       -- Já faturou ALGUMA vez antes desta competência? É o que separa conta nova
       -- de conta que voltou. Sem isto, todo retorno depois de uma pausa longa
       -- entraria como novo, e o MRR novo do mês viraria ficção.
       historico AS (
         SELECT DISTINCT account_id FROM analytics.mrr_faturado_mes
          WHERE competencia < ($1::date - interval '1 month')::date
       ),
       classificado AS (
         SELECT coalesce(a.account_id, p.account_id)      AS account_id,
                coalesce(a.mrr_centavos, 0)               AS agora,
                coalesce(p.mrr_centavos, 0)               AS antes,
                (h.account_id IS NOT NULL)                AS tinha_historico
           FROM atual a
           FULL OUTER JOIN anterior p ON p.account_id = a.account_id
           LEFT JOIN historico h ON h.account_id = coalesce(a.account_id, p.account_id)
       ),
       evento AS (
         SELECT account_id,
                CASE
                  WHEN antes = 0 AND agora > 0 AND NOT tinha_historico THEN 'novo'
                  WHEN antes = 0 AND agora > 0                         THEN 'reativacao'
                  WHEN antes > 0 AND agora = 0                         THEN 'churn_pedido'
                  WHEN agora > antes                                   THEN 'expansao'
                  WHEN agora < antes                                   THEN 'contracao'
                END AS tipo,
                CASE
                  WHEN antes = 0 AND agora > 0 THEN agora
                  WHEN antes > 0 AND agora = 0 THEN -antes
                  ELSE agora - antes
                END AS valor
           FROM classificado
       )
       INSERT INTO fact.mrr_event
         (account_id, competencia, valor_centavos, tipo, motivo, origem,
          reconstruido, chave_natural)
       SELECT account_id, $1::date, valor, tipo,
              'derivado do faturamento do Omie', 'ops', true,
              $2 || to_char($1::date, 'YYYY-MM') || ':' || account_id::text || ':' || tipo
         FROM evento
        WHERE tipo IS NOT NULL AND valor <> 0
       RETURNING tipo, '1' AS n`,
      [comp, PREFIXO],
    )

    await cliente.query('COMMIT')
    const conta = (t: string) => rows.filter((r) => r.tipo === t).length
    return {
      competencia: comp,
      novo: conta('novo'),
      expansao: conta('expansao'),
      contracao: conta('contracao'),
      churn: conta('churn_pedido'),
      reativacao: conta('reativacao'),
      total: rows.length,
    }
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => undefined)
    throw erro
  } finally {
    cliente.release()
  }
}

/**
 * As competências que têm faturamento e ainda não têm evento derivado.
 *
 * Mesma ideia do C21: o ciclo não pergunta "é dia 1º?", pergunta "que mês fechado
 * está sem?". Um cron mensal perde o mês se a máquina estiver fora do ar naquela
 * manhã, e aqui o dado é reconstruível — mas o buraco na série não se anuncia.
 */
export async function competenciasSemEventos(db: pg.Pool): Promise<string[]> {
  const { rows } = await db.query<{ competencia: string }>(
    `SELECT to_char(m.competencia, 'YYYY-MM-DD') AS competencia
       FROM (SELECT DISTINCT competencia FROM analytics.mrr_faturado_mes) m
      WHERE m.competencia < date_trunc('month', current_date)
        AND NOT EXISTS (
          SELECT 1 FROM fact.mrr_event e
           WHERE e.competencia = m.competencia
             AND e.chave_natural LIKE $1)
      ORDER BY 1`,
    [PREFIXO + '%'],
  )
  return rows.map((r) => r.competencia)
}
