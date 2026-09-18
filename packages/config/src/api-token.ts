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
 *
 * Há duas portas de entrada, de propósito: o CLI (`emitirToken`/`revogarToken`,
 * papel dono, sem motivo) e a tela de Configurações (`*Auditado`, papel da
 * aplicação, motivo obrigatório e trilha em `ops.mudanca`). A tela é o caminho
 * normal; o CLI é o de emergência — quando a tela não está de pé.
 */

const PREFIXO = "pulse_";
const DOMINIO = /^[^@\s]+@alloyal\.com\.br$/i;

// Amostragem do "último uso": grava no máximo uma vez por minuto por token. Em
// cada requisição virava uma ESCRITA por leitura — desnecessário para um carimbo
// cuja pergunta é "ninguém usa este token desde março?".
const INTERVALO_DE_USO_MS = 60_000;
const ultimoUsoGravado = new Map<string, number>();

export interface TokenValido {
  readonly id: string;
  readonly descricao: string;
  readonly escopo: string;
}

const hashDe = (bruto: string): string =>
  createHash("sha256").update(bruto, "utf8").digest("hex");

const novoToken = (): string => PREFIXO + randomBytes(32).toString("base64url");

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
  // quente, e falha aqui não pode virar 500 numa rota de leitura. Amostrada:
  // uma vez por minuto por token, não uma por requisição.
  const id = String(r["id"]);
  const agora = Date.now();
  if ((ultimoUsoGravado.get(id) ?? 0) + INTERVALO_DE_USO_MS <= agora) {
    ultimoUsoGravado.set(id, agora);
    void db
      .query(`UPDATE ops.api_token SET ultimo_uso_em = now() WHERE id = $1`, [id])
      .catch(() => {});
  }

  return {
    id,
    descricao: String(r["descricao"]),
    escopo: String(r["escopo"]),
  };
}

/**
 * Emite um token novo (porta do CLI). Devolve o token CRU uma única vez — não
 * há como relê-lo depois, porque o banco só guarda o hash.
 */
export async function emitirToken(
  db: pg.Pool,
  descricao: string,
  criadoPor: string,
  expiraEm?: Date | null,
  responsavel?: string | null,
): Promise<{ readonly id: string; readonly token: string }> {
  if (descricao.trim().length < 3) {
    throw new Error("descreva para quem/para quê o token é — some depois no rastro.");
  }
  const token = novoToken();
  const { rows } = await db.query(
    `INSERT INTO ops.api_token (descricao, token_sha256, criado_por, expira_em, responsavel)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [descricao.trim(), hashDe(token), criadoPor, expiraEm ?? null, responsavel ?? null],
  );
  return { id: String(rows[0]?.["id"]), token };
}

/** Revoga um token (porta do CLI). Idempotente: revogar duas vezes mantém a primeira data. */
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

export class TokenInvalidoError extends Error {}

/**
 * Emite pela TELA: valida como gente valida, grava o token e a trilha na MESMA
 * transação. Sem trilha não há token — e sem token não há trilha órfã.
 *
 * `dias` é obrigatório e limitado: expirar é hábito, revogar é reação. O
 * responsável é e-mail interno — é quem responde pelo token quando a pergunta
 * "de quem é isto?" aparecer, e ela sempre aparece.
 */
export async function emitirTokenAuditado(
  db: pg.Pool,
  e: {
    readonly descricao: string;
    readonly responsavel: string;
    readonly dias: number;
    readonly quem: string;
    readonly motivo: string;
  },
): Promise<{ readonly id: string; readonly token: string; readonly expiraEm: string }> {
  const descricao = e.descricao.trim();
  const responsavel = e.responsavel.trim().toLowerCase();
  const motivo = e.motivo.trim();
  if (descricao.length < 3) throw new TokenInvalidoError("Descreva para quem/para quê o token é.");
  if (!DOMINIO.test(responsavel)) {
    throw new TokenInvalidoError("O responsável precisa ser um e-mail @alloyal.com.br.");
  }
  if (!Number.isInteger(e.dias) || e.dias < 1 || e.dias > 730) {
    throw new TokenInvalidoError("A validade vai de 1 a 730 dias.");
  }
  if (motivo.length < 10) throw new TokenInvalidoError("Diga o motivo com pelo menos 10 caracteres.");

  const token = novoToken();
  const cliente = await db.connect();
  try {
    await cliente.query("BEGIN");
    const { rows } = await cliente.query(
      `INSERT INTO ops.api_token (descricao, token_sha256, criado_por, expira_em, responsavel)
       VALUES ($1, $2, $3, now() + make_interval(days => $4::int), $5)
       RETURNING id, expira_em`,
      [descricao, hashDe(token), e.quem, e.dias, responsavel],
    );
    const id = String(rows[0]?.["id"]);
    const expiraEm = new Date(rows[0]?.["expira_em"] as string).toISOString();
    // Nunca o token nem o hash na trilha — só o que identifica e explica.
    await cliente.query(
      `INSERT INTO ops.mudanca (tipo, chave, valor_antes, valor_depois, quem, motivo)
       VALUES ('api_token', $1, NULL, $2::jsonb, $3, $4)`,
      [id, JSON.stringify({ acao: "emitido", descricao, responsavel, expira_em: expiraEm }), e.quem, motivo],
    );
    await cliente.query("COMMIT");
    return { id, token, expiraEm };
  } catch (err) {
    await cliente.query("ROLLBACK");
    throw err;
  } finally {
    cliente.release();
  }
}

/** Revoga pela TELA: motivo obrigatório e trilha na mesma transação. */
export async function revogarTokenAuditado(
  db: pg.Pool,
  r: { readonly id: string; readonly quem: string; readonly motivo: string },
): Promise<{ readonly descricao: string }> {
  const motivo = r.motivo.trim();
  if (motivo.length < 10) throw new TokenInvalidoError("Diga o motivo com pelo menos 10 caracteres.");
  const cliente = await db.connect();
  try {
    await cliente.query("BEGIN");
    const { rows } = await cliente.query(
      `UPDATE ops.api_token
          SET revogado_em = coalesce(revogado_em, now()), revogado_por = coalesce(revogado_por, $2)
        WHERE id = $1
        RETURNING descricao, responsavel`,
      [r.id, r.quem],
    );
    if (!rows[0]) throw new TokenInvalidoError("Token não encontrado.");
    await cliente.query(
      `INSERT INTO ops.mudanca (tipo, chave, valor_antes, valor_depois, quem, motivo)
       VALUES ('api_token', $1, $2::jsonb, $3::jsonb, $4, $5)`,
      [
        r.id,
        JSON.stringify({ estado: "ativo" }),
        JSON.stringify({ estado: "revogado", descricao: rows[0]["descricao"], responsavel: rows[0]["responsavel"] }),
        r.quem,
        motivo,
      ],
    );
    await cliente.query("COMMIT");
    return { descricao: String(rows[0]["descricao"]) };
  } catch (err) {
    await cliente.query("ROLLBACK");
    throw err;
  } finally {
    cliente.release();
  }
}

export type EstadoDoToken = "ativo" | "expirado" | "revogado";

export interface TokenListado {
  readonly id: string;
  readonly descricao: string;
  readonly responsavel: string | null;
  readonly criadoPor: string;
  readonly criadoEm: string;
  readonly expiraEm: string | null;
  readonly revogadoEm: string | null;
  readonly revogadoPor: string | null;
  readonly ultimoUsoEm: string | null;
  readonly estado: EstadoDoToken;
}

/** Os tokens, para a tela e o CLI. Nunca devolve o segredo. */
export async function listarTokens(db: pg.Pool): Promise<TokenListado[]> {
  const { rows } = await db.query(
    `SELECT id, descricao, responsavel, criado_por, criado_em, expira_em, revogado_em, revogado_por, ultimo_uso_em,
            CASE WHEN revogado_em IS NOT NULL THEN 'revogado'
                 WHEN expira_em IS NOT NULL AND expira_em <= now() THEN 'expirado'
                 ELSE 'ativo' END AS estado
       FROM ops.api_token
      ORDER BY (revogado_em IS NULL AND (expira_em IS NULL OR expira_em > now())) DESC, criado_em DESC`,
  );
  const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
  return rows.map((r) => ({
    id: String(r["id"]),
    descricao: String(r["descricao"]),
    responsavel: (r["responsavel"] as string | null) ?? null,
    criadoPor: String(r["criado_por"]),
    criadoEm: new Date(r["criado_em"] as string).toISOString(),
    expiraEm: iso(r["expira_em"]),
    revogadoEm: iso(r["revogado_em"]),
    revogadoPor: (r["revogado_por"] as string | null) ?? null,
    ultimoUsoEm: iso(r["ultimo_uso_em"]),
    estado: String(r["estado"]) as EstadoDoToken,
  }));
}
