-- ═══════════════════════════════════════════════════════════════════════════
-- A massa do teste de arraste do quadro: UM cartão em cada posição.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ APAGA E REFAZ, de propósito.                                              │
-- │                                                                            │
-- │ O teste ARRASTA: ele muda o estado dos cartões que encontra. Rodá-lo duas   │
-- │ vezes sem refazer a massa falha no segundo passo — e falha MENTINDO, porque │
-- │ "a Clínica não é arrastável" é verdade depois de o próprio teste tê-la      │
-- │ movido para um desfecho. Aconteceu na primeira execução, em 10/09/2026.    │
-- │                                                                            │
-- │ O `TRUNCATE` é seguro aqui e SÓ aqui: este arquivo se roda contra o         │
-- │ Postgres descartável do e2e, nunca contra a produção. Confira a porta       │
-- │ antes: 127.0.0.1:5457, jamais 5434.                                        │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- As oito contas são idempotentes por `razao_social`; os pedidos são refeitos.

BEGIN;

TRUNCATE success.cancellation CASCADE;


INSERT INTO core.account (razao_social, cnpj, ativo, csm_email, status_core)
SELECT v.nome, v.cnpj, true, 'stack@alloyal.com.br', 'ativo'
  FROM (VALUES
    ('Padaria Bela Vista',    '11111111000101'),
    ('Metalurgica Horizonte', '22222222000102'),
    ('Clinica Sao Rafael',    '33333333000103'),
    ('Editora Lumen',         '44444444000104'),
    ('Oficina Trevo',         '55555555000105'),
    ('Hotel Miramar',         '66666666000106'),
    ('Grafica Aurora Sul',    '77777777000107'),
    ('Distribuidora Norte',   '88888888000108')
  ) AS v(nome, cnpj)
 WHERE NOT EXISTS (SELECT 1 FROM core.account a WHERE a.razao_social = v.nome);

-- pedido (anunciado) — com aviso prévio: pode ir para a coluna de perda.
INSERT INTO success.cancellation
  (account_id, origem, estado, data_levantada, canal, quem_comunicou,
   mrr_centavos_na_levantada, aviso_previo_dias, motivo, etapa_desde, criado_por)
SELECT id, 'cliente', 'anunciado', current_date - 3, 'email', 'Compras',
       480075, 30, 'custo', now() - interval '3 days', 'seed@alloyal.com.br'
  FROM core.account WHERE razao_social = 'Padaria Bela Vista';

-- pedido SEM aviso prévio: a coluna de perda tem de recusar por falta do dado.
INSERT INTO success.cancellation
  (account_id, origem, estado, data_levantada, canal,
   mrr_centavos_na_levantada, aviso_previo_dias, motivo, etapa_desde, criado_por)
SELECT id, 'cliente', 'anunciado', current_date - 20, 'whatsapp',
       915030, NULL, 'uso', now() - interval '20 days', 'seed@alloyal.com.br'
  FROM core.account WHERE razao_social = 'Distribuidora Norte';

-- financeiro
INSERT INTO success.cancellation
  (account_id, origem, estado, data_levantada, canal,
   mrr_centavos_na_levantada, aviso_previo_dias, motivo, etapa_desde, criado_por)
SELECT id, 'cliente', 'financeiro', current_date - 9, 'reuniao',
       1230040, 60, 'servico', now() - interval '9 days', 'seed@alloyal.com.br'
  FROM core.account WHERE razao_social = 'Metalurgica Horizonte';

-- reversao, e ESTAGNADO (mais de 14 dias na etapa)
INSERT INTO success.cancellation
  (account_id, origem, estado, data_levantada, canal,
   mrr_centavos_na_levantada, aviso_previo_dias, motivo, etapa_desde, criado_por)
SELECT id, 'cliente', 'reversao', current_date - 40, 'telefone',
       27500, 30, 'concorrente', now() - interval '22 days', 'seed@alloyal.com.br'
  FROM core.account WHERE razao_social = 'Clinica Sao Rafael';

-- em_aviso, origem cliente → coluna `cancelamento`
INSERT INTO success.cancellation
  (account_id, origem, estado, data_levantada, canal,
   mrr_centavos_na_levantada, aviso_previo_dias, aviso_confirmado_por,
   aviso_confirmado_em, data_fim_aviso, motivo, etapa_desde, criado_por)
SELECT id, 'cliente', 'em_aviso', current_date - 15, 'email',
       660020, 30, 'stack@alloyal.com.br', now() - interval '2 days',
       current_date + 15, 'preco', now() - interval '2 days', 'seed@alloyal.com.br'
  FROM core.account WHERE razao_social = 'Editora Lumen';

-- retido (desfecho: cartão parado)
INSERT INTO success.cancellation
  (account_id, origem, estado, data_levantada, canal,
   mrr_centavos_na_levantada, aviso_previo_dias, motivo, retido_em, retido_por,
   etapa_desde, criado_por)
SELECT id, 'cliente', 'retido', current_date - 30, 'reuniao',
       340060, 30, 'atendimento', current_date - 5, 'stack@alloyal.com.br',
       now() - interval '5 days', 'seed@alloyal.com.br'
  FROM core.account WHERE razao_social = 'Oficina Trevo';

-- desconto (desfecho)
INSERT INTO success.cancellation
  (account_id, origem, estado, data_levantada, canal,
   mrr_centavos_na_levantada, mrr_novo_centavos, competencia_efeito_receita,
   aviso_previo_dias, motivo, etapa_desde, criado_por, aprovado_por, aprovado_em)
SELECT id, 'cliente', 'desconto', current_date - 25, 'email',
       800000, 560000, date_trunc('month', current_date)::date,
       30, 'custo', now() - interval '4 days', 'seed@alloyal.com.br',
       'stack@alloyal.com.br', now() - interval '4 days'
  FROM core.account WHERE razao_social = 'Hotel Miramar';

-- pdd: encerrado com origem alloyal (sem levantada — o CHECK só a exige de cliente)
INSERT INTO success.cancellation
  (account_id, origem, estado, canal, mrr_centavos_na_levantada,
   aviso_previo_dias, aviso_confirmado_por, aviso_confirmado_em,
   competencia_ultima_cobranca, cobranca_confirmada_por, cobranca_confirmada_em,
   competencia_efeito_receita, motivo, motivo_confirmado_por, motivo_confirmado_em,
   aprovado_por, aprovado_em, etapa_desde, criado_por)
SELECT id, 'alloyal', 'encerrado', 'email', 220050,
       30, 'stack@alloyal.com.br', now() - interval '40 days',
       (date_trunc('month', current_date) - interval '1 month')::date,
       'stack@alloyal.com.br', now() - interval '35 days',
       date_trunc('month', current_date)::date, 'inadimplencia',
       'financeiro@alloyal.com.br', now() - interval '35 days',
       'stack@alloyal.com.br', now() - interval '34 days',
       now() - interval '34 days', 'seed@alloyal.com.br'
  FROM core.account WHERE razao_social = 'Grafica Aurora Sul';

COMMIT;
