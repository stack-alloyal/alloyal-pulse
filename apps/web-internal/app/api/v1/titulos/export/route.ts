import { listarTitulosApi, type TituloApi } from "@pulse/config";

import { pool } from "../../../../../lib/db";
import { csv, exigirToken, lerFiltros, lerFormato, reservarExport, streamExport } from "../../_lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CABECALHO =
  "codigo_lancamento_omie,account_id,cnpj,emissao,vencimento,pagamento,competencia,valor_centavos,recebido_centavos,em_aberto_centavos,dias_atraso,categoria,status_omie,status_pulse,sincronizado_em";

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

  return streamExport<TituloApi>({
    recurso: "titulos",
    formato: lerFormato(url),
    cabecalhoCsv: CABECALHO,
    linhaCsv: (r) =>
      [
        csv(r.codigo_lancamento_omie),
        csv(r.account_id),
        csv(r.cnpj),
        csv(r.emissao),
        csv(r.vencimento),
        csv(r.pagamento),
        csv(r.competencia),
        csv(r.valor_centavos),
        csv(r.recebido_centavos),
        csv(r.em_aberto_centavos),
        csv(r.dias_atraso),
        csv(r.categoria),
        csv(r.status_omie),
        csv(r.status_pulse),
        csv(r.sincronizado_em),
      ].join(","),
    buscar: (apos) => listarTitulosApi(pool(), { limite: 5000, apos, ...f.filtros }),
    aoTerminar: vaga.liberar,
  });
}
