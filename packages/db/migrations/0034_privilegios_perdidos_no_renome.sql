-- ============================================================================
-- 0034 · Devolve os privilégios que a 0033 apagou junto com o role antigo
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ A 0033 transferiu para `pulse_*` os GRANTs de esquema da 0001 e removeu os │
-- │ `ops_*`. Faltou o resto: as migrations 0002 a 0016 são ANTERIORES ao renome │
-- │ e concedem, tabela a tabela, para os nomes antigos. Num banco novo esses    │
-- │ grants caem no `ops_*` recriado — e o `DROP OWNED BY` da 0033 os levou      │
-- │ embora. Medido: 202 privilégios a menos que a produção, e nenhum a mais.    │
-- │                                                                            │
-- │ O caminho óbvio — repetir os comandos daquelas migrations com o nome novo — │
-- │ CONCEDE DEMAIS, e foi por isso descartado. A 0003 diz                       │
-- │ `GRANT SELECT ON ALL TABLES IN SCHEMA ops`, o que na época dela alcançou 7  │
-- │ tabelas; hoje `ops` tem 16. Entre as 9 novas está `ops.segredo`, onde a API │
-- │ grava mas DELIBERADAMENTE não lê — é o que impede que um furo na aplicação  │
-- │ devolva segredo cifrado. Repetir o comando hoje daria esse SELECT de volta. │
-- │                                                                            │
-- │ Por isso a lista abaixo é explícita e por objeto: cada `ALL TABLES` foi     │
-- │ expandido para os objetos que existiam NAQUELE ponto da cadeia. A coluna    │
-- │ `origem` diz de qual migration cada linha veio, e a ordem é a da cadeia —   │
-- │ o que importa porque a 0005 REVOGA de `pulse_api` o que a 0001 concedeu.    │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- IDEMPOTENTE: GRANT/REVOKE repetidos não mudam nada, e objeto ausente é pulado.
-- Em produção é no-op — o estado dela é o alvo que esta migration reproduz.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  g record;
  existe boolean;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
      (1, 'GRANT', 'SCHEMA', 'USAGE', 'core', 'pulse_api', '0001'),
      (2, 'GRANT', 'SCHEMA', 'USAGE', 'core', 'pulse_worker', '0001'),
      (3, 'GRANT', 'SCHEMA', 'USAGE', 'fact', 'pulse_api', '0001'),
      (4, 'GRANT', 'SCHEMA', 'USAGE', 'fact', 'pulse_worker', '0001'),
      (5, 'GRANT', 'SCHEMA', 'USAGE', 'metrics', 'pulse_api', '0001'),
      (6, 'GRANT', 'SCHEMA', 'USAGE', 'metrics', 'pulse_worker', '0001'),
      (7, 'GRANT', 'SCHEMA', 'USAGE', 'analytics', 'pulse_api', '0001'),
      (8, 'GRANT', 'SCHEMA', 'USAGE', 'analytics', 'pulse_worker', '0001'),
      (9, 'GRANT', 'SCHEMA', 'USAGE', 'ops', 'pulse_api', '0001'),
      (10, 'GRANT', 'SCHEMA', 'USAGE', 'ops', 'pulse_worker', '0001'),
      (11, 'GRANT', 'SCHEMA', 'USAGE', 'success', 'pulse_api', '0001'),
      (12, 'GRANT', 'SCHEMA', 'USAGE', 'success', 'pulse_worker', '0001'),
      (13, 'GRANT', 'SCHEMA', 'USAGE', 'public_v', 'pulse_worker', '0001'),
      (14, 'GRANT', 'SCHEMA', 'USAGE', 'public_v', 'pulse_portal', '0001'),
      (15, 'REVOKE', 'SCHEMA', 'ALL', 'core', 'pulse_portal', '0001'),
      (16, 'REVOKE', 'SCHEMA', 'ALL', 'fact', 'pulse_portal', '0001'),
      (17, 'REVOKE', 'SCHEMA', 'ALL', 'metrics', 'pulse_portal', '0001'),
      (18, 'REVOKE', 'SCHEMA', 'ALL', 'analytics', 'pulse_portal', '0001'),
      (19, 'REVOKE', 'SCHEMA', 'ALL', 'ops', 'pulse_portal', '0001'),
      (20, 'REVOKE', 'SCHEMA', 'ALL', 'success', 'pulse_portal', '0001'),
      (21, 'GRANT', 'TABLE', 'SELECT', 'core.account', 'pulse_api', '0002'),
      (22, 'GRANT', 'TABLE', 'SELECT', 'core.account_alias', 'pulse_api', '0002'),
      (23, 'GRANT', 'TABLE', 'SELECT', 'core.contract', 'pulse_api', '0002'),
      (24, 'GRANT', 'TABLE', 'SELECT', 'core.contract_product', 'pulse_api', '0002'),
      (25, 'GRANT', 'TABLE', 'SELECT', 'core.contact', 'pulse_api', '0002'),
      (26, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'core.account', 'pulse_worker', '0002'),
      (27, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'core.account_alias', 'pulse_worker', '0002'),
      (28, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'core.contract', 'pulse_worker', '0002'),
      (29, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'core.contract_product', 'pulse_worker', '0002'),
      (30, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'core.contact', 'pulse_worker', '0002'),
      (31, 'GRANT', 'TABLE', 'SELECT', 'fact.mrr_event', 'pulse_api', '0003'),
      (32, 'GRANT', 'TABLE', 'SELECT', 'fact.transaction_daily', 'pulse_api', '0003'),
      (33, 'GRANT', 'TABLE', 'SELECT', 'fact.activity', 'pulse_api', '0003'),
      (34, 'GRANT', 'TABLE', 'SELECT', 'ops.watermark', 'pulse_api', '0003'),
      (35, 'GRANT', 'TABLE', 'SELECT', 'ops.cycle_run', 'pulse_api', '0003'),
      (36, 'GRANT', 'TABLE', 'SELECT', 'ops.divergencia', 'pulse_api', '0003'),
      (37, 'GRANT', 'TABLE', 'SELECT', 'ops.audit', 'pulse_api', '0003'),
      (38, 'GRANT', 'TABLE', 'SELECT', 'ops.user_role', 'pulse_api', '0003'),
      (39, 'GRANT', 'TABLE', 'SELECT', 'ops.feature_flag', 'pulse_api', '0003'),
      (40, 'GRANT', 'TABLE', 'SELECT', 'ops.data_incident', 'pulse_api', '0003'),
      (41, 'GRANT', 'TABLE', 'INSERT', 'ops.audit', 'pulse_api', '0003'),
      (42, 'GRANT', 'TABLE', 'INSERT', 'ops.data_incident', 'pulse_api', '0003'),
      (43, 'GRANT', 'TABLE', 'UPDATE', 'ops.feature_flag', 'pulse_api', '0003'),
      (44, 'GRANT', 'TABLE', 'UPDATE', 'ops.data_incident', 'pulse_api', '0003'),
      (45, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'fact.mrr_event', 'pulse_worker', '0003'),
      (46, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'fact.transaction_daily', 'pulse_worker', '0003'),
      (47, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'fact.activity', 'pulse_worker', '0003'),
      (48, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'ops.watermark', 'pulse_worker', '0003'),
      (49, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'ops.cycle_run', 'pulse_worker', '0003'),
      (50, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'ops.divergencia', 'pulse_worker', '0003'),
      (51, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'ops.audit', 'pulse_worker', '0003'),
      (52, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'ops.user_role', 'pulse_worker', '0003'),
      (53, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'ops.feature_flag', 'pulse_worker', '0003'),
      (54, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'ops.data_incident', 'pulse_worker', '0003'),
      (55, 'GRANT', 'SEQUENCE', 'USAGE, SELECT', 'ops.cycle_run_id_seq', 'pulse_api', '0003'),
      (56, 'GRANT', 'SEQUENCE', 'USAGE, SELECT', 'ops.cycle_run_id_seq', 'pulse_worker', '0003'),
      (57, 'GRANT', 'SEQUENCE', 'USAGE, SELECT', 'ops.divergencia_id_seq', 'pulse_api', '0003'),
      (58, 'GRANT', 'SEQUENCE', 'USAGE, SELECT', 'ops.divergencia_id_seq', 'pulse_worker', '0003'),
      (59, 'GRANT', 'SEQUENCE', 'USAGE, SELECT', 'ops.audit_id_seq', 'pulse_api', '0003'),
      (60, 'GRANT', 'SEQUENCE', 'USAGE, SELECT', 'ops.audit_id_seq', 'pulse_worker', '0003'),
      (61, 'GRANT', 'SEQUENCE', 'USAGE, SELECT', 'ops.data_incident_id_seq', 'pulse_api', '0003'),
      (62, 'GRANT', 'SEQUENCE', 'USAGE, SELECT', 'ops.data_incident_id_seq', 'pulse_worker', '0003'),
      (63, 'GRANT', 'TABLE', 'SELECT', 'metrics.daily_snapshot', 'pulse_api', '0004'),
      (64, 'GRANT', 'TABLE', 'SELECT', 'metrics.signal', 'pulse_api', '0004'),
      (65, 'GRANT', 'TABLE', 'SELECT', 'metrics.signal_driver', 'pulse_api', '0004'),
      (66, 'GRANT', 'TABLE', 'SELECT', 'metrics.silent_churn_flag', 'pulse_api', '0004'),
      (67, 'GRANT', 'TABLE', 'SELECT', 'metrics.rfm_score', 'pulse_api', '0004'),
      (68, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE, DELETE', 'metrics.daily_snapshot', 'pulse_worker', '0004'),
      (69, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE, DELETE', 'metrics.signal', 'pulse_worker', '0004'),
      (70, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE, DELETE', 'metrics.signal_driver', 'pulse_worker', '0004'),
      (71, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE, DELETE', 'metrics.silent_churn_flag', 'pulse_worker', '0004'),
      (72, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE, DELETE', 'metrics.rfm_score', 'pulse_worker', '0004'),
      (73, 'GRANT', 'FUNCTION', 'EXECUTE', 'public_v.set_tenant(uuid)', 'pulse_portal', '0005'),
      (74, 'GRANT', 'FUNCTION', 'EXECUTE', 'public_v.set_tenant(uuid)', 'pulse_worker', '0005'),
      (75, 'GRANT', 'FUNCTION', 'EXECUTE', 'public_v.current_tenant()', 'pulse_portal', '0005'),
      (76, 'GRANT', 'FUNCTION', 'EXECUTE', 'public_v.current_tenant()', 'pulse_worker', '0005'),
      (77, 'GRANT', 'TABLE', 'SELECT', 'public_v.metric_daily', 'pulse_portal', '0005'),
      (78, 'GRANT', 'TABLE', 'SELECT', 'public_v.benchmark_monthly', 'pulse_portal', '0005'),
      (79, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE, DELETE', 'public_v.metric_daily', 'pulse_worker', '0005'),
      (80, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE, DELETE', 'public_v.benchmark_monthly', 'pulse_worker', '0005'),
      (81, 'REVOKE', 'TABLE', 'ALL', 'public_v.metric_daily', 'pulse_api', '0005'),
      (82, 'REVOKE', 'TABLE', 'ALL', 'public_v.benchmark_monthly', 'pulse_api', '0005'),
      (83, 'REVOKE', 'SCHEMA', 'USAGE', 'public_v', 'pulse_api', '0005'),
      (84, 'GRANT', 'TABLE', 'SELECT', 'ops.excecao_referencia', 'pulse_api', '0006'),
      (85, 'GRANT', 'TABLE', 'SELECT', 'analytics.monthly_close', 'pulse_api', '0006'),
      (86, 'GRANT', 'TABLE', 'INSERT, UPDATE', 'ops.excecao_referencia', 'pulse_api', '0006'),
      (87, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'ops.excecao_referencia', 'pulse_worker', '0006'),
      (88, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'analytics.monthly_close', 'pulse_worker', '0006'),
      (89, 'GRANT', 'SEQUENCE', 'USAGE, SELECT', 'ops.excecao_referencia_id_seq', 'pulse_api', '0006'),
      (90, 'GRANT', 'SEQUENCE', 'USAGE, SELECT', 'ops.excecao_referencia_id_seq', 'pulse_worker', '0006'),
      (91, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'success.playbook', 'pulse_api', '0007'),
      (92, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'success.work_item', 'pulse_api', '0007'),
      (93, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'success.project', 'pulse_api', '0007'),
      (94, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'success.project_task', 'pulse_api', '0007'),
      (95, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'success.renewal', 'pulse_api', '0007'),
      (96, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'success.cancellation', 'pulse_api', '0007'),
      (97, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'success.playbook', 'pulse_worker', '0007'),
      (98, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'success.work_item', 'pulse_worker', '0007'),
      (99, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'success.project', 'pulse_worker', '0007'),
      (100, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'success.project_task', 'pulse_worker', '0007'),
      (101, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'success.renewal', 'pulse_worker', '0007'),
      (102, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'success.cancellation', 'pulse_worker', '0007'),
      (103, 'GRANT', 'TABLE', 'SELECT', 'ops.cycle_declaration', 'pulse_api', '0009'),
      (104, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE, DELETE', 'ops.cycle_declaration', 'pulse_worker', '0009'),
      (105, 'GRANT', 'SCHEMA', 'USAGE', 'contracts', 'pulse_api', '0013'),
      (106, 'GRANT', 'SCHEMA', 'USAGE', 'contracts', 'pulse_worker', '0013'),
      (107, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'contracts.document', 'pulse_api', '0013'),
      (108, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'contracts.clause', 'pulse_api', '0013'),
      (109, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'contracts.obligation', 'pulse_api', '0013'),
      (110, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'contracts.event', 'pulse_api', '0013'),
      (111, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'contracts.approval', 'pulse_api', '0013'),
      (112, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'contracts.document', 'pulse_worker', '0013'),
      (113, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'contracts.clause', 'pulse_worker', '0013'),
      (114, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'contracts.obligation', 'pulse_worker', '0013'),
      (115, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'contracts.event', 'pulse_worker', '0013'),
      (116, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'contracts.approval', 'pulse_worker', '0013'),
      (117, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'success.client_report', 'pulse_api', '0015'),
      (118, 'GRANT', 'TABLE', 'SELECT, INSERT, UPDATE', 'success.client_report', 'pulse_worker', '0015'),
      (119, 'GRANT', 'TABLE', 'SELECT', 'ops.configuracao', 'pulse_api', '0016'),
      (120, 'GRANT', 'TABLE', 'SELECT', 'ops.configuracao', 'pulse_worker', '0016'),
      (121, 'GRANT', 'TABLE', 'INSERT, UPDATE, DELETE', 'ops.configuracao', 'pulse_api', '0016'),
      (122, 'GRANT', 'TABLE', 'SELECT, UPDATE', 'ops.segredo', 'pulse_worker', '0016'),
      (123, 'GRANT', 'TABLE', 'INSERT, UPDATE, DELETE', 'ops.segredo', 'pulse_api', '0016'),
      (124, 'GRANT', 'TABLE', 'SELECT, INSERT', 'ops.mudanca', 'pulse_api', '0016'),
      (125, 'GRANT', 'SEQUENCE', 'USAGE, SELECT', 'ops.mudanca_id_seq', 'pulse_api', '0016'),
      (126, 'GRANT', 'TABLE', 'SELECT, INSERT, DELETE', 'ops.user_role', 'pulse_api', '0016')
    ) AS t(ordem, acao, tipo, privs, obj, rol, origem)
    ORDER BY ordem
  LOOP
    -- Role ausente não é erro: um cluster que nunca teve o problema pode não ter
    -- todos os roles, e a migration não pode morrer por causa disso.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = g.rol) THEN
      CONTINUE;
    END IF;

    -- Objeto ausente também não: tabela renomeada ou removida por migration
    -- posterior sai da lista sem derrubar as outras 125 linhas.
    existe := CASE g.tipo
      WHEN 'SCHEMA'   THEN EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = g.obj)
      WHEN 'FUNCTION' THEN to_regprocedure(g.obj) IS NOT NULL
      ELSE to_regclass(g.obj) IS NOT NULL
    END;
    IF NOT existe THEN
      RAISE NOTICE 'pulado: % % (origem %) não existe neste banco', g.tipo, g.obj, g.origem;
      CONTINUE;
    END IF;

    -- `privs`, `tipo` e `obj` vêm da lista literal acima, não de entrada externa.
    EXECUTE format('%s %s ON %s %s %s %I',
      g.acao, g.privs, g.tipo, g.obj,
      CASE g.acao WHEN 'GRANT' THEN 'TO' ELSE 'FROM' END, g.rol);
  END LOOP;
END $$;

COMMIT;
