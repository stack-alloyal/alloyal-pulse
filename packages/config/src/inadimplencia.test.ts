import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import pg from "pg";

import { DIAS_CORRENTE, FAIXAS, apurarCompetencia, serieDaCarteira } from "./inadimplencia.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MIGRACAO = readFileSync(
  join(RAIZ, "packages", "db", "migrations", "0045_inadimplencia.sql"),
  "utf8",
);
// Pela RAIZ e não pelo diretório do próprio arquivo: compilado, este teste roda
// em `dist/`, onde não existe `.ts` nenhum. `RAIZ` funciona nos dois lugares
// porque src e dist estão à mesma profundidade.
const MODULO = readFileSync(
  join(RAIZ, "packages", "config", "src", "inadimplencia.ts"),
  "utf8",
);

// ═══ A REGRA DA FAIXA VIVE EM DOIS LUGARES, e eles têm de concordar ═══════════
//
// A coluna `faixa` de `fact.inadimplencia_titulo` é GERADA no banco — é lá que a
// regra mora para o histórico. Mas a lista de HOJE não passa por essa tabela: ela
// lê `core.omie_titulo` direto, e calcula a faixa no SELECT.
//
// São duas escritas da mesma regra, e não há como fundi-las: uma é DDL do
// Postgres, a outra é SQL de consulta. O que dá para fazer é recusar que elas
// divirjam — porque se divergirem, a tela de hoje e o gráfico do histórico
// mostram faixas diferentes para o mesmo título, e nada quebra.

test("os cortes de faixa são os mesmos no banco e na consulta de hoje", () => {
  const cortes = (texto: string) =>
    [...texto.matchAll(/<=\s*(\d+)\s*THEN\s*'([a-z0-9_]+)'/gi)].map(
      ([, dias, faixa]) => `${dias}:${faixa}`,
    );

  const daColunaGerada = cortes(
    MIGRACAO.match(/faixa text GENERATED ALWAYS AS \(([\s\S]*?)\) STORED/)?.[1] ?? "",
  );
  const daConsulta = cortes(MODULO.match(/const CARTEIRA_DE_HOJE = `([\s\S]*?)`;/)?.[1] ?? "");

  assert.ok(daColunaGerada.length >= 5, `li só ${daColunaGerada.length} cortes na coluna gerada`);
  assert.deepEqual(
    daConsulta,
    daColunaGerada,
    "a faixa da lista de hoje divergiu da faixa gravada no histórico",
  );
});

test("toda faixa gerada pelo banco tem rótulo em português", () => {
  const ids = new Set(FAIXAS.map((f) => f.id as string));
  const noBanco = [
    ...(MIGRACAO.match(/faixa text GENERATED ALWAYS AS \(([\s\S]*?)\) STORED/)?.[1] ?? "").matchAll(
      /'([a-z0-9_]+)'/g,
    ),
  ].map(([, id]) => id as string);
  assert.ok(noBanco.length > 0, "não li os valores da coluna gerada");
  for (const id of noBanco) {
    assert.ok(ids.has(id), `a faixa "${id}" existe no banco e não tem rótulo em FAIXAS`);
  }
});

// ═══ A IDENTIDADE DO FECHAMENTO É RESTRIÇÃO, e não cuidado de quem consulta ═══
//
// Um teste pega o defeito que eu escrevi hoje. O CHECK pega o que outra pessoa
// escrever em dois anos, de madrugada, corrigindo um mês à mão — que é o caso em
// que ninguém roda a suíte.

test("o fechamento mensal carrega a identidade como CHECK", () => {
  const semEspaco = MIGRACAO.replace(/\s+/g, " ");
  assert.match(
    semEspaco,
    /CHECK \( saldo_inicial_centavos \+ entrou_centavos - recuperado_centavos - cancelado_centavos \+ ajuste_centavos = saldo_final_centavos \)/,
    "a identidade do movimento saiu da tabela — sem ela um mês que não fecha é gravado em silêncio",
  );
  assert.match(
    semEspaco,
    /titulos_inicial \+ entrou_titulos - recuperado_titulos - cancelado_titulos = titulos_final/,
    "a contagem de títulos também precisa fechar: valor certo com contagem errada esconde título duplicado",
  );
});

test("a foto reconstruída não pode afirmar estado de painel", () => {
  // `core.account` não guarda histórico de `status_core`. Preencher a foto de
  // março com o estado de hoje seria inventar — e é o tipo de invenção que
  // ninguém consegue detectar depois, porque parece dado.
  assert.match(
    MIGRACAO.replace(/\s+/g, " "),
    /CHECK \(origem = 'apurado' OR status_painel IS NULL\)/,
  );
  assert.match(
    MIGRACAO.replace(/\s+/g, " "),
    /CHECK \(origem = 'apurado' OR \(corrente_centavos IS NULL AND corrente_clientes IS NULL\)\)/,
  );
});

test("o worker não pode apagar fechamento mensal", () => {
  // Espelha `analytics.monthly_close`: o worker grava e atualiza, nunca apaga. Um
  // mês some sem deixar rastro é a única perda que a série não tem como notar.
  assert.match(MIGRACAO, /GRANT SELECT, INSERT, UPDATE ON analytics\.inadimplencia_mes TO pulse_worker/);
  assert.doesNotMatch(MIGRACAO, /GRANT[^;]*DELETE[^;]*analytics\.inadimplencia_mes/);
});

test("o módulo de inadimplência não escreve em lugar nenhum além das próprias tabelas", () => {
  const escritas = [
    ...MODULO.matchAll(/\b(INSERT INTO|UPDATE|DELETE FROM)\s+([a-z_]+\.[a-z_]+)/gi),
  ].map(([, , tabela]) => tabela as string);
  const permitidas = new Set(["fact.inadimplencia_titulo", "analytics.inadimplencia_mes"]);
  for (const t of escritas) {
    assert.ok(
      permitidas.has(t),
      `a inadimplência escreve em ${t}; ela é tela de LEITURA — a régua de cobrança é do painel`,
    );
  }
  assert.ok(escritas.length >= 3, `li só ${escritas.length} escritas; a apuração tem três`);
});

// ═══ A MECÂNICA DOS QUATRO MOVIMENTOS, contra banco de verdade ════════════════

const ADMIN = process.env["DATABASE_URL_ADMIN"];

/**
 * Seis títulos, um para cada caminho possível, e o fechamento tem de fechar.
 *
 * O caso que justifica o teste é o `prorrogado`: ele não estava no desenho: só
 * apareceu escrevendo a apuração. Um título que vencia em maio e passa a vencer em
 * dezembro SAI da carteira sem ter sido pago e sem ter sido cancelado — e chamá-lo
 * de baixa registraria perda onde houve renegociação.
 */
describe("apuração dos quatro movimentos", { skip: !ADMIN }, () => {
  let db: pg.Pool;
  const DOC = "99000000000191";
  const M1 = "2019-07-01";
  const M2 = "2019-08-01";

  before(async () => {
    const { migrate } = await import("@pulse/db");
    await migrate(ADMIN as string);
    db = new pg.Pool({ connectionString: ADMIN });
    await limpar();

    await db.query(
      `INSERT INTO core.omie_cliente (codigo_omie, documento, razao_social, tags)
       VALUES (9900001, $1, 'CLIENTE DE TESTE', '["Cliente"]'::jsonb)
       ON CONFLICT (codigo_omie) DO NOTHING`,
      [DOC],
    );

    // Todos vencem em junho/2019 (antes de M1) exceto o que ENTRA, que vence em
    // julho — dentro do mês que M2 fecha.
    const titulo = (
      codigo: number,
      status: string,
      vencimento: string,
      valor: number,
      pagamento: string | null,
    ) =>
      db.query(
        `INSERT INTO core.omie_titulo
           (codigo_titulo, documento, status, vencimento, pagamento, valor_centavos, pago_centavos, aberto_centavos)
         VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8)`,
        [
          codigo,
          DOC,
          status,
          vencimento,
          pagamento,
          valor,
          pagamento ? valor : 0,
          pagamento ? 0 : valor,
        ],
      );

    await titulo(9900101, "ATRASADO", "2019-06-10", 100_00, null); // permanece
    await titulo(9900102, "ATRASADO", "2019-07-10", 200_00, null); // entra em M2
    await titulo(9900103, "RECEBIDO", "2019-06-11", 300_00, "2019-07-15"); // recuperado em M2
    await titulo(9900104, "CANCELADO", "2019-06-12", 400_00, null); // baixado
    await titulo(9900105, "ATRASADO", "2019-12-20", 500_00, null); // prorrogado: sai da carteira
    await titulo(9900106, "ATRASADO", "2019-06-13", 600_00, null); // vai ter o valor ajustado
  });

  after(async () => {
    await limpar();
    await db.end();
  });

  const limpar = async () => {
    await db.query("DELETE FROM fact.inadimplencia_titulo WHERE competencia IN ($1, $2)", [M1, M2]);
    await db.query("DELETE FROM analytics.inadimplencia_mes WHERE competencia IN ($1, $2)", [M1, M2]);
    await db.query("DELETE FROM core.omie_titulo WHERE documento = $1", [DOC]);
    await db.query("DELETE FROM core.omie_cliente WHERE documento = $1", [DOC]);
  };

  test("a foto de julho tem quem já estava vencido, e só", async () => {
    const r = await apurarCompetencia(db, M1, { origem: "reconstruido" });
    // Em 1º/jul/2019 estão vencidos e sem pagamento: 101, 103, 106. O 104 é
    // cancelado (fora por definição), o 102 vence em julho e o 105 em dezembro.
    assert.equal(r.titulosFinal, 3);
    assert.equal(r.saldoFinalCentavos, String(100_00 + 300_00 + 600_00));
  });

  test("agosto separa o que permaneceu, entrou, foi pago e saiu sem pagar", async () => {
    // O ajuste tem de acontecer ENTRE as duas fotos, senão não há o que ajustar.
    await db.query("UPDATE core.omie_titulo SET valor_centavos = $1, aberto_centavos = $1 WHERE codigo_titulo = 9900106", [650_00]);
    // E o 105 é prorrogado: ele estava na foto de julho? Não — vence em dezembro.
    // Para exercitar a saída sem pagamento, empurra-se o 101 para o futuro.
    await db.query("UPDATE core.omie_titulo SET vencimento = '2019-12-05' WHERE codigo_titulo = 9900101");

    const r = await apurarCompetencia(db, M2, { origem: "reconstruido" });

    const { rows } = await db.query(
      `SELECT codigo_titulo, movimento, motivo_saida, valor_centavos, ajuste_centavos
         FROM fact.inadimplencia_titulo WHERE competencia = $1 ORDER BY codigo_titulo`,
      [M2],
    );
    const por = new Map(rows.map((x) => [Number(x["codigo_titulo"]), x]));

    assert.equal(por.get(9900101)?.["movimento"], "cancelado", "vencimento empurrado sai da carteira");
    assert.equal(por.get(9900101)?.["motivo_saida"], "prorrogado", "e sai como renegociação, não como baixa");
    assert.equal(por.get(9900102)?.["movimento"], "entrou");
    assert.equal(por.get(9900103)?.["movimento"], "recuperado");
    assert.equal(por.get(9900103)?.["motivo_saida"], null, "quem pagou não tem motivo de saída");
    assert.equal(por.get(9900106)?.["movimento"], "permaneceu");
    assert.equal(Number(por.get(9900106)?.["ajuste_centavos"]), 50_00, "o ajuste é a diferença de valor");
    assert.equal(por.get(9900104), undefined, "cancelado nunca entrou na carteira, então não sai dela");

    // O fechamento: 1000 iniciais + 200 que entraram − 300 pagos − 100 prorrogado
    // + 50 de ajuste = 850. O CHECK do banco já recusaria outro número.
    assert.equal(r.saldoInicialCentavos, String(1000_00));
    assert.equal(r.entrouCentavos, String(200_00));
    assert.equal(r.recuperadoCentavos, String(300_00));
    assert.equal(r.canceladoCentavos, String(100_00));
    assert.equal(r.ajusteCentavos, String(50_00));
    assert.equal(r.saldoFinalCentavos, String(850_00));
  });

  test("o elo entre os meses fecha: saldo final de um é o inicial do seguinte", async () => {
    const serie = (await serieDaCarteira(db, 60)).filter(
      (m) => m.competencia === M1 || m.competencia === M2,
    );
    assert.equal(serie.length, 2);
    assert.equal(serie[1]?.saldoInicialCentavos, serie[0]?.saldoFinalCentavos);
    assert.equal(serie[1]?.titulosInicial, serie[0]?.titulosFinal);
  });

  test("reapurar é idempotente: rodar duas vezes dá o mesmo número", async () => {
    const a = await apurarCompetencia(db, M2, { origem: "reconstruido" });
    const b = await apurarCompetencia(db, M2, { origem: "reconstruido" });
    assert.deepEqual(a, b);
  });

  test("mês congelado não é reescrito, e isso não é falha", async () => {
    await db.query(
      `UPDATE analytics.inadimplencia_mes
          SET estado = 'congelada', congelado_por = 'teste', congelado_em = now()
        WHERE competencia = $1`,
      [M2],
    );
    const r = await apurarCompetencia(db, M2, { origem: "reconstruido" });
    assert.equal(r.congelada, true);
    assert.equal(r.linhas, 0);
    // E o que estava gravado continua lá: congelar não apaga.
    const { rows } = await db.query(
      "SELECT saldo_final_centavos FROM analytics.inadimplencia_mes WHERE competencia = $1",
      [M2],
    );
    assert.equal(String(rows[0]?.["saldo_final_centavos"]), String(850_00));
    await db.query(
      `UPDATE analytics.inadimplencia_mes
          SET estado = 'aberta', congelado_por = NULL, congelado_em = NULL
        WHERE competencia = $1`,
      [M2],
    );
  });

  test("a fronteira do corrente é a mesma constante da tela", () => {
    // 90 dias aparece em `DIAS_CORRENTE`, no rótulo da coluna e na apuração. Se a
    // constante mudar e o SQL não, o KPI e a lista passam a contar coisas
    // diferentes com o mesmo nome.
    assert.equal(DIAS_CORRENTE, 90);
    assert.ok(
      MODULO.includes("dias_atraso <= ${DIAS_CORRENTE}"),
      "a apuração precisa usar a constante, não o número 90 escrito à mão",
    );
  });
});
