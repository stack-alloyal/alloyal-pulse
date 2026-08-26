-- ============================================================================
-- 0045 · Inadimplência: a foto do dia 1º, e o fechamento que fecha
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ POR QUE UMA FOTO, SE A SÉRIE É RECONSTRUÍVEL.                              │
-- │                                                                            │
-- │ `core.omie_titulo` guarda `vencimento` e `pagamento`, que são FATO. Com os   │
-- │ dois, o saldo em atraso de qualquer data passada sai de uma consulta:        │
-- │ venceu antes do corte e não estava pago até o corte. Medido em 25/08/2026,   │
-- │ dá 19 meses de história, e ela FECHA AO CENTAVO em todos eles.               │
-- │                                                                            │
-- │ O problema é o que a reconstrução não pode ver. Quando o Omie CANCELA um     │
-- │ título, ele desaparece dos dois lados da conta — do saldo de hoje e do de    │
-- │ março —, e a tabela NÃO GUARDA DATA DE CANCELAMENTO: só `sincronizado_em`,   │
-- │ que é sobrescrito a cada carga. São R$ 1.339.547 cancelados com vencimento   │
-- │ em 2026 e R$ 1.269.481 em 2025.                                            │
-- │                                                                            │
-- │ Ou seja: o passado reconstruído hoje é diferente do passado reconstruído em  │
-- │ dezembro, e nada avisa. A foto é o que faz o número de março continuar sendo │
-- │ o número de março.                                                          │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ O GRÃO É O TÍTULO, e não a conta.                                          │
-- │                                                                            │
-- │ Grão por conta seria mais barato e estaria errado: um cliente que paga uma  │
-- │ fatura antiga e atrasa uma nova no mesmo mês tem saldo parecido nas duas    │
-- │ fotos, e as duas coisas — a recuperação e a entrada — somem juntas.         │
-- │ Atribuir recuperação exige identidade de título.                           │
-- │                                                                            │
-- │ Custo: 1.178 títulos na última foto, ~14 mil linhas por ano. Irrelevante.   │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ QUATRO MOVIMENTOS, E NÃO DOIS.                                             │
-- │                                                                            │
-- │ O modelo intuitivo tem dois: entra em atraso, e recupera quando paga. Mas   │
-- │ um título também SAI da carteira cancelado, e pode ter o VALOR alterado no  │
-- │ Omie depois de emitido. Com dois movimentos, um cancelamento aparece como   │
-- │ recuperação que nunca houve — ou como uma queda que ninguém explica três    │
-- │ meses depois.                                                              │
-- │                                                                            │
-- │ `movimento` tem quatro valores e o ajuste de valor é uma COLUNA, não um     │
-- │ quinto valor: o título ajustado continua na carteira, então ele é ao mesmo  │
-- │ tempo `permaneceu` e ajustado. Enumeração não comporta as duas coisas.      │
-- └───────────────────────────────────────────────────────────────────────────┘
-- ============================================================================

BEGIN;

CREATE TABLE fact.inadimplencia_titulo (
  -- O dia 1º da foto. A linha descreve a carteira NAQUELE instante e o
  -- movimento do mês que acabou de fechar.
  competencia      date   NOT NULL,
  codigo_titulo    bigint NOT NULL,
  documento        text   NOT NULL,
  -- Nulo é caso real e não falta de dado: 22 CNPJ com título vencido não têm
  -- vínculo com conta nenhuma no painel.
  account_id       uuid,

  -- ┌─────────────────────────────────────────────────────────────────────────┐
  -- │ O VALOR É `valor_centavos` DO TÍTULO, INTEIRO — não `aberto_centavos`.    │
  -- │                                                                          │
  -- │ Medido: pagamento parcial NÃO EXISTE nesta base. Zero títulos em aberto   │
  -- │ com parte paga. Trinta e dois títulos quitados têm resíduo somando        │
  -- │ R$ 40.907,99 (arredondamento e desconto na baixa).                        │
  -- │                                                                          │
  -- │ Usar `aberto` traria justamente esse resíduo para dentro do fechamento, e │
  -- │ foi o que fez a primeira apuração não fechar por R$ 850,50.               │
  -- └─────────────────────────────────────────────────────────────────────────┘
  valor_centavos   bigint NOT NULL,
  vencimento       date   NOT NULL,
  -- Dias de atraso NA DATA DA FOTO. Guardado e não calculado na consulta: em
  -- competência passada `current_date` daria a idade de hoje, não a de então.
  dias_atraso      integer NOT NULL,

  -- Coluna GERADA pelo mesmo motivo de `core.omie_titulo.situacao`: existe UM
  -- lugar onde a regra da faixa mora, ela é indexável, e uma tela nova não tem
  -- como inventar o próprio agrupamento sem que apareça no diff.
  --
  -- As faixas 181-365 e 365+ não são zelo: metade da carteira (R$ 1.072.488 em
  -- 790 títulos) está vencida há mais de um ano, e um balde "90+" esconderia
  -- justamente a parte que não se move.
  faixa text GENERATED ALWAYS AS (
    CASE
      WHEN dias_atraso <=  30 THEN '1_30'
      WHEN dias_atraso <=  60 THEN '31_60'
      WHEN dias_atraso <=  90 THEN '61_90'
      WHEN dias_atraso <= 180 THEN '91_180'
      WHEN dias_atraso <= 365 THEN '181_365'
      ELSE 'mais_365'
    END
  ) STORED,

  -- ┌─────────────────────────────────────────────────────────────────────────┐
  -- │ O ESTADO DO PAINEL NAQUELE DIA, e por isso ele é NULO no reconstruído.    │
  -- │                                                                          │
  -- │ É o corte que muda a conversa: R$ 1.522.766 dos R$ 2.106.405 vencidos     │
  -- │ estão em conta que o painel já suspendeu (`suspended_by_overdue`, 520     │
  -- │ contas) ou desativou. Cobrar isso é jurídico ou baixa, não operação.      │
  -- │                                                                          │
  -- │ Mas `core.account.status_core` não tem histórico: hoje não há como saber  │
  -- │ que estado uma conta tinha em março. Preencher a foto reconstruída com o  │
  -- │ estado de HOJE seria afirmar sobre o passado uma coisa que não se sabe —  │
  -- │ então fica nulo, e a série por estado começa quando a apuração começa.    │
  -- │ `dias_atraso` é diferente: sai das datas, e é fato em qualquer competência.│
  -- └─────────────────────────────────────────────────────────────────────────┘
  status_painel    text,

  -- Se o CNPJ é cliente pelas tags do Omie (nem Azul, nem só Fornecedor). NÃO é
  -- filtro da tabela: inadimplência é número financeiro, e excluir por etiqueta
  -- de CRM faria a carteira não amarrar com o Omie. Fica como coluna para a tela
  -- poder cortar dos dois jeitos — o delta medido é de R$ 955 em R$ 2,1 milhões.
  e_cliente        boolean NOT NULL DEFAULT true,

  movimento        text   NOT NULL,
  -- Diferença de valor contra a foto anterior. Só é diferente de zero em
  -- `permaneceu`: quem entrou não tem valor anterior, e quem saiu não tem novo.
  ajuste_centavos  bigint NOT NULL DEFAULT 0,
  origem           text   NOT NULL,

  PRIMARY KEY (competencia, codigo_titulo),

  CONSTRAINT inadimplencia_movimento_valido
    CHECK (movimento IN ('permaneceu', 'entrou', 'recuperado', 'cancelado')),
  CONSTRAINT inadimplencia_origem_valida
    CHECK (origem IN ('apurado', 'reconstruido')),
  -- Ajuste é do título que ficou. Em quem entrou ou saiu ele não tem significado,
  -- e permitir valor ali abriria a porta para o fechamento fechar por engano.
  CONSTRAINT inadimplencia_ajuste_so_em_permaneceu
    CHECK (ajuste_centavos = 0 OR movimento = 'permaneceu'),
  -- Foto reconstruída não pode afirmar estado de painel (ver o comentário acima).
  CONSTRAINT inadimplencia_reconstruido_sem_status
    CHECK (origem = 'apurado' OR status_painel IS NULL),
  CONSTRAINT inadimplencia_competencia_no_dia_1
    CHECK (competencia = date_trunc('month', competencia)::date)
);

COMMENT ON TABLE fact.inadimplencia_titulo IS
  'Foto do dia 1º, título a título: a carteira em atraso naquele instante e o movimento do mês que fechou. Grão por título porque atribuir recuperação exige identidade — grão por conta esconde o cliente que paga uma fatura antiga e atrasa uma nova no mesmo mês.';

COMMENT ON COLUMN fact.inadimplencia_titulo.movimento IS
  'permaneceu | entrou | recuperado | cancelado. Quem saiu da carteira aparece na competencia em que ja NAO esta no saldo, com o valor que tinha na foto anterior. cancelado cobre as duas formas de sair sem pagar: cancelado no Omie, e simplesmente ausente da base na carga seguinte -- o segundo caso existe porque o C20 faz upsert e nao apaga, mas um titulo excluido no Omie deixa de aparecer, e sem isso o fechamento de titulos nao fecharia.';

-- Por competência, para a tela e para a apuração do mês seguinte.
CREATE INDEX inadimplencia_titulo_competencia_idx
  ON fact.inadimplencia_titulo (competencia, movimento);
-- Por cliente: "este CNPJ está atrasado desde quando?" é a pergunta da ficha.
CREATE INDEX inadimplencia_titulo_documento_idx
  ON fact.inadimplencia_titulo (documento, competencia DESC);
CREATE INDEX inadimplencia_titulo_conta_idx
  ON fact.inadimplencia_titulo (account_id, competencia DESC)
  WHERE account_id IS NOT NULL;

-- ============================================================================
-- O mês fechado. Espelha `analytics.monthly_close` de propósito: mesma coluna
-- `estado`, mesmo congelamento, mesma ideia de que o mês vira decisão de gente.
--
-- Ele é DERIVADO da tabela de títulos e existe por três motivos que a consulta
-- por GROUP BY não dá: a identidade do fechamento gravada como CHECK, o estado
-- de congelamento (que é decisão e não cálculo), e 19 linhas para o gráfico ler
-- em vez de 23 mil.
-- ============================================================================

CREATE TABLE analytics.inadimplencia_mes (
  competencia            date   PRIMARY KEY,

  saldo_inicial_centavos bigint NOT NULL,
  titulos_inicial        integer NOT NULL,
  entrou_centavos        bigint NOT NULL DEFAULT 0,
  entrou_titulos         integer NOT NULL DEFAULT 0,
  recuperado_centavos    bigint NOT NULL DEFAULT 0,
  recuperado_titulos     integer NOT NULL DEFAULT 0,
  cancelado_centavos     bigint NOT NULL DEFAULT 0,
  cancelado_titulos      integer NOT NULL DEFAULT 0,
  ajuste_centavos        bigint NOT NULL DEFAULT 0,
  saldo_final_centavos   bigint NOT NULL,
  titulos_final          integer NOT NULL,

  -- Até 90 dias: sai das datas, então é série honesta desde a primeira
  -- competência reconstruída.
  recente_centavos       bigint NOT NULL DEFAULT 0,
  -- Até 90 dias E conta ativa no painel: a fila que responde a trabalho. NULO no
  -- reconstruído, porque depende do estado do painel, que não tem histórico.
  corrente_centavos      bigint,
  corrente_clientes      integer,

  origem                 text   NOT NULL,
  estado                 text   NOT NULL DEFAULT 'aberta',
  congelado_por          text,
  congelado_em           timestamptz,
  apurado_em             timestamptz NOT NULL DEFAULT now(),

  -- ┌─────────────────────────────────────────────────────────────────────────┐
  -- │ A IDENTIDADE DO FECHAMENTO, NO BANCO E NÃO NO CUIDADO DE QUEM CONSULTA.   │
  -- │                                                                          │
  -- │ Saldo inicial + entradas − recuperado − cancelado + ajuste = saldo final.  │
  -- │ É a mesma reconciliação que qualquer sistema de contas a receber publica   │
  -- │ junto do saldo, e é ela que torna o número defensável numa reunião.        │
  -- │                                                                          │
  -- │ Como CHECK e não como teste: um teste pega o bug que eu escrevi hoje; o    │
  -- │ CHECK pega o que outra pessoa escrever em dois anos, na madrugada, para    │
  -- │ corrigir um mês à mão.                                                    │
  -- └─────────────────────────────────────────────────────────────────────────┘
  CONSTRAINT inadimplencia_mes_fecha CHECK (
    saldo_inicial_centavos + entrou_centavos
      - recuperado_centavos - cancelado_centavos
      + ajuste_centavos = saldo_final_centavos
  ),
  CONSTRAINT inadimplencia_mes_titulos_fecham CHECK (
    titulos_inicial + entrou_titulos - recuperado_titulos - cancelado_titulos
      = titulos_final
  ),
  CONSTRAINT inadimplencia_mes_origem_valida
    CHECK (origem IN ('apurado', 'reconstruido')),
  CONSTRAINT inadimplencia_mes_estado_valido
    CHECK (estado IN ('aberta', 'congelada')),
  -- Reconstruído não sabe estado de painel, então não pode ter `corrente`.
  CONSTRAINT inadimplencia_mes_corrente_so_apurado
    CHECK (origem = 'apurado' OR (corrente_centavos IS NULL AND corrente_clientes IS NULL)),
  CONSTRAINT inadimplencia_mes_congelamento_completo
    CHECK ((estado = 'congelada') = (congelado_por IS NOT NULL AND congelado_em IS NOT NULL)),
  CONSTRAINT inadimplencia_mes_no_dia_1
    CHECK (competencia = date_trunc('month', competencia)::date)
);

COMMENT ON TABLE analytics.inadimplencia_mes IS
  'Fechamento mensal da carteira em atraso, derivado de fact.inadimplencia_titulo. A identidade do movimento é CHECK e não teste: pega o ajuste manual que alguém fizer em dois anos.';

COMMENT ON COLUMN analytics.inadimplencia_mes.cancelado_centavos IS
  'Sempre 0 em competência reconstruída: core.omie_titulo não guarda data de cancelamento, então a reconstrução não pode atribuir a baixa ao mês em que ela aconteceu. A identidade continua fechando porque o cancelado sai dos DOIS lados.';

GRANT SELECT ON fact.inadimplencia_titulo, analytics.inadimplencia_mes TO pulse_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON fact.inadimplencia_titulo TO pulse_worker;
GRANT SELECT, INSERT, UPDATE ON analytics.inadimplencia_mes TO pulse_worker;

COMMIT;
