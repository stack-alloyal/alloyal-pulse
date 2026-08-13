-- ============================================================================
-- 0043 · Baixa sem data de pagamento não cabe numa chave primária
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ A 0042 pôs `pagamento` na PRIMARY KEY, porque um título recebe mais de uma  │
-- │ baixa e só o código não distingue. Chave primária proíbe nulo — e 3.391 das │
-- │ 25.074 baixas não têm data.                                                │
-- │                                                                            │
-- │ O sintoma repetiu o da 0041, e por isso dói mais: o ciclo varreu 15 minutos,│
-- │ gravou 9.498 fichas e 90.041 títulos, e morreu no passo seguinte. Duas vezes│
-- │ seguidas o passo NOVO derrubou a execução inteira depois do trabalho pesado │
-- │ estar feito.                                                               │
-- │                                                                            │
-- │ A correção é chave substituta com índice único que trata NULL como valor.   │
-- │ `coalesce(pagamento, '0001-01-01')` não é gambiarra: diz que "sem data" É   │
-- │ uma posição no espaço de chaves, e não a ausência de posição — que é        │
-- │ exatamente o que o Postgres não assume sozinho.                            │
-- └───────────────────────────────────────────────────────────────────────────┘
-- ============================================================================

BEGIN;

ALTER TABLE core.omie_baixa DROP CONSTRAINT omie_baixa_pkey;
ALTER TABLE core.omie_baixa ALTER COLUMN pagamento DROP NOT NULL;
ALTER TABLE core.omie_baixa ADD COLUMN id bigserial PRIMARY KEY;

CREATE UNIQUE INDEX omie_baixa_natural_idx
  ON core.omie_baixa (codigo_titulo, coalesce(pagamento, DATE '0001-01-01'), pago_centavos);

COMMENT ON INDEX core.omie_baixa_natural_idx IS
  'A chave natural da baixa. `coalesce` porque 3.391 baixas não têm data e NULL não se compara consigo mesmo num índice único (ver 0043).';

GRANT USAGE, SELECT ON SEQUENCE core.omie_baixa_id_seq TO pulse_worker, pulse_api;

COMMIT;
