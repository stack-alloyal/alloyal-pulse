import type pg from "pg";

/**
 * As leituras da API de serviço (/api/v1) — F0: contas, titulos, eventos.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POR QUE O SQL MORA AQUI, e não na rota.                                     │
 * │                                                                            │
 * │ É a mesma regra do resto do `@pulse/config`: a rota é porteiro (token,      │
 * │ envelope, paginação) e o domínio é quem sabe o formato do dado. A ponte de   │
 * │ identidade — account ↔ CNPJ ↔ código Omie ↔ HubSpot — é a peça mais         │
 * │ delicada, e ela precisa estar num lugar testável, não espalhada em handler.  │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * PAGINAÇÃO por KEYSET, nunca OFFSET: a base muda entre uma página e outra, e
 * OFFSET pula ou repete linha quando isso acontece. A chave é sempre estável e
 * única (id da conta, código do título, id do evento), e a próxima página é
 * "depois desta chave". `proximaChave` é nula quando a página veio incompleta.
 */

export interface Pagina<T> {
  readonly linhas: readonly T[];
  /** A chave da última linha, para a próxima página. Nula = acabou. */
  readonly proximaChave: string | null;
  /** O carimbo mais novo do recurso inteiro — o "snapshot" do envelope. */
  readonly frescor: string | null;
}

export interface FiltroApi {
  /** Já validado e travado em [1, 5000] pela rota. */
  readonly limite: number;
  readonly apos?: string | null;
  readonly cnpj?: string | null;
  readonly accountId?: string | null;
  readonly competencia?: string | null;
  readonly atualizadoDesde?: string | null;
}

const soDigitos = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const d = s.replace(/\D/g, "");
  return d.length > 0 ? d : null;
};

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : new Date(v as string).toISOString();

// ─────────────────────────────────────────────────────────────────────────────
// contas — uma linha por conta, com TODOS os ids cruzados
// ─────────────────────────────────────────────────────────────────────────────

export interface ContaApi {
  readonly account_id: string;
  readonly razao_social: string | null;
  readonly cnpj: string | null;
  readonly codigo_omie: readonly string[];
  readonly hubspot_company_id: string | null;
  readonly brand_id: string | null;
  readonly branch_id: string | null;
  readonly parent_account_id: string | null;
  readonly status_core: string | null;
  readonly vinculo: string;
  readonly csm_email: string | null;
  readonly setor: string | null;
  readonly porte: string | null;
  readonly atualizado_em: string | null;
}

export async function listarContasApi(
  db: pg.Pool,
  f: FiltroApi,
): Promise<Pagina<ContaApi>> {
  const { rows } = await db.query(
    `SELECT
       a.id::text AS account_id,
       a.razao_social,
       nullif(regexp_replace(coalesce(a.cnpj, ''), '\\D', '', 'g'), '') AS cnpj,
       a.hubspot_company_id,
       a.brand_id::text  AS brand_id,
       a.branch_id::text AS branch_id,
       a.parent_account_id::text AS parent_account_id,
       a.status_core,
       a.csm_email,
       a.setor,
       a.porte,
       a.atualizado_em,
       coalesce((SELECT string_agg(DISTINCT v.fonte, ',' ORDER BY v.fonte)
                   FROM core.vinculo_cliente v WHERE v.account_id = a.id), 'sem_vinculo') AS vinculo,
       (SELECT coalesce(array_agg(DISTINCT oc.codigo_omie::text ORDER BY oc.codigo_omie::text), '{}')
          FROM core.omie_cliente oc
         WHERE oc.documento = regexp_replace(coalesce(a.cnpj, ''), '\\D', '', 'g')
            OR oc.documento IN (SELECT v.chave FROM core.vinculo_cliente v
                                 WHERE v.account_id = a.id AND v.fonte = 'omie')) AS codigo_omie,
       (SELECT max(atualizado_em) FROM core.account) AS _frescor
     FROM core.account a
     WHERE ($2::uuid IS NULL OR a.id > $2::uuid)
       AND ($3::text IS NULL OR regexp_replace(coalesce(a.cnpj, ''), '\\D', '', 'g') = $3)
       AND ($4::uuid IS NULL OR a.id = $4::uuid)
       AND ($5::timestamptz IS NULL OR a.atualizado_em >= $5::timestamptz)
     ORDER BY a.id
     LIMIT $1`,
    [f.limite, f.apos ?? null, soDigitos(f.cnpj), f.accountId ?? null, f.atualizadoDesde ?? null],
  );
  const linhas: ContaApi[] = rows.map((r) => ({
    account_id: String(r["account_id"]),
    razao_social: r["razao_social"] ?? null,
    cnpj: r["cnpj"] ?? null,
    codigo_omie: (r["codigo_omie"] as string[] | null)?.map(String) ?? [],
    hubspot_company_id: r["hubspot_company_id"] ? String(r["hubspot_company_id"]) : null,
    brand_id: r["brand_id"] ?? null,
    branch_id: r["branch_id"] ?? null,
    parent_account_id: r["parent_account_id"] ?? null,
    status_core: r["status_core"] ?? null,
    vinculo: String(r["vinculo"]),
    csm_email: r["csm_email"] ?? null,
    setor: r["setor"] ?? null,
    porte: r["porte"] ?? null,
    atualizado_em: iso(r["atualizado_em"]),
  }));
  return paginar(linhas, rows, f.limite, (l) => l.account_id);
}

// ─────────────────────────────────────────────────────────────────────────────
// titulos — os títulos do Omie como o Pulse os vê
// ─────────────────────────────────────────────────────────────────────────────

export interface TituloApi {
  readonly codigo_lancamento_omie: string;
  readonly account_id: string | null;
  readonly cnpj: string | null;
  readonly emissao: string | null;
  readonly vencimento: string | null;
  readonly pagamento: string | null;
  readonly competencia: string | null;
  readonly valor_centavos: string;
  readonly recebido_centavos: string;
  readonly em_aberto_centavos: string;
  readonly dias_atraso: number;
  readonly categoria: string | null;
  readonly status_omie: string | null;
  readonly status_pulse: string | null;
  readonly sincronizado_em: string | null;
}

const dataOuNull = (v: unknown): string | null => {
  if (!v) return null;
  // `date` do pg vem como Date; queremos só AAAA-MM-DD.
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

export async function listarTitulosApi(
  db: pg.Pool,
  f: FiltroApi,
): Promise<Pagina<TituloApi>> {
  const { rows } = await db.query(
    `SELECT
       t.codigo_titulo::text AS codigo_lancamento_omie,
       v.account_id::text AS account_id,
       nullif(regexp_replace(coalesce(t.documento, ''), '\\D', '', 'g'), '') AS cnpj,
       t.emissao, t.vencimento, t.pagamento,
       to_char(date_trunc('month', t.vencimento), 'YYYY-MM') AS competencia,
       t.valor_centavos::text  AS valor_centavos,
       t.pago_centavos::text   AS recebido_centavos,
       t.aberto_centavos::text AS em_aberto_centavos,
       CASE WHEN t.aberto_centavos > 0 AND t.vencimento < current_date
            THEN (current_date - t.vencimento) ELSE 0 END AS dias_atraso,
       t.categoria, t.status AS status_omie, t.situacao AS status_pulse,
       t.sincronizado_em,
       (SELECT max(sincronizado_em) FROM core.omie_titulo) AS _frescor
     FROM core.omie_titulo t
     LEFT JOIN LATERAL (
       SELECT v.account_id FROM core.vinculo_cliente v
        WHERE v.chave = t.documento AND v.fonte = 'omie'
        ORDER BY v.criado_em LIMIT 1
     ) v ON true
     WHERE ($2::bigint IS NULL OR t.codigo_titulo > $2::bigint)
       AND ($3::text IS NULL OR regexp_replace(coalesce(t.documento, ''), '\\D', '', 'g') = $3)
       AND ($4::uuid IS NULL OR v.account_id = $4::uuid)
       AND ($5::text IS NULL OR to_char(date_trunc('month', t.vencimento), 'YYYY-MM') = $5)
       AND ($6::timestamptz IS NULL OR t.sincronizado_em >= $6::timestamptz)
     ORDER BY t.codigo_titulo
     LIMIT $1`,
    [
      f.limite,
      f.apos ?? null,
      soDigitos(f.cnpj),
      f.accountId ?? null,
      f.competencia ?? null,
      f.atualizadoDesde ?? null,
    ],
  );
  const linhas: TituloApi[] = rows.map((r) => ({
    codigo_lancamento_omie: String(r["codigo_lancamento_omie"]),
    account_id: r["account_id"] ?? null,
    cnpj: r["cnpj"] ?? null,
    emissao: dataOuNull(r["emissao"]),
    vencimento: dataOuNull(r["vencimento"]),
    pagamento: dataOuNull(r["pagamento"]),
    competencia: r["competencia"] ?? null,
    valor_centavos: String(r["valor_centavos"] ?? "0"),
    recebido_centavos: String(r["recebido_centavos"] ?? "0"),
    em_aberto_centavos: String(r["em_aberto_centavos"] ?? "0"),
    dias_atraso: Number(r["dias_atraso"] ?? 0),
    categoria: r["categoria"] ?? null,
    status_omie: r["status_omie"] ?? null,
    status_pulse: r["status_pulse"] ?? null,
    sincronizado_em: iso(r["sincronizado_em"]),
  }));
  return paginar(linhas, rows, f.limite, (l) => l.codigo_lancamento_omie);
}

// ─────────────────────────────────────────────────────────────────────────────
// eventos — o ledger fact.mrr_event inteiro
// ─────────────────────────────────────────────────────────────────────────────

export interface EventoApi {
  readonly id: string;
  readonly account_id: string | null;
  readonly contract_id: string | null;
  readonly competencia: string | null;
  readonly tipo: string;
  readonly valor_centavos: string;
  readonly origem: string | null;
  readonly motivo: string | null;
  readonly reconstruido: boolean;
  readonly chave_natural: string | null;
  readonly criado_em: string | null;
}

export async function listarEventosApi(
  db: pg.Pool,
  f: FiltroApi,
): Promise<Pagina<EventoApi>> {
  const { rows } = await db.query(
    `SELECT
       e.id::text,
       e.account_id::text  AS account_id,
       e.contract_id::text AS contract_id,
       to_char(e.competencia, 'YYYY-MM') AS competencia,
       e.tipo,
       e.valor_centavos::text AS valor_centavos,
       e.origem, e.motivo, e.reconstruido, e.chave_natural,
       e.criado_em,
       (SELECT max(criado_em) FROM fact.mrr_event) AS _frescor
     FROM fact.mrr_event e
     WHERE ($2::uuid IS NULL OR e.id > $2::uuid)
       AND ($3::uuid IS NULL OR e.account_id = $3::uuid)
       AND ($4::text IS NULL OR to_char(e.competencia, 'YYYY-MM') = $4)
       AND ($5::timestamptz IS NULL OR e.criado_em >= $5::timestamptz)
     ORDER BY e.id
     LIMIT $1`,
    [f.limite, f.apos ?? null, f.accountId ?? null, f.competencia ?? null, f.atualizadoDesde ?? null],
  );
  const linhas: EventoApi[] = rows.map((r) => ({
    id: String(r["id"]),
    account_id: r["account_id"] ?? null,
    contract_id: r["contract_id"] ?? null,
    competencia: r["competencia"] ?? null,
    tipo: String(r["tipo"]),
    valor_centavos: String(r["valor_centavos"] ?? "0"),
    origem: r["origem"] ?? null,
    motivo: r["motivo"] ?? null,
    reconstruido: Boolean(r["reconstruido"]),
    chave_natural: r["chave_natural"] ?? null,
    criado_em: iso(r["criado_em"]),
  }));
  return paginar(linhas, rows, f.limite, (l) => l.id);
}

/**
 * A cauda comum: a próxima chave só existe quando a página VEIO CHEIA (veio
 * `limite` linhas). Página incompleta é o fim — pedir "depois da última" traria
 * vazio, e nulo diz isso sem uma ida a mais ao banco.
 */
function paginar<T>(
  linhas: readonly T[],
  rows: readonly Record<string, unknown>[],
  limite: number,
  chaveDe: (l: T) => string,
): Pagina<T> {
  const cheia = linhas.length >= limite;
  const ultima = linhas[linhas.length - 1];
  return {
    linhas,
    proximaChave: cheia && ultima ? chaveDe(ultima) : null,
    frescor: rows[0]?.["_frescor"] ? new Date(rows[0]["_frescor"] as string).toISOString() : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// receita — P1: mrr, fechamento, faturamento
// ─────────────────────────────────────────────────────────────────────────────

/**
 * O MESMO universo de títulos da Carteira e da aba Faturamento — copiado de
 * `packages/success/src/faturamento.ts`, que por sua vez o copiou da view
 * `analytics.mrr_faturado_mes`. É a terceira cópia, e não é descuido: este
 * pacote não pode importar `@pulse/success` (o sentido da dependência é o
 * inverso), e uma QUARTA definição de "o que é faturamento de cliente" na API
 * seria pior que a cópia. Se mudar lá, muda aqui — o comentário existe para isso.
 */
const UNIVERSO_DE_CLIENTE_API = `
  SELECT v.account_id, t.vencimento, t.pagamento, t.valor_centavos, t.pago_centavos
    FROM core.omie_titulo t
    JOIN core.vinculo_cliente v ON v.chave = t.documento AND v.fonte = 'omie'
   WHERE t.valor_centavos > 0
     AND t.situacao NOT IN ('previsao', 'cancelado')
     AND NOT EXISTS (SELECT 1 FROM core.omie_cliente az
                      WHERE az.documento = t.documento AND az.tags ? 'Azul')
     AND EXISTS (SELECT 1 FROM core.omie_cliente cl
                  WHERE cl.documento = t.documento
                    AND (cl.tags ? 'Cliente' OR cl.tags ? 'Cliente Hinova'
                         OR NOT (cl.tags ? 'Fornecedor' OR cl.tags ? 'Investidor')))`;

/** Resolve um CNPJ (só dígitos) para as contas ligadas a ele — pelo vínculo Omie ou pelo cadastro. */
const CONTAS_DO_CNPJ = `
  SELECT v.account_id FROM core.vinculo_cliente v
   WHERE v.fonte = 'omie' AND regexp_replace(v.chave, '\\D', '', 'g') = $CNPJ
  UNION
  SELECT a.id FROM core.account a
   WHERE regexp_replace(coalesce(a.cnpj, ''), '\\D', '', 'g') = $CNPJ`;

/** "AAAA-MM|uuid" → [date do 1º do mês, uuid]. A rota já validou a forma. */
const chaveMesConta = (apos: string | null | undefined): [string | null, string | null] => {
  if (!apos) return [null, null];
  const [mes, conta] = apos.split("|");
  return [mes ? `${mes}-01` : null, conta ?? null];
};
const mesOuNull = (c: string | null | undefined): string | null => (c ? `${c}-01` : null);

// ─── receita/mrr ─────────────────────────────────────────────────────────────

export interface MrrApi {
  readonly competencia: string;
  readonly account_id: string;
  /** O MRR SUAVIZADO da view: dobra e buraco corrigidos. É o número da Carteira. */
  readonly mrr_centavos: string;
  /** O que foi faturado BRUTO no mês, sem suavizar. */
  readonly faturado_centavos: string;
  /** Sempre `faturamento` — o Pulse não tem a camada de contrato. */
  readonly origem: "faturamento";
  /** `true` quando o mês foi PREENCHIDO pela suavização (não houve título). */
  readonly reconstruido: boolean;
  /** Títulos vivos com vencimento no mês, para a conta — mesmo universo de /titulos. */
  readonly titulos_no_mes: number;
}

export async function listarMrrApi(db: pg.Pool, f: FiltroApi): Promise<Pagina<MrrApi>> {
  const [mesApos, contaApos] = chaveMesConta(f.apos);
  const cnpj = soDigitos(f.cnpj);
  const { rows } = await db.query(
    `SELECT
       to_char(m.competencia, 'YYYY-MM') AS competencia,
       m.account_id::text AS account_id,
       round(m.mrr_centavos)::bigint::text      AS mrr_centavos,
       round(m.faturado_centavos)::bigint::text AS faturado_centavos,
       m.preenchido,
       (SELECT count(*) FROM core.omie_titulo t
          JOIN core.vinculo_cliente v ON v.chave = t.documento AND v.fonte = 'omie'
         WHERE v.account_id = m.account_id
           AND t.valor_centavos > 0 AND t.situacao NOT IN ('previsao', 'cancelado')
           AND date_trunc('month', t.vencimento)::date = m.competencia)::int AS titulos_no_mes,
       (SELECT max(sincronizado_em) FROM core.omie_titulo) AS _frescor
     FROM analytics.mrr_faturado_mes m
     WHERE ($2::date IS NULL OR (m.competencia, m.account_id) > ($2::date, $3::uuid))
       AND ($4::uuid IS NULL OR m.account_id = $4::uuid)
       AND ($5::date IS NULL OR m.competencia = $5::date)
       AND ($6::text IS NULL OR m.account_id IN (${CONTAS_DO_CNPJ.replace(/\$CNPJ/g, "$6")}))
     ORDER BY m.competencia, m.account_id
     LIMIT $1`,
    [f.limite, mesApos, contaApos, f.accountId ?? null, mesOuNull(f.competencia), cnpj],
  );
  const linhas: MrrApi[] = rows.map((r) => ({
    competencia: String(r["competencia"]),
    account_id: String(r["account_id"]),
    mrr_centavos: String(r["mrr_centavos"] ?? "0"),
    faturado_centavos: String(r["faturado_centavos"] ?? "0"),
    origem: "faturamento",
    reconstruido: Boolean(r["preenchido"]),
    titulos_no_mes: Number(r["titulos_no_mes"] ?? 0),
  }));
  return paginar(linhas, rows, f.limite, (l) => `${l.competencia}|${l.account_id}`);
}

// ─── receita/fechamento ──────────────────────────────────────────────────────

export interface FechamentoApi {
  readonly competencia: string;
  readonly mrr_inicial_centavos: string;
  readonly novo_centavos: string;
  readonly expansao_centavos: string;
  readonly contracao_centavos: string;
  readonly churn_pedido_centavos: string;
  readonly churn_inadimplencia_centavos: string;
  readonly reativacao_centavos: string;
  readonly ajuste_centavos: string;
  readonly nao_atribuido_centavos: string;
  readonly mrr_final_centavos: string;
  readonly contas_iniciais: number | null;
  readonly contas_novas: number | null;
  readonly contas_perdidas: number | null;
  readonly contas_finais: number | null;
  readonly nrr: number | null;
  readonly grr: number | null;
  readonly estado: string;
  readonly congelado_por: string | null;
  readonly congelado_em: string | null;
  readonly publicado_em: string | null;
  readonly gerado_em: string | null;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function listarFechamentoApi(db: pg.Pool, f: FiltroApi): Promise<Pagina<FechamentoApi>> {
  const { rows } = await db.query(
    `SELECT
       to_char(competencia, 'YYYY-MM') AS competencia,
       mrr_inicial_centavos::text, novo_centavos::text, expansao_centavos::text, contracao_centavos::text,
       churn_pedido_centavos::text, churn_inadimplencia_centavos::text, reativacao_centavos::text,
       ajuste_centavos::text, nao_atribuido_centavos::text, mrr_final_centavos::text,
       contas_iniciais, contas_novas, contas_perdidas, contas_finais,
       nrr, grr, estado, congelado_por, congelado_em, publicado_em, gerado_em,
       (SELECT max(gerado_em) FROM analytics.monthly_close) AS _frescor
     FROM analytics.monthly_close
     WHERE ($2::date IS NULL OR competencia > $2::date)
       AND ($3::date IS NULL OR competencia = $3::date)
       AND ($4::timestamptz IS NULL OR gerado_em >= $4::timestamptz)
     ORDER BY competencia
     LIMIT $1`,
    [f.limite, mesOuNull(f.apos), mesOuNull(f.competencia), f.atualizadoDesde ?? null],
  );
  const c = (r: Record<string, unknown>, k: string): string => String(r[k] ?? "0");
  const linhas: FechamentoApi[] = rows.map((r) => ({
    competencia: String(r["competencia"]),
    mrr_inicial_centavos: c(r, "mrr_inicial_centavos"),
    novo_centavos: c(r, "novo_centavos"),
    expansao_centavos: c(r, "expansao_centavos"),
    contracao_centavos: c(r, "contracao_centavos"),
    churn_pedido_centavos: c(r, "churn_pedido_centavos"),
    churn_inadimplencia_centavos: c(r, "churn_inadimplencia_centavos"),
    reativacao_centavos: c(r, "reativacao_centavos"),
    ajuste_centavos: c(r, "ajuste_centavos"),
    nao_atribuido_centavos: c(r, "nao_atribuido_centavos"),
    mrr_final_centavos: c(r, "mrr_final_centavos"),
    contas_iniciais: num(r["contas_iniciais"]),
    contas_novas: num(r["contas_novas"]),
    contas_perdidas: num(r["contas_perdidas"]),
    contas_finais: num(r["contas_finais"]),
    nrr: num(r["nrr"]),
    grr: num(r["grr"]),
    estado: String(r["estado"]),
    congelado_por: (r["congelado_por"] as string | null) ?? null,
    congelado_em: iso(r["congelado_em"]),
    publicado_em: iso(r["publicado_em"]),
    gerado_em: iso(r["gerado_em"]),
  }));
  return paginar(linhas, rows, f.limite, (l) => l.competencia);
}

// ─── receita/faturamento ─────────────────────────────────────────────────────

export interface FaturamentoApi {
  readonly competencia: string;
  readonly account_id: string;
  /** COBRADO no mês: títulos pelo VENCIMENTO (competência). Bruto, sem suavizar. */
  readonly cobrado_centavos: string;
  readonly titulos_cobrados: number;
  /** RECEBIDO no mês: pagamentos pela DATA DE PAGAMENTO (caixa). Nulo = nada entrou. */
  readonly recebido_centavos: string | null;
  readonly titulos_recebidos: number;
}

export async function listarFaturamentoApi(db: pg.Pool, f: FiltroApi): Promise<Pagina<FaturamentoApi>> {
  const [mesApos, contaApos] = chaveMesConta(f.apos);
  const cnpj = soDigitos(f.cnpj);
  const { rows } = await db.query(
    `WITH titulos AS (${UNIVERSO_DE_CLIENTE_API}
     ), comp AS (
       SELECT account_id, date_trunc('month', vencimento)::date AS mes,
              sum(valor_centavos) AS cobrado, count(*) AS titulos
         FROM titulos GROUP BY 1, 2
     ), cx AS (
       SELECT account_id, date_trunc('month', pagamento)::date AS mes,
              sum(pago_centavos) AS recebido, count(*) AS pagos
         FROM titulos WHERE pagamento IS NOT NULL AND pago_centavos > 0 GROUP BY 1, 2
     ), tudo AS (
       -- FULL OUTER: um mês pode ter cobrança sem recebimento (inadimplência) ou
       -- recebimento sem cobrança (pagou atrasado o mês anterior). As duas bases
       -- ficam lado a lado, nunca fundidas — é a regra da aba Faturamento.
       SELECT coalesce(c.account_id, x.account_id) AS account_id,
              coalesce(c.mes, x.mes) AS mes,
              c.cobrado, c.titulos, x.recebido, x.pagos
         FROM comp c
         FULL OUTER JOIN cx x ON x.account_id = c.account_id AND x.mes = c.mes
     )
     SELECT to_char(mes, 'YYYY-MM') AS competencia,
            account_id::text AS account_id,
            coalesce(cobrado, 0)::text AS cobrado_centavos,
            coalesce(titulos, 0)::int  AS titulos_cobrados,
            recebido::text             AS recebido_centavos,
            coalesce(pagos, 0)::int    AS titulos_recebidos,
            (SELECT max(sincronizado_em) FROM core.omie_titulo) AS _frescor
       FROM tudo
      WHERE ($2::date IS NULL OR (mes, account_id) > ($2::date, $3::uuid))
        AND ($4::uuid IS NULL OR account_id = $4::uuid)
        AND ($5::date IS NULL OR mes = $5::date)
        AND ($6::text IS NULL OR account_id IN (${CONTAS_DO_CNPJ.replace(/\$CNPJ/g, "$6")}))
      ORDER BY mes, account_id
      LIMIT $1`,
    [f.limite, mesApos, contaApos, f.accountId ?? null, mesOuNull(f.competencia), cnpj],
  );
  const linhas: FaturamentoApi[] = rows.map((r) => ({
    competencia: String(r["competencia"]),
    account_id: String(r["account_id"]),
    cobrado_centavos: String(r["cobrado_centavos"] ?? "0"),
    titulos_cobrados: Number(r["titulos_cobrados"] ?? 0),
    recebido_centavos: r["recebido_centavos"] === null || r["recebido_centavos"] === undefined
      ? null
      : String(r["recebido_centavos"]),
    titulos_recebidos: Number(r["titulos_recebidos"] ?? 0),
  }));
  return paginar(linhas, rows, f.limite, (l) => `${l.competencia}|${l.account_id}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// P2: inadimplencia (conta e título), saidas, ciclos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Título sem conta (CPF, ou CNPJ sem vínculo) precisa de uma chave de paginação
 * mesmo assim. O uuid nulo é o sentinela: ordena antes de qualquer conta real e
 * viaja no cursor como um uuid comum. Na resposta, `account_id` continua nulo.
 */
const SEM_CONTA = "00000000-0000-0000-0000-000000000000";
const NO_SALDO = `f.movimento IN ('permaneceu', 'entrou')`;

// ─── inadimplencia/contas — a foto por competência × conta ───────────────────

export interface InadimplenciaContaApi {
  readonly competencia: string;
  readonly account_id: string | null;
  readonly cnpj: string | null;
  /** O que estava em atraso na foto (movimento permaneceu/entrou). */
  readonly em_aberto_centavos: string;
  readonly titulos: number;
  readonly maior_atraso_dias: number | null;
  /** A faixa do título mais antigo em aberto. */
  readonly faixa: string | null;
  readonly status_painel: string | null;
  readonly ativa: boolean;
  /** Universo: `true` = cliente (tags Cliente/Hinova); `false` = tudo do Omie. */
  readonly e_cliente: boolean;
  readonly entrou_centavos: string;
  readonly recuperado_centavos: string;
  readonly cancelado_centavos: string;
  readonly origem: string | null;
}

export async function listarInadimplenciaContasApi(
  db: pg.Pool,
  f: FiltroApi,
): Promise<Pagina<InadimplenciaContaApi>> {
  const [mesApos, contaApos] = chaveMesConta(f.apos);
  const { rows } = await db.query(
    `SELECT
       to_char(f.competencia, 'YYYY-MM') AS competencia,
       f.account_id::text AS account_id,
       max(nullif(regexp_replace(f.documento, '\\D', '', 'g'), '')) AS cnpj,
       coalesce(sum(f.valor_centavos) FILTER (WHERE ${NO_SALDO}), 0)::text AS em_aberto_centavos,
       count(*) FILTER (WHERE ${NO_SALDO})::int AS titulos,
       max(f.dias_atraso) FILTER (WHERE ${NO_SALDO}) AS maior_atraso_dias,
       (array_agg(f.faixa ORDER BY f.dias_atraso DESC) FILTER (WHERE ${NO_SALDO}))[1] AS faixa,
       (array_agg(f.status_painel ORDER BY f.dias_atraso DESC) FILTER (WHERE ${NO_SALDO}))[1] AS status_painel,
       bool_or(f.e_cliente) AS e_cliente,
       coalesce(sum(f.valor_centavos) FILTER (WHERE f.movimento = 'entrou'), 0)::text     AS entrou_centavos,
       coalesce(sum(f.valor_centavos) FILTER (WHERE f.movimento = 'recuperado'), 0)::text AS recuperado_centavos,
       coalesce(sum(f.valor_centavos) FILTER (WHERE f.movimento = 'cancelado'), 0)::text  AS cancelado_centavos,
       max(f.origem) AS origem,
       (SELECT max(competencia) FROM fact.inadimplencia_titulo)::timestamptz AS _frescor
     FROM fact.inadimplencia_titulo f
     WHERE ($2::date IS NULL OR (f.competencia, coalesce(f.account_id, $7::uuid)) > ($2::date, $3::uuid))
       AND ($4::uuid IS NULL OR f.account_id = $4::uuid)
       AND ($5::date IS NULL OR f.competencia = $5::date)
       AND ($6::text IS NULL OR regexp_replace(f.documento, '\\D', '', 'g') = $6)
     GROUP BY f.competencia, coalesce(f.account_id, $7::uuid), f.account_id
     ORDER BY f.competencia, coalesce(f.account_id, $7::uuid)
     LIMIT $1`,
    [f.limite, mesApos, contaApos, f.accountId ?? null, mesOuNull(f.competencia), soDigitos(f.cnpj), SEM_CONTA],
  );
  const linhas: InadimplenciaContaApi[] = rows.map((r) => ({
    competencia: String(r["competencia"]),
    account_id: (r["account_id"] as string | null) ?? null,
    cnpj: (r["cnpj"] as string | null) ?? null,
    em_aberto_centavos: String(r["em_aberto_centavos"] ?? "0"),
    titulos: Number(r["titulos"] ?? 0),
    maior_atraso_dias: num(r["maior_atraso_dias"]),
    faixa: (r["faixa"] as string | null) ?? null,
    status_painel: (r["status_painel"] as string | null) ?? null,
    ativa: r["status_painel"] === "active",
    e_cliente: Boolean(r["e_cliente"]),
    entrou_centavos: String(r["entrou_centavos"] ?? "0"),
    recuperado_centavos: String(r["recuperado_centavos"] ?? "0"),
    cancelado_centavos: String(r["cancelado_centavos"] ?? "0"),
    origem: (r["origem"] as string | null) ?? null,
  }));
  return paginar(linhas, rows, f.limite, (l) => `${l.competencia}|${l.account_id ?? SEM_CONTA}`);
}

// ─── inadimplencia/titulos — a foto título a título ──────────────────────────

export interface InadimplenciaTituloApi {
  readonly competencia: string;
  readonly codigo_lancamento_omie: string;
  readonly account_id: string | null;
  readonly cnpj: string | null;
  readonly valor_centavos: string;
  readonly vencimento: string | null;
  readonly dias_atraso: number;
  readonly faixa: string | null;
  readonly status_painel: string | null;
  readonly e_cliente: boolean;
  /** permaneceu | entrou (no saldo) · recuperado | cancelado (saiu). */
  readonly movimento: string;
  readonly ajuste_centavos: string;
  readonly motivo_saida: string | null;
  readonly origem: string | null;
}

/** "AAAA-MM|codigo" → [date do 1º do mês, código]. */
const chaveMesTitulo = (apos: string | null | undefined): [string | null, string | null] => {
  if (!apos) return [null, null];
  const [mes, cod] = apos.split("|");
  return [mes ? `${mes}-01` : null, cod ?? null];
};

export async function listarInadimplenciaTitulosApi(
  db: pg.Pool,
  f: FiltroApi,
): Promise<Pagina<InadimplenciaTituloApi>> {
  const [mesApos, codApos] = chaveMesTitulo(f.apos);
  const { rows } = await db.query(
    `SELECT
       to_char(f.competencia, 'YYYY-MM') AS competencia,
       f.codigo_titulo::text AS codigo_lancamento_omie,
       f.account_id::text AS account_id,
       nullif(regexp_replace(f.documento, '\\D', '', 'g'), '') AS cnpj,
       f.valor_centavos::text AS valor_centavos,
       f.vencimento, f.dias_atraso, f.faixa, f.status_painel, f.e_cliente,
       f.movimento, f.ajuste_centavos::text AS ajuste_centavos, f.motivo_saida, f.origem,
       (SELECT max(competencia) FROM fact.inadimplencia_titulo)::timestamptz AS _frescor
     FROM fact.inadimplencia_titulo f
     WHERE ($2::date IS NULL OR (f.competencia, f.codigo_titulo) > ($2::date, $3::bigint))
       AND ($4::uuid IS NULL OR f.account_id = $4::uuid)
       AND ($5::date IS NULL OR f.competencia = $5::date)
       AND ($6::text IS NULL OR regexp_replace(f.documento, '\\D', '', 'g') = $6)
     ORDER BY f.competencia, f.codigo_titulo
     LIMIT $1`,
    [f.limite, mesApos, codApos, f.accountId ?? null, mesOuNull(f.competencia), soDigitos(f.cnpj)],
  );
  const linhas: InadimplenciaTituloApi[] = rows.map((r) => ({
    competencia: String(r["competencia"]),
    codigo_lancamento_omie: String(r["codigo_lancamento_omie"]),
    account_id: (r["account_id"] as string | null) ?? null,
    cnpj: (r["cnpj"] as string | null) ?? null,
    valor_centavos: String(r["valor_centavos"] ?? "0"),
    vencimento: dataOuNull(r["vencimento"]),
    dias_atraso: Number(r["dias_atraso"] ?? 0),
    faixa: (r["faixa"] as string | null) ?? null,
    status_painel: (r["status_painel"] as string | null) ?? null,
    e_cliente: Boolean(r["e_cliente"]),
    movimento: String(r["movimento"]),
    ajuste_centavos: String(r["ajuste_centavos"] ?? "0"),
    motivo_saida: (r["motivo_saida"] as string | null) ?? null,
    origem: (r["origem"] as string | null) ?? null,
  }));
  return paginar(linhas, rows, f.limite, (l) => `${l.competencia}|${l.codigo_lancamento_omie}`);
}

// ─── saidas — os pedidos de saída, com as quatro datas ───────────────────────

export interface SaidaApi {
  readonly id: string;
  readonly account_id: string | null;
  readonly contract_id: string | null;
  readonly pedido: string | null;
  readonly estado: string;
  readonly etapa_desde: string | null;
  readonly origem: string | null;
  readonly origem_do_registro: string | null;
  readonly canal: string | null;
  readonly ticket_externo: string | null;
  /** As quatro datas do fluxo. */
  readonly data_levantada: string | null;
  readonly data_fim_aviso: string | null;
  readonly competencia_ultima_cobranca: string | null;
  readonly competencia_efeito_receita: string | null;
  readonly aviso_previo_dias: number | null;
  /** O MRR CONGELADO no momento da levantada — é o que a saída tira da receita. */
  readonly mrr_centavos_na_levantada: string;
  readonly mrr_novo_centavos: string | null;
  readonly multa_aplicavel_centavos: string | null;
  readonly debito_aberto_na_levantada_centavos: string | null;
  readonly motivo: string | null;
  readonly motivo_detalhe: string | null;
  readonly retido_em: string | null;
  readonly aprovado_em: string | null;
  readonly criado_em: string | null;
  /** O carimbo mais novo entre todos os passos — a base do `atualizado_desde`. */
  readonly atualizado_em: string | null;
}

// Não há `atualizado_em` na tabela; cada passo tem o seu carimbo. O maior deles é
// "quando esta saída mudou pela última vez" — e é o que o incremental precisa.
// Quem fez cada passo (os `*_por`) fica de fora de propósito: é e-mail de gente.
const ATUALIZADO_SAIDA = `greatest(c.criado_em, c.aviso_confirmado_em, c.cobranca_confirmada_em,
  c.aprovado_em, c.motivo_confirmado_em, c.etapa_desde, c.retido_em::timestamptz)`;

export async function listarSaidasApi(db: pg.Pool, f: FiltroApi): Promise<Pagina<SaidaApi>> {
  const cnpj = soDigitos(f.cnpj);
  const { rows } = await db.query(
    `SELECT
       c.id::text, c.account_id::text AS account_id, c.contract_id::text AS contract_id,
       c.pedido, c.estado, c.etapa_desde, c.origem, c.origem_do_registro, c.canal, c.ticket_externo,
       c.data_levantada, c.data_fim_aviso,
       to_char(c.competencia_ultima_cobranca, 'YYYY-MM') AS competencia_ultima_cobranca,
       to_char(c.competencia_efeito_receita, 'YYYY-MM') AS competencia_efeito_receita,
       c.aviso_previo_dias,
       c.mrr_centavos_na_levantada::text AS mrr_centavos_na_levantada,
       c.mrr_novo_centavos::text AS mrr_novo_centavos,
       c.multa_aplicavel_centavos::text AS multa_aplicavel_centavos,
       c.debito_aberto_na_levantada_centavos::text AS debito_aberto_na_levantada_centavos,
       c.motivo, c.motivo_detalhe, c.retido_em, c.aprovado_em, c.criado_em,
       ${ATUALIZADO_SAIDA} AS atualizado_em,
       (SELECT max(${ATUALIZADO_SAIDA}) FROM success.cancellation c) AS _frescor
     FROM success.cancellation c
     WHERE ($2::uuid IS NULL OR c.id > $2::uuid)
       AND ($3::uuid IS NULL OR c.account_id = $3::uuid)
       AND ($4::date IS NULL OR c.competencia_efeito_receita = $4::date)
       AND ($5::timestamptz IS NULL OR ${ATUALIZADO_SAIDA} >= $5::timestamptz)
       AND ($6::text IS NULL OR c.account_id IN (${CONTAS_DO_CNPJ.replace(/\$CNPJ/g, "$6")}))
     ORDER BY c.id
     LIMIT $1`,
    [f.limite, f.apos ?? null, f.accountId ?? null, mesOuNull(f.competencia), f.atualizadoDesde ?? null, cnpj],
  );
  const s = (r: Record<string, unknown>, k: string): string | null =>
    r[k] === null || r[k] === undefined ? null : String(r[k]);
  const linhas: SaidaApi[] = rows.map((r) => ({
    id: String(r["id"]),
    account_id: s(r, "account_id"),
    contract_id: s(r, "contract_id"),
    pedido: s(r, "pedido"),
    estado: String(r["estado"]),
    etapa_desde: iso(r["etapa_desde"]),
    origem: s(r, "origem"),
    origem_do_registro: s(r, "origem_do_registro"),
    canal: s(r, "canal"),
    ticket_externo: s(r, "ticket_externo"),
    data_levantada: dataOuNull(r["data_levantada"]),
    data_fim_aviso: dataOuNull(r["data_fim_aviso"]),
    competencia_ultima_cobranca: s(r, "competencia_ultima_cobranca"),
    competencia_efeito_receita: s(r, "competencia_efeito_receita"),
    aviso_previo_dias: num(r["aviso_previo_dias"]),
    mrr_centavos_na_levantada: String(r["mrr_centavos_na_levantada"] ?? "0"),
    mrr_novo_centavos: s(r, "mrr_novo_centavos"),
    multa_aplicavel_centavos: s(r, "multa_aplicavel_centavos"),
    debito_aberto_na_levantada_centavos: s(r, "debito_aberto_na_levantada_centavos"),
    motivo: s(r, "motivo"),
    motivo_detalhe: s(r, "motivo_detalhe"),
    retido_em: dataOuNull(r["retido_em"]),
    aprovado_em: iso(r["aprovado_em"]),
    criado_em: iso(r["criado_em"]),
    atualizado_em: iso(r["atualizado_em"]),
  }));
  return paginar(linhas, rows, f.limite, (l) => l.id);
}

// ─── ciclos — o que roda, quando rodou, e quando deu certo pela última vez ───

export interface CicloApi {
  readonly ciclo: string;
  readonly descricao: string;
  readonly fonte: string | null;
  readonly metodo: string | null;
  readonly agenda: string | null;
  readonly janela: string | null;
  readonly fase: string | null;
  readonly implementado: boolean;
  readonly ultimo_status: string | null;
  readonly ultimo_inicio: string | null;
  readonly ultimo_fim: string | null;
  readonly ultimo_linhas_lidas: number | null;
  readonly ultimo_linhas_gravadas: number | null;
  readonly ultimo_erro: string | null;
  readonly ultimo_sucesso_em: string | null;
  readonly linhas_do_ultimo_sucesso: number | null;
}

/** Sem paginação: são poucas dezenas de ciclos. `proximaChave` é sempre nula. */
export async function listarCiclosApi(db: pg.Pool): Promise<Pagina<CicloApi>> {
  const { rows } = await db.query(
    `SELECT d.id AS ciclo, d.descricao, d.fonte, d.metodo, d.agenda, d.janela, d.fase, d.implementado,
            u.status AS ultimo_status, u.iniciado_em AS ultimo_inicio, u.terminado_em AS ultimo_fim,
            u.linhas_lidas AS ultimo_linhas_lidas, u.linhas_gravadas AS ultimo_linhas_gravadas, u.erro AS ultimo_erro,
            s.terminado_em AS ultimo_sucesso_em, s.linhas_gravadas AS linhas_do_ultimo_sucesso,
            (SELECT max(terminado_em) FROM ops.cycle_run) AS _frescor
       FROM ops.cycle_declaration d
       LEFT JOIN LATERAL (SELECT * FROM ops.cycle_run r WHERE r.ciclo = d.id
                          ORDER BY r.iniciado_em DESC LIMIT 1) u ON true
       LEFT JOIN LATERAL (SELECT * FROM ops.cycle_run r WHERE r.ciclo = d.id AND r.status = 'ok'
                          ORDER BY r.iniciado_em DESC LIMIT 1) s ON true
      ORDER BY d.id`,
  );
  const s = (r: Record<string, unknown>, k: string): string | null =>
    r[k] === null || r[k] === undefined ? null : String(r[k]);
  const linhas: CicloApi[] = rows.map((r) => ({
    ciclo: String(r["ciclo"]),
    descricao: String(r["descricao"] ?? ""),
    fonte: s(r, "fonte"),
    metodo: s(r, "metodo"),
    agenda: s(r, "agenda"),
    janela: s(r, "janela"),
    fase: s(r, "fase"),
    implementado: Boolean(r["implementado"]),
    ultimo_status: s(r, "ultimo_status"),
    ultimo_inicio: iso(r["ultimo_inicio"]),
    ultimo_fim: iso(r["ultimo_fim"]),
    ultimo_linhas_lidas: num(r["ultimo_linhas_lidas"]),
    ultimo_linhas_gravadas: num(r["ultimo_linhas_gravadas"]),
    ultimo_erro: s(r, "ultimo_erro"),
    ultimo_sucesso_em: iso(r["ultimo_sucesso_em"]),
    linhas_do_ultimo_sucesso: num(r["linhas_do_ultimo_sucesso"]),
  }));
  return {
    linhas,
    proximaChave: null,
    frescor: rows[0]?.["_frescor"] ? new Date(rows[0]["_frescor"] as string).toISOString() : null,
  };
}
