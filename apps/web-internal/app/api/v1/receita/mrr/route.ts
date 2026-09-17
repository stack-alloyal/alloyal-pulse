import { listarMrrApi } from "@pulse/config";

import { pool } from "../../../../../lib/db";
import {
  exigirToken,
  lerCursor,
  lerFiltros,
  lerLimite,
  limitarLista,
  protegido,
  respostaLista,
  semFiltro,
} from "../../_lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * MRR por competência × conta — a camada MEDIDA (faturado do Omie, suavizado
 * pela view `analytics.mrr_faturado_mes`). `origem` é sempre `faturamento`.
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await exigirToken(req);
  if ("erro" in auth) return auth.erro;
  const teto = limitarLista(auth.token);
  if (teto) return teto;

  const url = new URL(req.url);
  const f = lerFiltros(url);
  if ("erro" in f) return f.erro;
  // A view não tem carimbo de linha; o incremental é pelo `snapshot` do envelope.
  const recusa = semFiltro(f.filtros, "atualizadoDesde");
  if (recusa) return recusa;
  const cur = lerCursor(url, "mes_conta");
  if ("erro" in cur) return cur.erro;

  return protegido(async () => {
    const pagina = await listarMrrApi(pool(), {
      limite: lerLimite(url),
      apos: cur.apos,
      ...f.filtros,
    });
    return respostaLista("receita/mrr", pagina);
  });
}
