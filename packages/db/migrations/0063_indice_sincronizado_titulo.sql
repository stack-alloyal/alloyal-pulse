-- 0063 — índice em core.omie_titulo(sincronizado_em), para a API de leitura.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ O envelope de /api/v1/titulos carrega `snapshot` = max(sincronizado_em) da   │
-- │ tabela inteira, e o filtro `atualizado_desde` compara a mesma coluna. Sem    │
-- │ índice, o MAX é um seq scan de ~90 mil linhas em toda página (~9 ms medidos  │
-- │ no EXPLAIN) — inofensivo hoje, mas é custo fixo por requisição numa API que  │
-- │ pagina em lotes de milhares. Com o índice, o MAX vira uma leitura no fim da   │
-- │ árvore, e o incremental `>= desde` deixa de varrer a tabela.                  │
-- │                                                                            │
-- │ `CREATE INDEX` simples e não CONCURRENTLY: o runner envolve cada migração    │
-- │ numa transação, e CONCURRENTLY não roda dentro de uma. Em 90 mil linhas o     │
-- │ lock dura milissegundos.                                                     │
-- └───────────────────────────────────────────────────────────────────────────┘

BEGIN;

CREATE INDEX omie_titulo_sincronizado_idx ON core.omie_titulo (sincronizado_em);

COMMENT ON INDEX core.omie_titulo_sincronizado_idx IS
  'Serve o snapshot (max) e o filtro atualizado_desde de /api/v1/titulos.';

COMMIT;
