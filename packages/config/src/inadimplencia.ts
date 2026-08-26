/**
 * Inadimplência: a carteira em atraso, o fechamento mensal e a fila de cobrança.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ TRÊS DEFINIÇÕES, e cada uma foi medida contra o banco antes de virar código.│
 * │                                                                            │
 * │ 1. ATRASO CONTA DO VENCIMENTO, não da emissão. A defasagem entre as duas    │
 * │    datas vai de zero a dezoito dias nos títulos de 2026 — 396 vencem no dia │
 * │    da emissão, 303 quatorze dias depois. Contar da emissão traria 94         │
 * │    títulos e R$ 598.470 que ainda estão no prazo combinado, e uma fila com   │
 * │    boleto em trânsito perde a confiança de quem cobra na primeira semana.    │
 * │                                                                            │
 * │ 2. DOIS NÚMEROS, com hierarquia. A carteira total é R$ 2.106.405, e metade   │
 * │    dela está vencida há mais de um ano em conta que o painel já suspendeu.   │
 * │    Um indicador que não responde a esforço deixa de ser lido — então o que   │
 * │    a tela destaca é a INADIMPLÊNCIA CORRENTE (até 90 dias, conta ativa:      │
 * │    R$ 305.004 em 62 clientes) e a carteira total fica ao lado, com a faixa   │
 * │    acima de um ano nomeada como cobrança morta.                             │
 * │                                                                            │
 * │ 3. QUATRO MOVIMENTOS. Ver o cabeçalho da migração 0045 — resumo: com dois,   │
 * │    um cancelamento vira recuperação que nunca houve.                        │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O QUE NÃO ESTÁ AQUI, e é deliberado: nada escreve no Omie, nada suspende    │
 * │ conta e nada dispara aviso ao cliente. A régua de cobrança JÁ EXISTE — é o   │
 * │ `suspended_by_overdue` do painel Lecupon, com 520 contas. Inventar uma       │
 * │ segunda definição de inadimplência grave criaria a divergência que este      │
 * │ módulo existe para evitar; a tela LÊ o estado da régua e mostra a diferença  │
 * │ entre o que ela cortou e o que o financeiro ainda cobra.                    │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

import type pg from "pg";

import { E_CLIENTE } from "./revisao-faturamento.js";
import { textoDeBusca } from "./texto.js";

/**
 * O que conta como título vivo da carteira.
 *
 * `previsao` fora porque não é faturamento — é recorrência ainda não emitida, 66
 * mil títulos e R$ 229 milhões que apareceriam como dívida do cliente.
 * `cancelado` fora porque não se cobra o que foi baixado; ele volta como
 * MOVIMENTO de saída, que é onde ele importa.
 */
const TITULO_VIVO = `t.valor_centavos > 0 AND t.situacao NOT IN ('previsao', 'cancelado')`;

/**
 * ESTÁ NA CARTEIRA naquele instante — e o terceiro caso foi achado no QA.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ PAGAMENTO PARCIAL EXISTE, e a primeira versão deste módulo jurava que não.  │
 * │                                                                            │
 * │ Eu tinha medido pela forma errada: procurei `pagamento IS NULL AND           │
 * │ pago_centavos > 0` e achei zero. O Omie NÃO registra parcial assim — ele     │
 * │ põe a DATA de pagamento e deixa `aberto_centavos` maior que zero. A forma    │
 * │ certa é `pagamento IS NOT NULL AND aberto_centavos > 0`, e aí são 33         │
 * │ títulos com R$ 45.383 ainda em aberto, 29 deles com resíduo acima de 5%.     │
 * │                                                                            │
 * │ O maior é do INTERPROMO: título de R$ 45.000 marcado "recebido", com         │
 * │ R$ 33.750 pagos e R$ 11.250 em aberto — e o INTERPROMO é o SEGUNDO nome da   │
 * │ fila de cobrança. A versão anterior mostrava zero para ele. Numa tela cujo   │
 * │ trabalho é dizer quanto o cliente deve, alguém ligaria com o número errado.  │
 * │                                                                            │
 * │ Tentei antes reconstruir o aberto por data a partir de `core.omie_baixa`,    │
 * │ que tem valor e data de cada baixa. NÃO DÁ: 3.390 das 25.037 baixas estão    │
 * │ sem data (13,5%) e em 2.958 títulos a soma das baixas não fecha com          │
 * │ `pago_centavos` (13,7%). Trocaria uma falha de 2% por uma incerteza de 14%.  │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * DOIS CORTES e não um, porque as duas perguntas são diferentes: até quando o
 * título tinha de ter vencido, e até quando um pagamento conta como feito. Na
 * foto do dia 1º os dois são a mesma data. Na lista de HOJE não: vence "antes de
 * hoje" (um título que vence hoje não está atrasado) e é pago "até hoje
 * inclusive" — senão quem pagou esta manhã apareceria devendo à tarde.
 */
const NA_CARTEIRA = (venceuAntesDe: string, pagoAntesDe: string) => `
  ${TITULO_VIVO}
  AND t.vencimento < ${venceuAntesDe}
  AND (t.pagamento IS NULL OR t.pagamento >= ${pagoAntesDe} OR t.aberto_centavos > 0)`;

/**
 * QUANTO ainda se deve daquele título naquele instante.
 *
 * Se nada havia sido pago até o corte, é o valor cheio. Se houve baixa parcial
 * antes do corte, é o resíduo — e aí mora a única aproximação do módulo:
 * `aberto_centavos` é o resíduo de HOJE, não o daquela data. Ela atinge só o
 * título que estava vencido no corte E foi parcialmente pago depois: 33 títulos
 * hoje, R$ 45.383. O caminho exato exigiria a baixa por data, que a base não
 * sustenta (ver acima).
 */
const EM_ABERTO = (pagoAntesDe: string) => `
  CASE WHEN t.pagamento IS NULL OR t.pagamento >= ${pagoAntesDe}
       THEN t.valor_centavos ELSE t.aberto_centavos END`;

/**
 * A conta do painel de um documento, quando há mais de uma.
 *
 * 42 documentos têm identidade dupla — o mesmo CNPJ com duas contas. A escolha é
 * pelo painel PRINCIPAL primeiro (`parent_account_id IS NULL`) e, empatado, pela
 * conta ativa: se o CNPJ tem uma conta ativa, o cliente está ativo com a gente, e
 * o título dele é cobrança comercial e não jurídica. Escolher pela mais antiga
 * classificaria como perda um cliente que está no ar.
 */
const CONTA_DO_DOCUMENTO = (alias: string) => `
  LEFT JOIN LATERAL (
    SELECT a.id, a.status_core, a.razao_social
      FROM core.vinculo_cliente v
      JOIN core.account a ON a.id = v.account_id
     WHERE v.chave = ${alias}.documento AND v.fonte = 'omie'
     ORDER BY (a.parent_account_id IS NULL) DESC,
              (a.status_core = 'active') DESC,
              a.id
     LIMIT 1
  ) conta ON true`;

/** Até aqui a cobrança ainda responde a trabalho. Acima disso é passivo antigo. */
export const DIAS_CORRENTE = 90;
/** Acima de um ano: praticamente nada volta. A tela nomeia como cobrança morta. */
export const DIAS_MORTA = 365;

export const FAIXAS = [
  { id: "1_30", rotulo: "1 a 30 dias" },
  { id: "31_60", rotulo: "31 a 60 dias" },
  { id: "61_90", rotulo: "61 a 90 dias" },
  { id: "91_180", rotulo: "91 a 180 dias" },
  { id: "181_365", rotulo: "181 a 365 dias" },
  { id: "mais_365", rotulo: "mais de 365 dias" },
] as const;

export type FaixaId = (typeof FAIXAS)[number]["id"];

export const ESTADOS_DO_PAINEL = [
  { id: "active", rotulo: "Ativa", leitura: "cobrável" },
  { id: "suspended_by_overdue", rotulo: "Suspensa por atraso", leitura: "perda" },
  { id: "suspended", rotulo: "Suspensa", leitura: "perda" },
  { id: "inactive", rotulo: "Inativa", leitura: "perda" },
  { id: "sem_vinculo", rotulo: "Sem vínculo com o Omie", leitura: "vincular" },
] as const;

export const rotuloDaFaixa = (id: string) =>
  FAIXAS.find((f) => f.id === id)?.rotulo ?? id;

export const rotuloDoEstado = (id: string | null) =>
  ESTADOS_DO_PAINEL.find((e) => e.id === (id ?? "sem_vinculo"))?.rotulo ??
  (id ?? "sem vínculo");

export const leituraDoEstado = (id: string | null) =>
  ESTADOS_DO_PAINEL.find((e) => e.id === (id ?? "sem_vinculo"))?.leitura ?? "";

// ─────────────────────────────────────────────────────────────────────────────
// LEITURA · a carteira de hoje
// ─────────────────────────────────────────────────────────────────────────────

export interface FiltrosDaCarteira {
  /** Faixa de atraso. Vazio é todas. */
  readonly faixa?: FaixaId | "corrente" | "";
  /** Estado da conta no painel. Vazio é todos. */
  readonly estado?: string;
  /** Só quem é cliente pelas tags do Omie. */
  readonly apenasClientes?: boolean;
  /** Razão social, nome fantasia ou CNPJ. */
  readonly busca?: string;
}

export interface TituloEmAtraso {
  readonly codigoTitulo: string;
  readonly documento: string;
  readonly razaoSocial: string | null;
  readonly accountId: string | null;
  readonly statusPainel: string | null;
  /** O que ainda se deve. Com baixa parcial é menor que o valor do título. */
  readonly valorCentavos: string;
  /** O valor cheio emitido. Diferente de `valorCentavos` só em baixa parcial. */
  readonly valorDoTituloCentavos: string;
  /** Quanto já entrou deste título. Zero na esmagadora maioria. */
  readonly pagoCentavos: string;
  readonly vencimento: string;
  readonly emissao: string | null;
  readonly diasAtraso: number;
  readonly faixa: string;
  readonly categoria: string | null;
  readonly eCliente: boolean;
}

/** O SQL do recorte, compartilhado pelas quatro consultas de leitura. */
function ondeDaCarteira(f: FiltrosDaCarteira, base: number) {
  const cond: string[] = [];
  const par: unknown[] = [];
  if (f.faixa === "corrente") cond.push(`alvo.dias_atraso <= ${DIAS_CORRENTE}`);
  else if (f.faixa) {
    par.push(f.faixa);
    cond.push(`alvo.faixa = $${base + par.length}`);
  }
  if (f.estado === "sem_vinculo") cond.push(`conta.id IS NULL`);
  else if (f.estado) {
    par.push(f.estado);
    cond.push(`conta.status_core = $${base + par.length}`);
  }
  if (f.apenasClientes) cond.push(`alvo.e_cliente`);
  // Passa pelo limpador: byte nulo na URL virava HTTP 500 (ver `texto.ts`).
  const busca = textoDeBusca(f.busca);
  if (busca) {
    const digitos = busca.replace(/\D/g, "");
    par.push(`%${busca}%`);
    const like = `$${base + par.length}`;
    // O CNPJ só entra na busca com 4 dígitos ou mais: com menos, "12" casaria com
    // metade da base e a tela devolveria tudo como se o filtro não existisse.
    if (digitos.length >= 4) {
      par.push(`%${digitos}%`);
      cond.push(
        `(coalesce(conta.razao_social, alvo.razao_omie) ILIKE ${like} OR alvo.documento LIKE $${base + par.length})`,
      );
    } else {
      cond.push(`coalesce(conta.razao_social, alvo.razao_omie) ILIKE ${like}`);
    }
  }
  return { onde: cond.length ? `WHERE ${cond.join(" AND ")}` : "", par };
}

/**
 * O corpo comum: cada título vencido e sem pagamento, com a idade de HOJE.
 *
 * `faixa` é calculada aqui e é a MESMA regra da coluna gerada em
 * `fact.inadimplencia_titulo` — as duas precisam concordar, senão a lista de hoje
 * e o histórico contam faixas diferentes. Há portão comparando as duas.
 */
const CARTEIRA_DE_HOJE = `
  SELECT t.codigo_titulo, t.documento, t.vencimento, t.emissao, t.categoria,
         ${EM_ABERTO("current_date + 1")} AS valor_centavos,
         -- O valor cheio ao lado do que resta: a linha precisa dizer que o
         -- cliente pagou parte, senão o número menor parece erro de leitura.
         t.valor_centavos AS valor_do_titulo,
         t.pago_centavos,
         (current_date - t.vencimento)::int AS dias_atraso,
         CASE
           WHEN current_date - t.vencimento <=  30 THEN '1_30'
           WHEN current_date - t.vencimento <=  60 THEN '31_60'
           WHEN current_date - t.vencimento <=  90 THEN '61_90'
           WHEN current_date - t.vencimento <= 180 THEN '91_180'
           WHEN current_date - t.vencimento <= 365 THEN '181_365'
           ELSE 'mais_365'
         END AS faixa,
         ${E_CLIENTE("t.documento")} AS e_cliente,
         (SELECT c.razao_social FROM core.omie_cliente c
           WHERE c.documento = t.documento
           ORDER BY c.razao_social LIMIT 1) AS razao_omie
    FROM core.omie_titulo t
   WHERE ${NA_CARTEIRA("current_date", "current_date + 1")}`;

export async function carteiraDeHoje(
  db: pg.Pool,
  filtros: FiltrosDaCarteira = {},
  limite = 500,
): Promise<TituloEmAtraso[]> {
  const { onde, par } = ondeDaCarteira(filtros, 0);
  const { rows } = await db.query(
    `WITH alvo AS (${CARTEIRA_DE_HOJE})
     SELECT alvo.*,
            -- Formatar aqui no SQL e nao no TypeScript: o driver devolve
            -- a coluna date como objeto Date, e cortar a string dá "Sun Mar 01".
            to_char(alvo.vencimento, 'YYYY-MM-DD') AS vencimento_txt,
            to_char(alvo.emissao, 'YYYY-MM-DD')    AS emissao_txt,
            conta.id::text AS account_id, conta.status_core, conta.razao_social
       FROM alvo ${CONTA_DO_DOCUMENTO("alvo")}
     ${onde}
      ORDER BY alvo.valor_centavos DESC, alvo.vencimento
      LIMIT $${par.length + 1}::int`,
    [...par, limite],
  );
  return rows.map((r) => ({
    codigoTitulo: String(r["codigo_titulo"]),
    documento: String(r["documento"]),
    razaoSocial: (r["razao_social"] as string | null) ?? (r["razao_omie"] as string | null),
    accountId: (r["account_id"] as string | null) ?? null,
    statusPainel: (r["status_core"] as string | null) ?? null,
    valorCentavos: String(r["valor_centavos"]),
    valorDoTituloCentavos: String(r["valor_do_titulo"]),
    pagoCentavos: String(r["pago_centavos"]),
    vencimento: String(r["vencimento_txt"]),
    emissao: (r["emissao_txt"] as string | null) ?? null,
    diasAtraso: Number(r["dias_atraso"]),
    faixa: String(r["faixa"]),
    categoria: (r["categoria"] as string | null) ?? null,
    eCliente: Boolean(r["e_cliente"]),
  }));
}

export interface ClienteEmAtraso {
  readonly documento: string;
  readonly razaoSocial: string | null;
  readonly accountId: string | null;
  readonly statusPainel: string | null;
  readonly titulos: number;
  readonly valorCentavos: string;
  readonly correnteCentavos: string;
  readonly diasMax: number;
  readonly diasMin: number;
  readonly eCliente: boolean;
  /** Quanto já entrou dos títulos ainda em aberto — baixa parcial. */
  readonly pagoCentavos: string;
}

export async function clientesEmAtraso(
  db: pg.Pool,
  filtros: FiltrosDaCarteira = {},
): Promise<ClienteEmAtraso[]> {
  const { onde, par } = ondeDaCarteira(filtros, 0);
  const { rows } = await db.query(
    `WITH alvo AS (${CARTEIRA_DE_HOJE}),
     com_conta AS (
       SELECT alvo.*, conta.id::text AS account_id, conta.status_core,
              conta.razao_social
         FROM alvo ${CONTA_DO_DOCUMENTO("alvo")}
       ${onde}
     )
     SELECT documento,
            max(coalesce(razao_social, razao_omie)) AS nome,
            max(account_id) AS account_id, max(status_core) AS status_core,
            count(*)::int AS titulos,
            sum(valor_centavos)::text AS valor,
            coalesce(sum(valor_centavos) FILTER (WHERE dias_atraso <= ${DIAS_CORRENTE}), 0)::text AS corrente,
            max(dias_atraso)::int AS dias_max, min(dias_atraso)::int AS dias_min,
            bool_or(e_cliente) AS e_cliente,
            sum(pago_centavos)::text AS pago
       FROM com_conta
      GROUP BY documento
      ORDER BY sum(valor_centavos) DESC`,
    par,
  );
  return rows.map((r) => ({
    documento: String(r["documento"]),
    razaoSocial: (r["nome"] as string | null) ?? null,
    accountId: (r["account_id"] as string | null) ?? null,
    statusPainel: (r["status_core"] as string | null) ?? null,
    titulos: Number(r["titulos"]),
    valorCentavos: String(r["valor"]),
    correnteCentavos: String(r["corrente"]),
    diasMax: Number(r["dias_max"]),
    diasMin: Number(r["dias_min"]),
    eCliente: Boolean(r["e_cliente"]),
    pagoCentavos: String(r["pago"] ?? "0"),
  }));
}

export interface ResumoDaCarteira {
  readonly totalCentavos: string;
  readonly titulos: number;
  readonly clientes: number;
  readonly correnteCentavos: string;
  readonly correnteClientes: number;
  readonly mortaCentavos: string;
  readonly mortaTitulos: number;
  readonly abertoTotalCentavos: string;
  readonly faturado12mCentavos: string;
  readonly dsoDias: number | null;
  readonly porFaixa: readonly {
    faixa: string;
    titulos: number;
    clientes: number;
    centavos: string;
  }[];
  readonly porEstado: readonly {
    estado: string;
    cnpjs: number;
    titulos: number;
    centavos: string;
    recenteCentavos: string;
  }[];
}

/**
 * Os números do topo da tela, numa consulta.
 *
 * `corrente` exige as DUAS condições — até 90 dias E conta ativa. Só a idade não
 * serve: R$ 49.838 dos títulos com menos de 90 dias estão em conta já inativa, e
 * mandar isso para a fila de ligação é gastar a semana de alguém com quem já foi
 * embora.
 */
export async function resumoDaCarteira(
  db: pg.Pool,
  apenasClientes = false,
): Promise<ResumoDaCarteira> {
  const filtro = apenasClientes ? `WHERE alvo.e_cliente` : "";
  const { rows } = await db.query(
    `WITH alvo AS (${CARTEIRA_DE_HOJE}),
     com_conta AS (
       SELECT alvo.*, conta.id::text AS account_id, conta.status_core
         FROM alvo ${CONTA_DO_DOCUMENTO("alvo")}
       ${filtro}
     ),
     -- ┌───────────────────────────────────────────────────────────────────────┐
     -- │ O DSO USA O RECORTE DE CLIENTE SEMPRE, mesmo quando a tela está a       │
     -- │ mostrar a carteira inteira — e não é incoerência.                       │
     -- │                                                                        │
     -- │ Medido: incluir tudo muda o NUMERADOR em R$ 1.258 (a carteira em atraso │
     -- │ é praticamente toda de cliente) e o DENOMINADOR em três vezes, porque   │
     -- │ o faturado de 12 meses passa de R$ 19,9 mi para R$ 57,0 mi com          │
     -- │ intermediação de pontos e reembolso dentro. O índice caía de 52 dias    │
     -- │ para 18 — e 18 dias de DSO afirmaria uma saúde de cobrança que não      │
     -- │ existe, sobre uma receita que não é assinatura nossa.                   │
     -- └───────────────────────────────────────────────────────────────────────┘
     receita AS (
       SELECT
         coalesce(sum(t.valor_centavos) FILTER (
           WHERE t.vencimento >= date_trunc('month', current_date) - interval '12 months'
             AND t.vencimento <  date_trunc('month', current_date)), 0) AS faturado_12m,
         -- Em aberto e não valor do título: com baixa parcial os dois divergem,
         -- e o numerador do DSO é o que ainda se deve.
         coalesce(sum(${EM_ABERTO("current_date + 1")}) FILTER (
           WHERE t.pagamento IS NULL OR t.aberto_centavos > 0), 0) AS aberto
         FROM core.omie_titulo t
        WHERE ${TITULO_VIVO} AND ${E_CLIENTE("t.documento")}
     )
     SELECT
       (SELECT coalesce(sum(valor_centavos), 0) FROM com_conta)::text AS total,
       (SELECT count(*) FROM com_conta)::int AS titulos,
       (SELECT count(DISTINCT documento) FROM com_conta)::int AS clientes,
       (SELECT coalesce(sum(valor_centavos), 0) FROM com_conta
         WHERE dias_atraso <= ${DIAS_CORRENTE} AND status_core = 'active')::text AS corrente,
       (SELECT count(DISTINCT documento) FROM com_conta
         WHERE dias_atraso <= ${DIAS_CORRENTE} AND status_core = 'active')::int AS corrente_clientes,
       (SELECT coalesce(sum(valor_centavos), 0) FROM com_conta
         WHERE dias_atraso > ${DIAS_MORTA})::text AS morta,
       (SELECT count(*) FROM com_conta WHERE dias_atraso > ${DIAS_MORTA})::int AS morta_titulos,
       (SELECT aberto FROM receita)::text AS aberto,
       (SELECT faturado_12m FROM receita)::text AS faturado,
       CASE WHEN (SELECT faturado_12m FROM receita) > 0
            THEN round((SELECT aberto FROM receita)::numeric
                       / ((SELECT faturado_12m FROM receita)::numeric / 365.0), 1)
       END AS dso`,
  );
  const r = rows[0] ?? {};
  const faixas = await db.query(
    `WITH alvo AS (${CARTEIRA_DE_HOJE})
     SELECT alvo.faixa, count(*)::int AS titulos,
            count(DISTINCT alvo.documento)::int AS clientes,
            sum(alvo.valor_centavos)::text AS centavos
       FROM alvo ${CONTA_DO_DOCUMENTO("alvo")}
      ${filtro}
      GROUP BY alvo.faixa`,
  );
  const estados = await db.query(
    `WITH alvo AS (${CARTEIRA_DE_HOJE})
     SELECT coalesce(conta.status_core, 'sem_vinculo') AS estado,
            count(DISTINCT alvo.documento)::int AS cnpjs,
            count(*)::int AS titulos,
            sum(alvo.valor_centavos)::text AS centavos,
            coalesce(sum(alvo.valor_centavos)
              FILTER (WHERE alvo.dias_atraso <= ${DIAS_CORRENTE}), 0)::text AS recente
       FROM alvo ${CONTA_DO_DOCUMENTO("alvo")}
      ${filtro}
      GROUP BY 1
      ORDER BY sum(alvo.valor_centavos) DESC`,
  );
  const ordem = FAIXAS.map((f) => f.id);
  return {
    totalCentavos: String(r["total"] ?? "0"),
    titulos: Number(r["titulos"] ?? 0),
    clientes: Number(r["clientes"] ?? 0),
    correnteCentavos: String(r["corrente"] ?? "0"),
    correnteClientes: Number(r["corrente_clientes"] ?? 0),
    mortaCentavos: String(r["morta"] ?? "0"),
    mortaTitulos: Number(r["morta_titulos"] ?? 0),
    abertoTotalCentavos: String(r["aberto"] ?? "0"),
    faturado12mCentavos: String(r["faturado"] ?? "0"),
    dsoDias: r["dso"] === null || r["dso"] === undefined ? null : Number(r["dso"]),
    porFaixa: faixas.rows
      .map((f) => ({
        faixa: String(f["faixa"]),
        titulos: Number(f["titulos"]),
        clientes: Number(f["clientes"]),
        centavos: String(f["centavos"]),
      }))
      .sort((a, b) => ordem.indexOf(a.faixa as FaixaId) - ordem.indexOf(b.faixa as FaixaId)),
    porEstado: estados.rows.map((e) => ({
      estado: String(e["estado"]),
      cnpjs: Number(e["cnpjs"]),
      titulos: Number(e["titulos"]),
      centavos: String(e["centavos"]),
      recenteCentavos: String(e["recente"]),
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ESCRITA · a foto do dia 1º
// ─────────────────────────────────────────────────────────────────────────────

export type OrigemDaFoto = "apurado" | "reconstruido";

export interface ResultadoDaApuracao {
  readonly competencia: string;
  readonly origem: OrigemDaFoto;
  /** Mês congelado: nada foi escrito, e isso não é falha. */
  readonly congelada: boolean;
  readonly linhas: number;
  readonly saldoInicialCentavos: string;
  readonly entrouCentavos: string;
  readonly recuperadoCentavos: string;
  readonly canceladoCentavos: string;
  readonly ajusteCentavos: string;
  readonly saldoFinalCentavos: string;
  readonly titulosFinal: number;
}

/**
 * A carteira num instante, direto das datas.
 *
 * É a mesma expressão para hoje e para março de 2025, e é isso que permite
 * reconstruir a série: `vencimento` e `pagamento` são fato, e um título pago em
 * abril não estava pago em março — a condição `pagamento >= corte` é o que
 * devolve o passado em vez do presente.
 */
const CARTEIRA_EM = (corte: string) => `
  SELECT t.codigo_titulo, t.documento, t.vencimento,
         ${EM_ABERTO(corte)} AS valor_centavos
    FROM core.omie_titulo t
   WHERE ${NA_CARTEIRA(corte, corte)}`;

/**
 * Apura UMA competência: a foto do dia 1º e o fechamento do mês que acabou.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A FOTO ANTERIOR GRAVADA MANDA, e a das datas é só o berço.                  │
 * │                                                                            │
 * │ Se existe linha para a competência anterior em `fact.inadimplencia_titulo`,  │
 * │ é ELA que serve de saldo inicial — mesmo que as datas de hoje digam outra    │
 * │ coisa. É o que torna a cadeia autoritativa: a partir da primeira apuração,   │
 * │ o passado deixa de se reescrever quando o Omie cancela um título antigo.     │
 * │                                                                            │
 * │ Sem foto anterior (a primeira competência da carga inicial), o saldo inicial │
 * │ vem das datas. Aí ele É reconstruído, com o limite que isso tem — e é por    │
 * │ isso que `origem` existe na tabela e aparece no gráfico.                     │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * IDEMPOTENTE por competência: apaga e regrava. Rodar duas vezes no mesmo dia dá
 * o mesmo resultado, e é o que permite ao ciclo rodar todo dia sem medo.
 */
export async function apurarCompetencia(
  db: pg.Pool,
  competencia: string,
  opcoes: { readonly origem?: OrigemDaFoto } = {},
): Promise<ResultadoDaApuracao> {
  const origem: OrigemDaFoto = opcoes.origem ?? "apurado";
  const cliente = await db.connect();
  try {
    await cliente.query("BEGIN");

    // Congelado é decisão de gente sobre um mês fechado. Reapurar por cima
    // transformaria o relógio em autoridade sobre um número que já foi ao board.
    const { rows: existente } = await cliente.query(
      `SELECT estado FROM analytics.inadimplencia_mes WHERE competencia = $1::date`,
      [competencia],
    );
    if (existente[0]?.["estado"] === "congelada") {
      await cliente.query("ROLLBACK");
      return {
        competencia,
        origem,
        congelada: true,
        linhas: 0,
        saldoInicialCentavos: "0",
        entrouCentavos: "0",
        recuperadoCentavos: "0",
        canceladoCentavos: "0",
        ajusteCentavos: "0",
        saldoFinalCentavos: "0",
        titulosFinal: 0,
      };
    }

    await cliente.query(
      `DELETE FROM fact.inadimplencia_titulo WHERE competencia = $1::date`,
      [competencia],
    );

    const gravadas = await cliente.query(
      `WITH
       atual AS (${CARTEIRA_EM("$1::date")}),
       -- A foto anterior gravada. Vazia na primeira competência da carga inicial.
       anterior_gravada AS (
         SELECT codigo_titulo, documento, valor_centavos, vencimento
           FROM fact.inadimplencia_titulo
          WHERE competencia = ($1::date - interval '1 month')::date
            AND movimento IN ('permaneceu', 'entrou')
       ),
       anterior_das_datas AS (
         SELECT * FROM (${CARTEIRA_EM("($1::date - interval '1 month')::date")}) d
          WHERE NOT EXISTS (SELECT 1 FROM anterior_gravada)
       ),
       anterior AS (
         -- Colunas NOMEADAS e nao SELECT estrela: o UNION casa por POSICAO, e no dia
         -- em que a ordem de uma das duas consultas mudou o Postgres tentou unir
         -- bigint com date. Erro 42804, e a mensagem não diz qual das duas mudou.
         SELECT codigo_titulo, documento, valor_centavos, vencimento
           FROM anterior_gravada
         UNION ALL
         SELECT codigo_titulo, documento, valor_centavos, vencimento
           FROM anterior_das_datas
       ),
       juntos AS (
         SELECT
           coalesce(a.codigo_titulo, p.codigo_titulo)   AS codigo_titulo,
           coalesce(a.documento, p.documento)           AS documento,
           coalesce(a.valor_centavos, p.valor_centavos) AS valor_centavos,
           coalesce(a.vencimento, p.vencimento)         AS vencimento,
           (a.codigo_titulo IS NOT NULL)                AS no_saldo,
           (p.codigo_titulo IS NOT NULL)                AS estava,
           coalesce(a.valor_centavos, 0) - coalesce(p.valor_centavos, 0) AS delta
           FROM atual a
           FULL OUTER JOIN anterior p ON p.codigo_titulo = a.codigo_titulo
       )
       INSERT INTO fact.inadimplencia_titulo (
         competencia, codigo_titulo, documento, account_id, valor_centavos,
         vencimento, dias_atraso, status_painel, e_cliente, movimento,
         ajuste_centavos, origem, motivo_saida)
       SELECT
         $1::date, j.codigo_titulo, j.documento, conta.id, j.valor_centavos,
         j.vencimento,
         -- Idade NA DATA DA FOTO para quem está no saldo; para quem saiu, a idade
         -- que tinha na foto anterior — que é a última em que ele existiu.
         (CASE WHEN j.no_saldo THEN $1::date
               ELSE ($1::date - interval '1 month')::date END - j.vencimento)::int,
         -- Estado do painel só na foto apurada: no reconstruído não há histórico
         -- de status_core, e afirmar o de hoje sobre março seria inventar.
         CASE WHEN $2 = 'apurado' THEN conta.status_core END,
         ${E_CLIENTE("j.documento")},
         CASE
           WHEN j.no_saldo AND j.estava THEN 'permaneceu'
           WHEN j.no_saldo             THEN 'entrou'
           WHEN o.pagamento IS NOT NULL AND o.pagamento < $1::date THEN 'recuperado'
           ELSE 'cancelado'
         END,
         CASE WHEN j.no_saldo AND j.estava THEN j.delta ELSE 0 END,
         $2,
         CASE
           WHEN j.no_saldo THEN NULL
           WHEN o.pagamento IS NOT NULL AND o.pagamento < $1::date THEN NULL
           WHEN o.codigo_titulo IS NULL THEN 'ausente'
           WHEN o.situacao = 'cancelado' THEN 'cancelado'
           ELSE 'prorrogado'
         END
         FROM juntos j
         LEFT JOIN core.omie_titulo o ON o.codigo_titulo = j.codigo_titulo
         ${CONTA_DO_DOCUMENTO("j")}`,
      [competencia, origem],
    );

    // ┌─────────────────────────────────────────────────────────────────────────┐
    // │ O FECHAMENTO É DERIVADO DA MESMA TRANSAÇÃO, e o CHECK da tabela é quem    │
    // │ confere. Se esta agregação estiver errada, o INSERT falha — em vez de     │
    // │ gravar um mês que não fecha e alguém descobrir no board.                  │
    // │                                                                          │
    // │ O saldo INICIAL é reconstituído a partir dos movimentos: quem permaneceu   │
    // │ (pelo valor ANTIGO, isto é, menos o ajuste) mais quem saiu. Guardar o      │
    // │ saldo final do mês anterior seria a mesma coisa por outro caminho — e as   │
    // │ duas divergiriam no dia em que alguém reapurasse um mês do meio.           │
    // └─────────────────────────────────────────────────────────────────────────┘
    const { rows: fecho } = await cliente.query(
      `INSERT INTO analytics.inadimplencia_mes (
         competencia, saldo_inicial_centavos, titulos_inicial,
         entrou_centavos, entrou_titulos,
         recuperado_centavos, recuperado_titulos,
         cancelado_centavos, cancelado_titulos, ajuste_centavos,
         saldo_final_centavos, titulos_final,
         recente_centavos, corrente_centavos, corrente_clientes,
         origem, estado, apurado_em)
       SELECT
         $1::date,
         coalesce(sum(CASE
           WHEN movimento = 'permaneceu' THEN valor_centavos - ajuste_centavos
           WHEN movimento IN ('recuperado', 'cancelado') THEN valor_centavos
           ELSE 0 END), 0),
         count(*) FILTER (WHERE movimento IN ('permaneceu', 'recuperado', 'cancelado')),
         coalesce(sum(valor_centavos) FILTER (WHERE movimento = 'entrou'), 0),
         count(*) FILTER (WHERE movimento = 'entrou'),
         coalesce(sum(valor_centavos) FILTER (WHERE movimento = 'recuperado'), 0),
         count(*) FILTER (WHERE movimento = 'recuperado'),
         coalesce(sum(valor_centavos) FILTER (WHERE movimento = 'cancelado'), 0),
         count(*) FILTER (WHERE movimento = 'cancelado'),
         coalesce(sum(ajuste_centavos), 0),
         coalesce(sum(valor_centavos) FILTER (WHERE movimento IN ('permaneceu', 'entrou')), 0),
         count(*) FILTER (WHERE movimento IN ('permaneceu', 'entrou')),
         coalesce(sum(valor_centavos) FILTER (
           WHERE movimento IN ('permaneceu', 'entrou') AND dias_atraso <= ${DIAS_CORRENTE}), 0),
         CASE WHEN $2 = 'apurado' THEN coalesce(sum(valor_centavos) FILTER (
           WHERE movimento IN ('permaneceu', 'entrou')
             AND dias_atraso <= ${DIAS_CORRENTE} AND status_painel = 'active'), 0) END,
         CASE WHEN $2 = 'apurado' THEN count(DISTINCT documento) FILTER (
           WHERE movimento IN ('permaneceu', 'entrou')
             AND dias_atraso <= ${DIAS_CORRENTE} AND status_painel = 'active') END,
         $2, 'aberta', now()
         FROM fact.inadimplencia_titulo
        WHERE competencia = $1::date
       ON CONFLICT (competencia) DO UPDATE SET
         saldo_inicial_centavos = excluded.saldo_inicial_centavos,
         titulos_inicial        = excluded.titulos_inicial,
         entrou_centavos        = excluded.entrou_centavos,
         entrou_titulos         = excluded.entrou_titulos,
         recuperado_centavos    = excluded.recuperado_centavos,
         recuperado_titulos     = excluded.recuperado_titulos,
         cancelado_centavos     = excluded.cancelado_centavos,
         cancelado_titulos      = excluded.cancelado_titulos,
         ajuste_centavos        = excluded.ajuste_centavos,
         saldo_final_centavos   = excluded.saldo_final_centavos,
         titulos_final          = excluded.titulos_final,
         recente_centavos       = excluded.recente_centavos,
         corrente_centavos      = excluded.corrente_centavos,
         corrente_clientes      = excluded.corrente_clientes,
         origem                 = excluded.origem,
         apurado_em             = now()
       RETURNING saldo_inicial_centavos, entrou_centavos, recuperado_centavos,
                 cancelado_centavos, ajuste_centavos, saldo_final_centavos,
                 titulos_final`,
      [competencia, origem],
    );

    await cliente.query("COMMIT");
    const f = fecho[0] ?? {};
    return {
      competencia,
      origem,
      congelada: false,
      linhas: gravadas.rowCount ?? 0,
      saldoInicialCentavos: String(f["saldo_inicial_centavos"] ?? "0"),
      entrouCentavos: String(f["entrou_centavos"] ?? "0"),
      recuperadoCentavos: String(f["recuperado_centavos"] ?? "0"),
      canceladoCentavos: String(f["cancelado_centavos"] ?? "0"),
      ajusteCentavos: String(f["ajuste_centavos"] ?? "0"),
      saldoFinalCentavos: String(f["saldo_final_centavos"] ?? "0"),
      titulosFinal: Number(f["titulos_final"] ?? 0),
    };
  } catch (erro) {
    await cliente.query("ROLLBACK").catch(() => undefined);
    throw erro;
  } finally {
    cliente.release();
  }
}

/**
 * As competências fechadas que ainda não têm foto.
 *
 * É o que faz o ciclo poder rodar TODO DIA em vez de só no dia 1º. Um cron que
 * dispara uma vez por mês perde o mês inteiro, para sempre, se a VM estiver fora
 * do ar naquela manhã — e é justamente o único dia em que aquele dado ainda
 * podia ser apurado. Rodando diariamente, o buraco do dia 1º se fecha no dia 2.
 */
export async function competenciasSemFoto(
  db: pg.Pool,
  desde: string,
): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT to_char(m.competencia, 'YYYY-MM-DD') AS competencia
       FROM generate_series($1::date,
                            date_trunc('month', current_date)::date,
                            interval '1 month') AS m(competencia)
      WHERE NOT EXISTS (
        SELECT 1 FROM analytics.inadimplencia_mes f
         WHERE f.competencia = m.competencia::date)
      ORDER BY 1`,
    [desde],
  );
  return rows.map((r) => String(r["competencia"]));
}

/**
 * O mês mais antigo com título vencido — o começo da história reconstruível.
 *
 * Lido do banco e não fixado no código: a carga inicial vai até onde os dados
 * chegam, e chumbar uma data faria a série começar no lugar errado quando a base
 * do Omie for recarregada mais para trás.
 */
export async function primeiraCompetenciaPossivel(db: pg.Pool): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT to_char(date_trunc('month', min(t.vencimento)) + interval '1 month',
                    'YYYY-MM-DD') AS competencia
       FROM core.omie_titulo t WHERE ${TITULO_VIVO}`,
  );
  return (rows[0]?.["competencia"] as string | null) ?? null;
}

export interface ResultadoDaCarga {
  readonly competencias: number;
  readonly linhas: number;
  readonly primeira: string | null;
  readonly ultima: string | null;
  readonly congeladas: number;
}

/**
 * Carga inicial: reconstrói a série de trás para frente até o mês corrente.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ DA MAIS ANTIGA PARA A MAIS NOVA, e a ordem não é estética.                  │
 * │                                                                            │
 * │ Cada competência usa a foto da anterior como saldo inicial. Rodando ao       │
 * │ contrário, toda foto cairia no caminho "sem foto anterior" e sairia das      │
 * │ datas — o que dá o mesmo número hoje e quebra a cadeia amanhã, porque a      │
 * │ ligação entre um mês e o seguinte deixaria de existir.                       │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * `origem` é `reconstruido` porque é o que estas linhas são: o melhor que as
 * datas permitem, sem estado de painel e sem saber quando um título foi
 * cancelado. O gráfico mostra essa fronteira — esconder seria mentir com
 * precisão de centavo.
 */
export async function reconstruirHistorico(
  db: pg.Pool,
  opcoes: { readonly desde?: string; readonly aoVivo?: (m: string) => void } = {},
): Promise<ResultadoDaCarga> {
  const desde = opcoes.desde ?? (await primeiraCompetenciaPossivel(db));
  if (!desde) return { competencias: 0, linhas: 0, primeira: null, ultima: null, congeladas: 0 };
  const alvos = await competenciasSemFoto(db, desde);
  let linhas = 0;
  let congeladas = 0;
  for (const c of alvos) {
    opcoes.aoVivo?.(c);
    const r = await apurarCompetencia(db, c, { origem: "reconstruido" });
    if (r.congelada) congeladas++;
    linhas += r.linhas;
  }
  return {
    competencias: alvos.length - congeladas,
    linhas,
    primeira: alvos[0] ?? null,
    ultima: alvos[alvos.length - 1] ?? null,
    congeladas,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LEITURA · a série e o fechamento mês a mês
// ─────────────────────────────────────────────────────────────────────────────

export interface MesDaCarteira {
  readonly competencia: string;
  readonly saldoInicialCentavos: string;
  readonly titulosInicial: number;
  readonly entrouCentavos: string;
  readonly entrouTitulos: number;
  readonly recuperadoCentavos: string;
  readonly recuperadoTitulos: number;
  readonly canceladoCentavos: string;
  readonly canceladoTitulos: number;
  readonly ajusteCentavos: string;
  readonly saldoFinalCentavos: string;
  readonly titulosFinal: number;
  readonly recenteCentavos: string;
  readonly correnteCentavos: string | null;
  readonly correnteClientes: number | null;
  readonly origem: OrigemDaFoto;
  readonly estado: "aberta" | "congelada";
  readonly congeladoPor: string | null;
}

/**
 * A série do gráfico e do fechamento, do mais antigo para o mais novo.
 *
 * `meses` limita pelo fim e não pelo começo: a pergunta da tela é sempre "os
 * últimos N", e cortar pelo começo faria a série mudar de tamanho conforme a
 * carga inicial fosse mais para trás.
 */
export async function serieDaCarteira(
  db: pg.Pool,
  meses = 24,
): Promise<MesDaCarteira[]> {
  const { rows } = await db.query(
    // `to_char` e não `slice` no TypeScript: o driver devolve `date` como objeto
    // Date, e `String(date).slice(0,10)` dá "Sun Mar 01" — que passa pelo tipo,
    // passa pelo build, e só aparece como rótulo errado no eixo do gráfico.
    // A convenção da casa é formatar data no SQL, e é por isso que ela existe.
    `SELECT to_char(competencia, 'YYYY-MM-DD') AS competencia,
            saldo_inicial_centavos, titulos_inicial,
            entrou_centavos, entrou_titulos,
            recuperado_centavos, recuperado_titulos,
            cancelado_centavos, cancelado_titulos, ajuste_centavos,
            saldo_final_centavos, titulos_final,
            recente_centavos, corrente_centavos, corrente_clientes,
            origem, estado, congelado_por
       FROM (
         SELECT * FROM analytics.inadimplencia_mes
          ORDER BY competencia DESC LIMIT $1::int
       ) x ORDER BY competencia`,
    [meses],
  );
  return rows.map((r) => ({
    competencia: String(r["competencia"]),
    saldoInicialCentavos: String(r["saldo_inicial_centavos"]),
    titulosInicial: Number(r["titulos_inicial"]),
    entrouCentavos: String(r["entrou_centavos"]),
    entrouTitulos: Number(r["entrou_titulos"]),
    recuperadoCentavos: String(r["recuperado_centavos"]),
    recuperadoTitulos: Number(r["recuperado_titulos"]),
    canceladoCentavos: String(r["cancelado_centavos"]),
    canceladoTitulos: Number(r["cancelado_titulos"]),
    ajusteCentavos: String(r["ajuste_centavos"]),
    saldoFinalCentavos: String(r["saldo_final_centavos"]),
    titulosFinal: Number(r["titulos_final"]),
    recenteCentavos: String(r["recente_centavos"]),
    correnteCentavos:
      r["corrente_centavos"] === null ? null : String(r["corrente_centavos"]),
    correnteClientes:
      r["corrente_clientes"] === null ? null : Number(r["corrente_clientes"]),
    origem: String(r["origem"]) as OrigemDaFoto,
    estado: String(r["estado"]) as "aberta" | "congelada",
    congeladoPor: (r["congelado_por"] as string | null) ?? null,
  }));
}

export interface RecuperacaoDoMes {
  readonly entrou12mCentavos: string;
  readonly recuperado12mCentavos: string;
  /** Quanto da entrada volta, em percentual. Abaixo de 100% a carteira cresce. */
  readonly taxaRecuperacaoPct: number | null;
  readonly crescimento12mCentavos: string;
  readonly mesesFechados: number;
}

/**
 * A leitura de doze meses: entrou, voltou, e o saldo da diferença.
 *
 * A TAXA é o número que importa, e não os reais recuperados. Reais recuperados
 * caem quando faturamos menos, o que faria a cobrança parecer pior num mês bom —
 * é o mesmo motivo pelo qual contas a receber usa CEI e não "recebido no mês".
 */
export async function recuperacaoDeDozeMeses(db: pg.Pool): Promise<RecuperacaoDoMes> {
  const { rows } = await db.query(
    `WITH fechados AS (
       SELECT * FROM analytics.inadimplencia_mes
        WHERE competencia >= date_trunc('month', current_date) - interval '12 months'
          AND competencia <  date_trunc('month', current_date)
     )
     SELECT coalesce(sum(entrou_centavos), 0)::text     AS entrou,
            coalesce(sum(recuperado_centavos), 0)::text AS recuperado,
            count(*)::int                               AS meses
       FROM fechados`,
  );
  const r = rows[0] ?? {};
  const entrou = Number(r["entrou"] ?? 0);
  const recuperado = Number(r["recuperado"] ?? 0);
  return {
    entrou12mCentavos: String(r["entrou"] ?? "0"),
    recuperado12mCentavos: String(r["recuperado"] ?? "0"),
    taxaRecuperacaoPct:
      entrou > 0 ? Math.round((recuperado / entrou) * 1000) / 10 : null,
    crescimento12mCentavos: String(entrou - recuperado),
    mesesFechados: Number(r["meses"] ?? 0),
  };
}

/**
 * Coorte: do que venceu em cada mês, quanto voltou algum dia.
 *
 * Vem das DATAS e não das fotos, de propósito: a coorte pergunta pelo destino
 * final de um vencimento, e esse destino continua mudando depois de a foto ser
 * tirada. É a curva de vintage do crédito ao consumo — e é ela que separa atraso
 * de perda: nas coortes maduras 84% a 93% do valor volta, então a perda
 * estrutural é de 8% a 15% do que entra em atraso.
 */
export interface CoorteDoVencimento {
  readonly mes: string;
  readonly titulos: number;
  readonly valorCentavos: string;
  readonly pagoPct: number;
  readonly madura: boolean;
}

export async function coorteDoAtraso(
  db: pg.Pool,
  meses = 24,
): Promise<CoorteDoVencimento[]> {
  const { rows } = await db.query(
    // O agrupamento fica na subconsulta e o rótulo do mês por fora. Escrito num
    // nível só, `madura` usava `date_trunc` cru enquanto o GROUP BY agrupava pelo
    // `to_char` da mesma coisa — e o Postgres não tem como provar que uma é função
    // da outra: erro 42803, "column must appear in the GROUP BY clause".
    `SELECT to_char(c.mes, 'YYYY-MM-DD') AS mes, c.titulos, c.valor, c.pago_pct,
            -- Madura é a coorte com pelo menos seis meses de estrada: antes disso
            -- a taxa só diz que ainda não deu tempo de pagar.
            (c.mes < date_trunc('month', current_date) - interval '6 months') AS madura
       FROM (
         SELECT date_trunc('month', t.vencimento) AS mes,
                count(*)::int AS titulos,
                sum(t.valor_centavos)::text AS valor,
                round(100.0 * sum(t.pago_centavos) / sum(t.valor_centavos), 1) AS pago_pct
           FROM core.omie_titulo t
          WHERE ${TITULO_VIVO}
            AND t.vencimento >= date_trunc('month', current_date) - ($1::int || ' months')::interval
            AND t.vencimento <  date_trunc('month', current_date)
            -- Só quem chegou a atrasar: quem pagou no prazo nunca entrou na
            -- carteira, e incluí-lo faria a taxa medir pontualidade em vez de
            -- recuperação.
            AND (t.pagamento IS NULL OR t.pagamento > t.vencimento)
          GROUP BY 1
       ) c
      ORDER BY c.mes`,
    [meses],
  );
  return rows.map((r) => ({
    mes: String(r["mes"]),
    titulos: Number(r["titulos"]),
    valorCentavos: String(r["valor"]),
    pagoPct: Number(r["pago_pct"] ?? 0),
    madura: Boolean(r["madura"]),
  }));
}

/**
 * Contas que o painel suspendeu por atraso e que continuaram recebendo título.
 *
 * Caiu no colo da medição e é vazamento dos dois lados: ninguém vai pagar, e o
 * valor está inflando o faturamento emitido. Sete contas, doze títulos,
 * R$ 25.109,20 em noventa dias quando foi medido.
 */
export interface CobrancaEmContaCortada {
  readonly accountId: string;
  readonly razaoSocial: string;
  readonly documento: string;
  readonly titulos: number;
  readonly valorCentavos: string;
  readonly ultimoVencimento: string;
}

export async function faturandoContaCortada(
  db: pg.Pool,
  dias = 90,
): Promise<CobrancaEmContaCortada[]> {
  const { rows } = await db.query(
    `SELECT a.id::text AS account_id, a.razao_social, v.chave AS documento,
            count(*)::int AS titulos, sum(t.valor_centavos)::text AS valor,
            to_char(max(t.vencimento), 'YYYY-MM-DD') AS ultimo
       FROM core.account a
       JOIN core.vinculo_cliente v ON v.account_id = a.id AND v.fonte = 'omie'
       JOIN core.omie_titulo t ON t.documento = v.chave
      WHERE a.status_core = 'suspended_by_overdue'
        AND ${TITULO_VIVO}
        AND t.vencimento >= current_date - ($1::int || ' days')::interval
      GROUP BY 1, 2, 3
      ORDER BY sum(t.valor_centavos) DESC`,
    [dias],
  );
  return rows.map((r) => ({
    accountId: String(r["account_id"]),
    razaoSocial: String(r["razao_social"] ?? ""),
    documento: String(r["documento"]),
    titulos: Number(r["titulos"]),
    valorCentavos: String(r["valor"]),
    ultimoVencimento: String(r["ultimo"]),
  }));
}
