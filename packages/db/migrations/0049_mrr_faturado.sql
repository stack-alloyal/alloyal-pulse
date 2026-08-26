-- ============================================================================
-- 0049 · O MRR que existe: o faturado, por conta e por mês
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ POR QUE ESTA VIEW EXISTE, medido em 26/08/2026.                             │
-- │                                                                            │
-- │ A carteira e a cascata mostram MRR vindo de `core.contract`, e essa tabela   │
-- │ está VAZIA — zero linhas. Nada a alimenta: o ciclo que faria isso (C5, do    │
-- │ HubSpot) está declarado e não implementado. Consequência: a coluna de MRR    │
-- │ da carteira sempre em branco, e a cascata de julho gravada com TODOS os      │
-- │ valores em zero.                                                            │
-- │                                                                            │
-- │ Existem três candidatos a "MRR" nesta base, e eles discordam por 6x:        │
-- │                                                                            │
-- │  · `core.contract`            — 0 linhas;                                   │
-- │  · `core.omie_contrato`       — R$ 8,6 mi/mês somando tudo, R$ 4,02 mi só    │
-- │    na situação 10 — e o significado dos códigos 10/99/90/00 é uma pergunta   │
-- │    ainda aberta com o negócio;                                              │
-- │  · o FATURAMENTO do Omie      — R$ 1,37 mi/mês, que é o que de fato é         │
-- │    cobrado e entra.                                                        │
-- │                                                                            │
-- │ O faturamento é o único que corresponde à realidade, e é também o que o      │
-- │ produto JÁ usa: a base de clientes calcula `mrrMes` e `mrrTotal` assim, e a  │
-- │ revisão de faturamento e a inadimplência inteiras são construídas sobre ele. │
-- │ Escolher outra definição aqui faria duas telas do mesmo menu discordarem     │
-- │ sobre o MRR do mesmo cliente.                                              │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ O BURACO DE UM MÊS É PREENCHIDO, e sem isso a cascata mentiria.             │
-- │                                                                            │
-- │ Medido: 209 vezes uma conta fatura, some por um mês e volta — 163 contas,    │
-- │ 2,9% dos meses faturados. Faturamento adiantado, cobrança dobrada no mês     │
-- │ seguinte, boleto reemitido.                                                │
-- │                                                                            │
-- │ Sem tratar, cada buraco vira DOIS eventos falsos na cascata: um churn e uma  │
-- │ reativação, ~10 de cada por mês. Churn é o número mais lido de um relatório  │
-- │ de receita, e inflá-lo com 10 casos que não aconteceram é pior que não ter    │
-- │ cascata — porque o erro se parece com informação.                            │
-- │                                                                            │
-- │ Só buraco de UM mês, e só quando cercado por faturamento dos dois lados.     │
-- │ Dois meses seguidos sem faturar é ausência de verdade, e é o que a carência  │
-- │ da revisão de faturamento (MESES_DE_CARENCIA = 2) já trata como "parou".     │
-- │ `preenchido` marca a linha inventada — quem soma tem como saber.             │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- View e não tabela: são 90 mil títulos e ~7,3 mil pares conta-mês, e a consulta
-- roda em dezenas de milissegundos. Materializar exigiria um ciclo de refresh e
-- criaria a pergunta "este número é de quando?" — que é justamente a pergunta que
-- a foto da inadimplência existe para responder, e que aqui não precisa existir.
-- ============================================================================

BEGIN;

CREATE VIEW analytics.mrr_faturado_mes AS
WITH fat AS (
  SELECT v.account_id,
         date_trunc('month', t.vencimento)::date AS competencia,
         sum(t.valor_centavos)                   AS bruto
    FROM core.omie_titulo t
    JOIN core.vinculo_cliente v
      ON v.chave = t.documento AND v.fonte = 'omie'
   WHERE t.valor_centavos > 0
     AND t.situacao NOT IN ('previsao', 'cancelado')
     -- Sem o mês corrente incompleto para frente: o Omie EMITE título com
     -- vencimento futuro e ele não é `previsao`, então sem este corte um cliente
     -- com boleto emitido para dezembro apareceria faturando em dezembro.
     AND t.vencimento < date_trunc('month', current_date) + interval '1 month'
     -- O MESMO recorte de cliente da revisão de faturamento e da inadimplência.
     -- Ele é duplicado aqui porque a view é SQL e o recorte mora em TypeScript
     -- (`E_CLIENTE`, em revisao-faturamento.ts) — há portão comparando os dois,
     -- porque duas cópias divergem no dia em que uma tag nova aparecer no Omie.
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
-- A grade completa de cada conta, do primeiro ao último mês faturado: é ela que
-- torna o buraco VISÍVEL. Sem a grade, o mês ausente simplesmente não existe na
-- consulta e não há como distingui-lo de "a conta ainda não existia".
grade AS (
  SELECT b.account_id,
         m::date                AS competencia,
         coalesce(f.bruto, 0)   AS bruto
    FROM (SELECT account_id, min(competencia) AS de, max(competencia) AS ate
            FROM fat GROUP BY 1) b
    CROSS JOIN LATERAL generate_series(b.de, b.ate, interval '1 month') m
    LEFT JOIN fat f
           ON f.account_id = b.account_id AND f.competencia = m::date
),
vizinhos AS (
  SELECT account_id, competencia, bruto,
         lag(bruto)  OVER (PARTITION BY account_id ORDER BY competencia) AS ant,
         lead(bruto) OVER (PARTITION BY account_id ORDER BY competencia) AS prox
    FROM grade
)
SELECT account_id,
       competencia,
       CASE WHEN bruto = 0 THEN ant ELSE bruto END AS mrr_centavos,
       bruto                                       AS faturado_centavos,
       (bruto = 0)                                 AS preenchido
  FROM vizinhos
 -- Fica quem faturou, e o buraco de um mês cercado por faturamento dos dois
 -- lados. Dois meses seguidos em branco caem fora: aí é ausência de verdade.
 WHERE bruto > 0 OR (ant > 0 AND prox > 0);

COMMENT ON VIEW analytics.mrr_faturado_mes IS
  'MRR por conta e mes, derivado do faturamento do Omie -- que e a unica das tres fontes candidatas que corresponde a realidade (core.contract esta vazia; core.omie_contrato soma 6x o faturado). Buraco de UM mes cercado por faturamento e preenchido com o mes anterior e marcado em preenchido: sem isso, 209 buracos medidos virariam 209 churns falsos mais 209 reativacoes falsas na cascata. Ver o cabecalho da migracao 0049.';

GRANT SELECT ON analytics.mrr_faturado_mes TO pulse_api, pulse_worker;

COMMIT;
