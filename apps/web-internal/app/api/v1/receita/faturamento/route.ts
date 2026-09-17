import { listarFaturamentoApi } from "@pulse/config";

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
 * Faturamento por competência × conta nas DUAS bases, lado a lado e nunca
 * fundidas: cobrado (títulos pelo vencimento) e recebido (pagamentos pela data
 * de pagamento). Mesmo universo de cliente da Carteira e da aba Faturamento.
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await exigirToken(req);
  if ("erro" in auth) return auth.erro;
  const teto = limitarLista(auth.token);
  if (teto) return teto;

  const url = new URL(req.url);
  const f = lerFiltros(url);
  if ("erro" in f) return f.erro;
  // É agregação sob demanda, sem carimbo de linha; incremental pelo `snapshot`.
  const recusa = semFiltro(f.filtros, "atualizadoDesde");
  if (recusa) return recusa;
  const cur = lerCursor(url, "mes_conta");
  if ("erro" in cur) return cur.erro;

  return protegido(async () => {
    const pagina = await listarFaturamentoApi(pool(), {
      limite: lerLimite(url),
      apos: cur.apos,
      ...f.filtros,
    });
    return respostaLista("receita/faturamento", pagina);
  });
}
