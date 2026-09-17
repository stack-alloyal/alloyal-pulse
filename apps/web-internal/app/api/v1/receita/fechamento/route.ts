import { listarFechamentoApi } from "@pulse/config";

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
 * A cascata de MRR por competência — `analytics.monthly_close`, exatamente o que a
 * tela /receita lê: inicial, movimentos, final, NRR/GRR, contas, estado
 * (aberta/congelada) e publicado_em. É por competência, não por conta: cnpj e
 * account_id não se aplicam.
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await exigirToken(req);
  if ("erro" in auth) return auth.erro;
  const teto = limitarLista(auth.token);
  if (teto) return teto;

  const url = new URL(req.url);
  const f = lerFiltros(url);
  if ("erro" in f) return f.erro;
  const recusa = semFiltro(f.filtros, "cnpj", "accountId");
  if (recusa) return recusa;
  const cur = lerCursor(url, "mes");
  if ("erro" in cur) return cur.erro;

  return protegido(async () => {
    const pagina = await listarFechamentoApi(pool(), {
      limite: lerLimite(url),
      apos: cur.apos,
      ...f.filtros,
    });
    return respostaLista("receita/fechamento", pagina);
  });
}
