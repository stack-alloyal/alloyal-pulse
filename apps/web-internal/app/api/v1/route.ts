import { DICIONARIO_VERSAO } from "./_lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** O índice de /api/v1: aberto, só metadados — por onde o cliente começa. */
export function GET(): Response {
  return Response.json(
    {
      nome: "Alloyal Pulse — API de leitura",
      versao: "1.0.0",
      dicionario_versao: DICIONARIO_VERSAO,
      openapi: "/api/v1/openapi.json",
      autenticacao: "Authorization: Bearer <token pulse_...> — só leitura, revogável.",
      recursos: {
        contas: { lista: "/api/v1/contas", export: "/api/v1/contas/export?formato=ndjson|csv" },
        titulos: { lista: "/api/v1/titulos", export: "/api/v1/titulos/export?formato=ndjson|csv" },
        eventos: { lista: "/api/v1/eventos", export: "/api/v1/eventos/export?formato=ndjson|csv" },
      },
      filtros: ["cursor", "limite", "cnpj", "account_id", "competencia", "atualizado_desde"],
      observacao:
        "MRR/eventos são a camada faturada do Omie; contract_id é nulo (o Pulse não tem contrato). " +
        "Cruze o contrato pelo seu ETL usando os ids de /contas.",
    },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
