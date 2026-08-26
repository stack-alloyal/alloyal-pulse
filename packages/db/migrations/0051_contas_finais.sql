-- ============================================================================
-- 0051 · A contagem de contas da cascata: observada, não encadeada
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ O DEFEITO só apareceu quando a cascata ganhou dado.                        │
-- │                                                                            │
-- │ A tela mostrava "161 contas" no MRR final de julho de 2026, e a competência │
-- │ tem 348. A conta exibida era encadeada — `contas_iniciais + contas_novas −  │
-- │ contas_perdidas` — e nessa soma REATIVAÇÃO NÃO ENTRA: `contas_novas` conta  │
-- │ só eventos do tipo `novo`.                                                 │
-- │                                                                            │
-- │ Então cada par churn → reativação decrementa a contagem PARA SEMPRE. Com    │
-- │ ~20 churns e ~10 reativações por mês ao longo de 67 competências, a deriva  │
-- │ chegou a mais da metade. O valor em reais sempre esteve certo — reativação  │
-- │ soma no MRR —, e foi por isso que ninguém viu: o número grande fechava e o  │
-- │ pequeno, ao lado dele, mentia.                                             │
-- │                                                                            │
-- │ Contar reativação em `contas_novas` seria a correção errada: a coluna diz    │
-- │ "contas novas" e conta nova é conta que nunca existiu. Somar as duas apaga   │
-- │ a diferença entre conquistar e reconquistar, que é a distinção que a         │
-- │ reativação existe para carregar.                                            │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- A coluna nova é OBSERVADA, da mesma fonte do `mrr_final_centavos`, e é por isso
-- que ela não deriva: as duas respondem "quantas contas e quanto de MRR havia no
-- fim deste mês", olhando a base em vez de somar movimentos. O encadeamento
-- continua nas colunas de movimento, onde ele é a narrativa do mês.
-- ============================================================================

BEGIN;

ALTER TABLE analytics.monthly_close
  ADD COLUMN contas_finais integer;

COMMENT ON COLUMN analytics.monthly_close.contas_finais IS
  'Quantas contas tinham MRR no fim da competencia, OBSERVADO na mesma fonte do mrr_final_centavos. Nao e contas_iniciais + novas - perdidas: essa soma ignora reativacao e deriva para baixo um par churn/reativacao por vez -- chegou a mostrar 161 contas onde havia 348. Nulo em competencia fechada antes desta migracao.';

COMMIT;
