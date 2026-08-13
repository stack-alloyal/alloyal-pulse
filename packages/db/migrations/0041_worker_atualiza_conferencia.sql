-- ============================================================================
-- 0041 · O worker precisa ATUALIZAR a fila de conferência
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ A 0032 deu ao worker SELECT e INSERT em `core.conferencia_fonte`, e na época │
-- │ estava certo: a fila era populada por script e resolvida por gente.         │
-- │                                                                            │
-- │ Depois o C20 passou a REALIMENTAR a fila, e isso exige UPDATE em dois       │
-- │ pontos: `registrarDivergencia` usa `ON CONFLICT DO UPDATE` para refrescar o  │
-- │ par de valores quando um dos lados mudou, e `reconciliarConferencia` encerra │
-- │ o item quando as fontes voltam a concordar.                                │
-- │                                                                            │
-- │ O sintoma foi cruel: o ciclo varria 17 minutos, GRAVAVA os 90.041 títulos   │
-- │ com sucesso, e só então morria na última linha — "tentativa 1/3 falhou".    │
-- │ Todo o trabalho pesado feito, e a execução registrada como falha.           │
-- │                                                                            │
-- │ A lição que fica no código, e não neste comentário: quando um ciclo ganha   │
-- │ um passo novo que escreve, o GRANT é parte do passo — não detalhe posterior.│
-- └───────────────────────────────────────────────────────────────────────────┘
-- ============================================================================

BEGIN;

GRANT UPDATE ON core.conferencia_fonte TO pulse_worker;
GRANT USAGE, SELECT ON SEQUENCE core.conferencia_fonte_id_seq TO pulse_worker;

COMMIT;
