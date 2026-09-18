import { DICIONARIO_VERSAO } from "../_lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * O contrato OpenAPI de /api/v1, servido aberto (é esquema, não dado): o cliente
 * gera o client e o MCP em cima disto sem precisar de token para ler a forma.
 * Os dados, esses sim, todos exigem o Bearer.
 */

const FILTROS_COMUNS = [
  { $ref: "#/components/parameters/cursor" },
  { $ref: "#/components/parameters/limite" },
  { $ref: "#/components/parameters/cnpj" },
  { $ref: "#/components/parameters/account_id" },
  { $ref: "#/components/parameters/atualizado_desde" },
];

// Recursos que não aceitam todos os filtros comuns passam a própria lista em
// `comuns` — o contrato só promete o que a rota de fato aplica (o resto é 400).
function lista(recurso: string, schema: string, extras: unknown[] = [], comuns: unknown[] = FILTROS_COMUNS) {
  return {
    get: {
      summary: `Lista ${recurso} (paginado por cursor)`,
      tags: [recurso],
      security: [{ bearerAuth: [] }],
      parameters: [...comuns, ...extras],
      responses: {
        "200": {
          description: "Página de resultados",
          content: {
            "application/json": {
              schema: {
                allOf: [
                  { $ref: "#/components/schemas/Envelope" },
                  { properties: { dados: { type: "array", items: { $ref: `#/components/schemas/${schema}` } } } },
                ],
              },
            },
          },
        },
        "401": { $ref: "#/components/responses/NaoAutorizado" },
        "400": { $ref: "#/components/responses/Invalido" },
        "429": { $ref: "#/components/responses/LimiteExcedido" },
      },
    },
  };
}

const FILTROS_DE_EXPORT = [
  { $ref: "#/components/parameters/cnpj" },
  { $ref: "#/components/parameters/account_id" },
  { $ref: "#/components/parameters/atualizado_desde" },
];

function exportar(recurso: string, extras: unknown[] = [], comuns: unknown[] = FILTROS_DE_EXPORT) {
  return {
    get: {
      summary: `Export em massa de ${recurso} (NDJSON ou CSV, streaming)`,
      tags: [recurso],
      security: [{ bearerAuth: [] }],
      parameters: [{ $ref: "#/components/parameters/formato" }, ...comuns, ...extras],
      responses: {
        "200": {
          description: "Fluxo do recurso inteiro, uma linha por registro",
          content: {
            "application/x-ndjson": { schema: { type: "string" } },
            "text/csv": { schema: { type: "string" } },
          },
        },
        "401": { $ref: "#/components/responses/NaoAutorizado" },
        "400": { $ref: "#/components/responses/Invalido" },
        "429": { $ref: "#/components/responses/LimiteExcedido" },
      },
    },
  };
}

const centavos ={ type: "string", description: "Valor em centavos inteiros, como string." };
const dataIso = { type: "string", format: "date", nullable: true };
const tsIso = { type: "string", format: "date-time", nullable: true };

const SPEC = {
  openapi: "3.1.0",
  info: {
    title: "Alloyal Pulse — API de leitura",
    version: `1.0.0 (dicionário ${DICIONARIO_VERSAO})`,
    description:
      "Leitura da camada MEDIDA do Pulse (faturado do Omie) mais a ponte de identidade " +
      "account_id ↔ CNPJ ↔ código Omie ↔ HubSpot. O Pulse NÃO tem a camada de contrato " +
      "(core.contract vazio); o MRR aqui é o faturado, com origem sempre 'faturamento'. " +
      "Centavos inteiros, datas ISO, competência AAAA-MM, CNPJ só dígitos.",
  },
  servers: [{ url: "https://pulse.alloyal.com.br/api/v1" }],
  security: [{ bearerAuth: [] }],
  paths: {
    "/contas": lista("contas", "Conta"),
    "/contas/export": exportar("contas"),
    "/titulos": lista("titulos", "Titulo", [{ $ref: "#/components/parameters/competencia" }]),
    "/titulos/export": exportar("titulos", [{ $ref: "#/components/parameters/competencia" }]),
    "/eventos": lista("eventos", "Evento", [{ $ref: "#/components/parameters/competencia" }]),
    "/eventos/export": exportar("eventos", [{ $ref: "#/components/parameters/competencia" }]),
    // Receita (P1). Por conta × competência, sem carimbo de linha: `atualizado_desde`
    // não se aplica (400) — o incremental é pelo `snapshot` do envelope.
    "/receita/mrr": lista(
      "receita/mrr",
      "Mrr",
      [{ $ref: "#/components/parameters/competencia" }],
      [
        { $ref: "#/components/parameters/cursor" },
        { $ref: "#/components/parameters/limite" },
        { $ref: "#/components/parameters/cnpj" },
        { $ref: "#/components/parameters/account_id" },
      ],
    ),
    "/receita/mrr/export": exportar(
      "receita/mrr",
      [{ $ref: "#/components/parameters/competencia" }],
      [{ $ref: "#/components/parameters/cnpj" }, { $ref: "#/components/parameters/account_id" }],
    ),
    // A cascata é por competência, não por conta: cnpj e account_id não se aplicam.
    "/receita/fechamento": lista(
      "receita/fechamento",
      "Fechamento",
      [{ $ref: "#/components/parameters/competencia" }],
      [
        { $ref: "#/components/parameters/cursor" },
        { $ref: "#/components/parameters/limite" },
        { $ref: "#/components/parameters/atualizado_desde" },
      ],
    ),
    "/receita/faturamento": lista(
      "receita/faturamento",
      "Faturamento",
      [{ $ref: "#/components/parameters/competencia" }],
      [
        { $ref: "#/components/parameters/cursor" },
        { $ref: "#/components/parameters/limite" },
        { $ref: "#/components/parameters/cnpj" },
        { $ref: "#/components/parameters/account_id" },
      ],
    ),
    "/receita/faturamento/export": exportar(
      "receita/faturamento",
      [{ $ref: "#/components/parameters/competencia" }],
      [{ $ref: "#/components/parameters/cnpj" }, { $ref: "#/components/parameters/account_id" }],
    ),
    // P2. Inadimplência é FOTO (reescrita a cada apuração): sem atualizado_desde.
    "/inadimplencia/contas": lista(
      "inadimplencia/contas",
      "InadimplenciaConta",
      [{ $ref: "#/components/parameters/competencia" }],
      [
        { $ref: "#/components/parameters/cursor" },
        { $ref: "#/components/parameters/limite" },
        { $ref: "#/components/parameters/cnpj" },
        { $ref: "#/components/parameters/account_id" },
      ],
    ),
    "/inadimplencia/contas/export": exportar(
      "inadimplencia/contas",
      [{ $ref: "#/components/parameters/competencia" }],
      [{ $ref: "#/components/parameters/cnpj" }, { $ref: "#/components/parameters/account_id" }],
    ),
    "/inadimplencia/titulos": lista(
      "inadimplencia/titulos",
      "InadimplenciaTitulo",
      [{ $ref: "#/components/parameters/competencia" }],
      [
        { $ref: "#/components/parameters/cursor" },
        { $ref: "#/components/parameters/limite" },
        { $ref: "#/components/parameters/cnpj" },
        { $ref: "#/components/parameters/account_id" },
      ],
    ),
    "/inadimplencia/titulos/export": exportar(
      "inadimplencia/titulos",
      [{ $ref: "#/components/parameters/competencia" }],
      [{ $ref: "#/components/parameters/cnpj" }, { $ref: "#/components/parameters/account_id" }],
    ),
    // Saídas: `competencia` filtra pelo mês do EFEITO NA RECEITA.
    "/saidas": lista("saidas", "Saida", [{ $ref: "#/components/parameters/competencia" }]),
    // Ciclos: poucas dezenas de linhas, sem paginação nem filtros.
    "/ciclos": lista("ciclos", "Ciclo", [], []),
    "/dicionario": {
      get: {
        summary: "O dicionário: significado, fonte e regras de cada recurso e campo, versionado",
        tags: ["dicionario"],
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "O dicionário inteiro",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    recurso: { type: "string" },
                    gerado_em: { type: "string", format: "date-time" },
                    dicionario_versao: { type: "string" },
                    dados: { $ref: "#/components/schemas/Dicionario" },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/NaoAutorizado" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", description: "Token de serviço só-leitura, revogável (prefixo pulse_)." },
    },
    parameters: {
      cursor: { name: "cursor", in: "query", schema: { type: "string" }, description: "Cursor opaco da página anterior (proximo_cursor)." },
      limite: { name: "limite", in: "query", schema: { type: "integer", minimum: 1, maximum: 5000, default: 1000 } },
      cnpj: { name: "cnpj", in: "query", schema: { type: "string" }, description: "CNPJ (14 dígitos) ou CPF (11); a pontuação é ignorada. Outro comprimento → 400 cnpj_invalido." },
      account_id: { name: "account_id", in: "query", schema: { type: "string", format: "uuid" } },
      competencia: { name: "competencia", in: "query", schema: { type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])$" }, description: "AAAA-MM." },
      atualizado_desde: { name: "atualizado_desde", in: "query", schema: { type: "string", format: "date-time" }, description: "Só registros com carimbo de sincronização a partir daqui." },
      formato: { name: "formato", in: "query", schema: { type: "string", enum: ["ndjson", "csv"], default: "ndjson" } },
    },
    responses: {
      NaoAutorizado: { description: "Token ausente, inválido, revogado ou expirado", content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } } },
      Invalido: { description: "Parâmetro malformado", content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } } },
      LimiteExcedido: {
        description:
          "Acima do limite de uso: 300 requisições/min por token nas listas; 1 export simultâneo por token (3 no total); 30 falhas de autenticação/min por IP. Respeite Retry-After.",
        headers: { "Retry-After": { schema: { type: "integer" }, description: "Segundos até poder tentar de novo." } },
        content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } },
      },
    },
    schemas: {
      Envelope: {
        type: "object",
        required: ["recurso", "gerado_em", "dicionario_versao", "dados"],
        properties: {
          recurso: { type: "string" },
          gerado_em: { type: "string", format: "date-time", description: "Quando esta resposta foi montada." },
          snapshot: { type: "string", format: "date-time", nullable: true, description: "Carimbo do dado mais novo do recurso." },
          dicionario_versao: { type: "string" },
          proximo_cursor: { type: "string", nullable: true, description: "Passe em ?cursor= para a próxima página; nulo = fim." },
          dados: { type: "array", items: {} },
        },
      },
      Erro: {
        type: "object",
        properties: { erro: { type: "object", properties: { codigo: { type: "string" }, mensagem: { type: "string" } } }, gerado_em: { type: "string", format: "date-time" } },
      },
      Conta: {
        type: "object",
        properties: {
          account_id: { type: "string", format: "uuid" },
          razao_social: { type: "string", nullable: true },
          cnpj: { type: "string", nullable: true, description: "Só dígitos." },
          codigo_omie: { type: "array", items: { type: "string" }, description: "Um ou mais códigos de cliente no Omie (1:N)." },
          hubspot_company_id: { type: "string", nullable: true },
          brand_id: { type: "string", nullable: true },
          branch_id: { type: "string", nullable: true },
          parent_account_id: { type: "string", nullable: true, format: "uuid" },
          status_core: { type: "string", nullable: true },
          vinculo: { type: "string", description: "'omie', 'hubspot', 'hubspot,omie' ou 'sem_vinculo'." },
          csm_email: { type: "string", nullable: true },
          setor: { type: "string", nullable: true },
          porte: { type: "string", nullable: true },
          atualizado_em: tsIso,
        },
      },
      Titulo: {
        type: "object",
        properties: {
          codigo_lancamento_omie: { type: "string" },
          account_id: { type: "string", nullable: true, format: "uuid", description: "Nulo quando o título não casou com nenhuma conta." },
          cnpj: { type: "string", nullable: true },
          emissao: dataIso,
          vencimento: dataIso,
          pagamento: { ...dataIso, description: "Data de baixa; nula se em aberto." },
          competencia: { type: "string", nullable: true, description: "AAAA-MM do vencimento." },
          valor_centavos: centavos,
          recebido_centavos: centavos,
          em_aberto_centavos: centavos,
          dias_atraso: { type: "integer" },
          categoria: { type: "string", nullable: true },
          status_omie: { type: "string", nullable: true },
          status_pulse: { type: "string", nullable: true, description: "Situação derivada (a_vencer, vencido, recebido…)." },
          sincronizado_em: tsIso,
        },
      },
      Evento: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          account_id: { type: "string", nullable: true, format: "uuid" },
          contract_id: { type: "string", nullable: true, description: "Sempre nulo hoje — o Pulse não tem contrato." },
          competencia: { type: "string", description: "AAAA-MM." },
          tipo: { type: "string", enum: ["novo", "expansao", "contracao", "churn_pedido", "churn_inadimplencia", "reativacao", "ajuste"] },
          valor_centavos: centavos,
          origem: { type: "string", nullable: true },
          motivo: { type: "string", nullable: true },
          reconstruido: { type: "boolean" },
          chave_natural: { type: "string", nullable: true },
          criado_em: tsIso,
        },
      },
      Mrr: {
        type: "object",
        description: "MRR faturado por competência × conta, da view analytics.mrr_faturado_mes (suavizado). Camada MEDIDA; origem é sempre 'faturamento'.",
        properties: {
          competencia: { type: "string", description: "AAAA-MM." },
          account_id: { type: "string", format: "uuid" },
          mrr_centavos: { ...centavos, description: "MRR suavizado (dobra e buraco corrigidos) — o número da Carteira." },
          faturado_centavos: { ...centavos, description: "Faturado BRUTO no mês, sem suavizar." },
          origem: { type: "string", enum: ["faturamento"] },
          reconstruido: { type: "boolean", description: "true quando o mês foi preenchido pela suavização (não houve título)." },
          titulos_no_mes: { type: "integer", description: "Títulos vivos com vencimento no mês, para a conta (mesmo universo de /titulos)." },
        },
      },
      Fechamento: {
        type: "object",
        description: "A cascata de MRR por competência, exatamente como na tela /receita (analytics.monthly_close).",
        properties: {
          competencia: { type: "string", description: "AAAA-MM." },
          mrr_inicial_centavos: centavos,
          novo_centavos: centavos,
          expansao_centavos: centavos,
          contracao_centavos: centavos,
          churn_pedido_centavos: centavos,
          churn_inadimplencia_centavos: centavos,
          reativacao_centavos: centavos,
          ajuste_centavos: centavos,
          nao_atribuido_centavos: centavos,
          mrr_final_centavos: centavos,
          contas_iniciais: { type: "integer", nullable: true },
          contas_novas: { type: "integer", nullable: true },
          contas_perdidas: { type: "integer", nullable: true },
          contas_finais: { type: "integer", nullable: true },
          nrr: { type: "number", nullable: true, description: "Net revenue retention, como RAZÃO (1.0 = 100%; 0.8411 = 84,11%)." },
          grr: { type: "number", nullable: true, description: "Gross revenue retention, como RAZÃO (1.0 = 100%)." },
          estado: { type: "string", enum: ["aberta", "congelada"] },
          congelado_por: { type: "string", nullable: true },
          congelado_em: tsIso,
          publicado_em: tsIso,
          gerado_em: tsIso,
        },
      },
      Faturamento: {
        type: "object",
        description: "Cobrado (competência, por vencimento) e recebido (caixa, por data de pagamento) por competência × conta — lado a lado, nunca fundidos. Universo de cliente da Carteira.",
        properties: {
          competencia: { type: "string", description: "AAAA-MM." },
          account_id: { type: "string", format: "uuid" },
          cobrado_centavos: { ...centavos, description: "Títulos com vencimento no mês. Bruto." },
          titulos_cobrados: { type: "integer" },
          recebido_centavos: { type: "string", nullable: true, description: "Pagamentos com data no mês, em centavos. Nulo = nada entrou." },
          titulos_recebidos: { type: "integer" },
        },
      },
      InadimplenciaConta: {
        type: "object",
        description: "Foto de inadimplência (dia 1º — descreve o fim do mês anterior) por competência × conta. account_id nulo = título sem vínculo.",
        properties: {
          competencia: { type: "string", description: "AAAA-MM da FOTO." },
          account_id: { type: "string", format: "uuid", nullable: true },
          cnpj: { type: "string", nullable: true },
          em_aberto_centavos: { ...centavos, description: "Soma do que estava no saldo (permaneceu/entrou)." },
          titulos: { type: "integer" },
          maior_atraso_dias: { type: "integer", nullable: true },
          faixa: { type: "string", nullable: true, enum: ["1_30", "31_60", "61_90", "91_180", "181_365", "mais_365", null] },
          status_painel: { type: "string", nullable: true },
          ativa: { type: "boolean", description: "status_painel = 'active' na foto." },
          e_cliente: { type: "boolean", description: "Universo: true = cliente, false = tudo do Omie." },
          entrou_centavos: centavos,
          recuperado_centavos: centavos,
          cancelado_centavos: centavos,
          origem: { type: "string", nullable: true, enum: ["apurado", "reconstruido", null] },
        },
      },
      InadimplenciaTitulo: {
        type: "object",
        description: "Foto de inadimplência título a título.",
        properties: {
          competencia: { type: "string", description: "AAAA-MM da FOTO." },
          codigo_lancamento_omie: { type: "string" },
          account_id: { type: "string", format: "uuid", nullable: true },
          cnpj: { type: "string", nullable: true },
          valor_centavos: centavos,
          vencimento: dataIso,
          dias_atraso: { type: "integer", description: "Idade na data da foto (ou na anterior, se saiu)." },
          faixa: { type: "string", nullable: true },
          status_painel: { type: "string", nullable: true },
          e_cliente: { type: "boolean" },
          movimento: { type: "string", enum: ["permaneceu", "entrou", "recuperado", "cancelado"] },
          ajuste_centavos: centavos,
          motivo_saida: { type: "string", nullable: true, enum: ["cancelado", "prorrogado", "ausente", null] },
          origem: { type: "string", nullable: true },
        },
      },
      Saida: {
        type: "object",
        description: "Pedido de saída (camada REGISTRADA), com as quatro datas do fluxo e o MRR congelado na levantada.",
        properties: {
          id: { type: "string", format: "uuid" },
          account_id: { type: "string", format: "uuid", nullable: true },
          contract_id: { type: "string", nullable: true, description: "Sempre nulo hoje." },
          pedido: { type: "string", nullable: true, enum: ["cancelar", "desconto", null] },
          estado: { type: "string", enum: ["anunciado", "financeiro", "desconto", "renegociado", "retido", "encerrado"] },
          etapa_desde: tsIso,
          origem: { type: "string", nullable: true },
          origem_do_registro: { type: "string", nullable: true },
          canal: { type: "string", nullable: true },
          ticket_externo: { type: "string", nullable: true },
          data_levantada: dataIso,
          data_fim_aviso: dataIso,
          competencia_ultima_cobranca: { type: "string", nullable: true, description: "AAAA-MM." },
          competencia_efeito_receita: { type: "string", nullable: true, description: "AAAA-MM — o filtro `competencia`." },
          aviso_previo_dias: { type: "integer", nullable: true },
          mrr_centavos_na_levantada: { ...centavos, description: "O MRR CONGELADO na levantada." },
          mrr_novo_centavos: { type: "string", nullable: true },
          multa_aplicavel_centavos: { type: "string", nullable: true },
          debito_aberto_na_levantada_centavos: { type: "string", nullable: true },
          motivo: { type: "string", nullable: true },
          motivo_detalhe: { type: "string", nullable: true },
          retido_em: dataIso,
          aprovado_em: tsIso,
          criado_em: tsIso,
          atualizado_em: { ...tsIso, description: "Maior carimbo entre os passos; base do atualizado_desde." },
        },
      },
      Ciclo: {
        type: "object",
        description: "Um ciclo de carga: declaração + última execução + último sucesso.",
        properties: {
          ciclo: { type: "string" },
          descricao: { type: "string" },
          fonte: { type: "string", nullable: true },
          metodo: { type: "string", nullable: true },
          agenda: { type: "string", nullable: true },
          janela: { type: "string", nullable: true },
          fase: { type: "string", nullable: true },
          implementado: { type: "boolean" },
          ultimo_status: { type: "string", nullable: true, enum: ["ok", "falha", "rodando", "inerte", null] },
          ultimo_inicio: tsIso,
          ultimo_fim: tsIso,
          ultimo_linhas_lidas: { type: "integer", nullable: true },
          ultimo_linhas_gravadas: { type: "integer", nullable: true },
          ultimo_erro: { type: "string", nullable: true },
          ultimo_sucesso_em: { ...tsIso, description: "O frescor real da fonte." },
          linhas_do_ultimo_sucesso: { type: "integer", nullable: true },
        },
      },
      Dicionario: {
        type: "object",
        description: "Significado, fonte e regras de cada recurso e campo. Estrutura livre; versionada por dicionario_versao.",
        additionalProperties: true,
      },
    },
  },
} as const;

export function GET(): Response {
  return Response.json(SPEC, { headers: { "cache-control": "public, max-age=300" } });
}
