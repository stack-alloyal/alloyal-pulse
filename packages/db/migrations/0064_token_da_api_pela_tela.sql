-- 0064 — o token da API passa a ser emitido pela tela de Configurações.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ DUAS MUDANÇAS, e a segunda reverte uma decisão da 0061 — de propósito.       │
-- │                                                                            │
-- │ 1. `responsavel`: o e-mail interno de quem RESPONDE pelo token. Token é      │
-- │    credencial de serviço, não pessoa; o que o amarra a gente é este campo.   │
-- │    É o que permite, quando alguém sai, perguntar "que tokens eram dele?" e   │
-- │    ter resposta. Nulo só nas linhas antigas, emitidas pelo CLI.              │
-- │                                                                            │
-- │ 2. INSERT para `pulse_api`. A 0061 negou de propósito ("quem serve a API não │
-- │    cunha a própria chave"). O admin pediu o fluxo de emissão em Configurações│
-- │    só para pulse-admin — e a aplicação conecta como `pulse_api`. A barreira   │
-- │    deixa de ser o banco e passa a ser a aplicação: Server Action atrás de     │
-- │    `configurar`, motivo obrigatório e trilha em `ops.mudanca`. As rotas       │
-- │    /api/v1 seguem sem NENHUM caminho de código que emita token. DELETE        │
-- │    continua negado: revogar é preencher `revogado_em`, nunca apagar.          │
-- └───────────────────────────────────────────────────────────────────────────┘

BEGIN;

ALTER TABLE ops.api_token ADD COLUMN responsavel text;

COMMENT ON COLUMN ops.api_token.responsavel IS
  'E-mail interno de quem responde pelo token. Obrigatório na emissão pela tela; '
  'nulo nas emissões antigas pelo CLI.';

GRANT INSERT ON ops.api_token TO pulse_api;

-- A trilha. `ops.mudanca` só aceitava configuracao/segredo/papel; token entra
-- como quarto tipo, e herda a regra de motivo obrigatório (≥ 10 caracteres).
ALTER TABLE ops.mudanca DROP CONSTRAINT mudanca_tipo;
ALTER TABLE ops.mudanca ADD CONSTRAINT mudanca_tipo
  CHECK (tipo = ANY (ARRAY['configuracao'::text, 'segredo'::text, 'papel'::text, 'api_token'::text]));

COMMIT;
