/**
 * CLI do token de serviço da API de leitura (/api/v1). Ato de ADMIN — usa o papel
 * dono, não o `pulse_api` que serve a API. Uso:
 *
 *   DATABASE_URL_ADMIN=... node dist/api-token-cli.js emitir "ETL de conciliação — Fulano"
 *   DATABASE_URL_ADMIN=... node dist/api-token-cli.js listar
 *   DATABASE_URL_ADMIN=... node dist/api-token-cli.js revogar <id>
 *
 * Tudo em stderr (o lint da casa só permite warn/error): num CLI de segredo, ler
 * o token na tela e não deixá-lo vazar para um pipe é o comportamento certo.
 */
import pg from "pg";

import { emitirToken, listarTokens, revogarToken } from "./api-token.js";

const url = process.env["DATABASE_URL_ADMIN"] ?? process.env["DATABASE_URL"];
const acao = process.argv[2];
const arg = process.argv[3];
const quem = process.env["USER"] ?? "cli";

if (!url) {
  console.error("defina DATABASE_URL_ADMIN");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url });

async function main(): Promise<void> {
  if (acao === "emitir") {
    if (!arg || arg.trim().length < 3) {
      console.error('uso: api-token-cli emitir "descrição de para quem/para quê"');
      process.exit(1);
    }
    const { id, token } = await emitirToken(pool, arg, quem);
    console.error(`\nToken emitido (id ${id}).`);
    console.error("Guarde AGORA — o banco só tem o hash, não há como relê-lo:\n");
    console.error(`   ${token}\n`);
    console.error("Use como:  Authorization: Bearer " + token);
    return;
  }
  if (acao === "revogar") {
    if (!arg) {
      console.error("uso: api-token-cli revogar <id>");
      process.exit(1);
    }
    await revogarToken(pool, arg, quem);
    console.error(`Token ${arg} revogado.`);
    return;
  }
  if (acao === "listar") {
    const tokens = await listarTokens(pool);
    if (tokens.length === 0) console.error("(nenhum token)");
    for (const t of tokens) {
      const estado = t.revogadoEm ? "revogado" : "ativo";
      console.error(`${t.id}  [${estado}]  ${t.descricao}  · último uso: ${t.ultimoUsoEm ?? "nunca"}`);
    }
    return;
  }
  console.error('uso: api-token-cli <emitir "desc" | listar | revogar <id>>');
  process.exit(1);
}

main()
  .then(() => pool.end())
  .catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
