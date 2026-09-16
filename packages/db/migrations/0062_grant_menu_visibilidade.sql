-- 0062 — o GRANT que faltou em ops.menu_visibilidade (corrige a 0060).
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ A 0060 criou a tabela e ESQUECEU de dar acesso ao `pulse_api` — o papel com  │
-- │ que a aplicação conecta. O padrão da casa é GRANT explícito por tabela       │
-- │ (ver 0021, 0022, …), e sem ele o `pulse_api` não lê nem escreve.             │
-- │                                                                            │
-- │ O efeito medido: a tela Configurações → Acesso do menu grava override, mas   │
-- │ o `menu-visivel.ts` não conseguia LER de volta (permission denied). Como o    │
-- │ read roda em toda página, ele era engolido e o override simplesmente nunca    │
-- │ valia — o menu só respeitava o status estático de `menu.ts`.                  │
-- └───────────────────────────────────────────────────────────────────────────┘

BEGIN;

-- SELECT: `menu-visivel.ts` e a tela de admin leem. INSERT/UPDATE: `acoes.ts`
-- faz upsert do override. DELETE: para o dia em que a tela remover um override.
GRANT SELECT, INSERT, UPDATE, DELETE ON ops.menu_visibilidade TO pulse_api;

COMMIT;
