-- ============================================================================
-- 0036 · O Omie dentro do Pulse: ficha do cliente e histórico de faturamento
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ POR QUE COPIAR, E NÃO LER AO VIVO                                          │
-- │                                                                            │
-- │ Duas razões independentes, e cada uma bastaria.                            │
-- │                                                                            │
-- │ 1. A superfície web conecta como `pulse_api`, e a 0016 deu a ela SELECT por │
-- │    COLUNA em `ops.segredo` — tudo menos `valor_cifrado`. A aplicação web    │
-- │    não decifra segredo, de propósito: ela é a superfície exposta, e um furo │
-- │    ali não pode virar exfiltração das credenciais de integração. Logo, a    │
-- │    página não tem como falar com o Omie. Quem fala é o worker.              │
-- │                                                                            │
-- │ 2. Medido em 13/08/2026: são 124.079 lançamentos a receber, e a base de     │
-- │    clientes do Omie tem 9.630 fichas. Uma varredura completa leva ~15 min.  │
-- │    Nenhuma página abre em cima disso, com credencial ou sem.                │
-- │                                                                            │
-- │ O RECORTE é por DOCUMENTO — CNPJ ou CPF —, e não por `account_id`. Medido:  │
-- │ dos 1.671 clientes com a tag `Cliente` no Omie, 1.457 são CNPJ e 214 são    │
-- │ CPF, e NENHUM dos 214 CPF existe hoje em `core.account`. Amarrar a chave    │
-- │ estrangeira à conta descartaria 12,8% da base faturada no ato da carga.     │
-- │ O vínculo com a conta é uma consulta, não um pré-requisito da gravação.     │
-- └───────────────────────────────────────────────────────────────────────────┘
-- ============================================================================

BEGIN;

-- ═══ A ficha, como o Omie a devolve ═════════════════════════════════════════
CREATE TABLE core.omie_cliente (
  documento        text PRIMARY KEY,
  codigo_omie      bigint NOT NULL,
  razao_social     text NOT NULL,
  nome_fantasia    text,
  pessoa_fisica    boolean NOT NULL DEFAULT false,
  inativo          boolean NOT NULL DEFAULT false,
  email            text,
  contato          text,
  telefone         text,
  cidade           text,
  estado           text,
  -- `dInc`/`dAlt` do bloco `info`. Guardados como data porque é assim que se
  -- pergunta "quem entrou este mês", e texto dd/mm/aaaa ordena errado.
  cadastrado_em    date,
  alterado_em      date,
  -- Tags e características vêm como lista/dicionário e não têm esquema fixo: o
  -- Omie deixa a empresa criar o campo que quiser. Guardar em jsonb evita uma
  -- migration a cada característica nova — e já são sete: idHubspot, MRR, SETUP,
  -- Data de Cobrança, Limite de Vidas da Plataforma, Cobrar com base nos
  -- usuários, Data escolhida para repasse.
  tags             jsonb NOT NULL DEFAULT '[]'::jsonb,
  caracteristicas  jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Desnormalizados de `caracteristicas` porque são os dois que TODA consulta usa:
  -- o vínculo com o HubSpot e o MRR que o financeiro declara.
  hubspot_id       text GENERATED ALWAYS AS (caracteristicas->>'idHubspot') STORED,
  mrr_declarado    text GENERATED ALWAYS AS (caracteristicas->>'MRR') STORED,
  sincronizado_em  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT omie_cliente_documento_valido CHECK (documento ~ '^[0-9]{11}$' OR documento ~ '^[0-9]{14}$')
);

COMMENT ON TABLE core.omie_cliente IS
  'Ficha do cliente no Omie, por documento. Cópia mantida pelo ciclo C20 — a web não fala com o Omie (ver 0036).';
COMMENT ON COLUMN core.omie_cliente.documento IS
  'Só dígitos. CNPJ (14) ou CPF (11): 12,8% dos clientes faturados são CPF.';

CREATE INDEX omie_cliente_hubspot_idx ON core.omie_cliente (hubspot_id) WHERE hubspot_id IS NOT NULL;
CREATE INDEX omie_cliente_raiz_idx ON core.omie_cliente (left(documento, 8)) WHERE length(documento) = 14;
CREATE INDEX omie_cliente_tags_idx ON core.omie_cliente USING gin (tags);

-- ═══ O histórico de faturamento ═════════════════════════════════════════════
-- Vem de `financas/mf/ListarMovimentos` com `cNatureza=R`, e não de
-- `ListarContasReceber`: só o primeiro traz o que foi PAGO (`nValPago`), o que
-- está ABERTO (`nValAberto`) e a DATA do pagamento. O outro devolve o título e
-- silencia sobre a baixa — foi por isso que em 10/08 dei "valor recebido" e
-- "último recebimento" como indisponíveis na API. Estavam em outro endpoint.
CREATE TABLE core.omie_movimento (
  codigo_titulo    bigint PRIMARY KEY,
  documento        text NOT NULL,
  codigo_cliente   bigint,
  categoria        text,
  status           text,
  emissao          date,
  vencimento       date,
  previsao         date,
  pagamento        date,
  valor_centavos       bigint NOT NULL DEFAULT 0,
  pago_centavos        bigint NOT NULL DEFAULT 0,
  aberto_centavos      bigint NOT NULL DEFAULT 0,
  liquidado        text,
  sincronizado_em  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.omie_movimento IS
  'Lançamentos a receber do Omie (mf/ListarMovimentos, cNatureza=R). 124.079 em 13/08/2026.';
COMMENT ON COLUMN core.omie_movimento.valor_centavos IS
  'Centavos, inteiro. O Omie devolve float e somar float em dinheiro erra o centavo — o mesmo motivo de fact.mrr_event usar centavos.';

CREATE INDEX omie_movimento_documento_idx ON core.omie_movimento (documento, vencimento DESC);
CREATE INDEX omie_movimento_categoria_idx ON core.omie_movimento (categoria, vencimento);
CREATE INDEX omie_movimento_pagamento_idx ON core.omie_movimento (pagamento DESC) WHERE pagamento IS NOT NULL;
CREATE INDEX omie_movimento_aberto_idx ON core.omie_movimento (documento) WHERE aberto_centavos > 0;

-- ═══ Grants ═════════════════════════════════════════════════════════════════
-- O worker escreve, a web só lê. É a mesma divisão do resto de `core`, e aqui ela
-- tem peso extra: a web não tem credencial do Omie, então não teria como escrever
-- coisa correta nem se quisesse.
GRANT SELECT ON core.omie_cliente, core.omie_movimento TO pulse_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON core.omie_cliente, core.omie_movimento TO pulse_worker;

COMMIT;
