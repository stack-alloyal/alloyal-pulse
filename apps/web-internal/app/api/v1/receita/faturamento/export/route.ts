import { listarFaturamentoApi, type FaturamentoApi } from "@pulse/config";

import { pool } from "../../../../../../lib/db";
import {
  csv,
  exigirToken,
  lerFiltros,
  lerFormato,
  reservarExport,
  semFiltro,
  streamExport,
} from "../../../_lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CABECALHO =
  "competencia,account_id,cobrado_centavos,titulos_cobrados,recebido_centavos,titulos_recebidos";

export async function GET(req: Request): Promise<Response> {
  const auth = await exigirToken(req);
  if ("erro" in auth) return auth.erro;

  const url = new URL(req.url);
  const f = lerFiltros(url);
  if ("erro" in f) return f.erro;
  const recusa = semFiltro(f.filtros, "atualizadoDesde");
  if (recusa) return recusa;

  // A vaga só é tomada depois dos 400 possíveis.
  const vaga = reservarExport(auth.token);
  if ("erro" in vaga) return vaga.erro;

  return streamExport<FaturamentoApi>({
    recurso: "receita-faturamento",
    formato: lerFormato(url),
    cabecalhoCsv: CABECALHO,
    linhaCsv: (r) =>
      [
        csv(r.competencia),
        csv(r.account_id),
        csv(r.cobrado_centavos),
        csv(r.titulos_cobrados),
        csv(r.recebido_centavos),
        csv(r.titulos_recebidos),
      ].join(","),
    buscar: (apos) => listarFaturamentoApi(pool(), { limite: 5000, apos, ...f.filtros }),
    aoTerminar: vaga.liberar,
  });
}
