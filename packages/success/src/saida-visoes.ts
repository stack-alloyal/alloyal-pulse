import type pg from 'pg'

import type { Identidade } from '@pulse/auth'

import { DIAS_PARA_ESTAGNAR } from './cancelamento.js'

/**
 * As três visões do fluxo de saída: o quadro, a coorte e a meta.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ARQUIVO PRÓPRIO porque isto é LEITURA, e `cancelamento.ts` é a máquina de   │
 * │ estados. Lá cada função tem um gate humano e uma transação; aqui nenhuma    │
 * │ escreve — exceto `definirMeta`, que está aqui porque a meta é o insumo de   │
 * │ uma visão e não um estado do pedido.                                       │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

/** Só quem vê a base inteira; o resto vê a própria carteira. */
const daBase = (id: Identidade) => id.permissoes.contas === 'base'

// ═══ O QUADRO ════════════════════════════════════════════════════════════════

/**
 * As oito posições do quadro, derivadas de `estado` + `origem`.
 *
 * A coluna não é uma coluna do banco: `encerrado` + `origem` dá duas posições, e
 * gravar duas seria ter duas formas de escrever a mesma coisa. A derivação mora
 * aqui, num lugar, e a tela recebe a posição pronta.
 */
export type PosicaoDoQuadro =
  | 'pedido'
  | 'financeiro'
  | 'reversao'
  | 'revertido'
  | 'desconto'
  | 'renegociado'
  | 'cancelamento'
  | 'pdd'

export const POSICOES: ReadonlyArray<{
  id: PosicaoDoQuadro
  rotulo: string
  tipo: 'etapa' | 'salvo' | 'perda'
  explica: string
}> = [
  { id: 'pedido', rotulo: 'Pedido de cancelamento ou desconto', tipo: 'etapa',
    explica: 'a mão levantada, com cliente, data, canal e MRR congelado' },
  { id: 'financeiro', rotulo: 'Informações financeiras', tipo: 'etapa',
    explica: 'multa, dívida, aviso prévio e até quando ainda se cobra' },
  { id: 'reversao', rotulo: 'Tentativa de reversão', tipo: 'etapa',
    explica: 'a conversa; a única etapa com prazo' },
  { id: 'revertido', rotulo: 'Cancelamento revertido', tipo: 'salvo',
    explica: 'fica no mesmo valor; nada entra no ledger' },
  { id: 'desconto', rotulo: 'Desconto', tipo: 'salvo',
    explica: 'fica pagando menos; entra como contração' },
  { id: 'renegociado', rotulo: 'Renegociação financeira', tipo: 'salvo',
    explica: 'muda prazo ou parcela; só mexe no MRR se o mensal mudar' },
  { id: 'cancelamento', rotulo: 'Cancelamento', tipo: 'perda',
    explica: 'sai por decisão do cliente; churn pedido' },
  { id: 'pdd', rotulo: 'Cancelamento Alloyal (PDD)', tipo: 'perda',
    explica: 'nós cortamos, por crédito; churn por inadimplência' },
]

/**
 * O SQL que traduz estado + origem em posição. Um `CASE` só, e é ele que garante
 * que quadro, coorte e contagem concordem sobre onde cada pedido está.
 */
const POSICAO = `CASE
  WHEN c.estado = 'anunciado'   THEN 'pedido'
  WHEN c.estado = 'financeiro'  THEN 'financeiro'
  WHEN c.estado = 'reversao'    THEN 'reversao'
  WHEN c.estado = 'retido'      THEN 'revertido'
  WHEN c.estado = 'desconto'    THEN 'desconto'
  WHEN c.estado = 'renegociado' THEN 'renegociado'
  -- em_aviso é cancelamento decidido com o aviso correndo: aparece junto do
  -- cancelamento, porque para quem olha o quadro a decisão já foi tomada.
  WHEN c.origem = 'alloyal'     THEN 'pdd'
  ELSE 'cancelamento'
END`

export interface PedidoNoQuadro {
  readonly id: string
  readonly accountId: string
  readonly razaoSocial: string
  readonly posicao: PosicaoDoQuadro
  readonly pedido: 'cancelar' | 'desconto'
  readonly dataLevantada: string | null
  readonly mrrCentavos: string | null
  readonly mrrNovoCentavos: string | null
  readonly avisoPrevioDias: number | null
  readonly fimDoAviso: string | null
  readonly competenciaEfeito: string | null
  readonly motivo: string | null
  readonly motivoConfirmado: boolean
  readonly diasNaEtapa: number
  /** Parado além do prazo numa ETAPA. Desfecho não estagna. */
  readonly estagnado: boolean
  readonly dividaCentavos: string | null
}

export async function quadroDeSaida(
  db: pg.Pool,
  id: Identidade,
  opcoes: { readonly desde?: string } = {},
): Promise<PedidoNoQuadro[]> {
  const { rows } = await db.query(
    `SELECT c.id::text, c.account_id::text AS account_id, a.razao_social,
            ${POSICAO} AS posicao, c.pedido,
            to_char(c.data_levantada, 'YYYY-MM-DD')            AS data_levantada,
            c.mrr_centavos_na_levantada::text                  AS mrr,
            c.mrr_novo_centavos::text                          AS mrr_novo,
            c.aviso_previo_dias,
            to_char(c.data_fim_aviso, 'YYYY-MM-DD')            AS fim_aviso,
            to_char(c.competencia_efeito_receita, 'YYYY-MM')   AS efeito,
            c.motivo,
            (c.motivo_confirmado_por IS NOT NULL)              AS motivo_confirmado,
            greatest(0, (now()::date - c.etapa_desde::date))    AS dias_na_etapa,
            c.debito_aberto_na_levantada_centavos::text        AS divida
       FROM success.cancellation c
       JOIN core.account a ON a.id = c.account_id
      WHERE ($2::boolean OR a.csm_email = $1)
        AND ($3::date IS NULL OR c.criado_em >= $3::date)
      ORDER BY
        -- Etapas primeiro, e dentro delas o mais parado no topo: o quadro tem de
        -- puxar o olho para o que está esquecido, não para o que é recente.
        (c.estado IN ('anunciado', 'financeiro', 'reversao')) DESC,
        c.etapa_desde,
        c.mrr_centavos_na_levantada DESC NULLS LAST`,
    [id.email, daBase(id), opcoes.desde ?? null],
  )
  return rows.map((r) => {
    const posicao = String(r['posicao']) as PosicaoDoQuadro
    const dias = Number(r['dias_na_etapa'] ?? 0)
    const emEtapa = posicao === 'pedido' || posicao === 'financeiro' || posicao === 'reversao'
    return {
      id: String(r['id']),
      accountId: String(r['account_id']),
      razaoSocial: String(r['razao_social'] ?? ''),
      posicao,
      pedido: String(r['pedido']) as 'cancelar' | 'desconto',
      dataLevantada: (r['data_levantada'] as string | null) ?? null,
      mrrCentavos: r['mrr'] === null ? null : String(r['mrr']),
      mrrNovoCentavos: r['mrr_novo'] === null ? null : String(r['mrr_novo']),
      avisoPrevioDias: r['aviso_previo_dias'] === null ? null : Number(r['aviso_previo_dias']),
      fimDoAviso: (r['fim_aviso'] as string | null) ?? null,
      competenciaEfeito: (r['efeito'] as string | null) ?? null,
      motivo: (r['motivo'] as string | null) ?? null,
      motivoConfirmado: r['motivo_confirmado'] === true,
      diasNaEtapa: dias,
      estagnado: emEtapa && dias >= DIAS_PARA_ESTAGNAR,
      dividaCentavos: r['divida'] === null ? null : String(r['divida']),
    }
  })
}

// ═══ A COORTE ════════════════════════════════════════════════════════════════

export interface MesDaCoorte {
  readonly mes: string
  /** Do pipeline: pedidos ANUNCIADOS neste mês. Zero até alguém registrar. */
  readonly anunciados: number
  readonly mrrAnunciadoCentavos: string
  readonly avisoPrevioMedioDias: number | null
  readonly revertidos: number
  readonly comDesconto: number
  readonly renegociados: number
  readonly cancelados: number
  /** Do ledger derivado: churn com EFEITO neste mês. Tem história. */
  readonly churnEfeitoContas: number
  readonly churnEfeitoCentavos: string
  readonly reativouContas: number
  readonly reativouCentavos: string
}

/**
 * A coorte, com as DUAS datas lado a lado.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ SÃO DUAS COORTES E NÃO UMA, e juntá-las numa coluna seria o erro.           │
 * │                                                                            │
 * │ A coorte de ANÚNCIO conta quando a mão subiu — é a que antecipa, e é a que  │
 * │ o pedido pede. Ela começa vazia: o ledger derivado do faturamento sabe o    │
 * │ mês em que a receita PAROU, não o mês em que o cliente avisou.              │
 * │                                                                            │
 * │ A coorte de EFEITO conta quando a receita saiu, e tem história — R$ 843 mil │
 * │ em 2026 quando foi medido.                                                 │
 * │                                                                            │
 * │ A distância entre as duas É o aviso prévio. Somá-las numa coluna faria      │
 * │ junho aparecer com saídas que foram anunciadas em abril, e a leitura de      │
 * │ tendência ficaria deslocada pelo tamanho do aviso — que varia por contrato. │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export async function coorteDeSaida(db: pg.Pool, meses = 12): Promise<MesDaCoorte[]> {
  const { rows } = await db.query(
    `WITH grade AS (
       SELECT generate_series(
                date_trunc('month', current_date) - ($1::int || ' months')::interval,
                date_trunc('month', current_date),
                interval '1 month')::date AS mes
     ),
     anuncio AS (
       SELECT date_trunc('month', c.data_levantada)::date AS mes,
              count(*)                                        AS n,
              coalesce(sum(c.mrr_centavos_na_levantada), 0)   AS mrr,
              round(avg(c.aviso_previo_dias))                 AS aviso,
              count(*) FILTER (WHERE c.estado = 'retido')      AS revertidos,
              count(*) FILTER (WHERE c.estado = 'desconto')    AS descontos,
              count(*) FILTER (WHERE c.estado = 'renegociado') AS renegociados,
              count(*) FILTER (WHERE c.estado IN ('em_aviso', 'encerrado')) AS cancelados
         FROM success.cancellation c
        WHERE c.data_levantada IS NOT NULL
        GROUP BY 1
     ),
     efeito AS (
       SELECT competencia AS mes,
              count(*) FILTER (WHERE tipo IN ('churn_pedido', 'churn_inadimplencia')) AS n,
              coalesce(abs(sum(valor_centavos) FILTER (
                WHERE tipo IN ('churn_pedido', 'churn_inadimplencia'))), 0)            AS mrr,
              count(*) FILTER (WHERE tipo = 'reativacao')                              AS rea_n,
              coalesce(sum(valor_centavos) FILTER (WHERE tipo = 'reativacao'), 0)      AS rea_mrr
         FROM fact.mrr_event
        GROUP BY 1
     )
     SELECT to_char(g.mes, 'YYYY-MM-DD') AS mes,
            coalesce(an.n, 0)::int            AS anunciados,
            coalesce(an.mrr, 0)::text         AS mrr_anunciado,
            an.aviso                          AS aviso,
            coalesce(an.revertidos, 0)::int   AS revertidos,
            coalesce(an.descontos, 0)::int    AS descontos,
            coalesce(an.renegociados, 0)::int AS renegociados,
            coalesce(an.cancelados, 0)::int   AS cancelados,
            coalesce(ef.n, 0)::int            AS churn_contas,
            coalesce(ef.mrr, 0)::text         AS churn_mrr,
            coalesce(ef.rea_n, 0)::int        AS rea_contas,
            coalesce(ef.rea_mrr, 0)::text     AS rea_mrr
       FROM grade g
       LEFT JOIN anuncio an ON an.mes = g.mes
       LEFT JOIN efeito  ef ON ef.mes = g.mes
      ORDER BY g.mes`,
    [meses],
  )
  return rows.map((r) => ({
    mes: String(r['mes']),
    anunciados: Number(r['anunciados']),
    mrrAnunciadoCentavos: String(r['mrr_anunciado']),
    avisoPrevioMedioDias: r['aviso'] === null ? null : Number(r['aviso']),
    revertidos: Number(r['revertidos']),
    comDesconto: Number(r['descontos']),
    renegociados: Number(r['renegociados']),
    cancelados: Number(r['cancelados']),
    churnEfeitoContas: Number(r['churn_contas']),
    churnEfeitoCentavos: String(r['churn_mrr']),
    reativouContas: Number(r['rea_contas']),
    reativouCentavos: String(r['rea_mrr']),
  }))
}

// ═══ META CONTRA REALIZADO ═══════════════════════════════════════════════════

export interface LinhaDaMeta {
  readonly competencia: string
  /** Nulo é "sem meta definida", que a tela mostra diferente de meta zero. */
  readonly metaCentavos: string | null
  readonly metaAcumuladaCentavos: string | null
  readonly churnCentavos: string
  readonly churnAcumuladoCentavos: string
  /** Meta acumulada menos churn acumulado. Negativo é churn acima da meta. */
  readonly diferencaCentavos: string | null
  readonly definidoPor: string | null
}

/**
 * Meta contra realizado, com as duas curvas ACUMULADAS.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A COLUNA QUE DECIDE É A ACUMULADA, e é a que o pedido nomeia por último.    │
 * │                                                                            │
 * │ Junho de 2026, medido: R$ 57.421 de churn contra uma meta de R$ 100 mil —   │
 * │ o melhor mês do ano. Olhando só o mês, é uma vitória; olhando o acumulado,  │
 * │ ele MELHOROU a diferença de R$ 173 mil para R$ 130 mil, e o ano continua    │
 * │ atrasado. É a única coluna que responde "estamos recuperando ou só tivemos  │
 * │ um mês bom".                                                               │
 * │                                                                            │
 * │ O SINAL: negativo é churn ACIMA da meta, isto é, ruim. Em receita, o sinal  │
 * │ de um número de perda é a primeira coisa que alguém lê errado — a tela diz  │
 * │ isso em texto ao lado da tabela, não só pela cor.                           │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * O realizado conta SÓ `churn_pedido` e `churn_inadimplencia`. Desconto e
 * renegociação são contração: somá-los aqui faria a tabela deixar de ser de churn
 * e passar a ser de receita perdida — que é uma tabela útil, e é outra tabela.
 */
export async function metaVersusRealizado(
  db: pg.Pool,
  de: string,
  ate: string,
): Promise<LinhaDaMeta[]> {
  const { rows } = await db.query(
    `WITH grade AS (
       SELECT generate_series($1::date, $2::date, interval '1 month')::date AS mes
     ),
     churn AS (
       SELECT competencia AS mes,
              coalesce(abs(sum(valor_centavos)), 0) AS v
         FROM fact.mrr_event
        WHERE tipo IN ('churn_pedido', 'churn_inadimplencia')
        GROUP BY 1
     )
     SELECT to_char(g.mes, 'YYYY-MM-DD') AS mes,
            m.meta_centavos::text        AS meta,
            -- Acumulado da META: nulo enquanto NENHUM mês do período tem meta. Um
            -- acumulado que soma zero por falta de meta afirmaria meta zero.
            CASE WHEN count(m.meta_centavos) OVER (ORDER BY g.mes) > 0
                 THEN sum(coalesce(m.meta_centavos, 0)) OVER (ORDER BY g.mes)
            END::text                    AS meta_acumulada,
            coalesce(c.v, 0)::text       AS churn,
            sum(coalesce(c.v, 0)) OVER (ORDER BY g.mes)::text AS churn_acumulado,
            m.definido_por
       FROM grade g
       LEFT JOIN success.meta_churn m ON m.competencia = g.mes
       LEFT JOIN churn c ON c.mes = g.mes
      ORDER BY g.mes`,
    [de.slice(0, 7) + '-01', ate.slice(0, 7) + '-01'],
  )
  return rows.map((r) => {
    const metaAcum = r['meta_acumulada'] === null ? null : String(r['meta_acumulada'])
    const churnAcum = String(r['churn_acumulado'])
    return {
      competencia: String(r['mes']),
      metaCentavos: r['meta'] === null ? null : String(r['meta']),
      metaAcumuladaCentavos: metaAcum,
      churnCentavos: String(r['churn']),
      churnAcumuladoCentavos: churnAcum,
      diferencaCentavos: metaAcum === null ? null : String(Number(metaAcum) - Number(churnAcum)),
      definidoPor: (r['definido_por'] as string | null) ?? null,
    }
  })
}

/**
 * Define ou corrige a meta de um mês.
 *
 * Exige `configurar`: meta é combinado da casa, não decisão de quem trabalha a
 * fila. E é UPDATE em vez de apagar-e-criar, para `definido_por` e `definido_em`
 * dizerem quem mudou por último — meta que muda sem autor é meta que ninguém
 * combinou.
 */
export async function definirMeta(
  db: pg.Pool,
  id: Identidade,
  competencia: string,
  metaCentavos: string,
  nota?: string,
): Promise<void> {
  if (!id.permissoes.configurar) {
    throw new Error('definir meta de churn exige permissão de configurar')
  }
  const v = Number(metaCentavos)
  if (!Number.isFinite(v) || v < 0) throw new Error('meta tem de ser um valor em centavos, não negativo')
  await db.query(
    `INSERT INTO success.meta_churn (competencia, meta_centavos, definido_por, nota)
     VALUES (($1::text || '-01')::date, $2, $3, $4)
     ON CONFLICT (competencia) DO UPDATE
        SET meta_centavos = excluded.meta_centavos,
            definido_por  = excluded.definido_por,
            definido_em   = now(),
            nota          = excluded.nota`,
    [competencia.slice(0, 7), Math.round(v), id.email, nota ?? null],
  )
}
