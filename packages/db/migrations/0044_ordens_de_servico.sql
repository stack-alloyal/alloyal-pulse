-- ============================================================================
-- 0044 · Ordens de serviço: o que exatamente foi cobrado
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ O título a receber diz QUANTO e QUANDO, e sobre O QUÊ diz apenas um código  │
-- │ de categoria — `1.01.03`. A ordem de serviço diz o resto, em português:     │
-- │ "Manutenção do App Anuidade Zero".                                         │
-- │                                                                            │
-- │ São 22.444 OS na conta, e elas trazem três coisas que o título não tem:     │
-- │                                                                            │
-- │ · a DESCRIÇÃO do serviço, item a item;                                     │
-- │ · se foi FATURADA e se foi CANCELADA, com as datas de cada uma — e as duas  │
-- │   coisas coexistem: na amostra, 5 de 50 estão faturadas E canceladas;       │
-- │ · a etapa em que parou.                                                    │
-- │                                                                            │
-- │ DUAS TABELAS porque a OS tem mais de um serviço — a maioria tem um, algumas  │
-- │ têm dois. Achatar numa coluna só perderia justamente o caso em que a        │
-- │ pergunta "o que foi cobrado aqui?" é interessante.                          │
-- │                                                                            │
-- │ `cancelada` e `faturada` são booleanos separados, e não um estado único: no  │
-- │ Omie são dois campos independentes (`cCancelada`, `cFaturada`), e colapsá-los│
-- │ numa enumeração obrigaria a inventar um nome para a combinação das duas.    │
-- └───────────────────────────────────────────────────────────────────────────┘
-- ============================================================================

BEGIN;

CREATE TABLE core.omie_os (
  codigo           bigint PRIMARY KEY,
  numero           text,
  codigo_cliente   bigint,
  -- Resolvido contra `core.omie_cliente` na gravação: a OS traz só o código, e o
  -- documento é a chave por onde tudo neste sistema se liga.
  documento        text,
  etapa            text,
  cancelada        boolean NOT NULL DEFAULT false,
  faturada         boolean NOT NULL DEFAULT false,
  previsao         date,
  incluida_em      date,
  faturada_em      date,
  cancelada_em     date,
  valor_centavos   bigint NOT NULL DEFAULT 0,
  categoria        text,
  sincronizado_em  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.omie_os IS
  'Ordens de serviço do Omie. É onde está a descrição do que foi cobrado — o título só tem o código da categoria (ver 0044).';
COMMENT ON COLUMN core.omie_os.cancelada IS
  'Independente de `faturada`: na amostra, 5 de 50 OS estão faturadas E canceladas.';

CREATE INDEX omie_os_documento_idx ON core.omie_os (documento, previsao DESC);
CREATE INDEX omie_os_cliente_idx ON core.omie_os (codigo_cliente);
CREATE INDEX omie_os_faturada_idx ON core.omie_os (faturada, cancelada);

CREATE TABLE core.omie_os_servico (
  os_codigo        bigint NOT NULL REFERENCES core.omie_os(codigo) ON DELETE CASCADE,
  sequencia        smallint NOT NULL,
  descricao        text,
  categoria        text,
  codigo_servico   bigint,
  quantidade       numeric(14,4),
  valor_unitario_centavos bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (os_codigo, sequencia)
);

COMMENT ON TABLE core.omie_os_servico IS
  'Itens da ordem de serviço. Tabela separada porque uma OS tem mais de um serviço — achatar perderia o caso em que a pergunta é interessante.';

CREATE INDEX omie_os_servico_categoria_idx ON core.omie_os_servico (categoria);

GRANT SELECT ON core.omie_os, core.omie_os_servico TO pulse_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON core.omie_os, core.omie_os_servico TO pulse_worker;

COMMIT;
