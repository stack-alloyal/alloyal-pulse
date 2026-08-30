-- ============================================================================
-- 0054 · A competência de efeito significa duas coisas, e a restrição só cobria uma
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ `efeito_receita_exige_duas_confirmacoes` foi escrita para o CANCELAMENTO,   │
-- │ e está certa para ele: ali a competência de efeito é DERIVADA do aviso      │
-- │ prévio e da última cobrança, e as duas precisam de confirmação humana —     │
-- │ sem isso o mês em que a receita sai seria um chute de quem clicou.          │
-- │                                                                            │
-- │ Nos desfechos que SALVAM o cliente ela quer dizer outra coisa: em que mês o │
-- │ preço novo passa a valer. Não há aviso a confirmar nem última cobrança a    │
-- │ combinar, porque não há última cobrança — o cliente continua pagando.       │
-- │                                                                            │
-- │ Descoberto pelo teste do desconto, que recusou com                         │
-- │ "violates check constraint efeito_receita_exige_duas_confirmacoes". A       │
-- │ restrição estava funcionando; o que faltava era escopo.                     │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- A garantia original é preservada INTEIRA para o caminho do cancelamento, e é
-- por isso que a nova versão lista os estados em vez de simplesmente afrouxar:
-- afrouxar deixaria o cancelamento passar sem as confirmações, que é justamente
-- o que a restrição existe para impedir.
-- ============================================================================

BEGIN;

ALTER TABLE success.cancellation
  DROP CONSTRAINT efeito_receita_exige_duas_confirmacoes;

ALTER TABLE success.cancellation
  ADD CONSTRAINT efeito_receita_exige_duas_confirmacoes CHECK (
    competencia_efeito_receita IS NULL
    -- Desfechos que salvam o cliente: a competência é a do preço novo, e não há
    -- aviso nem última cobrança envolvidos.
    OR estado IN ('desconto', 'renegociado')
    -- Caminho do cancelamento: a garantia original, palavra por palavra.
    OR (aviso_confirmado_por IS NOT NULL
        AND aviso_confirmado_em IS NOT NULL
        AND cobranca_confirmada_por IS NOT NULL
        AND cobranca_confirmada_em IS NOT NULL
        AND competencia_ultima_cobranca IS NOT NULL)
  );

COMMENT ON COLUMN success.cancellation.competencia_efeito_receita IS
  'O mes em que este pedido bate no ledger. No cancelamento e quando a receita PARA, e vem das duas confirmacoes (aviso e ultima cobranca). No desconto e na renegociacao e quando o preco NOVO passa a valer, e nao ha confirmacao a fazer -- ver a 0054.';

COMMIT;
