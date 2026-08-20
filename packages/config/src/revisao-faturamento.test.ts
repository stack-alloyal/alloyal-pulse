import assert from "node:assert/strict";
import test from "node:test";

import {
  JANELA_DO_REAJUSTE,
  MESES_DE_CARENCIA,
  mesesDesde,
} from "./revisao-faturamento.js";

// ═══ Meses FECHADOS desde o reajuste ══════════════════════════════════════════
//
// É a multiplicação da perda acumulada: errar um mês aqui erra o número que vai
// para a reunião. E é conta de calendário, que é onde se erra na virada do ano.

test("conta os meses fechados, e não os corridos", () => {
  // 20/08/2026, reajuste em março: mar, abr, mai, jun, jul fechados. Agosto está
  // sendo faturado agora e contá-lo inflaria a perda com um mês que não acabou.
  assert.equal(mesesDesde("2026-03", new Date(Date.UTC(2026, 7, 20))), 5);
});

test("no próprio mês do reajuste, zero", () => {
  assert.equal(mesesDesde("2026-03", new Date(Date.UTC(2026, 2, 31))), 0);
});

test("atravessa a virada do ano", () => {
  // De março/2026 a fevereiro/2027 são onze meses fechados. Uma conta que só
  // subtraísse o mês daria −1.
  assert.equal(mesesDesde("2026-03", new Date(Date.UTC(2027, 1, 15))), 11);
});

test("nunca devolve negativo: reajuste no futuro é zero, não dívida ao contrário", () => {
  assert.equal(mesesDesde("2027-03", new Date(Date.UTC(2026, 7, 20))), 0);
});

test("mês malformado não vira NaN na multiplicação", () => {
  assert.equal(mesesDesde("", new Date(Date.UTC(2026, 7, 20))), 0);
  assert.equal(mesesDesde("abacaxi", new Date(Date.UTC(2026, 7, 20))), 0);
});

// ═══ As janelas ═══════════════════════════════════════════════════════════════

test("o mês do reajuste fica FORA das duas janelas de comparação", () => {
  // Medido: o MRR de março/2026 foi R$ 1,85M contra ~R$ 1,2M nos meses vizinhos,
  // porque o mês do reajuste carrega cobrança extra e retroativo. Comparar
  // contra ele inventaria aumento em quem não teve nenhum.
  const j = JANELA_DO_REAJUSTE;
  assert.equal(j.antesAte, j.reajuste, "a janela de antes termina no reajuste");
  assert.ok(j.depoisDe > j.reajuste, "a de depois começa após o reajuste");
  assert.ok(
    j.depoisDe > "2026-04-01",
    "e pula abril também: o mês seguinte ainda carrega acerto do reajuste",
  );
});

test("a carência de 'parou de faturar' é maior que um mês", () => {
  // Um mês só marcaria como parado todo cliente que vence dia 20, todo dia 1º.
  assert.ok(MESES_DE_CARENCIA >= 2);
});
