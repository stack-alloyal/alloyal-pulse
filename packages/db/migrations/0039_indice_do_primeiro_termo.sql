-- ============================================================================
-- 0039 · `core.termo` e os índices que a tela de match exige
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ A tela de match nasceu com "timed out" na primeira carga real. A evidência  │
-- │ por nome comparava com LIKE 'PREFIXO%' e media a raridade do termo com uma  │
-- │ subconsulta POR LINHA — 3.242 contas × 9.498 fichas, varredura completa a   │
-- │ cada uma.                                                                  │
-- │                                                                            │
-- │ A troca é de semântica, e é melhor além de mais rápida: comparar o PRIMEIRO │
-- │ TERMO dos dois lados por IGUALDADE, em vez de prefixo. "SWILE" = "SWILE"    │
-- │ continua casando; "BANCO" deixa de casar com "BANCOOB" por acaso de prefixo.│
-- │                                                                            │
-- │ A expressão virou função porque aparecia em cinco consultas, e uma delas    │
-- │ escrita com uma letra fora do lugar casaria silenciosamente com nada — o    │
-- │ tipo de defeito que não levanta erro, só devolve lista vazia.               │
-- │                                                                            │
-- │ IMMUTABLE é exigência do índice funcional, e é verdade: `upper`,            │
-- │ `split_part` e `regexp_replace` são todas imutáveis.                        │
-- └───────────────────────────────────────────────────────────────────────────┘
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION core.termo(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT upper(split_part(regexp_replace(coalesce(t, ''), '[^A-Za-z0-9 ]', '', 'g'), ' ', 1))
$$;

COMMENT ON FUNCTION core.termo(text) IS
  'Primeiro termo da razão social, normalizado. Usado no match por nome e indexado nos dois lados (ver 0039).';

CREATE INDEX omie_cliente_termo_idx ON core.omie_cliente (core.termo(razao_social));
CREATE INDEX account_termo_idx ON core.account (core.termo(razao_social));

-- O documento da conta, que a fila de match recalcula em toda linha.
CREATE INDEX account_doc_idx
  ON core.account (regexp_replace(coalesce(cnpj, ''), '[^0-9]', '', 'g'));

GRANT EXECUTE ON FUNCTION core.termo(text) TO pulse_api, pulse_worker;

COMMIT;
