import { listarInadimplenciaContasApi } from "@pulse/config";

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
 * A foto de inadimplência por competência × conta (fact.inadimplencia_titulo
 * agregado): em aberto, títulos, maior atraso, faixa, status do painel e o
 * universo (`e_cliente`). Conta nula = título sem vínculo (CPF ou CNPJ solto).
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await exigirToken(req);
  if ("erro" in auth) return auth.erro;
  const teto = limitarLista(auth.token);
  if (teto) return teto;

  const url = new URL(req.url);
  const f = lerFiltros(url);
  if ("erro" in f) return f.erro;
  // A foto é reescrita inteira a cada apuração: não há carimbo por linha.
  const recusa = semFiltro(f.filtros, "atualizadoDesde");
  if (recusa) return recusa;
  const cur = lerCursor(url, "mes_conta");
  if ("erro" in cur) return cur.erro;

  return protegido(async () => {
    const pagina = await listarInadimplenciaContasApi(pool(), {
      limite: lerLimite(url),
      apos: cur.apos,
      ...f.filtros,
    });
    return respostaLista("inadimplencia/contas", pagina);
  });
}
