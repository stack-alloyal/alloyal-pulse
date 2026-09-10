-- ============================================================================
-- 0058 · O calendário de feriado, e o dia útil que passa a respeitá-lo
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ A LACUNA QUE A 0048 ANOTOU, e por que ela virou urgente.                   │
-- │                                                                            │
-- │ A 0048 deixou `core.dia_util_antes` pulando só sábado e domingo, e escreveu │
-- │ o motivo: "inventar uma lista aqui seria pior que não ter (…) uma lista     │
-- │ incompleta erra em silêncio no dia em que alguém confia nela". A ressalva   │
-- │ continua certa, e é o desenho desta migração que responde a ela — ver o     │
-- │ bloco COBERTURA abaixo.                                                    │
-- │                                                                            │
-- │ O que mudou é a medida. Em 09/09/2026 o usuário levantou exatamente este    │
-- │ ponto: "se o pagamento cai para pagamento em uma sexta-feira, somente na    │
-- │ segunda ao fim do dia teremos a atualização". A carência de dois dias úteis │
-- │ já faz sexta→terça certo. Mas se a SEGUNDA for feriado, o Omie só atualiza  │
-- │ na terça à noite e a visão só vale na quarta — e a função contava a segunda │
-- │ como útil, encurtando a carência em um dia.                                │
-- │                                                                            │
-- │ Medido na base, e não estimado:                                            │
-- │   · Aparecida cai numa SEGUNDA, 12/10/2026 — e Finados também, 02/11.       │
-- │   · SEGUNDA é o vencimento mais comum: 2.306 títulos em 12 meses, 38,3%,    │
-- │     R$ 13,0 milhões. (O comentário da 0048 dizia que era a sexta; sexta é a │
-- │     maior em DINHEIRO, R$ 15,4 mi, não em quantidade.)                      │
-- │   · 28 títulos, R$ 178.613,69, têm vencimento EM feriado nacional — a fonte │
-- │     emite, então o caso não é teórico.                                     │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ COBERTURA: a lista incompleta não pode errar em silêncio.                  │
-- │                                                                            │
-- │ É a objeção da 0048, e tem duas respostas.                                 │
-- │                                                                            │
-- │ 1. A DEGRADAÇÃO É SEGURA. Fora do intervalo semeado a função volta a contar │
-- │    só o fim de semana — isto é, ao comportamento de HOJE, que está          │
-- │    documentado e é tolerável. Ela não passa a produzir número errado e      │
-- │    plausível; volta a produzir o número conhecido.                         │
-- │                                                                            │
-- │ 2. O AVISO É ALTO. `core.feriado_cobertura()` diz até quando o calendário   │
-- │    vai, e um portão em `inadimplencia.test.ts` RECUSA cobertura de menos de │
-- │    12 meses à frente. Quando faltar um ano para acabar, o CI quebra com o   │
-- │    recado — não o número na tela.                                          │
-- │                                                                            │
-- │ A função NÃO levanta exceção fora da cobertura, e é decisão: `vencimento    │
-- │ <= NULL` não é erro, é ZERO LINHA. Uma função que falhasse aqui deixaria a  │
-- │ tela de inadimplência vazia — o pior dos resultados, porque vazio parece    │
-- │ "não há inadimplência" em vez de "não sei responder".                      │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ QUAL CALENDÁRIO: o BANCÁRIO NACIONAL, e o municipal continua de fora.      │
-- │                                                                            │
-- │ O que importa aqui é quando o pagamento aparece no Omie, e isso segue a     │
-- │ liquidação bancária. Então entram os nove feriados nacionais fixos mais os  │
-- │ quatro móveis em que o banco não opera — Carnaval (segunda e terça),        │
-- │ Sexta-feira Santa e Corpus Christi. Carnaval é ponto facultativo para o     │
-- │ serviço público e fechamento efetivo para o banco; é o banco que decide se  │
-- │ o boleto compensa.                                                         │
-- │                                                                            │
-- │ Feriado MUNICIPAL fica fora, e agora por um motivo mais forte que "é        │
-- │ difícil": ele depende da praça do PAGADOR, que não temos em lugar nenhum do │
-- │ modelo. A coluna `tipo` existe para que uma praça conhecida possa ser        │
-- │ acrescentada por INSERT, sem tocar na função nem em migração nova.          │
-- │                                                                            │
-- │ O resíduo, então, deixou de ser "toda semana com feriado" e passou a ser    │
-- │ "semana com feriado municipal da praça do pagador" — mais estreito, e ainda │
-- │ sempre para o mesmo lado (um dia a mais na fila, nunca a menos).            │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ MEXER NISTO MUDA NÚMERO ANTIGO SE ALGUÉM REAPURAR.                        │
-- │                                                                            │
-- │ As 68 fotos de `analytics.inadimplencia_mes` já estão gravadas e não mudam  │
-- │ sozinhas. Mas `reconstruirHistorico` passa a produzir números um pouco      │
-- │ diferentes dos guardados, nas competências que têm feriado perto da virada. │
-- │ A diferença é para o lado CERTO — a carência era curta —, e é por isso que  │
-- │ está escrito aqui em vez de descoberto depois.                             │
-- └───────────────────────────────────────────────────────────────────────────┘
-- ============================================================================

BEGIN;

-- ── A Páscoa, de onde saem os quatro móveis ─────────────────────────────────
--
-- Algoritmo gregoriano anônimo (Meeus/Jones/Butcher). Aritmética pura, então
-- IMMUTABLE de verdade. Semear as datas móveis à mão seria 4 linhas por ano
-- para conferir na unha; a fórmula fecha o assunto e o teste a confere contra
-- anos de Páscoa conhecida.
CREATE OR REPLACE FUNCTION core.pascoa(ano integer)
RETURNS date
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  WITH t AS (
    SELECT ano % 19 AS a, ano / 100 AS b, ano % 100 AS c
  ), u AS (
    SELECT a, b, c, b / 4 AS d, b % 4 AS e, (b + 8) / 25 AS f FROM t
  ), v AS (
    SELECT a, c, d, e, (b - f + 1) / 3 AS g, b FROM u
  ), w AS (
    SELECT a, c, d, e, g, (19 * a + b - d - g + 15) % 30 AS h FROM v
  ), x AS (
    SELECT a, h, e, c / 4 AS i, c % 4 AS k FROM w
  ), y AS (
    SELECT a, h, (32 + 2 * e + 2 * i - h - k) % 7 AS l FROM x
  ), z AS (
    SELECT h, l, (a + 11 * h + 22 * l) / 451 AS m FROM y
  )
  SELECT make_date(ano, (h + l - 7 * m + 114) / 31,
                        ((h + l - 7 * m + 114) % 31) + 1)
    FROM z
$$;

COMMENT ON FUNCTION core.pascoa(integer) IS
  'Domingo de Pascoa do ano, pelo algoritmo gregoriano anonimo. Base dos quatro feriados moveis do calendario bancario: Carnaval (-48 e -47 dias), Sexta-feira Santa (-2) e Corpus Christi (+60).';

-- ── A tabela ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS core.feriado (
  data       date PRIMARY KEY,
  nome       text NOT NULL,
  -- `nacional` e `bancario` são os dois que a liquidação de boleto respeita.
  -- `municipal` existe para a praça que alguém venha a conhecer, e é o único
  -- que pode ser acrescentado sem migração.
  tipo       text NOT NULL CHECK (tipo IN ('nacional', 'bancario', 'municipal')),
  fonte      text NOT NULL,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.feriado IS
  'Calendario de feriado que atrasa a liquidacao bancaria. Semeado com o nacional (fixo e movel) de 2019 a 2040 -- ver o cabecalho da 0058 para por que o municipal fica de fora e como acrescenta-lo. Fora do intervalo semeado, core.dia_util_antes volta a contar so fim de semana.';

-- ── A semeadura: 2019 a 2040 ────────────────────────────────────────────────
--
-- O dado REAL começa em 2021: vencimento mais antigo 2021-01-25, foto mais
-- antiga 2021-02-01. Semear de 2019 é por causa da SUÍTE, que tem fixture em
-- julho de 2019 — calendário que não cobre a data do teste faz o teste
-- exercitar o caminho degradado em vez do que produção usa, e aí o portão
-- deixa de guardar o que interessa.
--
-- 2040 dá catorze anos de folga à frente, e o portão de cobertura avisa muito
-- antes de acabar.
INSERT INTO core.feriado (data, nome, tipo, fonte)
SELECT make_date(ano, mes, dia), nome, 'nacional', '0058'
  FROM generate_series(2019, 2040) AS ano,
       (VALUES (1, 1, 'Confraternização Universal'),
               (4, 21, 'Tiradentes'),
               (5, 1, 'Dia do Trabalho'),
               (9, 7, 'Independência'),
               (10, 12, 'Nossa Senhora Aparecida'),
               (11, 2, 'Finados'),
               (11, 15, 'Proclamação da República'),
               -- Nacional desde a Lei 14.759/2023. Antes disso era municipal em
               -- várias praças; semeado no intervalo todo de propósito, porque o
               -- que interessa é o banco ter fechado, não a lei ter mudado.
               (11, 20, 'Consciência Negra'),
               (12, 25, 'Natal')) AS f(mes, dia, nome)
ON CONFLICT (data) DO NOTHING;

INSERT INTO core.feriado (data, nome, tipo, fonte)
SELECT core.pascoa(ano) + deslocamento, nome, 'bancario', '0058'
  FROM generate_series(2019, 2040) AS ano,
       (VALUES (-48, 'Carnaval (segunda)'),
               (-47, 'Carnaval (terça)'),
               (-2, 'Sexta-feira Santa'),
               (60, 'Corpus Christi')) AS m(deslocamento, nome)
ON CONFLICT (data) DO NOTHING;

-- ── Até onde o calendário responde ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION core.feriado_cobertura()
RETURNS TABLE (de date, ate date, quantos bigint)
LANGUAGE sql
STABLE PARALLEL SAFE
AS $$
  SELECT min(data), max(data), count(*) FROM core.feriado
$$;

COMMENT ON FUNCTION core.feriado_cobertura() IS
  'Intervalo coberto pelo calendario. Existe para o portao: inadimplencia.test.ts recusa cobertura de menos de 12 meses a frente, para o CI quebrar com recado antes de a carencia encurtar em silencio.';

-- ── O dia útil, agora com feriado ───────────────────────────────────────────
--
-- Deixa de ser IMMUTABLE e passa a STABLE: ela lê tabela. Conferido antes de
-- mexer — nenhum índice e nenhuma coluna gerada dependem dela, então a troca
-- não invalida nada.
--
-- A JANELA VAI DE 30 PARA 60 DIAS, e não é excesso de zelo. Trinta dias corridos
-- têm 22 dias úteis hoje; tirando feriado, uma janela com Carnaval e Sexta-feira
-- Santa perde mais. Se a janela não alcançar o n-ésimo dia útil a função devolve
-- NULL — e `vencimento <= NULL` é ZERO LINHA, não erro: a tela de inadimplência
-- ficaria vazia sem nada quebrar. Sessenta linhas de `generate_series` custam
-- nada e tiram esse caminho do mapa.
CREATE OR REPLACE FUNCTION core.dia_util_antes(d date, n integer)
RETURNS date
LANGUAGE sql
STABLE STRICT PARALLEL SAFE
AS $$
  SELECT (d - g)::date
    FROM generate_series(1, 60) AS g
   WHERE extract(isodow FROM d - g) < 6
     AND NOT EXISTS (SELECT 1 FROM core.feriado f WHERE f.data = (d - g)::date)
   ORDER BY g
  OFFSET greatest(n, 1) - 1
   LIMIT 1
$$;

COMMENT ON FUNCTION core.dia_util_antes(date, integer) IS
  'O n-esimo dia util ANTES de d, pulando fim de semana E core.feriado. Usada pela inadimplencia para transformar "carencia de N dias uteis" num corte por data. Fora do intervalo semeado em core.feriado, degrada para so-fim-de-semana (o comportamento anterior a 0058) -- ver o bloco COBERTURA no cabecalho dela.';

GRANT SELECT ON core.feriado TO pulse_api, pulse_worker;
GRANT EXECUTE ON FUNCTION core.pascoa(integer) TO pulse_api, pulse_worker;
GRANT EXECUTE ON FUNCTION core.feriado_cobertura() TO pulse_api, pulse_worker;

COMMIT;
