import { listarSaidasApi } from "@pulse/config";

import { pool } from "../../../../lib/db";
import {
  exigirToken,
  lerCursor,
  lerFiltros,
  lerLimite,
  limitarLista,
  protegido,
  respostaLista,
} from "../_lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * As saídas (success.cancellation) com as quatro datas — levantada, fim do
 * aviso, última cobrança, efeito na receita —, o MRR congelado na levantada,
 * motivo e estado. `competencia` filtra pelo mês do EFEITO NA RECEITA;
 * `atualizado_desde` usa o carimbo mais novo entre os passos do fluxo.
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await exigirToken(req);
  if ("erro" in auth) return auth.erro;
  const teto = limitarLista(auth.token);
  if (teto) return teto;

  const url = new URL(req.url);
  const f = lerFiltros(url);
  if ("erro" in f) return f.erro;
  const cur = lerCursor(url, "uuid");
  if ("erro" in cur) return cur.erro;

  return protegido(async () => {
    const pagina = await listarSaidasApi(pool(), {
      limite: lerLimite(url),
      apos: cur.apos,
      ...f.filtros,
    });
    return respostaLista("saidas", pagina);
  });
}
