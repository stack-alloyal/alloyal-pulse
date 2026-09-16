import { listarEventosApi } from "@pulse/config";

import { pool } from "../../../../lib/db";
import { exigirToken, lerCursor, lerFiltros, lerLimite, protegido, respostaLista } from "../_lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const auth = await exigirToken(req);
  if ("erro" in auth) return auth.erro;

  const url = new URL(req.url);
  const f = lerFiltros(url);
  if ("erro" in f) return f.erro;

  const cur = lerCursor(url, "uuid");
  if ("erro" in cur) return cur.erro;

  return protegido(async () => {
    const pagina = await listarEventosApi(pool(), {
      limite: lerLimite(url),
      apos: cur.apos,
      ...f.filtros,
    });
    return respostaLista("eventos", pagina);
  });
}
