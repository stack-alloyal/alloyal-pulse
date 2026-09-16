import "server-only";

import { verificarToken, type Pagina, type TokenValido } from "@pulse/config";

import { pool } from "../../../../lib/db";

/**
 * A cozinha compartilhada de /api/v1: token, envelope, cursor, paginação, stream.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A ROTA É PORTEIRO, não domínio. Aqui está só o que TODO recurso repete —    │
 * │ conferir o token, montar o envelope, ler/escrever cursor. O SQL mora em      │
 * │ `@pulse/config`. Um recurso novo é uma função de leitura lá e três linhas    │
 * │ de handler aqui.                                                            │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

/** Sobe quando um CAMPO muda de sentido — o cliente decide se re-gera o client. */
export const DICIONARIO_VERSAO = "2026-09-16";

const SEM_CACHE = { "cache-control": "no-store" } as const;

export function erroJson(status: number, codigo: string, mensagem: string): Response {
  return Response.json(
    { erro: { codigo, mensagem }, gerado_em: new Date().toISOString() },
    { status, headers: SEM_CACHE },
  );
}

/**
 * Envolve a leitura: erro inesperado vira 500 EM JSON, que o ETL sabe parsear —
 * e não a página HTML de erro do Next. O detalhe fica só no log do servidor;
 * o corpo nunca carrega mensagem de banco (que denunciaria nome de tabela/coluna).
 */
export async function protegido(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    console.error("[api/v1]", err instanceof Error ? err.message : String(err));
    return erroJson(500, "erro_interno", "Falha ao ler o recurso. Tente de novo; se persistir, avise.");
  }
}

/**
 * Exige um token de serviço vivo. Devolve `{ token }` ou `{ erro }` já pronto.
 *
 * A rota /api/v1 fica FORA do oauth2-proxy (o ETL não tem sessão Google), então
 * este é o único portão. É por isso que ele é a primeira linha de todo handler,
 * antes de tocar em qualquer dado.
 */
export async function exigirToken(
  req: Request,
): Promise<{ readonly token: TokenValido } | { readonly erro: Response }> {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!m?.[1]) {
    return { erro: erroJson(401, "sem_token", "Envie Authorization: Bearer <token>.") };
  }
  const token = await verificarToken(pool(), m[1]);
  if (!token) {
    return { erro: erroJson(401, "token_invalido", "Token ausente, revogado ou expirado.") };
  }
  return { token };
}

// ─── cursor opaco (base64url da chave crua) ──────────────────────────────────

export type TipoDeChave = "uuid" | "bigint";

/**
 * Lê o cursor opaco E confere que a chave decodificada tem a FORMA da chave do
 * recurso (uuid ou inteiro). Achado no pentest: cursor forjado ou corrompido
 * virava erro de cast no Postgres — 500 onde a resposta certa é 400.
 */
export function lerCursor(
  url: URL,
  tipo: TipoDeChave,
): { readonly apos: string | null } | { readonly erro: Response } {
  const c = url.searchParams.get("cursor");
  if (!c) return { apos: null };
  let bruto = "";
  try {
    bruto = Buffer.from(c, "base64url").toString("utf8");
  } catch {
    bruto = "";
  }
  const ok = tipo === "uuid" ? UUID.test(bruto) : /^\d{1,19}$/.test(bruto);
  if (!ok) {
    return {
      erro: erroJson(
        400,
        "cursor_invalido",
        "cursor não é desta lista — use o proximo_cursor que ela devolveu.",
      ),
    };
  }
  return { apos: bruto };
}

function escreverCursor(chave: string | null): string | null {
  return chave === null ? null : Buffer.from(chave, "utf8").toString("base64url");
}

/** Página default grande, teto de segurança — casa com o pedido do ETL. */
export function lerLimite(url: URL): number {
  const bruto = url.searchParams.get("limite") ?? url.searchParams.get("page_size");
  const n = Number(bruto ?? 1000);
  if (!Number.isFinite(n)) return 1000;
  return Math.min(Math.max(Math.trunc(n), 1), 5000);
}

export interface FiltrosDaUrl {
  readonly cnpj: string | null;
  readonly accountId: string | null;
  readonly competencia: string | null;
  readonly atualizadoDesde: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Lê e valida os filtros comuns. Devolve os filtros ou um erro 400 — parâmetro
 * malformado responde na hora em vez de virar um `WHERE` que não casa nada e
 * parece "sem dados". Parâmetro presente mas VAZIO (`?cnpj=`) conta como ausente.
 */
export function lerFiltros(url: URL): { readonly filtros: FiltrosDaUrl } | { readonly erro: Response } {
  const p = url.searchParams;
  const accountId = p.get("account_id") || null;
  if (accountId && !UUID.test(accountId)) {
    return { erro: erroJson(400, "account_id_invalido", "account_id deve ser um UUID.") };
  }
  const competencia = p.get("competencia") || null;
  if (competencia && !COMPETENCIA.test(competencia)) {
    return { erro: erroJson(400, "competencia_invalida", "competencia deve ser AAAA-MM.") };
  }

  // CNPJ: a pontuação é ignorada, mas o que sobrar tem de SER um documento (14
  // dígitos, ou 11 para CPF). Achado no pentest: `cnpj=abc` virava filtro vazio e
  // devolvia a base INTEIRA — erro de digitação não pode ser lido como "sem filtro".
  const cnpjBruto = p.get("cnpj") || null;
  let cnpj: string | null = null;
  if (cnpjBruto) {
    const d = cnpjBruto.replace(/\D/g, "");
    if (d.length !== 14 && d.length !== 11) {
      return {
        erro: erroJson(
          400,
          "cnpj_invalido",
          "cnpj deve ter 14 dígitos (ou 11, para CPF); a pontuação é ignorada.",
        ),
      };
    }
    cnpj = d;
  }

  // atualizado_desde: forma ISO ESTRITA, e NORMALIZADO antes de ir ao SQL. Achado
  // no pentest: `Date.parse("1")` é válido (ano 2001) e o Postgres recusa
  // `'1'::timestamptz` — 500. Só o ISO que nós mesmos geramos chega ao banco.
  const desdeBruto = p.get("atualizado_desde") || null;
  let atualizadoDesde: string | null = null;
  if (desdeBruto) {
    const ms = Date.parse(desdeBruto);
    if (!DATA_ISO.test(desdeBruto) || Number.isNaN(ms)) {
      return {
        erro: erroJson(
          400,
          "atualizado_desde_invalido",
          "atualizado_desde deve ser ISO: AAAA-MM-DD ou AAAA-MM-DDTHH:MM:SSZ.",
        ),
      };
    }
    atualizadoDesde = new Date(ms).toISOString();
  }

  return { filtros: { cnpj, accountId, competencia, atualizadoDesde } };
}

export function respostaLista<T>(recurso: string, pagina: Pagina<T>): Response {
  return Response.json(
    {
      recurso,
      gerado_em: new Date().toISOString(),
      // O carimbo mais novo do recurso: o cliente sabe até quando os dados vão.
      snapshot: pagina.frescor,
      dicionario_versao: DICIONARIO_VERSAO,
      proximo_cursor: escreverCursor(pagina.proximaChave),
      dados: pagina.linhas,
    },
    { headers: SEM_CACHE },
  );
}

// ─── export em massa (NDJSON/CSV), keyset em streaming ───────────────────────

export type Formato = "ndjson" | "csv";

export function lerFormato(url: URL): Formato {
  return url.searchParams.get("formato") === "csv" ? "csv" : "ndjson";
}

/**
 * Faz o dump inteiro do recurso, paginando por keyset e emitindo linha a linha —
 * nunca carrega os 170 mil na memória. Um teto de páginas evita laço infinito se
 * algum dia a chave deixar de avançar.
 */
export function streamExport<T>(opts: {
  readonly recurso: string;
  readonly formato: Formato;
  readonly cabecalhoCsv: string;
  readonly linhaCsv: (r: T) => string;
  readonly buscar: (apos: string | null) => Promise<Pagina<T>>;
}): Response {
  const { formato, cabecalhoCsv, linhaCsv, buscar } = opts;
  const encoder = new TextEncoder();
  const MAX_PAGINAS = 100_000;

  const stream = new ReadableStream<Uint8Array>({
    async start(controlador) {
      try {
        if (formato === "csv") controlador.enqueue(encoder.encode(cabecalhoCsv + "\n"));
        let apos: string | null = null;
        for (let i = 0; i < MAX_PAGINAS; i++) {
          const pagina: Pagina<T> = await buscar(apos);
          for (const linha of pagina.linhas) {
            const texto = formato === "csv" ? linhaCsv(linha) : JSON.stringify(linha);
            controlador.enqueue(encoder.encode(texto + "\n"));
          }
          if (pagina.proximaChave === null) break;
          apos = pagina.proximaChave;
        }
        controlador.close();
      } catch (err) {
        controlador.error(err);
      }
    },
  });

  const tipo = formato === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson; charset=utf-8";
  const data = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "content-type": tipo,
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="${opts.recurso}-${data}.${formato === "csv" ? "csv" : "ndjson"}"`,
    },
  });
}

/**
 * Escapa um campo para CSV (RFC 4180): aspas dobradas quando há vírgula/aspas/quebra.
 *
 * E neutraliza INJEÇÃO DE FÓRMULA: célula que começa com `=`, `+`, `@` (ou `-`
 * sem ser número) é executada pelo Excel/Sheets ao abrir o arquivo. Achado no
 * pentest: há razão social na base começando assim. O apóstrofo na frente faz a
 * planilha ler texto — e número negativo legítimo (valor de contração) passa
 * intacto, porque a regra do `-` só vale quando NÃO é número.
 */
export function csv(valor: string | number | boolean | null | undefined): string {
  if (valor === null || valor === undefined) return "";
  let s = String(valor);
  if (/^[=+@]/.test(s) || (s.startsWith("-") && !/^-?\d+(\.\d+)?$/.test(s))) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
