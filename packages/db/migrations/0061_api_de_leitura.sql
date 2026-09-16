-- 0061 — o token de serviço da API de leitura (/api/v1).
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ POR QUE ESTA TABELA EXISTE.                                                │
-- │                                                                            │
-- │ A superfície interna é gated pelo oauth2-proxy: sessão Google verificada    │
-- │ pela casa. Um ETL que roda em batch não tem sessão de navegador — precisa   │
-- │ de um segredo portável. Este é o token de serviço: só leitura, revogável,   │
-- │ e escopo trancado no banco (`escopo = 'leitura'`), não só na aplicação.     │
-- │                                                                            │
-- │ GUARDA O HASH, NUNCA O TOKEN. Vaza a tabela, não vaza acesso: o que entra    │
-- │ na coluna é o SHA-256 do token, e o token cru só existe uma vez, no momento  │
-- │ da emissão. É o mesmo princípio do `ops.segredo`, levado ao token.          │
-- └───────────────────────────────────────────────────────────────────────────┘

BEGIN;

CREATE TABLE ops.api_token (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Para quem/para quê. "ETL de conciliação — Fulano" é o que permite revogar o
  -- token certo sem derrubar os outros.
  descricao     text NOT NULL,
  -- SHA-256 hex do token cru (com o prefixo `pulse_`). Único: dois tokens não
  -- colidem, e a busca no login é por igualdade exata deste hash.
  token_sha256  text NOT NULL UNIQUE,
  -- Trancado em 'leitura' pelo CHECK: a promessa de só-leitura é do banco, não
  -- de uma lembrança de quem escreve a rota. Ampliar exige migração — de novo.
  escopo        text NOT NULL DEFAULT 'leitura' CHECK (escopo = 'leitura'),
  criado_por    text NOT NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  -- Nulo = não expira. Um token com prazo é preferível, mas não obrigatório.
  expira_em     timestamptz,
  -- Revogar é preencher isto. Mantém a linha para a auditoria de "quem usou até
  -- quando", em vez de apagar e perder o rastro.
  revogado_em   timestamptz,
  revogado_por  text,
  -- Best-effort: a rota atualiza sem bloquear a leitura. Serve para achar token
  -- morto ("ninguém usa desde março") sem virar escrita no caminho quente.
  ultimo_uso_em timestamptz
);

COMMENT ON TABLE ops.api_token IS
  'Token de serviço da API de leitura /api/v1. Guarda o SHA-256 do token, nunca '
  'o token cru. Só-leitura (escopo trancado no CHECK) e revogável (revogado_em).';

-- A aplicação conecta como `pulse_api`. Ela CONFERE o token (SELECT) e marca o
-- último uso (UPDATE) — nada mais. Emitir e revogar é ato de admin, feito pelo
-- CLI com o papel dono, então `pulse_api` de propósito NÃO tem INSERT/DELETE:
-- quem serve a API não pode cunhar a própria chave.
GRANT SELECT, UPDATE ON ops.api_token TO pulse_api;

COMMIT;
