import assert from "node:assert/strict";
import test from "node:test";

import {
  corDoCliente,
  iniciaisDoCliente,
  ultimoMesComMovimento,
} from "./base-de-clientes.js";

test("as iniciais ignoram o que está entre colchetes e parênteses", () => {
  // Nomes reais da base: "[Ultramed] Saúde Mais", "Barra Net (Playhub)". O colchete e o
  // parêntese carregam canal e apelido — usá-los daria "US" e "BP", que não identificam
  // ninguém.
  assert.equal(iniciaisDoCliente("[Ultramed] Saúde Mais"), "SM");
  assert.equal(iniciaisDoCliente("Barra Net (Playhub)"), "BN");
});

test("as iniciais pulam partícula e sufixo societário", () => {
  assert.equal(iniciaisDoCliente("ASSOCIACAO DE SOCORRO MUTUO"), "AS");
  assert.equal(iniciaisDoCliente("VISTAME COMERCIO LTDA"), "VC");
  assert.equal(iniciaisDoCliente("BIG MIDIA EIRELI"), "BM");
});

test("nome de uma palavra devolve uma letra, e nome vazio não quebra", () => {
  assert.equal(iniciaisDoCliente("MULTIBET"), "M");
  assert.equal(iniciaisDoCliente(""), "?");
  assert.equal(iniciaisDoCliente("   "), "?");
  // Só pontuação: o filtro remove tudo e o retorno não pode ser string vazia, senão o
  // círculo aparece em branco na lista.
  assert.equal(iniciaisDoCliente("--- ///"), "?");
});

test('número no começo do nome conta — "99 AUTO CAR" existe na base', () => {
  assert.equal(iniciaisDoCliente("99 AUTO CAR"), "9A");
});

test("a cor é determinística: o mesmo cliente tem a mesma cor sempre", () => {
  // Cor sorteada faria o cliente mudar de cor a cada render, e a referência visual que a
  // cor existe para dar se perde.
  const a = corDoCliente("c0ffee-1234");
  const b = corDoCliente("c0ffee-1234");
  assert.equal(a, b);
  assert.ok(a >= 0 && a < 360);
});

test("ids diferentes tendem a cores diferentes", () => {
  const cores = new Set(
    ["1252", "1778", "1779", "1780", "1781", "2660", "3436"].map((x) =>
      corDoCliente(x),
    ),
  );
  // Não exijo unicidade absoluta — 360 matizes colidem em algum momento e forçar isso
  // seria um teste frágil. Exijo que a função espalhe.
  assert.ok(cores.size >= 6, `esperava dispersão, veio ${cores.size} cores`);
});

// ═══ O último mês com movimento ═══════════════════════════════════════════════
//
// Os quatro casos que a coluna "MRR mês" precisa acertar. O primeiro é o que
// motivou a função: em 17/08, um cliente que vence dia 20 tem agosto zerado, e
// mostrar R$ 0 diria "parou de pagar".

const MESES12 = [
  "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02",
  "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08",
];

test("mês corrente ainda vazio: vale o mês anterior, e o rótulo diz qual", () => {
  const serie = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 600000, 0];
  assert.deepEqual(ultimoMesComMovimento(serie, MESES12), {
    centavos: 600000,
    rotulo: "2026-07",
  });
});

test("cliente que parou há meses aponta o mês em que parou, não o corrente", () => {
  const serie = [0, 0, 0, 0, 0, 0, 450000, 0, 0, 0, 0, 0];
  assert.deepEqual(ultimoMesComMovimento(serie, MESES12), {
    centavos: 450000,
    rotulo: "2026-03",
  });
});

test("série toda zero devolve rótulo nulo — e não o mês 0 com R$ 0", () => {
  assert.deepEqual(ultimoMesComMovimento(Array(12).fill(0), MESES12), {
    centavos: 0,
    rotulo: null,
  });
});

test("com movimento no mês corrente, é ele que vale — não o anterior", () => {
  const serie = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 600000, 590000];
  assert.deepEqual(ultimoMesComMovimento(serie, MESES12), {
    centavos: 590000,
    rotulo: "2026-08",
  });
});

test("valor negativo é movimento: estorno não pode ser lido como mês sem nada", () => {
  const serie = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 600000, -12000];
  assert.deepEqual(ultimoMesComMovimento(serie, MESES12), {
    centavos: -12000,
    rotulo: "2026-08",
  });
});
