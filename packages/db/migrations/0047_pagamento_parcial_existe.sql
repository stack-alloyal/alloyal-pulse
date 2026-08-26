-- ============================================================================
-- 0047 · Pagamento parcial EXISTE, e a 0045 jurava que não
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ A 0045 afirma, em comentário de coluna: "pagamento parcial NÃO EXISTE       │
-- │ nesta base. Zero títulos em aberto com parte paga." A afirmação está        │
-- │ errada, e o erro foi de MEDIÇÃO, não de leitura da regra.                   │
-- │                                                                            │
-- │ Eu procurei por `pagamento IS NULL AND pago_centavos > 0` e achei zero. O    │
-- │ Omie não registra baixa parcial assim — ele põe a DATA de pagamento e deixa  │
-- │ `aberto_centavos` maior que zero, com `liquidado = 'N'`. A forma certa é     │
-- │ `pagamento IS NOT NULL AND aberto_centavos > 0`: são 33 títulos, R$ 45.383   │
-- │ ainda em aberto, e 29 deles com resíduo acima de 5% do valor.                │
-- │                                                                            │
-- │ O maior é do INTERPROMO: título de R$ 45.000 marcado "recebido", R$ 33.750   │
-- │ pagos, R$ 11.250 em aberto — e o INTERPROMO é o segundo nome da fila de      │
-- │ cobrança. A versão anterior mostrava zero para ele: alguém ligaria com o     │
-- │ número errado, na tela cujo único trabalho é dizer quanto o cliente deve.    │
-- │                                                                            │
-- │ O QUE MUDOU no código: a carteira passa a ser valorada pelo que está EM      │
-- │ ABERTO, e o título com baixa parcial CONTINUA nela pelo resíduo em vez de    │
-- │ sair inteiro. Consequência boa: `recuperado` passa a significar exatamente   │
-- │ "quitado", e a baixa parcial cai em `ajuste` — que é redução de saldo sem     │
-- │ saída da carteira. São 19 meses com ajuste, somando −R$ 25.860 na série.     │
-- │                                                                            │
-- │ O CAMINHO EXATO NÃO EXISTE, e vale registrar por que não: `core.omie_baixa`  │
-- │ tem valor e data de cada baixa, o que permitiria reconstruir o aberto em      │
-- │ QUALQUER data em vez de usar o resíduo de hoje. Medido: 3.390 das 25.037     │
-- │ baixas estão sem data (13,5%) e em 2.958 títulos a soma das baixas não fecha │
-- │ com `pago_centavos` (13,7%). Trocaria uma imprecisão de 2% por uma           │
-- │ incerteza de 14%.                                                           │
-- │                                                                            │
-- │ Migração só de COMENTÁRIO: nenhuma coluna muda. Ela existe porque a 0045      │
-- │ está aplicada e o guarda de checksum a torna imutável — e um comentário de   │
-- │ banco que afirma o contrário do que o código faz é pior que comentário       │
-- │ nenhum. Quem for ler a coluna vai ler as duas.                              │
-- └───────────────────────────────────────────────────────────────────────────┘
-- ============================================================================

BEGIN;

COMMENT ON COLUMN fact.inadimplencia_titulo.valor_centavos IS
  'O que ainda se DEVE daquele titulo na data da foto -- nao o valor emitido. Sao iguais no caso normal e diferentes na baixa parcial, que EXISTE (33 titulos, R$ 45.383 em aberto quando medido em 26/08/2026), ao contrario do que o comentario da 0045 afirma. O Omie registra parcial pondo a data de pagamento e deixando aberto_centavos > 0 com liquidado = N. Em competencia reconstruida o residuo usado e o de HOJE, nao o daquela data: e a unica aproximacao do modulo, e ela existe porque core.omie_baixa tem 13,5% das baixas sem data.';

COMMENT ON COLUMN analytics.inadimplencia_mes.ajuste_centavos IS
  'Mudanca de valor de titulo que CONTINUOU na carteira. Duas coisas caem aqui: baixa PARCIAL (o cliente pagou parte e o resto segue devido) e edicao de valor no Omie. Nao e recuperacao: recuperado_centavos e so o titulo quitado, que sai da carteira. Se esta linha crescer, vale separar as duas -- na serie de 67 meses ela soma -R$ 25.860 em 19 meses.';

COMMIT;
