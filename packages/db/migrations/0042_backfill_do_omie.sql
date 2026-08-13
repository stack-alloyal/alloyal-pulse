-- ============================================================================
-- 0042 · O resto do Omie: contratos, vendedores e baixas
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ INVENTÁRIO do que a API oferece e o Pulse ainda não tinha baixado, medido   │
-- │ em 13/08/2026:                                                             │
-- │                                                                            │
-- │   contratos de serviço ..... 2.231                                          │
-- │   movimentos a pagar ....... 72.564                                         │
-- │   contas a pagar ........... 29.223                                         │
-- │   baixas a receber ......... ~34.039  (as linhas com valor 0 do mf)         │
-- │   vendedores ............... 35                                             │
-- │   produtos ................. 0                                              │
-- │                                                                            │
-- │ CONTRATO É O ACHADO. O Pulse mostra MRR zerado desde o começo — não há um    │
-- │ único contrato em `contracts`. E o Omie tem 2.231, cada um com              │
-- │ `nValTotMes`: o valor mensal. É MRR na fonte, não uma reconstrução a partir │
-- │ de títulos. O cabeçalho ainda traz vigência inicial e final, situação e dia  │
-- │ de faturamento — que é o que uma tela de renovação precisa.                 │
-- │                                                                            │
-- │ E `infAdic.nCodVend` é o VENDEDOR, que estava na lista original de campos   │
-- │ pedidos e não existe no cadastro do cliente. Ele mora no contrato.          │
-- │                                                                            │
-- │ BAIXAS são as linhas de `mf/ListarMovimentos` com `nValorTitulo = 0`, que a │
-- │ 0037 manda descartar por não serem título. Elas carregam o que o título não │
-- │ tem: juros, multa, desconto e a data real do dinheiro. Guardá-las separadas │
-- │ mantém a soma do faturamento intacta e responde "quanto entrou de verdade". │
-- │                                                                            │
-- │ CONTAS A PAGAR ficam de fora desta migration, de propósito. São 100 mil     │
-- │ registros de despesa, não descrevem cliente nenhum, e nenhuma tela pedida   │
-- │ até aqui os usa. Entram quando houver a pergunta que eles respondem.        │
-- └───────────────────────────────────────────────────────────────────────────┘
-- ============================================================================

BEGIN;

-- ═══ Vendedores ═════════════════════════════════════════════════════════════
CREATE TABLE core.omie_vendedor (
  codigo           bigint PRIMARY KEY,
  nome             text NOT NULL,
  email            text,
  comissao         numeric(6,3),
  inativo          boolean NOT NULL DEFAULT false,
  sincronizado_em  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.omie_vendedor IS
  'Vendedores do Omie. O vínculo com o cliente vem pelo CONTRATO (infAdic.nCodVend), não pelo cadastro.';

-- ═══ Contratos ══════════════════════════════════════════════════════════════
CREATE TABLE core.omie_contrato (
  codigo             bigint PRIMARY KEY,
  numero             text,
  codigo_cliente     bigint,
  -- Desnormalizado do cliente para a consulta não precisar de dois saltos: é a
  -- chave por onde tudo neste sistema se liga.
  documento          text,
  situacao           text,
  vigencia_inicio    date,
  vigencia_fim       date,
  dia_faturamento    smallint,
  tipo_faturamento   text,
  -- O valor MENSAL do contrato. É MRR na fonte.
  valor_mensal_centavos bigint NOT NULL DEFAULT 0,
  codigo_vendedor    bigint,
  categoria          text,
  sincronizado_em    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.omie_contrato IS
  'Contratos de serviço do Omie. `valor_mensal_centavos` é o MRR declarado na fonte — o Pulse mostrava MRR zero por não ter contrato nenhum (ver 0042).';
COMMENT ON COLUMN core.omie_contrato.valor_mensal_centavos IS
  'nValTotMes em centavos. Somar float em dinheiro erra o centavo — mesma razão de fact.mrr_event.';

CREATE INDEX omie_contrato_documento_idx ON core.omie_contrato (documento);
CREATE INDEX omie_contrato_cliente_idx ON core.omie_contrato (codigo_cliente);
CREATE INDEX omie_contrato_situacao_idx ON core.omie_contrato (situacao);
CREATE INDEX omie_contrato_vendedor_idx ON core.omie_contrato (codigo_vendedor);

-- ═══ Baixas ═════════════════════════════════════════════════════════════════
-- Chave composta porque um título recebe mais de uma baixa (parcial, juros
-- lançado à parte), e `nCodTitulo` sozinho não distingue. Sem a data no meio, a
-- segunda baixa sobrescreveria a primeira e o total recebido encolheria.
CREATE TABLE core.omie_baixa (
  codigo_titulo    bigint NOT NULL,
  pagamento        date,
  documento        text NOT NULL,
  pago_centavos    bigint NOT NULL DEFAULT 0,
  juros_centavos   bigint NOT NULL DEFAULT 0,
  multa_centavos   bigint NOT NULL DEFAULT 0,
  desconto_centavos bigint NOT NULL DEFAULT 0,
  categoria        text,
  sincronizado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (codigo_titulo, pagamento, pago_centavos)
);

COMMENT ON TABLE core.omie_baixa IS
  'Movimentos de caixa a receber (mf, valor de título zero). Carrega juros, multa e a data real do dinheiro — o que o título não tem.';

CREATE INDEX omie_baixa_documento_idx ON core.omie_baixa (documento, pagamento DESC);

GRANT SELECT ON core.omie_vendedor, core.omie_contrato, core.omie_baixa TO pulse_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON core.omie_vendedor, core.omie_contrato, core.omie_baixa TO pulse_worker;

COMMIT;
