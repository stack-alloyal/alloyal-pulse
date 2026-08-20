/**
 * Revisão de faturamento: onde o faturamento e o cadastro DISCORDAM.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ TRÊS PERGUNTAS DE VAZAMENTO, e cada uma tem uma ação diferente do outro     │
 * │ lado — é por isso que são três listas e não uma:                            │
 * │                                                                            │
 * │  1. quem PAROU DE FATURAR e segue ativo no painel — ou o clube deveria ter  │
 * │     sido desligado, ou a cobrança parou sem ninguém pedir;                  │
 * │  2. quem NÃO TEVE O REAJUSTE com o aniversário do contrato já vencido — é   │
 * │     dinheiro que deixa de entrar todo mês, e acumula;                       │
 * │  3. quem NÃO TEM VÍNCULO com o Omie — sobre esses não se pode afirmar nada,  │
 * │     e é a fila que precisa encolher para as duas primeiras serem confiáveis. │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

import type pg from "pg";

/**
 * O recorte de quem é cliente — por exclusão, e olhando TODOS os cadastros.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ DUAS VERSÕES ERRADAS ANTES DESTA, e as duas erraram para o mesmo lado:      │
 * │ jogaram cliente real fora, o que é pior que trazer um fornecedor — lista     │
 * │ curta demais não levanta suspeita.                                          │
 * │                                                                            │
 * │ 1ª: exigir a tag `Cliente`. Dos 1.327 vínculos, 77 não a têm, e a maioria    │
 * │     é cliente: 18 sem tag NENHUMA e 16 "Cliente Hinova", que é o canal.      │
 * │ 2ª: excluir se ALGUM cadastro fosse Fornecedor. A OAB-MT tem SEIS cadastros  │
 * │     no mesmo CNPJ — quatro sem tag, um "Fornecedor", um "Garantia Sicoob" —  │
 * │     e fatura R$ 4.200/mês sem falhar desde janeiro. Um cadastro paralelo     │
 * │     tirava o cliente inteiro da revisão.                                    │
 * │                                                                            │
 * │ A regra que ficou, sobre o CONJUNTO de cadastros do documento:                │
 * │                                                                            │
 * │  · fora se QUALQUER cadastro tem `Azul` — é a intermediação de pontos, a     │
 * │    linha que saltou de R$ 30 mil para R$ 3,2 milhões em março, e não é        │
 * │    assinatura nossa;                                                        │
 * │  · dentro se ALGUM cadastro é plausivelmente cliente: tem `Cliente`, tem      │
 * │    `Cliente Hinova`, ou simplesmente NÃO é fornecedor nem investidor.        │
 * │                                                                            │
 * │ Isso derruba a BIZ INVEST, cujo único cadastro é `["Fornecedor",             │
 * │ "Investidor"]` — o que "parou de faturar" nela foi um pagamento NOSSO —, e   │
 * │ mantém a OAB-MT. Cadastro sem tag fica: a tag é preenchida à mão no Omie, e   │
 * │ ausência de tag é ausência de informação, não evidência do contrário.         │
 * │                                                                            │
 * │ Quem está vinculado e não tem a tag aparece em `vinculosSemTagDeCliente`,     │
 * │ que é a fila de correção — o recorte não deve depender de tag para sempre.    │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
const E_CLIENTE = (coluna: string) => `(
  NOT EXISTS (
    SELECT 1 FROM core.omie_cliente az
     WHERE az.documento = ${coluna} AND az.tags ? 'Azul')
  AND EXISTS (
    SELECT 1 FROM core.omie_cliente cl
     WHERE cl.documento = ${coluna}
       AND (cl.tags ? 'Cliente'
            OR cl.tags ? 'Cliente Hinova'
            OR NOT (cl.tags ? 'Fornecedor' OR cl.tags ? 'Investidor')))
)`

/**
 * A carência antes de chamar um cliente de "parou de faturar": 2 meses cheios.
 *
 * Não é folga arbitrária. Um cliente que vence dia 20 tem o mês corrente vazio
 * até o dia 20, e o anterior pode estar em aberto — chamar isso de "parou" numa
 * lista de operação gera fila falsa, e fila falsa é ignorada em duas semanas.
 */
export const MESES_DE_CARENCIA = 2;

export interface ContaQueParou {
  readonly accountId: string;
  readonly razaoSocial: string;
  readonly cnpj: string | null;
  readonly brandId: string | null;
  readonly statusCore: string | null;
  /** `2026-03` do último mês faturado. */
  readonly ultimoMes: string;
  readonly mesesParado: number;
  /** O que ele faturava por mês antes de parar, em centavos. */
  readonly mrrAnterior: number;
  readonly usuariosCadastrados: number;
}

/**
 * Quem parou de faturar e continua ativo no painel.
 *
 * O status usado é `status_core = 'active'`, e não o booleano `ativo`: `ativo`
 * também vira falso quando a conta não vem na carga do core, o que é ausência de
 * dado e não decisão de ninguém. A pergunta aqui é sobre o que o painel AFIRMA.
 */
export async function contasQuePararamDeFaturar(
  db: pg.Pool,
): Promise<ContaQueParou[]> {
  const { rows } = await db.query<Record<string, string>>(
    `WITH fat AS (
       SELECT v.account_id,
              max(date_trunc('month', t.vencimento)) AS ultimo,
              max(t.vencimento)                      AS ultima_data
         FROM core.vinculo_cliente v
         JOIN core.omie_titulo t ON t.documento = v.chave
        WHERE v.fonte = 'omie' AND t.situacao <> 'previsao' AND t.valor_centavos > 0
          AND ${E_CLIENTE('v.chave')}
        GROUP BY 1
     ),
     antes AS (
       -- O que faturava por mês ANTES de parar: a média dos três meses que
       -- antecedem o último. Um mês só pegaria justamente o mês parcial em que
       -- a cobrança já estava caindo.
       SELECT v.account_id, sum(t.valor_centavos) / 3 AS mrr
         FROM core.vinculo_cliente v
         JOIN core.omie_titulo t ON t.documento = v.chave
         JOIN fat f ON f.account_id = v.account_id
        WHERE v.fonte = 'omie' AND t.situacao <> 'previsao' AND t.valor_centavos > 0
          AND t.vencimento >= f.ultimo - interval '2 months'
          AND t.vencimento <  f.ultimo + interval '1 month'
          AND ${E_CLIENTE('v.chave')}
        GROUP BY 1
     )
     SELECT a.id::text AS account_id, a.razao_social, a.cnpj, a.brand_id, a.status_core,
            to_char(f.ultimo, 'YYYY-MM') AS ultimo_mes,
            (extract(year FROM age(date_trunc('month', current_date), f.ultimo)) * 12
             + extract(month FROM age(date_trunc('month', current_date), f.ultimo)))::text AS meses_parado,
            coalesce(n.mrr, 0)::text AS mrr_anterior,
            coalesce(a.usuarios_cadastrados, 0)::text AS usuarios_cadastrados
       FROM core.account a
       JOIN fat f ON f.account_id = a.id
       LEFT JOIN antes n ON n.account_id = a.id
      WHERE a.parent_account_id IS NULL
        AND a.status_core = 'active'
        AND f.ultimo < date_trunc('month', current_date) - ($1::int || ' months')::interval
      ORDER BY coalesce(n.mrr, 0) DESC, a.razao_social`,
    [MESES_DE_CARENCIA],
  );
  return rows.map((r) => ({
    accountId: String(r["account_id"]),
    razaoSocial: String(r["razao_social"] ?? ""),
    cnpj: (r["cnpj"] as string | null) ?? null,
    brandId: (r["brand_id"] as string | null) ?? null,
    statusCore: (r["status_core"] as string | null) ?? null,
    ultimoMes: String(r["ultimo_mes"]),
    mesesParado: Number(r["meses_parado"]),
    mrrAnterior: Number(r["mrr_anterior"]),
    usuariosCadastrados: Number(r["usuarios_cadastrados"]),
  }));
}

// ═══ 2. O reajuste que não foi aplicado ══════════════════════════════════════

/**
 * O mês em que o reajuste anual foi aplicado, e as janelas de comparação.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ MARÇO FICA DE FORA DAS DUAS JANELAS, de propósito. Medido: o MRR de março    │
 * │ de 2026 foi R$ 1,85M contra ~R$ 1,2M em janeiro, fevereiro e abril — o mês    │
 * │ do reajuste carrega cobrança extra e retroativo, e comparar contra ele       │
 * │ inventaria aumento em quem não teve nenhum.                                 │
 * │                                                                            │
 * │ Então: ANTES é jan+fev, DEPOIS é mai+jun, e cada um é dividido por 2 para    │
 * │ virar valor mensal. Dois meses em cada lado e não um, porque um mês só cai   │
 * │ no primeiro cliente que atrasou uma fatura.                                 │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export const JANELA_DO_REAJUSTE = {
  reajuste: "2026-03-01",
  antesDe: "2026-01-01",
  antesAte: "2026-03-01",
  depoisDe: "2026-05-01",
  depoisAte: "2026-07-01",
} as const;

/** Quanto de variação ainda conta como "não mudou": meio ponto percentual. */
export const TOLERANCIA = 0.005;

export interface ContaSemReajuste {
  readonly documento: string;
  readonly accountId: string | null;
  readonly razaoSocial: string;
  readonly mrrMensal: number;
  /** Início do contrato mais antigo no Omie. */
  readonly contratoDesde: string | null;
  readonly aniversarios: number;
  /** O que deixou de entrar por mês, à taxa de referência, em centavos. */
  readonly perdaMensal: number;
}

export interface RevisaoDoReajuste {
  /**
   * A taxa de referência, LIDA DO DADO e não digitada.
   *
   * É a moda dos aumentos observados, arredondada a 0,1 ponto. Em 2026 saiu
   * 4,40%, com 96 dos 142 clientes que subiram — 67,6% — exatamente nela. Uma
   * taxa digitada à mão envelheceria em silêncio no ano seguinte; esta, não.
   */
  readonly taxaPct: number;
  readonly clientesNaTaxa: number;
  readonly clientesQueSubiram: number;
  readonly clientesSemMudanca: number;
  /** Sem mudança E com aniversário vencido: a fila de verdade. */
  readonly semReajusteVencidos: ContaSemReajuste[];
  /** Sem mudança mas com contrato novo demais — corretamente não reajustados. */
  readonly semReajusteNaoDevidos: number;
  readonly perdaMensal: number;
  readonly mesesDesdeOReajuste: number;
  readonly perdaAcumulada: number;
  /**
   * A HIPÓTESE: e se TODOS os que ficaram parados tivessem sido reajustados?
   *
   * ┌─────────────────────────────────────────────────────────────────────────┐
   * │ Não é a mesma pergunta da perda. A perda conta só quem tinha aniversário  │
   * │ VENCIDO — é dinheiro a que temos direito contratual e não cobramos. Esta   │
   * │ conta inclui também os de contrato novo, que corretamente não foram        │
   * │ reajustados: é o teto do que a correção renderia se valesse para todos,    │
   * │ não uma cobrança esquecida.                                               │
   * │                                                                          │
   * │ As duas ficam lado a lado de propósito. Levar só a maior para uma reunião  │
   * │ é prometer receita que não existe; levar só a menor é subdimensionar o     │
   * │ efeito de padronizar a data de reajuste.                                  │
   * └─────────────────────────────────────────────────────────────────────────┘
   */
  readonly hipotese: {
    readonly clientes: number;
    readonly mrrMensal: number;
    readonly ganhoMensal: number;
    readonly ganhoAcumulado: number;
    /** O mesmo, a 4,00% cravados — a taxa "redonda" de referência. */
    readonly ganhoMensalA4: number;
    readonly ganhoAcumuladoA4: number;
  };
}

export async function revisaoDoReajuste(db: pg.Pool): Promise<RevisaoDoReajuste> {
  const j = JANELA_DO_REAJUSTE;
  // A categoria vem pelo NOME e não pelo código: "MRR" é como o plano de contas
  // do Omie chama a receita de assinatura, e o código (1.01.02) é o que muda se
  // alguém reorganizar o plano.
  const base = `
    WITH mrr AS (
      SELECT t.documento,
             sum(t.valor_centavos) FILTER (
               WHERE t.vencimento >= $1::date AND t.vencimento < $2::date) / 2 AS antes,
             sum(t.valor_centavos) FILTER (
               WHERE t.vencimento >= $3::date AND t.vencimento < $4::date) / 2 AS depois
        FROM core.omie_titulo t
        LEFT JOIN core.omie_categoria c ON c.codigo = t.categoria
       WHERE t.situacao <> 'previsao' AND t.valor_centavos > 0 AND c.descricao = 'MRR'
         AND ${E_CLIENTE('t.documento')}
       GROUP BY 1
    ),
    var AS (
      SELECT documento, antes, depois, (depois::numeric / antes - 1) AS delta
        FROM mrr WHERE antes > 0 AND depois > 0
    )`;
  const p = [j.antesDe, j.antesAte, j.depoisDe, j.depoisAte];

  const { rows: taxa } = await db.query<{ pct: string; n: string; subiram: string; parados: string }>(
    `${base}
     SELECT (SELECT round(delta * 100, 1) FROM var WHERE delta > $5::numeric
              GROUP BY 1 ORDER BY count(*) DESC, 1 DESC LIMIT 1)::text AS pct,
            (SELECT count(*) FROM var WHERE delta > $5::numeric)::text  AS subiram,
            (SELECT count(*) FROM var WHERE abs(delta) <= $5::numeric)::text AS parados,
            '0' AS n`,
    [...p, TOLERANCIA],
  );
  const taxaPct = Number(taxa[0]?.pct ?? 0);
  const subiram = Number(taxa[0]?.subiram ?? 0);
  const parados = Number(taxa[0]?.parados ?? 0);

  const { rows: naTaxa } = await db.query<{ n: string }>(
    `${base}
     SELECT count(*)::text AS n FROM var
      WHERE round(delta * 100, 1) = $5::numeric`,
    [...p, taxaPct],
  );

  const { rows: fila } = await db.query<Record<string, string>>(
    `${base},
     ctr AS (SELECT documento, min(vigencia_inicio) AS inicio FROM core.omie_contrato GROUP BY 1)
     -- DISTINCT ON (documento): os dois LEFT JOIN de identidade multiplicam a
     -- linha — 42 contas têm mais de uma identidade no Omie, e um CNPJ pode casar
     -- com mais de um cliente lá. Sem isto a fila saía com 90 nomes onde havia 74,
     -- e a perda mensal vinha 26% inflada. Conferido: 74 + 62 = 136, que é o
     -- total de clientes sem mudança.
     SELECT DISTINCT ON (v.documento)
            v.documento, v.antes::text AS mrr_mensal,
            to_char(c.inicio, 'YYYY-MM-DD') AS contrato_desde,
            (extract(year FROM age($6::date, c.inicio)))::text AS aniversarios,
            vc.account_id::text AS account_id,
            coalesce(a.razao_social, oc.razao_social, v.documento) AS razao_social
       FROM var v
       LEFT JOIN ctr c ON c.documento = v.documento
       LEFT JOIN core.vinculo_cliente vc ON vc.chave = v.documento AND vc.fonte = 'omie'
       LEFT JOIN core.account a ON a.id = vc.account_id
       LEFT JOIN core.omie_cliente oc ON oc.documento = v.documento
      WHERE abs(v.delta) <= $5::numeric
        AND c.inicio IS NOT NULL
        AND c.inicio <= ($6::date - interval '12 months')
      ORDER BY v.documento, v.antes DESC`,
    [...p, TOLERANCIA, j.reajuste],
  );

  // A hipótese: o MRR mensal de TODOS os que ficaram parados, com ou sem
  // aniversário vencido. É o teto do que a correção renderia.
  const { rows: todos } = await db.query<{ n: string; mrr: string }>(
    `${base}
     SELECT count(*)::text AS n, coalesce(sum(antes), 0)::text AS mrr
       FROM var WHERE abs(delta) <= $5::numeric`,
    [...p, TOLERANCIA],
  );

  const { rows: naoDevidos } = await db.query<{ n: string }>(
    `${base},
     ctr AS (SELECT documento, min(vigencia_inicio) AS inicio FROM core.omie_contrato GROUP BY 1)
     SELECT count(*)::text AS n
       FROM var v LEFT JOIN ctr c ON c.documento = v.documento
      WHERE abs(v.delta) <= $5::numeric
        AND (c.inicio IS NULL OR c.inicio > ($6::date - interval '12 months'))`,
    [...p, TOLERANCIA, j.reajuste],
  );

  // A ordenação FINAL é aqui, e não no SQL: `DISTINCT ON (documento)` obriga o
  // ORDER BY a começar pelo documento, então a consulta sai em ordem de CNPJ. A
  // fila tem de sair pela maior perda — é por onde se começa a ligar.
  const semReajusteVencidos: ContaSemReajuste[] = fila.map((r) => {
    const mrr = Number(r["mrr_mensal"]);
    return {
      documento: String(r["documento"]),
      accountId: (r["account_id"] as string | null) ?? null,
      razaoSocial: String(r["razao_social"] ?? ""),
      mrrMensal: mrr,
      contratoDesde: (r["contrato_desde"] as string | null) ?? null,
      aniversarios: Number(r["aniversarios"] ?? 0),
      perdaMensal: Math.round((mrr * taxaPct) / 100),
    };
  });

  semReajusteVencidos.sort((x, y) => y.perdaMensal - x.perdaMensal);
  const perdaMensal = semReajusteVencidos.reduce((s, c) => s + c.perdaMensal, 0);
  const meses = mesesDesde(j.reajuste, new Date());
  const mrrParado = Number(todos[0]?.mrr ?? 0);
  const ganhoMensal = Math.round((mrrParado * taxaPct) / 100);
  const ganhoMensalA4 = Math.round(mrrParado * 0.04);
  return {
    taxaPct,
    clientesNaTaxa: Number(naTaxa[0]?.n ?? 0),
    clientesQueSubiram: subiram,
    clientesSemMudanca: parados,
    semReajusteVencidos,
    semReajusteNaoDevidos: Number(naoDevidos[0]?.n ?? 0),
    perdaMensal,
    mesesDesdeOReajuste: meses,
    perdaAcumulada: perdaMensal * meses,
    hipotese: {
      clientes: Number(todos[0]?.n ?? 0),
      mrrMensal: mrrParado,
      ganhoMensal,
      ganhoAcumulado: ganhoMensal * meses,
      ganhoMensalA4,
      ganhoAcumuladoA4: ganhoMensalA4 * meses,
    },
  };
}

/**
 * Quantos meses FECHADOS desde o mês do reajuste.
 *
 * Fechados, e não corridos: em 20/08 o mês de agosto ainda está sendo faturado,
 * e contá-lo inflaria a perda acumulada com um mês que não terminou. Exportada
 * para ter teste — é uma conta de calendário, e as contas de calendário erram
 * na virada do ano.
 */
export function mesesDesde(mesInicial: string, agora: Date): number {
  const [a, m] = mesInicial.split("-").map(Number);
  if (!a || !m) return 0;
  const meses =
    (agora.getUTCFullYear() - a) * 12 + (agora.getUTCMonth() + 1 - m);
  return Math.max(meses, 0);
}

// ═══ 3. Sem vínculo entre o painel e o Omie ══════════════════════════════════

export interface ContaSemVinculo {
  readonly accountId: string;
  readonly razaoSocial: string;
  readonly cnpj: string | null;
  readonly brandId: string | null;
  readonly hubspotCompanyId: string | null;
  readonly statusCore: string | null;
  readonly usuariosCadastrados: number;
  /**
   * Existe cliente no Omie com este MESMO CNPJ, esperando o vínculo?
   *
   * É a diferença entre "falta ligar" e "não existe no Omie" — duas filas com
   * ações opostas. Sem essa coluna, as 515 contas viram um monte só e ninguém
   * sabe por onde começar.
   */
  readonly temCandidatoNoOmie: boolean;
}

export async function contasSemVinculoComOmie(
  db: pg.Pool,
  { somenteAtivas = true }: { somenteAtivas?: boolean } = {},
): Promise<ContaSemVinculo[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT a.id::text AS account_id, a.razao_social, a.cnpj, a.brand_id,
            h.hubspot_company_id, a.status_core,
            coalesce(a.usuarios_cadastrados, 0)::text AS usuarios_cadastrados,
            (oc.documento IS NOT NULL) AS tem_candidato
       FROM core.account a
       LEFT JOIN core.account_hubspot h ON h.account_id = a.id
       -- Candidato pelo CNPJ limpo dos dois lados: "26.989.697/0001-00" e
       -- "26989697000100" são o mesmo cliente, e a base tem os dois formatos.
       -- O candidato tem de ser CLIENTE lá. Um cadastro de fornecedor com o mesmo
       -- CNPJ não é ligação a fazer: ligá-lo traria pagamento nosso como receita.
       LEFT JOIN core.omie_cliente oc
              ON regexp_replace(coalesce(oc.documento, ''), '\\D', '', 'g')
               = regexp_replace(coalesce(a.cnpj, ''), '\\D', '', 'g')
             AND a.cnpj IS NOT NULL
             AND NOT (oc.tags ? 'Azul')
             AND (oc.tags ? 'Cliente' OR oc.tags ? 'Cliente Hinova'
                  OR NOT (oc.tags ? 'Fornecedor' OR oc.tags ? 'Investidor'))
      WHERE a.parent_account_id IS NULL
        AND ($1::boolean IS NOT TRUE OR a.status_core = 'active')
        AND NOT EXISTS (
          SELECT 1 FROM core.vinculo_cliente v
           WHERE v.account_id = a.id AND v.fonte = 'omie')
      ORDER BY coalesce(a.usuarios_cadastrados, 0) DESC, a.razao_social`,
    [somenteAtivas],
  );
  // `DISTINCT` no id: o LEFT JOIN por CNPJ pode casar mais de um cliente do Omie
  // com a mesma conta — 42 contas têm identidade dupla lá.
  const vistos = new Set<string>();
  const saida: ContaSemVinculo[] = [];
  for (const r of rows) {
    const id = String(r["account_id"]);
    if (vistos.has(id)) continue;
    vistos.add(id);
    saida.push({
      accountId: id,
      razaoSocial: String(r["razao_social"] ?? ""),
      cnpj: (r["cnpj"] as string | null) ?? null,
      brandId: (r["brand_id"] as string | null) ?? null,
      hubspotCompanyId: (r["hubspot_company_id"] as string | null) ?? null,
      statusCore: (r["status_core"] as string | null) ?? null,
      usuariosCadastrados: Number(r["usuarios_cadastrados"]),
      temCandidatoNoOmie: r["tem_candidato"] === true,
    });
  }
  return saida;
}

// ═══ 4. A fila de correção de tag no Omie ════════════════════════════════════

export interface VinculoSemTag {
  readonly accountId: string;
  readonly razaoSocial: string;
  readonly documento: string;
  /** Todas as tags de todos os cadastros daquele documento, sem repetir. */
  readonly tags: string[];
  readonly cadastros: number;
  /** Faturou nos últimos 12 meses, em centavos — o tamanho do que está em jogo. */
  readonly faturamento12m: number;
}

/**
 * Quem o Pulse trata como cliente e o Omie não marca como tal.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ É A FILA DE CORREÇÃO, e ela existe para o recorte deixar de precisar de      │
 * │ adivinhação. Hoje `E_CLIENTE` mantém cadastro sem tag porque ausência de tag  │
 * │ é ausência de informação — mas isso significa que um fornecedor novo, sem     │
 * │ tag, entraria na revisão como cliente. Enquanto esta lista não zerar, o       │
 * │ recorte é uma inferência; quando zerar, passa a ser uma leitura.              │
 * │                                                                            │
 * │ Ordenada pelo faturamento dos últimos 12 meses: taguear primeiro quem move    │
 * │ dinheiro é o que reduz o risco mais rápido.                                  │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export async function vinculosSemTagDeCliente(
  db: pg.Pool,
): Promise<VinculoSemTag[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `WITH lig AS (
       SELECT DISTINCT v.account_id, v.chave AS documento
         FROM core.vinculo_cliente v
        WHERE v.fonte = 'omie'
     ),
     fat AS (
       SELECT documento, sum(valor_centavos) AS total
         FROM core.omie_titulo
        WHERE situacao <> 'previsao' AND valor_centavos > 0
          AND vencimento >= date_trunc('month', current_date) - interval '11 months'
          AND vencimento <  date_trunc('month', current_date) + interval '1 month'
        GROUP BY 1
     )
     SELECT l.account_id::text AS account_id, a.razao_social, l.documento,
            coalesce(t.tags, ARRAY[]::text[]) AS tags,
            coalesce(t.cadastros, 0)::text AS cadastros,
            coalesce(f.total, 0)::text AS faturamento12m
       FROM lig l
       JOIN core.account a ON a.id = l.account_id
       LEFT JOIN fat f ON f.documento = l.documento
       LEFT JOIN LATERAL (
         SELECT count(*) AS cadastros,
                array_agg(DISTINCT tag) FILTER (WHERE tag IS NOT NULL) AS tags
           FROM core.omie_cliente oc
           LEFT JOIN LATERAL jsonb_array_elements_text(oc.tags) AS tag ON true
          WHERE oc.documento = l.documento
       ) t ON true
      WHERE NOT EXISTS (
        SELECT 1 FROM core.omie_cliente cl
         WHERE cl.documento = l.documento
           AND (cl.tags ? 'Cliente' OR cl.tags ? 'Cliente Hinova'))
      ORDER BY coalesce(f.total, 0) DESC, a.razao_social`,
  );
  return rows.map((r) => ({
    accountId: String(r["account_id"]),
    razaoSocial: String(r["razao_social"] ?? ""),
    documento: String(r["documento"] ?? ""),
    tags: (r["tags"] as string[] | null) ?? [],
    cadastros: Number(r["cadastros"] ?? 0),
    faturamento12m: Number(r["faturamento12m"] ?? 0),
  }));
}
