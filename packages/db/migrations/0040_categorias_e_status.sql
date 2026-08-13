-- ============================================================================
-- 0040 · Categorias com nome, e o status como eixo do faturamento
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ DUAS COISAS QUE A CONFERÊNCIA DA SWILE ENSINOU.                            │
-- │                                                                            │
-- │ 1. O EIXO ERA A DATA, E O CERTO É O STATUS.                                │
-- │                                                                            │
-- │ Faltavam R$ 59.625 na Swile. É UM título, vencendo em 25/08, com status     │
-- │ `A VENCER`: a fatura do mês, emitida e ainda não paga. Meu corte "vencimento │
-- │ <= hoje" a jogava fora como se fosse projeção.                              │
-- │                                                                            │
-- │ O Omie distingue duas coisas que a data não distingue:                      │
-- │   A VENCER  — título EMITIDO, aguardando pagamento. É faturamento.          │
-- │   PREVISAO  — recorrência projetada, ainda NÃO emitida. Não é faturamento.  │
-- │                                                                            │
-- │ Medido na base: 66.012 títulos em PREVISAO somando R$ 229,6 milhões contra  │
-- │ R$ 141,5 milhões de faturamento real. Cortar por data misturava os dois nas │
-- │ duas direções — deixava entrar 31 PREVISAO com data passada e deixava de    │
-- │ fora 313 A VENCER com data futura.                                          │
-- │                                                                            │
-- │ 2. CÓDIGO DE CATEGORIA NÃO É NOME.                                          │
-- │                                                                            │
-- │ As telas mostravam `1.01.02`, e ninguém fora do financeiro sabe o que é.    │
-- │ O Omie tem o nome, em `geral/categorias`: 225 categorias. E o nome de       │
-- │ 1.01.02 é, literalmente, **MRR** — 1.01.01 é UPFRONT e 1.01.03 é SETUP.     │
-- │ O dado que faltava para a conversa de receita estava a uma chamada.         │
-- └───────────────────────────────────────────────────────────────────────────┘
-- ============================================================================

BEGIN;

CREATE TABLE core.omie_categoria (
  codigo           text PRIMARY KEY,
  descricao        text NOT NULL,
  categoria_superior text,
  natureza         text,
  tipo             text,
  conta_receita    boolean NOT NULL DEFAULT false,
  conta_despesa    boolean NOT NULL DEFAULT false,
  totalizadora     boolean NOT NULL DEFAULT false,
  inativa          boolean NOT NULL DEFAULT false,
  sincronizado_em  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.omie_categoria IS
  'Plano de categorias do Omie. Existe para as telas mostrarem "MRR" em vez de "1.01.02" (ver 0040).';

CREATE INDEX omie_categoria_superior_idx ON core.omie_categoria (categoria_superior);

-- ═══ O status normalizado ═══════════════════════════════════════════════════
-- O Omie escreve "A VENCER", "VENCE HOJE", "PREVISAO", "ATRASADO", "RECEBIDO",
-- "CANCELADO". São seis textos para quatro perguntas, e cada tela que os
-- agrupasse à mão agruparia de um jeito diferente.
--
-- Coluna GERADA, e não calculada na consulta: assim existe UM lugar onde a regra
-- mora, ela é indexável, e uma tela nova não tem como inventar o próprio
-- agrupamento sem que isso apareça no diff.
ALTER TABLE core.omie_titulo
  ADD COLUMN situacao text GENERATED ALWAYS AS (
    CASE upper(coalesce(status, ''))
      WHEN 'RECEBIDO'   THEN 'recebido'
      WHEN 'CANCELADO'  THEN 'cancelado'
      WHEN 'PREVISAO'   THEN 'previsao'
      WHEN 'ATRASADO'   THEN 'atrasado'
      WHEN 'A VENCER'   THEN 'a_vencer'
      WHEN 'VENCE HOJE' THEN 'a_vencer'
      ELSE 'outro'
    END
  ) STORED;

COMMENT ON COLUMN core.omie_titulo.situacao IS
  'Status normalizado. previsao NÃO é faturamento — é recorrência ainda não emitida (66 mil títulos, R$ 229 mi).';

CREATE INDEX omie_titulo_situacao_idx ON core.omie_titulo (situacao, documento);
CREATE INDEX omie_titulo_doc_situacao_idx ON core.omie_titulo (documento, situacao, vencimento DESC);

GRANT SELECT ON core.omie_categoria TO pulse_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON core.omie_categoria TO pulse_worker;

COMMIT;
