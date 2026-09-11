-- 0059 — o histórico do HubSpot entra sem inventar quem aprovou o quê.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ POR QUE ESTA MIGRATION EXISTE.                                            │
-- │                                                                            │
-- │ O pipeline `INT | Cancelamento` do HubSpot tem 485 tickets, de 21/11/2023  │
-- │ a 08/09/2026, e as oito etapas dele casam uma a uma com as oito posições   │
-- │ do quadro. `success.cancellation` tem ZERO linha. A carga é o que dá        │
-- │ história às telas de cancelamento — sem ela o gráfico de 12 meses desenha  │
-- │ o vazio.                                                                   │
-- │                                                                            │
-- │ Só que 426 desses tickets estão fechados, e o estado `encerrado` exige      │
-- │ CINCO campos de auditoria que o export não tem em nenhuma coluna:           │
-- │ `aviso_confirmado_por`, `cobranca_confirmada_por`,                          │
-- │ `competencia_ultima_cobranca`, `aprovado_por` e `motivo_confirmado_por`.    │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ A ESCOLHA, E A QUE FOI RECUSADA.                                          │
-- │                                                                            │
-- │ RECUSADA: preencher os cinco com uma identidade sintética                  │
-- │ (`carga@hubspot`). Passaria nos CHECK e seria mentira gravada: o ledger     │
-- │ passaria a afirmar que um robô aprovou 426 distratos, e o CHECK             │
-- │ `motivo_confirmado_por_outra_pessoa` — que existe para exigir DUAS pessoas  │
-- │ — seria satisfeito com duas identidades falsas. O portão continuaria verde  │
-- │ enquanto a garantia que ele protege teria deixado de existir.               │
-- │                                                                            │
-- │ ESCOLHIDA: a linha DIZ que é importada, e os CHECK passam a exigir a        │
-- │ corrente de confirmações só de quem foi registrado por uma PESSOA. Os       │
-- │ cinco campos ficam NULOS nas linhas importadas, que é a verdade: ninguém    │
-- │ confirmou nada aqui dentro, o fato veio de fora já fechado.                 │
-- │                                                                            │
-- │ É a mesma separação que as telas de churn já usam — a camada medida e a     │
-- │ camada registrada, e nenhuma finge ser a outra. `origem_do_registro` é o    │
-- │ nome dessa fronteira dentro da tabela.                                     │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ O QUE ESTA MIGRATION NÃO AFROUXA.                                         │
-- │                                                                            │
-- │ · `desconto_tem_mrr_novo` fica INTACTO, de propósito. Os 11 tickets de      │
-- │   desconto têm `[CSM] Valor do Desconto` ambíguo — em 5 dos 11 ele é IGUAL  │
-- │   ao MRR, então não se sabe se é o valor novo ou o valor do abatimento. O   │
-- │   CHECK forte é o que impede a carga de gravar contração errada no ledger:  │
-- │   esses 11 ficam de fora até alguém dizer o que o campo significa.          │
-- │ · `origem_cliente_tem_levantada` fica intacto: os 485 têm data de levantada │
-- │   e MRR, medido, então não há nada a dispensar.                             │
-- │ · Para `origem_do_registro = 'humano'` — o padrão, e o que toda ação de     │
-- │   `@pulse/success` grava — os quatro CHECK continuam exatamente como eram.  │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ `ticket_externo` É O QUE TORNA A CARGA REPETÍVEL.                          │
-- │                                                                            │
-- │ Sem chave externa, rodar a carga duas vezes cria 970 linhas e ninguém       │
-- │ descobre pela tela — 485 cartões duplicados parecem 485 clientes a mais     │
-- │ pedindo cancelamento. Com ela, a segunda execução é `ON CONFLICT DO         │
-- │ UPDATE`, e a base corrigida que vier depois ATUALIZA em vez de duplicar.    │
-- │                                                                            │
-- │ Índice PARCIAL (`WHERE ... IS NOT NULL`): o pedido que uma pessoa abre na   │
-- │ tela não tem ticket no HubSpot, e um índice único comum recusaria o         │
-- │ segundo desses.                                                            │
-- │                                                                            │
-- │ De brinde, o cartão do quadro passa a poder linkar para o ticket de onde    │
-- │ ele veio — e o time trabalha nos dois lugares.                             │
-- └───────────────────────────────────────────────────────────────────────────┘

BEGIN;

ALTER TABLE success.cancellation
  ADD COLUMN origem_do_registro text NOT NULL DEFAULT 'humano',
  ADD COLUMN ticket_externo     text;

ALTER TABLE success.cancellation
  ADD CONSTRAINT cancellation_origem_do_registro_check
  CHECK (origem_do_registro IN ('humano', 'carga_hubspot'));

COMMENT ON COLUMN success.cancellation.origem_do_registro IS
  'humano = alguém registrou na tela e a corrente de confirmações vale; '
  'carga_hubspot = história importada, os campos de confirmação são nulos porque '
  'ninguém confirmou nada aqui dentro.';

COMMENT ON COLUMN success.cancellation.ticket_externo IS
  'O "Ticket ID" do HubSpot. Chave natural da carga: é o que faz reexecutar '
  'atualizar em vez de duplicar. Nulo em pedido aberto na própria tela.';

CREATE UNIQUE INDEX cancellation_ticket_externo_uk
  ON success.cancellation (ticket_externo)
  WHERE ticket_externo IS NOT NULL;

-- ── O canal ganha `outro`, porque o HubSpot o usa 94 vezes ──────────────────
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ O enum tinha cinco valores tirados do desenho, não da base. Medido no      │
-- │ export: `Outro` aparece em 94 dos 485 tickets — mais que Telefônico (11) e │
-- │ quase tanto quanto Reunião (145). E dois dos cinco que eu declarei,         │
-- │ `email` e `formulario`, não aparecem NENHUMA vez.                          │
-- │                                                                            │
-- │ Sem `outro`, 94 tickets entrariam com canal nulo — e nulo aqui diria "não  │
-- │ sei por onde veio" quando a verdade registrada é "veio por um canal que a  │
-- │ lista não nomeia". São coisas diferentes e a tela mostra as duas.          │
-- └───────────────────────────────────────────────────────────────────────────┘
ALTER TABLE success.cancellation DROP CONSTRAINT cancellation_canal_check;
ALTER TABLE success.cancellation
  ADD CONSTRAINT cancellation_canal_check CHECK (
    canal = ANY (ARRAY['email', 'reuniao', 'whatsapp', 'formulario', 'telefone', 'outro'])
  );

-- ── Os quatro CHECK, recriados exigindo a corrente só de quem é `humano` ─────
-- Recriar e não alterar: o Postgres não tem ALTER CONSTRAINT para CHECK, e
-- DROP + ADD na mesma transação nunca deixa a tabela sem a garantia.

ALTER TABLE success.cancellation DROP CONSTRAINT encerrado_tem_efeito_e_aprovacao;
ALTER TABLE success.cancellation
  ADD CONSTRAINT encerrado_tem_efeito_e_aprovacao CHECK (
    origem_do_registro <> 'humano'
    OR estado <> 'encerrado'
    OR (competencia_efeito_receita IS NOT NULL AND aprovado_por IS NOT NULL)
  );

ALTER TABLE success.cancellation DROP CONSTRAINT encerrado_tem_motivo_confirmado;
ALTER TABLE success.cancellation
  ADD CONSTRAINT encerrado_tem_motivo_confirmado CHECK (
    origem_do_registro <> 'humano'
    OR estado <> 'encerrado'
    OR motivo_confirmado_por IS NOT NULL
  );

ALTER TABLE success.cancellation DROP CONSTRAINT efeito_receita_exige_duas_confirmacoes;
ALTER TABLE success.cancellation
  ADD CONSTRAINT efeito_receita_exige_duas_confirmacoes CHECK (
    origem_do_registro <> 'humano'
    OR competencia_efeito_receita IS NULL
    OR estado = ANY (ARRAY['desconto', 'renegociado'])
    OR (aviso_confirmado_por IS NOT NULL AND aviso_confirmado_em IS NOT NULL
        AND cobranca_confirmada_por IS NOT NULL AND cobranca_confirmada_em IS NOT NULL
        AND competencia_ultima_cobranca IS NOT NULL)
  );

ALTER TABLE success.cancellation DROP CONSTRAINT retido_tem_autor;
ALTER TABLE success.cancellation
  ADD CONSTRAINT retido_tem_autor CHECK (
    origem_do_registro <> 'humano'
    OR estado <> 'retido'
    OR (retido_em IS NOT NULL AND retido_por IS NOT NULL)
  );

COMMIT;
