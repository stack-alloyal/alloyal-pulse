-- ============================================================================
-- 0035 · Devolve as POLÍTICAS de RLS que a 0033 derrubou junto com o role antigo
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ `DROP OWNED BY` não remove apenas o que o role possui e o que lhe foi       │
-- │ concedido: ele também mexe nas POLÍTICAS que citam o role, e quando o role  │
-- │ é o único citado, a política inteira vai embora. As quatro políticas da     │
-- │ 0005 são `TO ops_portal` e `TO ops_worker` — exatamente esse caso.          │
-- │                                                                            │
-- │ O resultado é traiçoeiro porque falha FECHADO: `public_v` está com RLS      │
-- │ FORCE, e tabela forçada sem política nenhuma nega tudo. Nada vaza; o portal │
-- │ simplesmente para de enxergar as próprias linhas. E os testes de isolamento │
-- │ que perguntam "o cliente A NÃO vê o cliente B?" passam todos — porque       │
-- │ ninguém vê nada. Só o teste que exige VER as próprias 2 linhas acusou.      │
-- │                                                                            │
-- │ Produção nunca perdeu as políticas: lá os `ops_*` já não existiam quando a  │
-- │ 0033 rodou, então o bloco inteiro foi pulado. A perda atinge só o banco que │
-- │ sofreu o defeito original — o segundo banco de um cluster já renomeado.     │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- São as mesmas quatro políticas da 0005, com o nome do role corrigido. A guarda
-- é por nome de política, e o renome da 0017 preservou as referências (política
-- aponta para o role por OID), então em produção isto é no-op.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  -- ── public_v.metric_daily ──────────────────────────────────────────────
  -- O cliente lê apenas as próprias linhas, e apenas SELECT.
  IF to_regclass('public_v.metric_daily') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_policy
                      WHERE polrelid = 'public_v.metric_daily'::regclass
                        AND polname = 'tenant_read') THEN
    CREATE POLICY tenant_read ON public_v.metric_daily
      FOR SELECT TO pulse_portal
      USING (account_id = public_v.current_tenant());
    RAISE NOTICE 'política tenant_read recriada';
  END IF;

  -- A consolidação escreve tudo. Precisa de política própria porque FORCE vale
  -- inclusive para o dono da tabela.
  IF to_regclass('public_v.metric_daily') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_policy
                      WHERE polrelid = 'public_v.metric_daily'::regclass
                        AND polname = 'worker_all') THEN
    CREATE POLICY worker_all ON public_v.metric_daily
      FOR ALL TO pulse_worker
      USING (true) WITH CHECK (true);
    RAISE NOTICE 'política worker_all recriada';
  END IF;

  -- ── public_v.benchmark_monthly ─────────────────────────────────────────
  -- Benchmark é agregado entre clientes: não tem tenant, logo não tem RLS por
  -- linha. A proteção é o CHECK de k-anonimato, que a 0005 mantém.
  IF to_regclass('public_v.benchmark_monthly') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_policy
                      WHERE polrelid = 'public_v.benchmark_monthly'::regclass
                        AND polname = 'benchmark_read') THEN
    CREATE POLICY benchmark_read ON public_v.benchmark_monthly
      FOR SELECT TO pulse_portal
      USING (NOT suprimido);
    RAISE NOTICE 'política benchmark_read recriada';
  END IF;

  IF to_regclass('public_v.benchmark_monthly') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_policy
                      WHERE polrelid = 'public_v.benchmark_monthly'::regclass
                        AND polname = 'benchmark_worker') THEN
    CREATE POLICY benchmark_worker ON public_v.benchmark_monthly
      FOR ALL TO pulse_worker
      USING (true) WITH CHECK (true);
    RAISE NOTICE 'política benchmark_worker recriada';
  END IF;
END $$;

-- ── A trava que torna isto impossível de repetir em silêncio ────────────────
-- Tabela com RLS FORCE e nenhuma política nega tudo. Isso é seguro, e é
-- justamente por ser seguro que passa despercebido: nada vaza, o recurso apenas
-- para de funcionar. Esta verificação recusa a migration em vez de deixar o
-- banco terminar num estado que só um teste específico denunciaria.
DO $$
DECLARE
  orfas text;
BEGIN
  SELECT string_agg(c.relnamespace::regnamespace || '.' || c.relname, ', ')
    INTO orfas
    FROM pg_class c
   WHERE c.relrowsecurity AND c.relforcerowsecurity
     AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid);
  IF orfas IS NOT NULL THEN
    RAISE EXCEPTION 'RLS forçado sem política nenhuma em: % — a tabela nega tudo e o recurso morre calado', orfas;
  END IF;
END $$;

COMMIT;
