import { listarContasApi } from "@pulse/config";

import { pool } from "../../../../lib/db";
import { exigirToken, lerCursor, lerFiltros, lerLimite, respostaLista } from "../_lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const auth = await exigirToken(req);
  if ("erro" in auth) return auth.erro;

  const url = new URL(req.url);
  const f = lerFiltros(url);
  if ("erro" in f) return f.erro;

  const pagina = await listarContasApi(pool(), {
    limite: lerLimite(url),
    apos: lerCursor(url),
    ...f.filtros,
  });
  return respostaLista("contas", pagina);
}
