import { listarInadimplenciaContasApi, type InadimplenciaContaApi } from "@pulse/config";

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
  "competencia,account_id,cnpj,em_aberto_centavos,titulos,maior_atraso_dias,faixa,status_painel,ativa,e_cliente,entrou_centavos,recuperado_centavos,cancelado_centavos,origem";

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

  return streamExport<InadimplenciaContaApi>({
    recurso: "inadimplencia-contas",
    formato: lerFormato(url),
    cabecalhoCsv: CABECALHO,
    linhaCsv: (r) =>
      [
        csv(r.competencia),
        csv(r.account_id),
        csv(r.cnpj),
        csv(r.em_aberto_centavos),
        csv(r.titulos),
        csv(r.maior_atraso_dias),
        csv(r.faixa),
        csv(r.status_painel),
        csv(r.ativa),
        csv(r.e_cliente),
        csv(r.entrou_centavos),
        csv(r.recuperado_centavos),
        csv(r.cancelado_centavos),
        csv(r.origem),
      ].join(","),
    buscar: (apos) => listarInadimplenciaContasApi(pool(), { limite: 5000, apos, ...f.filtros }),
    aoTerminar: vaga.liberar,
  });
}
