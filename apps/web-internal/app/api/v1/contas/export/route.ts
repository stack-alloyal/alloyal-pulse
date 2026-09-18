import { listarContasApi, type ContaApi } from "@pulse/config";

import { pool } from "../../../../../lib/db";
import {
  csv,
  exigirToken,
  lerFiltros,
  lerFormato,
  reservarExport,
  semFiltro,
  streamExport,
} from "../../_lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CABECALHO =
  "account_id,razao_social,cnpj,codigo_omie,hubspot_company_id,brand_id,branch_id,parent_account_id,status_core,vinculo,csm_email,setor,porte,atualizado_em";

export async function GET(req: Request): Promise<Response> {
  const auth = await exigirToken(req);
  if ("erro" in auth) return auth.erro;

  const url = new URL(req.url);
  const f = lerFiltros(url);
  if ("erro" in f) return f.erro;
  // Conta não tem competência: aceitar e ignorar devolveria a base inteira.
  const recusa = semFiltro(f.filtros, "competencia");
  if (recusa) return recusa;

  // A vaga só é tomada depois dos 400 possíveis: parâmetro errado não pode
  // consumir a concorrência de quem está exportando de verdade.
  const vaga = reservarExport(auth.token);
  if ("erro" in vaga) return vaga.erro;

  return streamExport<ContaApi>({
    recurso: "contas",
    formato: lerFormato(url),
    cabecalhoCsv: CABECALHO,
    linhaCsv: (r) =>
      [
        csv(r.account_id),
        csv(r.razao_social),
        csv(r.cnpj),
        // O array de códigos Omie vira uma célula, separada por ';' — CSV não
        // tem lista, e uma coluna por código explodiria a largura.
        csv(r.codigo_omie.join(";")),
        csv(r.hubspot_company_id),
        csv(r.brand_id),
        csv(r.branch_id),
        csv(r.parent_account_id),
        csv(r.status_core),
        csv(r.vinculo),
        csv(r.csm_email),
        csv(r.setor),
        csv(r.porte),
        csv(r.atualizado_em),
      ].join(","),
    buscar: (apos) => listarContasApi(pool(), { limite: 2000, apos, ...f.filtros }),
    aoTerminar: vaga.liberar,
  });
}
