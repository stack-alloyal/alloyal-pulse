import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type pg from "pg";

/**
 * O token de serviço da API de leitura (/api/v1).
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O BANCO GUARDA O HASH, e a comparação é por igualdade do hash — nunca do    │
 * │ token cru. O token só existe em texto uma vez, no retorno de `emitirToken`.  │
 * │                                                                            │
 * │ O prefixo `pulse_` não é enfeite: faz o segredo ser reconhecível por        │
 * │ secret-scanner de repositório e por olho humano num log, para ser trocado    │
 * │ em vez de ignorado.                                                         │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

const PREFIXO = "pulse_";

export interface TokenValido {
  readonly id: string;
  readonly descricao: string;
  readonly escopo: string;
}

const hashDe = (bruto: string): string =>
  createHash("sha256").update(bruto, "utf8").digest("hex");

/**
 * Confere um token cru contra o banco. Devolve o registro se vivo, ou `null`.
 *
 * Vivo = existe, não revogado, não expirado. A comparação final é constant-time
 * sobre o hash — o `WHERE token_sha256 = $1` já casa por igualdade, e o
 * `timingSafeEqual` é a cinta e o suspensório contra medir tempo de resposta.
 */
export async function verificarToken(
  db: pg.Pool,
  bruto: string,
): Promise<TokenValido | null> {
  const t = (bruto ?? "").trim();
  // Curto demais nunca é token nosso — evita ir ao banco por lixo.
  if (t.length < PREFIXO.length + 20 || !t.startsWith(PREFIXO)) return null;

  const hash = hashDe(t);
  const { rows } = await db.query(
    `SELECT id, descricao, escopo, token_sha256
       FROM ops.api_token
      WHERE token_sha256 = $1
        AND revogado_em IS NULL
        AND (expira_em IS NULL OR expira_em > now())
      LIMIT 1`,
    [hash],
  );
  const r = rows[0];
  if (!r) return null;

  const guardado = String(r["token_sha256"]);
  if (
    guardado.length !== hash.length ||
    !timingSafeEqual(Buffer.from(guardado), Buffer.from(hash))
  ) {
    return null;
  }

  // Marca o uso sem bloquear nem derrubar a leitura: é escrita fora do caminho
  // quente, e falha aqui não pode virar 500 numa rota de leitura.
  void db
    .query(`UPDATE ops.api_token SET ultimo_uso_em = now() WHERE id = $1`, [r["id"]])
    .catch(() => {});

  return {
    id: String(r["id"]),
    descricao: String(r["descricao"]),
    escopo: String(r["escopo"]),
  };
}

/**
 * Emite um token novo. Devolve o token CRU uma única vez — não há como relê-lo
 * depois, porque o banco só guarda o hash.
 */
export async function emitirToken(
  db: pg.Pool,
  descricao: string,
  criadoPor: string,
  expiraEm?: Date | null,
): Promise<{ readonly id: string; readonly token: string }> {
  if (descricao.trim().length < 3) {
    throw new Error("descreva para quem/para quê o token é — some depois no rastro.");
  }
  const token = PREFIXO + randomBytes(32).toString("base64url");
  const { rows } = await db.query(
    `INSERT INTO ops.api_token (descricao, token_sha256, criado_por, expira_em)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [descricao.trim(), hashDe(token), criadoPor, expiraEm ?? null],
  );
  return { id: String(rows[0]?.["id"]), token };
}

/** Revoga um token. Idempotente: revogar duas vezes mantém a primeira data. */
export async function revogarToken(
  db: pg.Pool,
  id: string,
  quem: string,
): Promise<void> {
  await db.query(
    `UPDATE ops.api_token
        SET revogado_em = coalesce(revogado_em, now()), revogado_por = coalesce(revogado_por, $2)
      WHERE id = $1`,
    [id, quem],
  );
}

export interface TokenListado {
  readonly id: string;
  readonly descricao: string;
  readonly criadoPor: string;
  readonly criadoEm: string;
  readonly expiraEm: string | null;
  readonly revogadoEm: string | null;
  readonly ultimoUsoEm: string | null;
}

/** Os tokens, para uma tela/CLI de administração. Nunca devolve o segredo. */
export async function listarTokens(db: pg.Pool): Promise<TokenListado[]> {
  const { rows } = await db.query(
    `SELECT id, descricao, criado_por, criado_em, expira_em, revogado_em, ultimo_uso_em
       FROM ops.api_token
      ORDER BY criado_em DESC`,
  );
  return rows.map((r) => ({
    id: String(r["id"]),
    descricao: String(r["descricao"]),
    criadoPor: String(r["criado_por"]),
    criadoEm: new Date(r["criado_em"]).toISOString(),
    expiraEm: r["expira_em"] ? new Date(r["expira_em"]).toISOString() : null,
    revogadoEm: r["revogado_em"] ? new Date(r["revogado_em"]).toISOString() : null,
    ultimoUsoEm: r["ultimo_uso_em"] ? new Date(r["ultimo_uso_em"]).toISOString() : null,
  }));
}
