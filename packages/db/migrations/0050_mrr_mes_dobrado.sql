-- ============================================================================
-- 0050 · O mês dobrado: quando a cobrança de um mês sai no seguinte
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ A 0049 tratou o buraco de um mês e PAROU NA METADE DO PROBLEMA.             │
-- │                                                                            │
-- │ Ela preenche o mês vazio com o anterior, o que está certo. Mas o mês         │
-- │ SEGUINTE fica com as duas cobranças dentro, e essa metade ficou de fora.     │
-- │                                                                            │
-- │ Medido logo depois de aplicá-la, e o caso é grande: fevereiro de 2026 tem     │
-- │ 136 contas sem faturamento, e 99 delas faturam o DOBRO em março e voltam ao   │
-- │ normal em abril. São R$ 860.660 do total de março. Não é um punhado de casos  │
-- │ dispersos — é a rodada de cobrança de fevereiro que saiu em março.           │
-- │                                                                            │
-- │   SWILE          jan 59.625 · fev 0 · mar 117.617 · abr 59.625               │
-- │   Playhub        jan 50.000 · fev 0 · mar 103.000 · abr 50.000               │
-- │   Pix do milhão  jan 40.000 · fev 0 · mar  80.000 · abr 40.000               │
-- │                                                                            │
-- │ Com a 0049 sozinha, a cascata diria +R$ 860 mil de EXPANSÃO em março e        │
-- │ −R$ 860 mil de CONTRAÇÃO em abril. As duas falsas, e nas duas o número mais   │
-- │ lido de um relatório de receita. Erro que se parece com informação é pior     │
-- │ que dado faltando, porque ninguém vai conferir.                              │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ A REGRA: divide-se o mês dobrado ao meio, e as duas metades ficam marcadas.  │
-- │                                                                            │
-- │ Quando o mês anterior está vazio E este vem com 1,7x ou mais do que se        │
-- │ cobrava antes dele, este mês contém dois. Metade para cada um.               │
-- │                                                                            │
-- │ Metade e não "o valor recorrente de cada lado": se houve reajuste no meio —   │
-- │ e março de 2026 é justamente o mês do reajuste do IPCA — as duas metades não  │
-- │ são iguais, e não há como saber qual parcela era a antiga. Dividir espalha    │
-- │ um erro pequeno por dois meses em vez de concentrar um erro grande em um; o   │
-- │ reajuste aparece um mês depois, em abril, que é onde ele passa a ser cobrado  │
-- │ sozinho de qualquer forma.                                                  │
-- │                                                                            │
-- │ 1,7x e não 2x exatos porque o reajuste muda o total: SWILE dá 1,97x, e um     │
-- │ cliente que subiu de faixa no mesmo mês daria menos. Abaixo de 1,7 é          │
-- │ expansão de verdade e não pode ser dividida.                                │
-- └───────────────────────────────────────────────────────────────────────────┘
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW analytics.mrr_faturado_mes AS
WITH fat AS (
  SELECT v.account_id,
         date_trunc('month', t.vencimento)::date AS competencia,
         sum(t.valor_centavos)                   AS bruto
    FROM core.omie_titulo t
    JOIN core.vinculo_cliente v
      ON v.chave = t.documento AND v.fonte = 'omie'
   WHERE t.valor_centavos > 0
     AND t.situacao NOT IN ('previsao', 'cancelado')
     AND t.vencimento < date_trunc('month', current_date) + interval '1 month'
     AND NOT EXISTS (
       SELECT 1 FROM core.omie_cliente az
        WHERE az.documento = t.documento AND az.tags ? 'Azul')
     AND EXISTS (
       SELECT 1 FROM core.omie_cliente cl
        WHERE cl.documento = t.documento
          AND (cl.tags ? 'Cliente'
               OR cl.tags ? 'Cliente Hinova'
               OR NOT (cl.tags ? 'Fornecedor' OR cl.tags ? 'Investidor')))
   GROUP BY 1, 2
),
grade AS (
  SELECT b.account_id,
         m::date              AS competencia,
         coalesce(f.bruto, 0) AS bruto
    FROM (SELECT account_id, min(competencia) AS de, max(competencia) AS ate
            FROM fat GROUP BY 1) b
    CROSS JOIN LATERAL generate_series(b.de, b.ate, interval '1 month') m
    LEFT JOIN fat f
           ON f.account_id = b.account_id AND f.competencia = m::date
),
-- Duas janelas para trás, e a segunda é o que faltava na 0049: o mês DOBRADO só
-- se reconhece olhando dois meses atrás, porque a comparação é com o que se
-- cobrava ANTES do buraco.
vizinhos AS (
  SELECT account_id, competencia, bruto,
         lag(bruto, 1)  OVER j AS ant,
         lag(bruto, 2)  OVER j AS ant2,
         lead(bruto, 1) OVER j AS prox
    FROM grade
  WINDOW j AS (PARTITION BY account_id ORDER BY competencia)
),
classificado AS (
  SELECT *,
         -- Este mês está vazio e o próximo vem dobrado: o próximo contém os dois.
         (bruto = 0 AND ant > 0 AND prox >= ant * 1.7)                      AS vazio_com_dobra,
         -- Este mês É o dobrado: veio depois de um vazio e traz 1,7x do de antes.
         (bruto > 0 AND ant = 0 AND ant2 > 0 AND bruto >= ant2 * 1.7)       AS eh_o_dobrado,
         -- Buraco comum: vazio cercado por faturamento, sem dobra depois.
         (bruto = 0 AND ant > 0 AND prox > 0 AND prox < ant * 1.7)          AS buraco_comum
    FROM vizinhos
)
SELECT account_id,
       competencia,
       CASE
         WHEN vazio_com_dobra THEN (prox / 2)::bigint
         WHEN eh_o_dobrado    THEN (bruto / 2)::bigint
         WHEN buraco_comum    THEN ant
         ELSE bruto
       END                                        AS mrr_centavos,
       bruto                                      AS faturado_centavos,
       (vazio_com_dobra OR eh_o_dobrado OR buraco_comum) AS preenchido
  FROM classificado
 WHERE bruto > 0 OR (ant > 0 AND prox > 0);

COMMENT ON VIEW analytics.mrr_faturado_mes IS
  'MRR por conta e mes, derivado do faturamento do Omie -- a unica das tres fontes candidatas que corresponde a realidade (core.contract esta vazia; core.omie_contrato soma 6x o faturado). Corrige duas distorcoes de OPERACAO de cobranca, nao de negocio: buraco de um mes cercado por faturamento, e mes DOBRADO (a rodada de um mes saindo no seguinte -- 99 contas e R$ 860.660 em marco de 2026). Sem as duas, a cascata inventaria ~10 churns por mes e uma expansao de R$ 860 mil que nao houve. preenchido marca toda linha ajustada. Ver os cabecalhos das migracoes 0049 e 0050.';

COMMIT;
