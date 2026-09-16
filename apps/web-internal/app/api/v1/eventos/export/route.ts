import { listarEventosApi, type EventoApi } from "@pulse/config";

import { pool } from "../../../../../lib/db";
import { csv, exigirToken, lerFiltros, lerFormato, reservarExport, streamExport } from "../../_lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CABECALHO =
  "id,account_id,contract_id,competencia,tipo,valor_centavos,origem,motivo,reconstruido,chave_natural,criado_em";

export async function GET(req: Request): Promise<Response> {
  const auth = await exigirToken(req);
  if ("erro" in auth) return auth.erro;

  const url = new URL(req.url);
  const f = lerFiltros(url);
  if ("erro" in f) return f.erro;

  // A vaga só é tomada depois dos 400 possíveis: parâmetro errado não pode
  // consumir a concorrência de quem está exportando de verdade.
  const vaga = reservarExport(auth.token);
  if ("erro" in vaga) return vaga.erro;

  return streamExport<EventoApi>({
    recurso: "eventos",
    formato: lerFormato(url),
    cabecalhoCsv: CABECALHO,
    linhaCsv: (r) =>
      [
        csv(r.id),
        csv(r.account_id),
        csv(r.contract_id),
        csv(r.competencia),
        csv(r.tipo),
        csv(r.valor_centavos),
        csv(r.origem),
        csv(r.motivo),
        csv(r.reconstruido),
        csv(r.chave_natural),
        csv(r.criado_em),
      ].join(","),
    buscar: (apos) => listarEventosApi(pool(), { limite: 5000, apos, ...f.filtros }),
    aoTerminar: vaga.liberar,
  });
}
