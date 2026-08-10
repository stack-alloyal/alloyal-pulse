-- ============================================================================
-- 0033 · Banco novo em cluster já renomeado nasce com os GRANTs no role errado
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ DESCOBERTO criando um banco de teste no cluster de produção, em 10/08/2026. │
-- │ Seis testes de RLS falharam com "permission denied for schema public_v", e  │
-- │ a causa não estava em nenhuma migration recente:                            │
-- │                                                                            │
-- │   1. A 0001 cria os roles com os nomes ANTIGOS (`ops_api`, `ops_portal`…)   │
-- │      e concede tudo a eles. Ela não muda — migration aplicada é história.   │
-- │   2. Role é objeto do CLUSTER, não do banco. Num cluster onde a 0017 já     │
-- │      renomeou, os `ops_*` não existem mais — então a 0001 os RECRIA.        │
-- │   3. A 0017 então pula o renome, porque a guarda dela é "renomeia só se o   │
-- │      novo NÃO existir" — e `pulse_api` já existe desde o primeiro banco.    │
-- │                                                                            │
-- │ O banco novo termina com os privilégios em `ops_*` e os `pulse_*` sem nada. │
-- │ A aplicação conecta como `pulse_api` e não enxerga esquema nenhum.          │
-- │                                                                            │
-- │ O CI nunca pegou isso porque levanta um cluster limpo a cada execução: lá   │
-- │ os `ops_*` são criados pela 0001 e renomeados pela 0017, na ordem certa.    │
-- │ O defeito só aparece no SEGUNDO banco do mesmo cluster — que é exatamente o │
-- │ caso de um ambiente de teste ao lado da produção, ou de um restore.         │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- A correção é fazer a cadeia se autocorrigir: ao final dela, o que a 0001 concedeu
-- a `ops_*` passa para `pulse_*`, e os roles antigos são removidos do cluster.
--
-- IDEMPOTENTE e inofensiva quando não há nada a corrigir: num banco onde a 0017 já
-- renomeou, os `ops_*` não existem e o bloco inteiro é pulado.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  par record;
BEGIN
  FOR par IN
    SELECT * FROM (VALUES
      ('ops_owner',  'pulse_owner'),
      ('ops_api',    'pulse_api'),
      ('ops_portal', 'pulse_portal'),
      ('ops_worker', 'pulse_worker')
    ) AS t(antigo, novo)
  LOOP
    -- Só age quando os DOIS existem, que é a assinatura exata do problema: a 0001
    -- recriou o antigo, e o novo veio do renome de outro banco.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = par.antigo)
       AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = par.novo) THEN

      -- Transfere o que o antigo POSSUI neste banco. Sem isto, o DROP falha com
      -- "role cannot be dropped because some objects depend on it" — e a migration
      -- morreria no meio deixando o banco pela metade.
      EXECUTE format('REASSIGN OWNED BY %I TO %I', par.antigo, par.novo);

      -- Herda os privilégios concedidos ao antigo, e só então os apaga. A ordem
      -- importa: `DROP OWNED` primeiro removeria os GRANTs antes de o novo herdá-los.
      EXECUTE format('GRANT %I TO %I', par.antigo, par.novo);
      EXECUTE format('REVOKE %I FROM %I', par.antigo, par.novo);

      -- Os GRANTs da 0001 são explícitos por esquema, então a herança acima não
      -- basta: é preciso repeti-los para o role novo. São os mesmos comandos da
      -- 0001, com o nome corrigido.
      IF par.novo IN ('pulse_api', 'pulse_worker') THEN
        EXECUTE format('GRANT USAGE ON SCHEMA core, fact, metrics, analytics, ops, success TO %I', par.novo);
      END IF;
      IF par.novo IN ('pulse_worker', 'pulse_portal') THEN
        EXECUTE format('GRANT USAGE ON SCHEMA public_v TO %I', par.novo);
      END IF;

      -- `DROP OWNED` limpa os privilégios que sobraram para o antigo NESTE banco.
      EXECUTE format('DROP OWNED BY %I', par.antigo);

      -- O DROP do role pode falhar legitimamente: `REASSIGN`/`DROP OWNED` só alcançam
      -- o banco corrente, e o role antigo pode possuir objetos em OUTRO banco do mesmo
      -- cluster. Falhar aqui abortaria a migration inteira e desfaria a transferência
      -- de privilégios — que é a parte que importa. O role órfão é inofensivo e sai
      -- quando o último banco rodar esta mesma migration.
      BEGIN
        EXECUTE format('DROP ROLE IF EXISTS %I', par.antigo);
        RAISE NOTICE 'role duplicado % removido; privilégios com %', par.antigo, par.novo;
      EXCEPTION WHEN dependent_objects_still_exist THEN
        RAISE NOTICE 'privilégios de % transferidos para %; o role antigo ainda possui objetos em outro banco e sai depois', par.antigo, par.novo;
      END;
    END IF;
  END LOOP;
END $$;

COMMIT;
