import { listarContasApi } from "@pulse/config";

import { pool } from "../../../../lib/db";
import {
  exigirToken,
  lerCursor,
  lerFiltros,
  lerLimite,
  limitarLista,
  protegido,
  respostaLista,
  semFiltro,
} from "../_lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const auth = await exigirToken(req);
  if ("erro" in auth) return auth.erro;
  const teto = limitarLista(auth.token);
  if (teto) return teto;

  const url = new URL(req.url);
  const f = lerFiltros(url);
  if ("erro" in f) return f.erro;
  // Conta não tem competência. Achado na auditoria da documentação: o parâmetro
  // era aceito e ignorado — devolvia a base inteira como se fosse o recorte.
  const recusa = semFiltro(f.filtros, "competencia");
  if (recusa) return recusa;
  const cur = lerCursor(url, "uuid");
  if ("erro" in cur) return cur.erro;

  return protegido(async () => {
    const pagina = await listarContasApi(pool(), {
      limite: lerLimite(url),
      apos: cur.apos,
      ...f.filtros,
    });
    return respostaLista("contas", pagina);
  });
}
