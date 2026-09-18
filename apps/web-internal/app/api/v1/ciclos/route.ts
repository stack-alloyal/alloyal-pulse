import { listarCiclosApi } from "@pulse/config";

import { pool } from "../../../../lib/db";
import { exigirToken, lerFiltros, limitarLista, protegido, respostaLista, semFiltro } from "../_lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Os ciclos de carga: declaração (fonte, método, agenda, fase, implementado) +
 * a última execução e o último SUCESSO de cada um. É como o ETL sabe contra que
 * frescor está comparando. Poucas dezenas de linhas — sem paginação nem filtros.
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await exigirToken(req);
  if ("erro" in auth) return auth.erro;
  const teto = limitarLista(auth.token);
  if (teto) return teto;

  const url = new URL(req.url);
  const f = lerFiltros(url);
  if ("erro" in f) return f.erro;
  const recusa = semFiltro(f.filtros, "cnpj", "accountId", "competencia", "atualizadoDesde");
  if (recusa) return recusa;

  return protegido(async () => respostaLista("ciclos", await listarCiclosApi(pool())));
}
