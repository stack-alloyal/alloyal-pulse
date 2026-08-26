-- ============================================================================
-- 0048 · Dia útil, e a carência que a inadimplência precisa
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ POR QUE D+1 NÃO É INADIMPLÊNCIA.                                           │
-- │                                                                            │
-- │ O pagamento leva um dia útil para ser processado e aparecer no Omie. Um     │
-- │ título que vence na segunda e é pago na segunda só é visível na terça — e a │
-- │ nossa carga do Omie (C20) roda às 04h10, antes de o dia da terça acontecer. │
-- │ Então quem paga em dia aparece devendo por dois dias.                       │
-- │                                                                            │
-- │ Medido na tela: a SWILE apareceu como o MAIOR devedor da fila com R$ 59.625 │
-- │ e UM dia de atraso, e a HINOVA com R$ 33.955 e dois. Eu tinha posto um      │
-- │ rótulo "em trânsito?" ao lado — o que é admitir na interface que a lista    │
-- │ está errada em vez de consertar a lista.                                    │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ DIA ÚTIL E NÃO DIA CORRIDO, e a diferença não é preciosismo.                │
-- │                                                                            │
-- │ Carência de dois dias CORRIDOS não resolve a sexta-feira: quem vence e paga │
-- │ na sexta só aparece na segunda ou na terça, e no domingo já estaria na       │
-- │ fila. Vencimento em sexta é o caso mais comum de boleto mensal.             │
-- │                                                                            │
-- │ A função devolve o N-ésimo dia útil ANTES de uma data, e é assim que o corte │
-- │ vira UMA data em vez de uma conta por linha: "está atrasado quem venceu até  │
-- │ o segundo dia útil atrás". Dias úteis decorridos crescem junto com a         │
-- │ antiguidade do vencimento, então o corte por data é exatamente equivalente — │
-- │ e custa uma avaliação em vez de noventa mil.                                 │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ SÓ FIM DE SEMANA, NÃO FERIADO — e isto é uma lacuna conhecida.              │
-- │                                                                            │
-- │ O projeto não tem tabela de feriado, e inventar uma lista aqui seria pior   │
-- │ que não ter: feriado nacional é fácil, mas o que atrasa compensação bancária │
-- │ inclui municipal, e uma lista incompleta erra em silêncio no dia em que      │
-- │ alguém confia nela.                                                        │
-- │                                                                            │
-- │ O efeito da lacuna é estreito e sempre para o mesmo lado: numa semana com    │
-- │ feriado, um título pago em dia pode aparecer na fila por um dia. É o mesmo   │
-- │ defeito que esta migração conserta, reduzido de "todo mês" para "no dia      │
-- │ seguinte a um feriado". Quando houver tabela de feriado, é aqui que ela      │
-- │ entra — em UM lugar.                                                        │
-- └───────────────────────────────────────────────────────────────────────────┘
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION core.dia_util_antes(d date, n integer)
RETURNS date
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  -- Olha até 30 dias para trás: 30 dias corridos contêm no mínimo 20 dias úteis,
  -- então a janela cobre qualquer `n` que faça sentido aqui com folga larga. Fixa
  -- de propósito — janela dependente de `n` seria uma segunda regra para manter.
  SELECT (d - g)::date
    FROM generate_series(1, 30) AS g
   WHERE extract(isodow FROM d - g) < 6
   ORDER BY g
  OFFSET greatest(n, 1) - 1
   LIMIT 1
$$;

COMMENT ON FUNCTION core.dia_util_antes(date, integer) IS
  'O n-esimo dia util ANTES de d, contando so fim de semana como nao-util (o projeto nao tem tabela de feriado -- ver o cabecalho da 0048). Usada pela inadimplencia para transformar "carencia de N dias uteis" num corte por data: dia util decorrido cresce junto com a antiguidade do vencimento, entao o corte por data e equivalente e custa uma avaliacao em vez de uma por linha.';

-- `pulse_api` e `pulse_worker` precisam chamar: a carência vale na lista de hoje
-- (api) e na apuração da foto (worker). EXECUTE em função não vem de graça
-- quando o schema não é público.
GRANT EXECUTE ON FUNCTION core.dia_util_antes(date, integer) TO pulse_api, pulse_worker;

COMMIT;
