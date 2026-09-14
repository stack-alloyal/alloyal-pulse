import type pg from 'pg'

/**
 * O faturamento em DUAS BASES: competência (por vencimento) e caixa (por pagamento).
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POR QUE AS DUAS, E POR QUE A DIFERENÇA É A INFORMAÇÃO.                     │
 * │                                                                            │
 * │ COMPETÊNCIA conta o título no mês do VENCIMENTO — o mês do serviço, o que    │
 * │ foi cobrado. CAIXA conta pelo mês do PAGAMENTO — o que de fato entrou. A     │
 * │ diferença entre as duas, num mês passado, é inadimplência + timing; num mês  │
 * │ futuro, competência existe (título já emitido) e caixa ainda não.           │
 * │                                                                            │
 * │ Somá-las ou trocá-las uma pela outra dá número errado — foi o motivo do      │
 * │ pedido. Por isso a tela mostra as duas lado a lado, nunca fundidas.         │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O MESMO UNIVERSO DE TÍTULOS da Carteira, para os números baterem.          │
 * │                                                                            │
 * │ O filtro de cliente é copiado de `analytics.mrr_faturado_mes`: título de    │
 * │ cliente (tag Cliente/Hinova, ou nem Fornecedor nem Investidor), fora os      │
 * │ marcados 'Azul', com `situacao` válida e valor positivo. Sem isso, o total   │
 * │ incluiria Fornecedor e Investidor e diria R$ 9 mi onde a receita de cliente  │
 * │ é R$ 1,3 mi. Uma segunda definição de "o que é faturamento de cliente"       │
 * │ divergiria da Carteira, e duas verdades sobre receita é o pior lugar para    │
 * │ ter uma.                                                                    │
 * │                                                                            │
 * │ A diferença para a view: aqui NÃO se suaviza (a view corrige mês de dobra e  │
 * │ buraco para achar o MRR). Faturamento é o valor BRUTO real — dobra é dobra,  │
 * │ e escondê-la seria mentir sobre o que foi cobrado.                         │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export interface MesDeFaturamento {
  /** `AAAA-MM-01`. */
  readonly competencia: string
  /** O que foi cobrado no mês (títulos por vencimento). */
  readonly competenciaCentavos: string
  /** O que entrou no mês (pagamentos por data de pagamento). `null` no futuro. */
  readonly caixaCentavos: string | null
}

const UNIVERSO_DE_CLIENTE = `
  SELECT t.vencimento, t.pagamento, t.valor_centavos, t.pago_centavos
    FROM core.omie_titulo t
    JOIN core.vinculo_cliente v ON v.chave = t.documento AND v.fonte = 'omie'
   WHERE t.valor_centavos > 0
     AND t.situacao NOT IN ('previsao', 'cancelado')
     AND NOT EXISTS (SELECT 1 FROM core.omie_cliente az
                      WHERE az.documento = t.documento AND az.tags ? 'Azul')
     AND EXISTS (SELECT 1 FROM core.omie_cliente cl
                  WHERE cl.documento = t.documento
                    AND (cl.tags ? 'Cliente' OR cl.tags ? 'Cliente Hinova'
                         OR NOT (cl.tags ? 'Fornecedor' OR cl.tags ? 'Investidor')))`

/**
 * Uma linha por mês, com as duas bases. Vai de `meses` atrás do mês corrente até
 * o vencimento mais no futuro que já existe (título emitido para meses à frente).
 * Caixa é nula nos meses que ainda não tiveram pagamento — nula, e não zero,
 * porque "não recebeu nada" e "não chegou o mês" são coisas diferentes.
 */
export async function faturamentoPorMes(db: pg.Pool, meses = 12): Promise<MesDeFaturamento[]> {
  const { rows } = await db.query(
    `WITH titulos AS (${UNIVERSO_DE_CLIENTE}
    ), comp AS (
       SELECT date_trunc('month', vencimento)::date AS mes, sum(valor_centavos) AS v
         FROM titulos GROUP BY 1
     ), cx AS (
       SELECT date_trunc('month', pagamento)::date AS mes, sum(pago_centavos) AS v
         FROM titulos WHERE pagamento IS NOT NULL AND pago_centavos > 0 GROUP BY 1
     ), grade AS (
       SELECT generate_series(
                date_trunc('month', current_date) - make_interval(months => $1::int),
                COALESCE((SELECT max(mes) FROM comp), date_trunc('month', current_date)),
                '1 month')::date AS mes
     )
     SELECT to_char(g.mes, 'YYYY-MM-DD') AS competencia,
            COALESCE((SELECT v FROM comp WHERE comp.mes = g.mes), 0)::text AS competencia_c,
            (SELECT v FROM cx WHERE cx.mes = g.mes)::text AS caixa_c
       FROM grade g ORDER BY g.mes`,
    [meses],
  )
  return rows.map((r) => ({
    competencia: String(r['competencia']),
    competenciaCentavos: String(r['competencia_c']),
    caixaCentavos: r['caixa_c'] === null ? null : String(r['caixa_c']),
  }))
}
