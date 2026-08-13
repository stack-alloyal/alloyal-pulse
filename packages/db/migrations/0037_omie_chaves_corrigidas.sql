-- ============================================================================
-- 0037 · As chaves da 0036 estavam erradas, e só os dados reais mostraram
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ A 0036 assumiu duas coisas que a carga desmentiu no ato:                   │
-- │                                                                            │
-- │ 1. `documento` como chave primária do cliente. Das 9.622 fichas com CNPJ ou │
-- │    CPF, só 6.989 documentos são distintos: 1.624 se repetem. CEMIG          │
-- │    DISTRIBUICAO aparece com dois códigos Omie, e não é erro de cadastro —   │
-- │    é como a empresa opera. Chave é `codigo_cliente_omie`, que é único;      │
-- │    `documento` vira coluna indexada, porque continua sendo o que liga ao    │
-- │    Pulse.                                                                  │
-- │                                                                            │
-- │ 2. `nCodTitulo` como chave do movimento. São 124.079 linhas para 93.624     │
-- │    títulos. `ListarMovimentos` devolve UMA LINHA POR MOVIMENTO: a linha do  │
-- │    título e as linhas de BAIXA, misturadas.                                │
-- │                                                                            │
-- │ RECONCILIADO contra `ListarContasReceber`, que é a fonte definitiva de      │
-- │ título, num cliente ativo de 17 títulos:                                    │
-- │                                                                            │
-- │   ListarContasReceber ....... 17 títulos · R$ 5.622,82                     │
-- │   movimentos com valor > 0 ... 17 títulos · R$ 5.622,82 — os MESMOS códigos │
-- │   soma de `pago` nos títulos . R$ 3.578,25                                  │
-- │   os 8 títulos RECEBIDO ...... R$ 3.578,25  ← bate exatamente               │
-- │   soma de `pago` nas baixas .. R$ 3.596,12  ← R$ 17,87 a mais: juros        │
-- │                                                                            │
-- │ Logo: TÍTULO é a linha com `valor > 0`, e o `pago` dela é o valor liquidado.│
-- │ As linhas com `valor = 0` são movimento de caixa — 33.825 delas, e as 8.751 │
-- │ sem código de título estão todas aí.                                        │
-- │                                                                            │
-- │ Somar `pago` em TODAS as linhas conta o recebimento duas vezes. Eu fiz isso │
-- │ e cheguei a R$ 562 milhões recebidos numa base que faturou R$ 526 milhões — │
-- │ o número impossível é que denunciou o erro.                                 │
-- │                                                                            │
-- │ 3. E `00000000000` passava no CHECK de CPF. São 78 fichas: "Cliente         │
-- │    Consumidor", GitHub, Slack, Mapbox, Notion — fornecedor de SaaS lançado  │
-- │    como cliente sem documento. Agrupá-los sob um documento faria 78         │
-- │    empresas virarem uma.                                                    │
-- │                                                                            │
-- │ As tabelas estão vazias (1 linha de teste), então a 0037 as recria em vez   │
-- │ de remendar. A 0036 fica no histórico com o desenho que a medição derrubou. │
-- └───────────────────────────────────────────────────────────────────────────┘
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS core.omie_movimento;
DROP TABLE IF EXISTS core.omie_cliente;

-- ═══ A ficha ════════════════════════════════════════════════════════════════
CREATE TABLE core.omie_cliente (
  codigo_omie      bigint PRIMARY KEY,
  -- Só dígitos, e NÃO único: 1.624 documentos se repetem entre fichas.
  documento        text NOT NULL,
  razao_social     text NOT NULL,
  nome_fantasia    text,
  pessoa_fisica    boolean NOT NULL DEFAULT false,
  inativo          boolean NOT NULL DEFAULT false,
  email            text,
  contato          text,
  telefone         text,
  cidade           text,
  estado           text,
  cadastrado_em    date,
  alterado_em      date,
  tags             jsonb NOT NULL DEFAULT '[]'::jsonb,
  caracteristicas  jsonb NOT NULL DEFAULT '{}'::jsonb,
  hubspot_id       text GENERATED ALWAYS AS (caracteristicas->>'idHubspot') STORED,
  mrr_declarado    text GENERATED ALWAYS AS (caracteristicas->>'MRR') STORED,
  sincronizado_em  timestamptz NOT NULL DEFAULT now(),

  -- Documento válido E não-degenerado. `00000000000` e `00000000000000` têm o
  -- formato certo e não identificam ninguém.
  CONSTRAINT omie_cliente_documento_valido CHECK (
    (documento ~ '^[0-9]{11}$' OR documento ~ '^[0-9]{14}$')
    AND documento !~ '^0+$'
  )
);

COMMENT ON TABLE core.omie_cliente IS
  'Ficha do cliente no Omie. Chave é o código do Omie: 1.624 documentos se repetem entre fichas (ver 0037).';

CREATE INDEX omie_cliente_documento_idx ON core.omie_cliente (documento);
CREATE INDEX omie_cliente_raiz_idx ON core.omie_cliente (left(documento, 8)) WHERE length(documento) = 14;
CREATE INDEX omie_cliente_hubspot_idx ON core.omie_cliente (hubspot_id) WHERE hubspot_id IS NOT NULL;
CREATE INDEX omie_cliente_tags_idx ON core.omie_cliente USING gin (tags);

-- ═══ O título ═══════════════════════════════════════════════════════════════
-- Só as linhas com `valor > 0`. Ver o cabeçalho: são elas que reconciliam com
-- `ListarContasReceber`, título a título e centavo a centavo.
CREATE TABLE core.omie_titulo (
  codigo_titulo    bigint PRIMARY KEY,
  documento        text NOT NULL,
  codigo_cliente   bigint,
  categoria        text,
  status           text,
  emissao          date,
  vencimento       date,
  previsao         date,
  pagamento        date,
  valor_centavos   bigint NOT NULL DEFAULT 0,
  pago_centavos    bigint NOT NULL DEFAULT 0,
  aberto_centavos  bigint NOT NULL DEFAULT 0,
  liquidado        text,
  sincronizado_em  timestamptz NOT NULL DEFAULT now(),

  -- Título com valor zero é linha de baixa entrando no lugar errado. O banco
  -- recusa em vez de deixar a soma de faturamento ficar certa por acaso.
  CONSTRAINT omie_titulo_tem_valor CHECK (valor_centavos > 0),
  CONSTRAINT omie_titulo_documento_valido CHECK (
    (documento ~ '^[0-9]{11}$' OR documento ~ '^[0-9]{14}$') AND documento !~ '^0+$'
  )
);

COMMENT ON TABLE core.omie_titulo IS
  'Títulos a receber do Omie (mf/ListarMovimentos, cNatureza=R, valor>0). Reconciliado com ListarContasReceber — ver 0037.';
COMMENT ON COLUMN core.omie_titulo.pago_centavos IS
  'Valor liquidado do título. Confere com o status RECEBIDO no ListarContasReceber. NÃO inclui juros — estes aparecem na linha de baixa, que esta tabela não guarda.';

CREATE INDEX omie_titulo_documento_idx ON core.omie_titulo (documento, vencimento DESC);
CREATE INDEX omie_titulo_categoria_idx ON core.omie_titulo (categoria, vencimento);
CREATE INDEX omie_titulo_pagamento_idx ON core.omie_titulo (pagamento DESC) WHERE pagamento IS NOT NULL;
CREATE INDEX omie_titulo_aberto_idx ON core.omie_titulo (documento) WHERE aberto_centavos > 0;

GRANT SELECT ON core.omie_cliente, core.omie_titulo TO pulse_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON core.omie_cliente, core.omie_titulo TO pulse_worker;

COMMIT;
