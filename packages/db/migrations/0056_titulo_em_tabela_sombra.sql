-- 0056 — a carga de títulos do Omie ganha tabela sombra, e o vivo ganha TRUNCATE.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ O DEFEITO, medido em 02/09/2026: a carga nunca remove o que sumiu da fonte. │
-- │                                                                            │
-- │ O C20 roda todo dia às 04:10, completo (`parcial: false` em 20 execuções   │
-- │ seguidas), e grava com `ON CONFLICT DO UPDATE`. Ele acrescenta e atualiza,  │
-- │ e NUNCA apaga. Então título que o Omie para de devolver fica aqui para      │
-- │ sempre, com o `sincronizado_em` congelado no último dia em que existiu.     │
-- │                                                                            │
-- │ Medido: o banco guardava 90.906 títulos e a API devolveu 89.827. A          │
-- │ diferença de 1.079 são fantasmas. Dos 1.079, 1.073 são `previsao` —          │
-- │ provisórios que mudam de identidade ao serem emitidos — e são inofensivos,   │
-- │ porque `analytics.mrr_faturado_mes` já exclui `previsao`.                   │
-- │                                                                            │
-- │ Os outros 6 são `atrasado`, e esses CONTAM: R$ 31.020,64 de R$ 2.168.681,84 │
-- │ da carteira em atraso de setembro — 1,4% — vinham de títulos que a fonte    │
-- │ não confirma há até 19 dias. Se foram pagos no Omie, é dívida fantasma no   │
-- │ número que o Financeiro cobra.                                             │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ POR QUE SOMBRA, E NÃO SÓ UM DELETE DO QUE FICOU PARA TRÁS.                 │
-- │                                                                            │
-- │ O comentário de `gravarOmie` explica por que era upsert, e as duas razões   │
-- │ dele continuam válidas: "apagar deixaria a tela vazia durante a carga, e    │
-- │ uma carga PARCIAL apagaria dado bom para gravar menos do que havia".        │
-- │                                                                            │
-- │ A sombra responde às duas, e é o que o PRD já prescreve para carga          │
-- │ completa: carrega fora do caminho, VALIDA a contagem contra o que está      │
-- │ vivo, e só então troca — numa transação só, então nenhum leitor vê a        │
-- │ tabela vazia nem meio trocada. Varrer o vivo com DELETE resolveria o        │
-- │ fantasma e deixaria as duas razões originais de pé.                        │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ A SOMBRA NÃO LEVA OS SEIS ÍNDICES DE CONSULTA, só a chave.                 │
-- │                                                                            │
-- │ `core.omie_titulo` tem 7 índices, e eles servem às telas. Na sombra só a    │
-- │ PK importa — é ela que o `ON CONFLICT` usa para absorver a sobreposição     │
-- │ entre páginas da API. Os outros seis só custariam escrita em 90 mil linhas  │
-- │ por dia, para responder consulta que ninguém faz nela.                     │
-- └───────────────────────────────────────────────────────────────────────────┘

BEGIN;

CREATE TABLE IF NOT EXISTS core.omie_titulo_sombra (
  LIKE core.omie_titulo INCLUDING DEFAULTS INCLUDING GENERATED
);

-- A chave, e só ela: o `ON CONFLICT (codigo_titulo)` da carga depende dela.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'core.omie_titulo_sombra'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE core.omie_titulo_sombra
      ADD CONSTRAINT omie_titulo_sombra_pkey PRIMARY KEY (codigo_titulo);
  END IF;
END $$;

COMMENT ON TABLE core.omie_titulo_sombra IS
  'Área de carga do C20. Vive vazia entre execuções; o conteúdo é descartável por desenho.';

-- ── Os grants ────────────────────────────────────────────────────────────────
--
-- TRUNCATE no VIVO é o que a troca precisa, e o worker não tinha: ele tem DELETE
-- desde sempre, mas DELETE em 90 mil linhas todo dia deixaria 90 mil tuplas mortas
-- por trás, para o autovacuum limpar. TRUNCATE não deixa, e dentro da transação da
-- troca é igualmente atômico.
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON core.omie_titulo_sombra TO pulse_worker;
GRANT TRUNCATE ON core.omie_titulo TO pulse_worker;
-- A app só lê o vivo; a sombra não é assunto dela.
GRANT SELECT ON core.omie_titulo_sombra TO pulse_api;

COMMIT;
