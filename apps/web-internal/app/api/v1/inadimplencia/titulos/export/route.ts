import { listarInadimplenciaTitulosApi, type InadimplenciaTituloApi } from "@pulse/config";

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
  "competencia,codigo_lancamento_omie,account_id,cnpj,valor_centavos,vencimento,dias_atraso,faixa,status_painel,e_cliente,movimento,ajuste_centavos,motivo_saida,origem";

export async function GET(req: Request): Promise<Response> {
  const auth = await exigirToken(req);
  if ("erro" in auth) return auth.erro;

  const url = new URL(req.url);
  const f = lerFiltros(url);
  if ("erro" in f) return f.erro;
  const recusa = semFiltro(f.filtros, "atualizadoDesde");
  if (recusa) return recusa;

  const vaga = reservarExport(auth.token);
  if ("erro" in vaga) return vaga.erro;

  return streamExport<InadimplenciaTituloApi>({
    recurso: "inadimplencia-titulos",
    formato: lerFormato(url),
    cabecalhoCsv: CABECALHO,
    linhaCsv: (r) =>
      [
        csv(r.competencia),
        csv(r.codigo_lancamento_omie),
        csv(r.account_id),
        csv(r.cnpj),
        csv(r.valor_centavos),
        csv(r.vencimento),
        csv(r.dias_atraso),
        csv(r.faixa),
        csv(r.status_painel),
        csv(r.e_cliente),
        csv(r.movimento),
        csv(r.ajuste_centavos),
        csv(r.motivo_saida),
        csv(r.origem),
      ].join(","),
    buscar: (apos) => listarInadimplenciaTitulosApi(pool(), { limite: 5000, apos, ...f.filtros }),
    aoTerminar: vaga.liberar,
  });
}
