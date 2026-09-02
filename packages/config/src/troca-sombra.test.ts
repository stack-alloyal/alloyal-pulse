/**
 * A troca de títulos pela sombra — e sobretudo as três formas de ela RECUSAR.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O DEFEITO QUE A SOMBRA CONSERTA, medido em 02/09/2026.                     │
 * │                                                                            │
 * │ O C20 gravava com `ON CONFLICT DO UPDATE`: acrescentava e atualizava, e     │
 * │ nunca removia. Título que o Omie parava de devolver ficava no banco para    │
 * │ sempre, com o `sincronizado_em` congelado. Eram 1.079 fantasmas contra      │
 * │ 89.827 títulos reais; dos 1.079, seis estavam em atraso e somavam           │
 * │ R$ 31.020,64 na carteira de setembro — 1,4% do que o Financeiro cobra.      │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O QUE ESTE ARQUIVO EXISTE PARA PROVAR: que a troca RECUSA.                 │
 * │                                                                            │
 * │ Provar que ela troca é fácil e quase não vale nada — o caminho felizvai     │
 * │ ser exercitado todo dia às 04:10. O que ninguém exercita é a proteção, e é  │
 * │ ela que decide se um dia ruim na API do Omie apaga a base ou não.           │
 * │                                                                            │
 * │ Três recusas, e cada uma é um jeito diferente de a carga dar errado sem     │
 * │ dar erro: sombra vazia (a carga não aconteceu), sombra abaixo do piso (a    │
 * │ varredura morreu no meio) e varredura parcial (o C20 nem tenta trocar).     │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import pg from "pg";

import {
  PISO_DA_TROCA,
  limparSombraDeTitulos,
  trocarTitulosDaSombra,
} from "./omie.js";

const ADMIN = process.env["DATABASE_URL_ADMIN"];

test("o piso é folgado o bastante para não disparar por rotatividade normal", () => {
  // Medido nas 20 execuções gravadas do C20: a contagem variou 0,3% e a maior
  // queda entre dias levou a 99,8% do dia anterior. Um piso apertado dispararia
  // por variação legítima, e portão que dispara à toa é portão que se desliga.
  assert.ok(PISO_DA_TROCA <= 0.95, `piso de ${PISO_DA_TROCA} é apertado para 0,3% de variação real`);
  assert.ok(PISO_DA_TROCA >= 0.5, `piso de ${PISO_DA_TROCA} é frouxo: metade da base sumindo passaria`);
});

describe("troca de títulos pela sombra", { skip: !ADMIN }, () => {
  let db: pg.Pool;
  const DOC = "99000000000191";

  const titulo = (tabela: string, codigo: number, status = "RECEBIDO") =>
    db.query(
      `INSERT INTO ${tabela}
         (codigo_titulo, documento, vencimento, valor_centavos, aberto_centavos, status, categoria)
       VALUES ($1, $2, '2026-01-10', 100000, 0, $3, 'mensalidade')`,
      [codigo, DOC, status],
    );

  const contar = async (tabela: string) =>
    Number((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${tabela}`)).rows[0]!.n);

  before(async () => {
    const { migrate } = await import("@pulse/db");
    await migrate(ADMIN as string);
    db = new pg.Pool({ connectionString: ADMIN });
    await db.query(
      `INSERT INTO core.omie_cliente (codigo_omie, documento, razao_social, tags)
       VALUES (9900001, $1, 'CLIENTE DE TESTE', '["Cliente"]'::jsonb)
       ON CONFLICT (codigo_omie) DO NOTHING`,
      [DOC],
    );
  });

  after(async () => {
    await db?.query("TRUNCATE core.omie_titulo, core.omie_titulo_sombra");
    await db?.end();
  });

  beforeEach(async () => {
    await db.query("TRUNCATE core.omie_titulo, core.omie_titulo_sombra");
  });

  test("a sombra existe e o worker pode escrever nela", async () => {
    // O par da asserção "há arquivos para varrer": sem a tabela e sem o grant, os
    // testes abaixo passariam medindo o vazio.
    const { rows } = await db.query<{ pode: boolean }>(
      `SELECT has_table_privilege('pulse_worker','core.omie_titulo_sombra','INSERT')
          AND has_table_privilege('pulse_worker','core.omie_titulo','TRUNCATE') AS pode`,
    );
    assert.equal(rows[0]?.pode, true, "o worker não tem os grants que a troca precisa");
  });

  test("a troca remove o que saiu da fonte E acrescenta o que entrou", async () => {
    /* O caso do defeito, nas duas direções. Vinte vivos (1..20), a fonte devolve
       2..21: o título 1 sumiu e o 21 é novo.

       ⚠️ VINTE E NÃO TRÊS, e a primeira versão deste teste usou três — a proteção
       recusou, com razão: 2 de 3 é 66%, abaixo do piso de 90%. Foi o dado do
       teste que era irreal, não o código. Rotatividade de um título entre 90 mil
       é 0,001%; entre três é um terço. Cenário pequeno demais faz a proteção
       parecer defeito. */
    for (let c = 1; c <= 20; c++) await titulo("core.omie_titulo", c);
    for (let c = 2; c <= 21; c++) await titulo("core.omie_titulo_sombra", c);

    const r = await trocarTitulosDaSombra(db);
    assert.equal(r.trocou, true, r.motivo);
    assert.equal(r.removidos, 1, "não contou o título que saiu da fonte");
    assert.equal(await contar("core.omie_titulo"), 20);

    const { rows } = await db.query<{ existe: boolean }>(
      `SELECT (SELECT count(*) FROM core.omie_titulo WHERE codigo_titulo = 1) = 0
          AND (SELECT count(*) FROM core.omie_titulo WHERE codigo_titulo = 21) = 1 AS existe`,
    );
    assert.equal(rows[0]?.existe, true, "o fantasma ficou vivo, ou o título novo não entrou");
  });

  test("o valor de cada coluna vem da sombra, e não do que estava vivo", async () => {
    // Troca que preserva a contagem e o conteúdo velho seria pior que não trocar:
    // pareceria funcionar e continuaria mentindo.
    await titulo("core.omie_titulo", 1, "ATRASADO");
    await titulo("core.omie_titulo_sombra", 1, "RECEBIDO");
    await trocarTitulosDaSombra(db);
    const { rows } = await db.query<{ status: string; situacao: string }>(
      "SELECT status, situacao FROM core.omie_titulo WHERE codigo_titulo = 1",
    );
    assert.equal(rows[0]?.status, "RECEBIDO", "manteve o status velho");
    // `situacao` é coluna GERADA: ela tem de ser recalculada do status novo, e não
    // copiada. É o detalhe que uma troca com `INSERT ... SELECT *` quebraria.
    assert.equal(rows[0]?.situacao, "recebido", "a coluna gerada não acompanhou");
  });

  test("RECUSA sombra vazia — carga que não aconteceu não apaga a base", async () => {
    for (const c of [1, 2, 3]) await titulo("core.omie_titulo", c);
    const r = await trocarTitulosDaSombra(db);
    assert.equal(r.trocou, false);
    assert.match(r.motivo ?? "", /vazia/);
    assert.equal(await contar("core.omie_titulo"), 3, "apagou a base com a sombra vazia");
  });

  test("RECUSA sombra abaixo do piso — varredura truncada não vira verdade", async () => {
    // Dez vivos, dois na sombra: 20%, muito abaixo do piso. É o retrato de uma
    // varredura que morreu na segunda página.
    for (const c of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) await titulo("core.omie_titulo", c);
    for (const c of [1, 2]) await titulo("core.omie_titulo_sombra", c);

    const r = await trocarTitulosDaSombra(db);
    assert.equal(r.trocou, false);
    assert.match(r.motivo ?? "", /piso/);
    assert.equal(await contar("core.omie_titulo"), 10, "trocou por uma carga truncada");
  });

  test("o piso é uma FRONTEIRA, e os dois lados dela se comportam", async () => {
    /* Dez vivos. Nove na sombra é 90% — exatamente o piso, e passa. Oito é 80% e
       recusa. Testar só longe da fronteira deixaria passar um `<` escrito onde
       devia ser `<=`, que é o erro que se comete nesta linha. */
    for (let c = 1; c <= 10; c++) await titulo("core.omie_titulo", c);
    for (let c = 1; c <= 9; c++) await titulo("core.omie_titulo_sombra", c);
    const noPiso = await trocarTitulosDaSombra(db);
    assert.equal(noPiso.trocou, true, `90% deveria passar: ${noPiso.motivo}`);
    assert.equal(await contar("core.omie_titulo"), 9);

    // Agora nove vivos e sete na sombra: 77,8%, abaixo.
    await db.query("TRUNCATE core.omie_titulo_sombra");
    for (let c = 1; c <= 7; c++) await titulo("core.omie_titulo_sombra", c);
    const abaixo = await trocarTitulosDaSombra(db);
    assert.equal(abaixo.trocou, false, "77,8% passou pelo piso de 90%");
    assert.equal(await contar("core.omie_titulo"), 9, "trocou mesmo tendo recusado");
  });

  test("base vazia aceita a primeira carga — não há piso contra zero", async () => {
    // O primeiro dia, e o dia depois de um restauro. Piso sobre zero recusaria
    // qualquer carga e o ciclo nunca sairia do lugar.
    for (const c of [1, 2]) await titulo("core.omie_titulo_sombra", c);
    const r = await trocarTitulosDaSombra(db);
    assert.equal(r.trocou, true, r.motivo);
    assert.equal(await contar("core.omie_titulo"), 2);
  });

  test("limparSombraDeTitulos esvazia sem tocar no vivo", async () => {
    await titulo("core.omie_titulo", 1);
    await titulo("core.omie_titulo_sombra", 2);
    await limparSombraDeTitulos(db);
    assert.equal(await contar("core.omie_titulo_sombra"), 0);
    assert.equal(await contar("core.omie_titulo"), 1, "a limpeza da sombra mexeu no vivo");
  });
});
