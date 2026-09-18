import { listarInadimplenciaTitulosApi } from "@pulse/config";

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
 * A foto de inadimplência título a título (fact.inadimplencia_titulo): a cada
 * competência, o que estava no saldo (permaneceu/entrou) e o que saiu
 * (recuperado/cancelado), com idade, faixa e estado do painel naquele momento.
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await exigirToken(req);
  if ("erro" in auth) return auth.erro;
  const teto = limitarLista(auth.token);
  if (teto) return teto;

  const url = new URL(req.url);
  const f = lerFiltros(url);
  if ("erro" in f) return f.erro;
  const recusa = semFiltro(f.filtros, "atualizadoDesde");
  if (recusa) return recusa;
  const cur = lerCursor(url, "mes_titulo");
  if ("erro" in cur) return cur.erro;

  return protegido(async () => {
    const pagina = await listarInadimplenciaTitulosApi(pool(), {
      limite: lerLimite(url),
      apos: cur.apos,
      ...f.filtros,
    });
    return respostaLista("inadimplencia/titulos", pagina);
  });
}
