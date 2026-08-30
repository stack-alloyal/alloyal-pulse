-- ============================================================================
-- 0053 · A tela precisa poder DEFINIR a meta
--
-- A 0052 deu só SELECT em `success.meta_churn` para `pulse_api`, e `pulse_api` é
-- justamente o papel com que a aplicação web escreve: `success.cancellation` e
-- `success.work_item` têm INSERT e UPDATE para ele, e é assim que o fluxo de
-- saídas grava hoje.
--
-- Com SELECT só, a tela de meta abriria e o botão de salvar devolveria "permission
-- denied" — e o erro apareceria na primeira vez que alguém tentasse usar, não no
-- deploy. Sem DELETE, pelo mesmo motivo das outras duas: a aplicação nunca apaga
-- linha de decisão. Meta errada se corrige por UPDATE, com autor e data novos.
-- ============================================================================

BEGIN;

GRANT INSERT, UPDATE ON success.meta_churn TO pulse_api;

COMMIT;
