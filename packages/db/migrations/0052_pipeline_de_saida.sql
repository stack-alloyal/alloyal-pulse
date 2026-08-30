-- ============================================================================
-- 0052 · O pipeline do pedido de saída ou redução
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ ESTENDE a máquina de estados que já existia, e não a troca.                │
-- │                                                                            │
-- │ `success.cancellation` tinha quatro estados e sete restrições de banco —    │
-- │ `encerrado` exige competência de efeito e aprovação, `retido` exige autor e │
-- │ data, efeito na receita exige as duas confirmações. São essas restrições    │
-- │ que impedem um mês já apresentado de mudar depois, e trocar a máquina        │
-- │ significaria reescrevê-las.                                                │
-- │                                                                            │
-- │ A tabela está VAZIA (zero linhas, medido), então renomear seria seguro do   │
-- │ ponto de vista de dado. Não é seguro do ponto de vista das garantias: cada  │
-- │ uma daquelas sete foi escrita por um motivo, e recriá-las é a chance de     │
-- │ perder uma sem ninguém ver.                                                │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ AS OITO POSIÇÕES DO QUADRO, e como elas caem em estado + origem.            │
-- │                                                                            │
-- │  1 Pedido de cancelamento ou desconto  → estado `anunciado`                 │
-- │  2 Informações financeiras             → estado `financeiro`      (novo)    │
-- │  3 Tentativa de reversão               → estado `reversao`        (novo)    │
-- │  4 Cancelamento revertido              → estado `retido`                    │
-- │  5 Desconto                            → estado `desconto`       (novo)    │
-- │  6 Renegociação financeira             → estado `renegociado`     (novo)    │
-- │  7 Cancelamento                        → `encerrado` + origem `cliente`     │
-- │  8 Cancelamento Alloyal (PDD)          → `encerrado` + origem `alloyal`     │
-- │                                                                            │
-- │ 7 e 8 NÃO ganham estado próprio: `origem` já os separa e já tem CHECK. Dois │
-- │ estados para a mesma posição contábil dariam duas formas de escrever a       │
-- │ mesma coisa, e uma delas seria esquecida na próxima consulta.               │
-- │                                                                            │
-- │ `em_aviso` continua existindo e NÃO está na lista de oito: é o cancelamento │
-- │ já decidido enquanto o aviso prévio corre e o cliente ainda paga. O quadro  │
-- │ mostra como "cancelamento", e a coluna de efeito diz quando para de entrar. │
-- └───────────────────────────────────────────────────────────────────────────┘
-- ============================================================================

BEGIN;

-- ── 1. Os quatro estados novos ─────────────────────────────────────────────
ALTER TABLE success.cancellation
  DROP CONSTRAINT cancellation_estado_check;

ALTER TABLE success.cancellation
  ADD CONSTRAINT cancellation_estado_check CHECK (estado IN (
    -- etapas de trabalho: o pedido ESTÁ nelas
    'anunciado', 'financeiro', 'reversao',
    -- o cancelamento decidido, com o aviso prévio correndo
    'em_aviso',
    -- desfechos: o pedido PAROU neles
    'retido', 'desconto', 'renegociado', 'encerrado'
  ));

-- ── 2. O que se pediu, que decide os desfechos possíveis ───────────────────
ALTER TABLE success.cancellation
  ADD COLUMN pedido text NOT NULL DEFAULT 'cancelar';

COMMENT ON COLUMN success.cancellation.pedido IS
  'O que o cliente pediu: cancelar ou desconto. Existe porque a porta de entrada e a MESMA para os dois -- chamar o quadro de churn faria o time hesitar em registrar um pedido de desconto ali, que e justamente o caso em que a intervencao precoce funciona.';

ALTER TABLE success.cancellation
  ADD CONSTRAINT cancellation_pedido_check CHECK (pedido IN ('cancelar', 'desconto'));

-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ DOIS DOS CINCO DESFECHOS SALVAM O CLIENTE POR MENOS DINHEIRO, e o ledger    │
-- │ precisa saber o novo valor para gerar CONTRAÇÃO em vez de churn.            │
-- │                                                                            │
-- │ `mrr_novo_centavos` é o mensal depois do acordo. A contração é a diferença  │
-- │ contra `mrr_centavos_na_levantada`, que já está congelado na levantada — e   │
-- │ é por isso que ele é congelado: sem o valor de antes, não há delta.          │
-- └───────────────────────────────────────────────────────────────────────────┘
ALTER TABLE success.cancellation
  ADD COLUMN mrr_novo_centavos bigint;

COMMENT ON COLUMN success.cancellation.mrr_novo_centavos IS
  'O MRR mensal DEPOIS do acordo, nos desfechos desconto e renegociado. A contracao lancada no ledger e mrr_centavos_na_levantada menos este. Nulo em renegociacao que so mexeu em prazo ou parcelamento: aí o recebivel muda e o MRR nao.';

ALTER TABLE success.cancellation
  ADD CONSTRAINT desconto_tem_mrr_novo
    CHECK (estado <> 'desconto' OR (mrr_novo_centavos IS NOT NULL
                                    AND mrr_novo_centavos < mrr_centavos_na_levantada));

-- ── 3. A idade na etapa, para a reversão não virar cemitério ────────────────
--
-- Um pedido parado na tentativa de reversão é um cancelamento que ninguém quis
-- anunciar. O prazo é de 14 dias, e o número tem motivo: é menor que o menor
-- aviso prévio praticado (30 dias), então o pedido aparece como estagnado
-- enquanto ainda há tempo de agir. Prazo maior que o aviso avisaria tarde.
ALTER TABLE success.cancellation
  ADD COLUMN etapa_desde timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN success.cancellation.etapa_desde IS
  'Quando o pedido entrou na etapa ATUAL. Reiniciado a cada transicao. E o que permite a tela listar o que esta estagnado -- sem isso o quadro conta uma historia melhor que a real, porque um pedido esquecido parece um pedido em andamento.';

-- ── 4. Quem registrou, e quem confirmou o motivo ────────────────────────────
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ O MOTIVO É CONFIRMADO POR OUTRA PESSOA, e isso vem da prática de win/loss   │
-- │ de vendas: quem conduziu o caso tem viés, e "custo" é o motivo mais         │
-- │ confortável de escrever. O Pulse já exige aprovação de outra pessoa para    │
-- │ ENCERRAR; estender ao motivo custa uma coluna e muda a qualidade do dado    │
-- │ que alimenta toda a análise de churn.                                      │
-- │                                                                            │
-- │ `criado_por` existe para a restrição poder comparar as duas pessoas. Sem    │
-- │ ele, "confirmado por outra pessoa" seria combinado de processo, e combinado │
-- │ de processo é o que se rompe na semana corrida.                            │
-- └───────────────────────────────────────────────────────────────────────────┘
ALTER TABLE success.cancellation
  ADD COLUMN criado_por text,
  ADD COLUMN motivo_confirmado_por text,
  ADD COLUMN motivo_confirmado_em timestamptz;

ALTER TABLE success.cancellation
  ADD CONSTRAINT motivo_confirmado_por_outra_pessoa
    CHECK (motivo_confirmado_por IS NULL
           OR criado_por IS NULL
           OR motivo_confirmado_por <> criado_por),
  ADD CONSTRAINT confirmacao_de_motivo_completa
    CHECK ((motivo_confirmado_por IS NULL) = (motivo_confirmado_em IS NULL));

-- Desfecho de PERDA exige motivo confirmado: é o dado que vai para a análise, e
-- é na hora de encerrar que alguém ainda lembra o que aconteceu.
ALTER TABLE success.cancellation
  ADD CONSTRAINT encerrado_tem_motivo_confirmado
    CHECK (estado <> 'encerrado' OR motivo_confirmado_por IS NOT NULL);

CREATE INDEX cancellation_etapa_idx ON success.cancellation (estado, etapa_desde);

-- ============================================================================
-- A META de churn. Não existia tabela de meta em lugar nenhum do Pulse.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ EM REAIS POR MÊS, e contando SÓ cancelamento e PDD.                        │
-- │                                                                            │
-- │ Reais e não percentual do MRR: percentual se corrige sozinho quando a base  │
-- │ cresce, o que é uma vantagem — e uma meta que muda de valor sem ninguém     │
-- │ mexer nela é uma meta que ninguém consegue combinar em voz alta. Reais é o   │
-- │ que cabe numa reunião.                                                     │
-- │                                                                            │
-- │ E só churn: desconto e renegociação são CONTRAÇÃO. Somá-los aqui faria a     │
-- │ tabela deixar de ser de churn e passar a ser de receita perdida — que é uma  │
-- │ tabela útil, e é outra tabela. Misturar as duas apagaria a diferença entre   │
-- │ o cliente que foi embora e o que ficou pagando menos.                       │
-- └───────────────────────────────────────────────────────────────────────────┘
-- ============================================================================

CREATE TABLE success.meta_churn (
  competencia    date PRIMARY KEY,
  meta_centavos  bigint NOT NULL,
  definido_por   text   NOT NULL,
  definido_em    timestamptz NOT NULL DEFAULT now(),
  nota           text,

  CONSTRAINT meta_no_dia_1 CHECK (competencia = date_trunc('month', competencia)::date),
  -- Meta negativa não existe; meta zero significa "nenhum churn aceitável", que é
  -- uma meta legítima e diferente de não ter meta (ausência da linha).
  CONSTRAINT meta_nao_negativa CHECK (meta_centavos >= 0)
);

COMMENT ON TABLE success.meta_churn IS
  'Meta de churn de MRR por competencia, em centavos. Conta so cancelamento e PDD -- desconto e renegociacao sao contracao. Ausencia de linha e "sem meta definida", que a tela mostra diferente de meta zero.';

GRANT SELECT ON success.meta_churn TO pulse_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON success.meta_churn TO pulse_owner;

COMMIT;
