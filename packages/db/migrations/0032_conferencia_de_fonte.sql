-- ============================================================================
-- 0032 · Fila de conferência: quando duas fontes discordam sobre o mesmo campo
--
-- MEDIDO em 10/08/2026, cruzando a API viva da Lecupon com o `idHubspot` das fichas
-- Cliente do Omie (1.455 consultas, uma por ficha — o Omie não tem método em lote):
--
--    824  mesmo HubSpot ID nos dois          94,9% de concordância
--     44  IDs DIFERENTES nos dois            ← esta tabela
--     11  só no Omie
--     30  só na Lecupon
--    207  em nenhum dos dois
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ A decisão de produto é "Lecupon vence" — ela é o sistema do produto e o que │
-- │ alimenta o Pulse. Mas vencer NÃO É a mesma coisa que estar certa: em 44     │
-- │ contas os dois lados apontam para empresas diferentes no HubSpot, e uma das │
-- │ duas está errada em cada caso.                                             │
-- │                                                                            │
-- │ Aplicar a regra e jogar o outro valor fora transformaria 44 erros CONHECIDOS│
-- │ em 44 erros silenciosos. A fila existe para o conflito continuar visível    │
-- │ depois de a regra ter sido aplicada.                                       │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- GENÉRICA NO CAMPO de propósito. Hoje só `hubspot_company_id` diverge, mas razão
-- social, CNPJ e situação vão divergir assim que mais fontes entrarem — e uma tabela
-- por campo seria a mesma estrutura copiada, que é como as cópias divergem.
-- ============================================================================

BEGIN;

CREATE TABLE core.conferencia_fonte (
  id            bigserial PRIMARY KEY,
  account_id    uuid NOT NULL REFERENCES core.account(id),
  campo         text NOT NULL,

  -- Os valores COMO ESTAVAM quando o conflito foi detectado. Guardados, e não
  -- consultados na hora de exibir: um valor que muda entre a detecção e a leitura faz
  -- a fila mostrar um conflito que já não existe, ou esconder um que existe.
  valor_lecupon text,
  valor_omie    text,
  detectado_em  timestamptz NOT NULL DEFAULT now(),

  estado        text NOT NULL DEFAULT 'aberta',
  -- Qual fonte a pessoa confirmou. `nenhum` é resposta válida: quando as duas estão
  -- erradas, forçar a escolha de uma delas grava um dado que ninguém conferiu.
  decisao       text,
  nota          text,
  decidido_por  text,
  decidido_em   timestamptz,

  CONSTRAINT conferencia_estado CHECK (estado IN ('aberta','resolvida','ignorada')),
  CONSTRAINT conferencia_decisao CHECK (decisao IS NULL OR decisao IN ('lecupon','omie','nenhum')),

  -- Resolver exige dizer QUEM e O QUÊ. Sem isto, "resolvida" vira um estado que
  -- alguém marcou e ninguém consegue explicar seis meses depois.
  CONSTRAINT conferencia_resolvida_tem_autor CHECK (
    estado = 'aberta' OR (decisao IS NOT NULL AND decidido_por IS NOT NULL AND decidido_em IS NOT NULL)
  ),

  -- Ignorar também pede motivo escrito: é a saída mais fácil da fila, e a que some
  -- sem deixar rastro se não for justificada.
  CONSTRAINT conferencia_ignorada_tem_motivo CHECK (
    estado <> 'ignorada' OR (nota IS NOT NULL AND length(trim(nota)) >= 10)
  )
);

-- Um conflito ABERTO por conta e campo. Sem isto, cada execução do detector
-- empilharia a mesma divergência de novo e a fila cresceria sozinha.
CREATE UNIQUE INDEX conferencia_uma_aberta_idx
  ON core.conferencia_fonte (account_id, campo)
  WHERE estado = 'aberta';

CREATE INDEX conferencia_abertas_idx ON core.conferencia_fonte (campo, detectado_em)
  WHERE estado = 'aberta';

COMMENT ON TABLE core.conferencia_fonte IS
  'Divergência entre fontes sobre o mesmo campo da mesma conta. A regra de precedência '
  '(Lecupon vence) já foi aplicada ao valor gravado em core.account; esta tabela existe '
  'para o conflito não desaparecer junto com a aplicação da regra.';

COMMENT ON COLUMN core.conferencia_fonte.decisao IS
  'lecupon | omie | nenhum. `nenhum` significa que as DUAS estão erradas e a conta fica '
  'sem vínculo até alguém descobrir o valor certo — é resposta honesta, não indecisão.';

GRANT SELECT, INSERT, UPDATE ON core.conferencia_fonte TO pulse_api;
GRANT SELECT, INSERT ON core.conferencia_fonte TO pulse_worker;
GRANT USAGE, SELECT ON SEQUENCE core.conferencia_fonte_id_seq TO pulse_api, pulse_worker;

COMMIT;
