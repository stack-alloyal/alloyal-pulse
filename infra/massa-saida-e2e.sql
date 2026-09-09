-- Massa para `packages/ui/testes-navegador/saida-ponta-a-ponta.mjs`.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ POR QUE ESTE ARQUIVO EXISTE.                                              │
-- │                                                                            │
-- │ O roteiro no cabeçalho do teste descrevia a massa em PROSA — "duas contas   │
-- │ ativas, contrato numa, faturamento de 6 meses nas duas". Prosa não roda, e  │
-- │ o teste espera nome e valor EXATOS ("Transportadora Aurora", R$ 12.500,00). │
-- │ Sem este arquivo, quem tentasse rodar via `make seed` levava sete falhas de │
-- │ massa que PARECEM defeito de produto — foi o que aconteceu em 09/09/2026.   │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ⚠ SÓ EM BANCO DESCARTÁVEL. Cria conta, contrato e faturamento sintéticos.
--   O teste recusa BASE que não seja loopback; este arquivo não tem como saber
--   onde está, então a recusa vive lá e a regra vive aqui.
--
--   docker exec -i pulse-pg-e2e psql -U postgres -d pulse -f - < infra/massa-saida-e2e.sql

BEGIN;

-- A conta que o teste procura pelo nome.
INSERT INTO core.account (razao_social, cnpj, ativo, status_core, porte, setor)
VALUES ('Transportadora Aurora', '19.876.543/0001-21', true, 'active', 'medio', 'logistica')
ON CONFLICT DO NOTHING;

-- O contrato: R$ 12.500,00/mês. O teste confere que `anunciar` congela ESTE
-- valor, e não o faturado — a conta tem os dois, e o contrato vence na ordem de
-- resolução da função.
INSERT INTO core.contract
  (account_id, mrr_centavos, inicio, vigencia_fim, aviso_previo_dias, status_vigencia, tipo_receita)
SELECT a.id, 1250000, current_date - interval '18 months', current_date + interval '6 months',
       30, 'vigente', 'recorrente'
  FROM core.account a
 WHERE a.razao_social = 'Transportadora Aurora'
   AND NOT EXISTS (SELECT 1 FROM core.contract c WHERE c.account_id = a.id);

-- ── O faturamento ───────────────────────────────────────────────────────────
-- `analytics.mrr_faturado_mes` é VIEW sobre o Omie, e o `make seed` não popula
-- Omie nenhum: sem estas três inserções o select do cadastro fica vazio, e a
-- própria tela avisa ("ou o faturamento não foi carregado").
--
-- O `documento` é dígito puro: há CHECK em `omie_cliente` que recusa o CNPJ
-- pontuado, e o vínculo tem de casar com a forma guardada, não com a exibida.
INSERT INTO core.omie_cliente (codigo_omie, documento, razao_social, tags)
SELECT 8809001, regexp_replace(a.cnpj, '[^0-9]', '', 'g'), a.razao_social, '["Cliente"]'::jsonb
  FROM core.account a WHERE a.razao_social = 'Transportadora Aurora'
ON CONFLICT (codigo_omie) DO NOTHING;

INSERT INTO core.vinculo_cliente (account_id, fonte, chave, origem, motivo, criado_por)
SELECT a.id, 'omie', o.documento, 'manual', 'massa do teste ponta a ponta de saida', 'e2e'
  FROM core.account a
  JOIN core.omie_cliente o ON o.documento = regexp_replace(a.cnpj, '[^0-9]', '', 'g')
 WHERE a.razao_social = 'Transportadora Aurora'
   AND NOT EXISTS (SELECT 1 FROM core.vinculo_cliente v
                    WHERE v.account_id = a.id AND v.chave = o.documento AND v.fonte = 'omie');

-- Seis competências recebidas, a última no mês corrente: o select só oferece o
-- MRR como congelável se estiver dentro da carência de dois meses.
INSERT INTO core.omie_titulo
  (codigo_titulo, documento, codigo_cliente, categoria, status, emissao, vencimento,
   valor_centavos, pago_centavos, aberto_centavos, liquidado)
SELECT 7709000 + g, o.documento, o.codigo_omie, 'mensalidade', 'RECEBIDO',
       (date_trunc('month', current_date) - (g || ' months')::interval)::date,
       (date_trunc('month', current_date) - (g || ' months')::interval)::date + 9,
       1250000, 1250000, 0, true
  FROM core.omie_cliente o CROSS JOIN generate_series(0, 5) g
 WHERE o.codigo_omie = 8809001
ON CONFLICT (codigo_titulo) DO NOTHING;

COMMIT;

\echo '── conferência ──'
SELECT a.razao_social, (c.mrr_centavos/100.0)::text AS contrato_reais,
       (SELECT count(*) FROM core.omie_titulo t WHERE t.documento = regexp_replace(a.cnpj,'[^0-9]','','g'))::text AS titulos,
       (SELECT count(*) FROM analytics.mrr_faturado_mes m WHERE m.account_id = a.id)::text AS na_visao
  FROM core.account a LEFT JOIN core.contract c ON c.account_id = a.id
 WHERE a.razao_social = 'Transportadora Aurora';
