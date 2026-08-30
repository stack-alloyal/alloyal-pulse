-- 0055 — o worker pode apagar o evento que ELE derivou, e só esse.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ O DEFEITO, medido em 27/08/2026: o C22 NUNCA escreveu um evento em          │
-- │ produção.                                                                  │
-- │                                                                            │
-- │ Enfileirado à mão, ele falhou em 2 segundos com                             │
-- │ "permission denied for table mrr_event". `pulse_worker` tinha INSERT,       │
-- │ SELECT e UPDATE em `fact.mrr_event`, e NÃO DELETE — e `gerarEventosDeMrr`   │
-- │ começa apagando os eventos derivados da competência, que é como ele é       │
-- │ idempotente.                                                               │
-- │                                                                            │
-- │ Por que ninguém viu antes: o ciclo pergunta `competenciasSemEventos` antes  │
-- │ de escrever, e essa pergunta é só SELECT. Com o ledger cheio a resposta era │
-- │ "nenhuma pendente", ele registrava `ok` com zero linhas e a parede de       │
-- │ permissão nunca era tocada. O painel de sincronização mostrou C22 verde     │
-- │ todos os dias por uma semana, para um ciclo que não conseguia gravar.       │
-- │                                                                            │
-- │ Ciclo que não tem o que fazer e ciclo que não PODE fazer registram a mesma  │
-- │ coisa. É o que faz um portão verde não valer nada.                          │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ POR QUE UM GATILHO, E NÃO SÓ O GRANT.                                      │
-- │                                                                            │
-- │ `fact.mrr_event` guarda DUAS coisas: o evento derivado do faturamento       │
-- │ (`chave_natural` começando em `faturamento:`, `reconstruido = true`) e a     │
-- │ baixa de receita que uma PESSOA aprovou na tela de saídas                   │
-- │ (`cancelamento:...`). O `DELETE` do código já se restringe ao primeiro, mas  │
-- │ GRANT é por tabela: um `DELETE` sem `WHERE` num ciclo futuro apagaria o      │
-- │ distrato aprovado, e o churn de receita do mês desapareceria sem rastro.     │
-- │                                                                            │
-- │ O gatilho põe a garantia no banco, onde ela não depende de quem escreve o    │
-- │ próximo ciclo se lembrar do `LIKE`.                                        │
-- │                                                                            │
-- │ A saída para o dono é explícita, igual à da 0027: `pulse_owner` corrige o    │
-- │ que precisar. O que não passa é o worker apagando decisão de gente.          │
-- └───────────────────────────────────────────────────────────────────────────┘

BEGIN;

CREATE OR REPLACE FUNCTION fact.mrr_event_apaga_so_derivado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- O dono corrige o que precisar: migração, ajuste manual, banco descartável.
  IF pg_has_role(current_user, 'pulse_owner', 'MEMBER') THEN
    RETURN OLD;
  END IF;
  IF OLD.reconstruido AND OLD.chave_natural LIKE 'faturamento:%' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'fact.mrr_event só aceita DELETE de evento DERIVADO do faturamento '
    '(reconstruido = true e chave_natural começando em ''faturamento:''). '
    'A tentativa foi em id=% (tipo=%, chave=%, reconstruido=%), que é evento '
    'aprovado por pessoa — apagá-lo faria o churn de receita do mês desaparecer '
    'sem rastro. Para corrigir de propósito, use pulse_owner.',
    OLD.id, OLD.tipo, OLD.chave_natural, OLD.reconstruido;
END;
$$;

DROP TRIGGER IF EXISTS mrr_event_apaga_so_derivado ON fact.mrr_event;
CREATE TRIGGER mrr_event_apaga_so_derivado
  BEFORE DELETE ON fact.mrr_event
  FOR EACH ROW EXECUTE FUNCTION fact.mrr_event_apaga_so_derivado();

-- ── O grant que faltava ──────────────────────────────────────────────────────
--
-- O worker JÁ apaga em vinte tabelas, entre elas `fact.inadimplencia_titulo` e
-- `metrics.daily_snapshot` — fatos derivados reprocessados, exatamente o mesmo
-- padrão. `fact.mrr_event` não é exceção de política: foi esquecida.
GRANT DELETE ON fact.mrr_event TO pulse_worker;

COMMENT ON FUNCTION fact.mrr_event_apaga_so_derivado() IS
  'Recusa DELETE de evento de MRR aprovado por pessoa; o worker só apaga o que derivou do faturamento.';

COMMIT;
