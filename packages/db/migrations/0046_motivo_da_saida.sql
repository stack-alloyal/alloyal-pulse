-- ============================================================================
-- 0046 · Por que o título saiu da carteira sem ter sido pago
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ A 0045 assumiu que um título vencido só sai da carteira de três formas:     │
-- │ pago, cancelado, ou apagado da base. Escrevendo a apuração apareceu a        │
-- │ quarta, e ela é a mais interessante das quatro: o Omie pode PRORROGAR o      │
-- │ vencimento.                                                                │
-- │                                                                            │
-- │ Um título que vencia em março e passa a vencer em setembro deixa de estar    │
-- │ atrasado — some da carteira sem pagamento e sem cancelamento. Chamar isso    │
-- │ de "cancelado" seria registrar uma BAIXA onde houve uma RENEGOCIAÇÃO, que    │
-- │ é quase o oposto: uma é perda reconhecida, a outra é cobrança que continua   │
-- │ viva com data nova.                                                        │
-- │                                                                            │
-- │ A ARITMÉTICA é a mesma nos dois casos — o título sai da carteira sem pagar —  │
-- │ e por isso o `movimento` continua sendo um só e o CHECK do fechamento não    │
-- │ muda. O que muda é que o MOTIVO passa a ter lugar próprio, separado da       │
-- │ conta. Misturar diagnóstico com aritmética é o que faria a tela precisar     │
-- │ inventar um quinto movimento e o fechamento deixar de fechar.               │
-- └───────────────────────────────────────────────────────────────────────────┘
-- ============================================================================

BEGIN;

ALTER TABLE fact.inadimplencia_titulo
  ADD COLUMN motivo_saida text;

COMMENT ON COLUMN fact.inadimplencia_titulo.motivo_saida IS
  'Por que saiu sem pagar: cancelado (situacao cancelada no Omie), prorrogado (vencimento empurrado para frente -- renegociacao, nao perda), ausente (nao esta mais na base; o C20 faz upsert e nao apaga, mas titulo excluido no Omie para de aparecer).';

ALTER TABLE fact.inadimplencia_titulo
  ADD CONSTRAINT inadimplencia_motivo_valido
    CHECK (motivo_saida IS NULL
           OR motivo_saida IN ('cancelado', 'prorrogado', 'ausente')),
  -- O motivo existe exatamente quando o movimento é a saída sem pagamento, e
  -- só aí. Sem esta amarra o campo viraria opcional na prática, e um mês
  -- apurado sem motivo nenhum passaria sem ninguém ver.
  ADD CONSTRAINT inadimplencia_motivo_so_na_saida
    CHECK ((movimento = 'cancelado') = (motivo_saida IS NOT NULL));

-- O nome da coluna do fechamento continua `cancelado_centavos` de propósito: ela
-- é a linha "baixas" da reconciliação, e renomeá-la para `saiu_sem_pagar` faria
-- a tabela divergir do vocabulário de contas a receber por precisão que a
-- aritmética não usa. O comentário é que carrega a verdade completa.
COMMENT ON COLUMN analytics.inadimplencia_mes.cancelado_centavos IS
  'Saiu da carteira SEM pagamento: cancelado, prorrogado ou ausente da base (ver fact.inadimplencia_titulo.motivo_saida). Sempre 0 em competencia reconstruida -- core.omie_titulo nao guarda data de cancelamento, entao a reconstrucao nao pode atribuir a baixa ao mes em que ela aconteceu. A identidade continua fechando porque o cancelado sai dos DOIS lados.';

COMMIT;
