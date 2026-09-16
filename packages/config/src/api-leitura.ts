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
