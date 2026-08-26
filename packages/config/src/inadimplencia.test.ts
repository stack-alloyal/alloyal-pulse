import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import pg from "pg";

import {
  DIAS_CORRENTE,
  DIAS_UTEIS_PARA_APARECER,
  FAIXAS,
  apurarCompetencia,
  carteiraDeHoje,
  serieDaCarteira,
} from "./inadimplencia.js";
import { mainBusinesses } from "./base-de-clientes.js";
import { textoDeBusca } from "./texto.js";

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

// ═══ QUEM ESTÁ NA CARTEIRA E QUANTO VALE: uma escrita só ══════════════════════
//
// Este portão nasceu de um defeito de produção. A lista de hoje e a apuração da
// foto tinham cada uma a sua condição escrita à mão, e as duas diziam
// `pagamento IS NULL` — o que EXCLUI o título com baixa parcial, porque o Omie
// registra parcial pondo a data de pagamento e deixando `aberto_centavos > 0`.
//
// Resultado: R$ 45.383 de dívida real não apareciam em lugar nenhum, e o segundo
// nome da fila de cobrança (INTERPROMO, R$ 11.250 de resíduo num título de
// R$ 45.000) aparecia zerado.
//
// Duas escritas da mesma regra divergem; uma escrita não tem como divergir.

test("só existe uma definição de estar na carteira, e uma de quanto se deve", () => {
  const chamadas = (nome: string) =>
    [...MODULO.matchAll(new RegExp(`\\$\\{${nome}\\(`, "g"))].length;
  const definicoes = (nome: string) =>
    [...MODULO.matchAll(new RegExp(`^const ${nome} = `, "gm"))].length;

  assert.equal(definicoes("NA_CARTEIRA"), 1, "a regra de pertencer à carteira tem de ter UM lugar");
  assert.equal(definicoes("EM_ABERTO"), 1, "a regra de quanto se deve tem de ter UM lugar");
  assert.ok(chamadas("NA_CARTEIRA") >= 2, "a lista de hoje e a apuração precisam usar a MESMA regra");
  assert.ok(chamadas("EM_ABERTO") >= 2, "a lista de hoje e a apuração precisam usar a MESMA valoração");

  // ┌───────────────────────────────────────────────────────────────────────┐
  // │ AS DUAS CONSULTAS DA CARTEIRA NÃO PODEM TER CONDIÇÃO DE PAGAMENTO         │
  // │ PRÓPRIA. Elas DELEGAM, e é só isso que este portão exige.                 │
  // │                                                                          │
  // │ A primeira versão da regra era mais larga — proibia `pagamento IS NULL`   │
  // │ em qualquer lugar do arquivo — e acusou três usos corretos: a própria     │
  // │ definição, o numerador do DSO e a coorte, que pergunta outra coisa ("foi  │
  // │ pago DEPOIS de vencer?"). Portão que acusa o certo é desligado no         │
  // │ primeiro dia, então ele olha só as duas consultas que quebraram.          │
  // └───────────────────────────────────────────────────────────────────────┘
  for (const nome of ["CARTEIRA_DE_HOJE", "CARTEIRA_EM"]) {
    const corpo =
      MODULO.match(new RegExp(`const ${nome} = (?:\\(corte: string\\) => )?\`([\\s\\S]*?)\`;`))?.[1] ?? "";
    assert.ok(corpo.length > 20, `não li o corpo de ${nome}`);
    assert.doesNotMatch(
      corpo,
      /pagamento\s+IS\s+NULL|aberto_centavos/,
      `${nome} escreve a própria condição de pagamento em vez de delegar — ` +
        "foi exatamente assim que a baixa parcial ficou de fora da carteira",
    );
  }
});

test("o comentário da 0045 sobre pagamento parcial está corrigido em migração posterior", () => {
  // A 0045 está aplicada e o guarda de checksum a torna imutável. Ela afirma que
  // pagamento parcial não existe, o que é falso. A correção só pode vir por outra
  // migração — e este portão garante que ela continue existindo.
  const correcao = readFileSync(
    join(RAIZ, "packages", "db", "migrations", "0047_pagamento_parcial_existe.sql"),
    "utf8",
  );
  assert.match(MIGRACAO, /pagamento parcial NÃO EXISTE/, "a 0045 mudou; conferir se a 0047 ainda faz sentido");
  assert.match(correcao, /COMMENT ON COLUMN fact\.inadimplencia_titulo\.valor_centavos/);
  assert.match(correcao, /COMMENT ON COLUMN analytics\.inadimplencia_mes\.ajuste_centavos/);
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

  test("baixa parcial FICA na carteira pelo resíduo, e não sai como recuperada", async () => {
    // O defeito que este teste protege: o Omie marca o título como pago (data
    // preenchida) mas deixa `aberto_centavos > 0`. A primeira versão do módulo
    // usava `pagamento IS NULL` e jogava o título inteiro fora — R$ 45.383 de
    // dívida real invisíveis, sendo o maior caso o segundo nome da fila.
    const P = "2019-09-01";
    await db.query(
      `INSERT INTO core.omie_titulo
         (codigo_titulo, documento, status, vencimento, pagamento,
          valor_centavos, pago_centavos, aberto_centavos, liquidado)
       VALUES (9900107, $1, 'RECEBIDO', '2019-06-14'::date, '2019-08-20'::date,
               1000_00, 700_00, 300_00, 'N')`,
      [DOC],
    );
    // Na foto de agosto o título ainda não tinha pagamento nenhum: vale cheio.
    await apurarCompetencia(db, M2, { origem: "reconstruido" });
    const { rows: emAgosto } = await db.query(
      `SELECT valor_centavos, movimento FROM fact.inadimplencia_titulo
        WHERE competencia = $1 AND codigo_titulo = 9900107`,
      [M2],
    );
    assert.equal(String(emAgosto[0]?.["valor_centavos"]), String(1000_00), "em 1º/ago nada havia sido pago");

    // Em setembro a baixa parcial já ocorreu (20/ago): fica na carteira pelos 300.
    const r = await apurarCompetencia(db, P, { origem: "reconstruido" });
    const { rows } = await db.query(
      `SELECT valor_centavos, movimento, ajuste_centavos
         FROM fact.inadimplencia_titulo WHERE competencia = $1 AND codigo_titulo = 9900107`,
      [P],
    );
    assert.equal(rows[0]?.["movimento"], "permaneceu", "quem pagou PARTE não sai da carteira");
    assert.equal(String(rows[0]?.["valor_centavos"]), String(300_00), "e fica pelo que ainda se deve");
    assert.equal(String(rows[0]?.["ajuste_centavos"]), String(-700_00), "os 700 recebidos são ajuste, não recuperação");
    assert.ok(Number(r.ajusteCentavos) <= -700_00, "o fechamento do mês carrega o ajuste");

    await db.query("DELETE FROM fact.inadimplencia_titulo WHERE competencia = $1", [P]);
    await db.query("DELETE FROM analytics.inadimplencia_mes WHERE competencia = $1", [P]);
    await db.query("DELETE FROM core.omie_titulo WHERE codigo_titulo = 9900107");
    await apurarCompetencia(db, M2, { origem: "reconstruido" });
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

// ═══ ACHADO DO PEN TEST: `?q=%00` devolvia HTTP 500 ══════════════════════════
//
// O byte nulo chega ao Postgres como parâmetro vinculado e ele recusa a
// codificação: "invalid byte sequence for encoding UTF8: 0x00". Não é vazamento —
// nada é interpretado como SQL —, mas é 500 que qualquer pessoa com acesso à tela
// produz montando a URL, e 500 é pista: conta ao curioso que a entrada dele
// chegou ao banco.
//
// Duas telas caíam, a inadimplência e a base de clientes. As outras cinco buscas
// do produto filtram em memória. O conserto é um lugar só, e estes testes
// protegem os dois consumidores.

test("o limpador tira controle e preserva o que a busca precisa", () => {
  assert.equal(textoDeBusca("\u0000"), "");
  assert.equal(textoDeBusca("\u0001\u0002swile"), "swile");
  assert.equal(textoDeBusca("  swile  "), "swile");
  assert.equal(textoDeBusca(undefined), "");
  assert.equal(textoDeBusca(null), "");
  // Aspa e porcento FICAM: aspa é parâmetro vinculado e porcento é curinga de
  // quem busca "50%". Sanitizar além do necessário quebraria a busca de verdade
  // e daria falsa sensação de defesa onde a defesa é o parâmetro.
  assert.equal(textoDeBusca("50% O'Brien"), "50% O'Brien");
  assert.equal(textoDeBusca("' OR 1=1--"), "' OR 1=1--");
});

describe("busca com byte nulo não derruba a consulta", { skip: !ADMIN }, () => {
  let db: pg.Pool;
  before(async () => {
    const { migrate } = await import("@pulse/db");
    await migrate(ADMIN as string);
    db = new pg.Pool({ connectionString: ADMIN });
  });
  after(async () => {
    await db.end();
  });

  for (const carga of ["\u0000", "\u0000swile", "\uFFFE\u0000", "\u0001\u0002\u0003"]) {
    const rotulo = JSON.stringify(carga);
    test(`carteiraDeHoje sobrevive a ${rotulo}`, async () => {
      const r = await carteiraDeHoje(db, { busca: carga }, 5);
      assert.ok(Array.isArray(r), "tem de devolver lista, não lançar");
    });
    test(`mainBusinesses sobrevive a ${rotulo}`, async () => {
      const r = await mainBusinesses(db, { busca: carga });
      assert.ok(r !== null && typeof r === "object", "tem de devolver resultado, não lançar");
    });
  }
});

// ═══ D+1 NÃO É INADIMPLÊNCIA ═════════════════════════════════════════════════
//
// O pagamento leva um dia útil para aparecer no Omie, e a carga roda às 04h10 —
// antes de esse dia acontecer. Sem carência, quem pagava no dia do vencimento
// aparecia na fila, e aparecia no TOPO: medido na tela, a SWILE era a maior
// devedora com R$ 59.625 e UM dia de atraso.
//
// Dias ÚTEIS e não corridos, e a sexta-feira é o teste que separa as duas
// implementações: quem vence na sexta e paga na sexta só aparece na terça.

test("a carência é de dias úteis, e o segundo dia não é folga", () => {
  // O primeiro dia é o que o pagamento leva para aparecer; o segundo é o que
  // permite CONCLUIR que ele não apareceu. Com um só, a fila conteria quem pagou.
  assert.equal(DIAS_UTEIS_PARA_APARECER, 1);
});

describe("carência em dias úteis", { skip: !ADMIN }, () => {
  let db: pg.Pool;
  before(async () => {
    const { migrate } = await import("@pulse/db");
    await migrate(ADMIN as string);
    db = new pg.Pool({ connectionString: ADMIN });
  });
  after(async () => {
    await db.end();
  });

  test("dia_util_antes pula o fim de semana", async () => {
    const { rows } = await db.query(
      `SELECT to_char(core.dia_util_antes($1::date, 2), 'YYYY-MM-DD') AS corte,
              to_char(core.dia_util_antes($2::date, 2), 'YYYY-MM-DD') AS corte_segunda,
              to_char(core.dia_util_antes($3::date, 1), 'YYYY-MM-DD') AS um_dia`,
      // 26/08/2026 é quarta; 31/08/2026 é segunda; 30/08/2026 é domingo.
      ["2026-08-26", "2026-08-31", "2026-08-30"],
    );
    // Quarta menos dois dias úteis: segunda.
    assert.equal(rows[0]?.["corte"], "2026-08-24");
    // SEGUNDA menos dois dias úteis: QUINTA. Uma conta de dias corridos daria
    // sábado, e aí quem venceu e pagou na sexta entraria na fila no domingo.
    assert.equal(rows[0]?.["corte_segunda"], "2026-08-27");
    // Domingo menos um dia útil: sexta.
    assert.equal(rows[0]?.["um_dia"], "2026-08-28");
  });

  test("título recente NÃO entra na carteira, e o de dois dias úteis entra", async () => {
    const DOC = "99000000000272";
    // Competência 01/07/2019 é uma SEGUNDA. Dois dias úteis antes: quinta 27/06.
    // Então 27/06 entra e 28/06 (sexta) não — e é justamente aqui que a conta de
    // dias corridos erraria: 01/07 menos 2 dias é 29/06, e 28/06 passaria.
    const M = "2019-07-01";
    await db.query(
      `INSERT INTO core.omie_cliente (codigo_omie, documento, razao_social, tags)
       VALUES (9900201, $1, 'CARENCIA DE TESTE', '["Cliente"]'::jsonb)
       ON CONFLICT (codigo_omie) DO NOTHING`,
      [DOC],
    );
    const titulo = (codigo: number, vencimento: string) =>
      db.query(
        `INSERT INTO core.omie_titulo
           (codigo_titulo, documento, status, vencimento, valor_centavos, aberto_centavos)
         VALUES ($1, $2, 'ATRASADO', $3::date, 100_00, 100_00)`,
        [codigo, DOC, vencimento],
      );
    await titulo(9900301, "2019-06-27"); // quinta: dois dias úteis atrás — entra
    await titulo(9900302, "2019-06-28"); // sexta: um dia útil atrás — fica fora
    try {
      await apurarCompetencia(db, M, { origem: "reconstruido" });
      const { rows } = await db.query(
        `SELECT codigo_titulo FROM fact.inadimplencia_titulo
          WHERE competencia = $1 AND codigo_titulo IN (9900301, 9900302)
          ORDER BY codigo_titulo`,
        [M],
      );
      assert.deepEqual(
        rows.map((r) => Number(r["codigo_titulo"])),
        [9900301],
        "só o de dois dias úteis pode estar na carteira",
      );
    } finally {
      await db.query("DELETE FROM fact.inadimplencia_titulo WHERE competencia = $1", [M]);
      await db.query("DELETE FROM analytics.inadimplencia_mes WHERE competencia = $1", [M]);
      await db.query("DELETE FROM core.omie_titulo WHERE documento = $1", [DOC]);
      await db.query("DELETE FROM core.omie_cliente WHERE documento = $1", [DOC]);
    }
  });

  test("nada com menos de dois dias úteis aparece na lista de hoje", async () => {
    const r = await carteiraDeHoje(db, {}, 1000);
    const { rows } = await db.query(
      `SELECT to_char(core.dia_util_antes(current_date, $1::int), 'YYYY-MM-DD') AS corte`,
      [DIAS_UTEIS_PARA_APARECER + 1],
    );
    const corte = String(rows[0]?.["corte"]);
    const cedo = r.filter((t) => t.vencimento > corte);
    assert.deepEqual(
      cedo.map((t) => `${t.documento} venceu ${t.vencimento}`),
      [],
      `há título vencido depois do corte ${corte} na carteira — a carência furou`,
    );
  });
});
