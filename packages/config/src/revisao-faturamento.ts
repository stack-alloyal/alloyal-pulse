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
/**
 * EXPORTADO porque a inadimplência precisa do MESMO recorte.
 *
 * Não é conveniência: duplicar estas quinze linhas em `inadimplencia.ts` faria as
 * duas telas de Receita discordarem sobre quem é cliente no dia em que uma tag
 * nova aparecer no Omie — e discordarem em silêncio, porque ninguém abre as duas
 * lado a lado. O histórico deste recorte (duas versões erradas antes desta, ambas
 * jogando cliente real fora) é exatamente o argumento contra ter duas cópias.
 */
export const E_CLIENTE = (coluna: string) => `(
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

/**
 * O mês em que o faturamento PARA de contar: o corrente, inclusive.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O Omie EMITE título com vencimento à frente, e ele não é `previsao` — são    │
 * │ 61 títulos de 24.037, em 45 documentos, o mais distante em janeiro de 2027.  │
 * │                                                                            │
 * │ Sem este corte, `max(vencimento)` de um cliente devolvia dez/26 em agosto de │
 * │ 2026: a coluna "último mês" mostrava mês do FUTURO, e o "MRR do mês" era o   │
 * │ valor de um mês que ainda não aconteceu. Pior no outro sentido — um cliente  │
 * │ parado desde março com um título emitido para dezembro contava como ATIVO, e │
 * │ ficava fora da fila de quem parou. Era o defeito silencioso dos dois lados.  │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
const ATE_O_MES_CORRENTE =
  "t.vencimento < date_trunc('month', current_date) + interval '1 month'";


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
          AND ${ATE_O_MES_CORRENTE}
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

// ═══ 2. O reajuste: quem teve, quem não teve ═════════════════════════════════

/**
 * As janelas de comparação, e por que a MODA em vez da média.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A PRIMEIRA VERSÃO USAVA A MÉDIA DE DOIS MESES, E ERRAVA. O caso que expôs:   │
 * │ a SWILE fatura R$ 59.625 em janeiro, fevereiro, abril, maio, julho e agosto  │
 * │ — não teve reajuste nenhum. Mas março veio dobrado (R$ 117.617, cobrança     │
 * │ extra) e junho parcial (R$ 53.982). A média de jan+fev contra mai+jun deu    │
 * │ −4,7%, e a SWILE foi classificada como "caiu" em vez de "sem reajuste":      │
 * │ sumiu da fila justamente por um mês irregular.                              │
 * │                                                                            │
 * │ A MODA é imune a isso. O valor recorrente de um cliente é o que mais se      │
 * │ repete, não o que dá na média — um mês dobrado e um mês parcial não movem a  │
 * │ moda de cinco meses. Com ela a SWILE aparece com 0,00% de variação, que é o  │
 * │ fato.                                                                       │
 * │                                                                            │
 * │ O ganho foi geral, não só num caso: 178 clientes sem mudança contra 136 pela │
 * │ média, e 110 exatamente na taxa de 4,4% contra 96 — o sinal ficou mais       │
 * │ limpo dos dois lados.                                                       │
 * │                                                                            │
 * │ Cinco meses antes e quatro depois, com MARÇO FORA das duas: é o mês do       │
 * │ reajuste e carrega retroativo. Agosto também fica fora — hoje é dia 20, e o  │
 * │ mês em curso ainda não fechou.                                              │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export const JANELA_DO_REAJUSTE = {
  reajuste: "2026-03-01",
  antesDe: "2025-10-01",
  antesAte: "2026-03-01",
  depoisDe: "2026-04-01",
  depoisAte: "2026-08-01",
} as const;

/** Quanto de variação ainda conta como "não mudou": meio ponto percentual. */
export const TOLERANCIA = 0.005;

/**
 * As CTEs que produzem a moda mensal de cada lado da janela.
 *
 * `DISTINCT ON (documento) ... ORDER BY n DESC, v DESC` é a moda: agrupa por
 * valor, conta quantos meses repetem cada um, e fica com o mais frequente. O
 * empate desempata pelo MAIOR valor — entre dois valores que aparecem o mesmo
 * número de vezes, o recorrente é o maior; o menor costuma ser mês parcial.
 */
const CTE_MODA = `
  WITH mensal AS (
    SELECT t.documento, date_trunc('month', t.vencimento) m,
           sum(t.valor_centavos) v
      FROM core.omie_titulo t
      LEFT JOIN core.omie_categoria c ON c.codigo = t.categoria
     WHERE c.descricao = 'MRR' AND t.situacao <> 'previsao' AND t.valor_centavos > 0
       AND t.vencimento >= $1::date AND t.vencimento < $4::date
       AND ${E_CLIENTE('t.documento')}
     GROUP BY 1, 2
  ),
  antes AS (
    SELECT DISTINCT ON (documento) documento, v
      FROM (SELECT documento, v, count(*) n FROM mensal
             WHERE m < $2::date GROUP BY 1, 2) x
     ORDER BY documento, n DESC, v DESC
  ),
  depois AS (
    SELECT DISTINCT ON (documento) documento, v
      FROM (SELECT documento, v, count(*) n FROM mensal
             WHERE m >= $3::date GROUP BY 1, 2) x
     ORDER BY documento, n DESC, v DESC
  ),
  var AS (
    SELECT a.documento, a.v AS antes, d.v AS depois,
           (d.v::numeric / a.v - 1) AS delta
      FROM antes a JOIN depois d USING (documento)
  ),
  ctr AS (
    SELECT documento, min(vigencia_inicio) AS inicio
      FROM core.omie_contrato GROUP BY 1
  )`;

const PARAMS = [
  JANELA_DO_REAJUSTE.antesDe,
  JANELA_DO_REAJUSTE.antesAte,
  JANELA_DO_REAJUSTE.depoisDe,
  JANELA_DO_REAJUSTE.depoisAte,
];

/** O nome da conta e o id, a partir do documento do Omie. */
const IDENTIFICA = `
  LEFT JOIN core.vinculo_cliente vc ON vc.chave = v.documento AND vc.fonte = 'omie'
  LEFT JOIN core.account a ON a.id = vc.account_id
  LEFT JOIN core.omie_cliente oc ON oc.documento = v.documento`;

export interface ContaSemReajuste {
  readonly documento: string;
  readonly accountId: string | null;
  readonly razaoSocial: string;
  readonly mrrMensal: number;
  readonly contratoDesde: string | null;
  readonly aniversarios: number;
  readonly perdaMensal: number;
}

export interface ContaComReajuste {
  readonly documento: string;
  readonly accountId: string | null;
  readonly razaoSocial: string;
  /** A moda mensal ANTES de março, em centavos. */
  readonly mrrAntes: number;
  /** A moda mensal DEPOIS de março, em centavos. */
  readonly mrrDepois: number;
  readonly incremento: number;
  readonly pct: number;
  /**
   * Está exatamente na taxa de referência?
   *
   * Separa reajuste de MUDANÇA DE CONTRATO. Dos 141 que subiram, 110 estão em
   * 4,4% e somam R$ 8.116/mês de incremento; os outros 31 somam R$ 91.341 —
   * upsell, troca de plano, cobrança nova. Somar os dois numa linha só
   * atribuiria ao IPCA um aumento que veio de venda.
   */
  readonly naTaxa: boolean;
}

export interface RevisaoDoReajuste {
  readonly taxaPct: number;
  readonly clientesNaTaxa: number;
  readonly clientesQueSubiram: number;
  readonly clientesSemMudanca: number;
  readonly clientesQueCairam: number;
  readonly semReajusteVencidos: ContaSemReajuste[];
  readonly semReajusteNaoDevidos: number;
  readonly perdaMensal: number;
  readonly mesesDesdeOReajuste: number;
  readonly perdaAcumulada: number;
  readonly hipotese: {
    readonly clientes: number;
    readonly mrrMensal: number;
    readonly ganhoMensal: number;
    readonly ganhoAcumulado: number;
    readonly ganhoMensalA4: number;
    readonly ganhoAcumuladoA4: number;
  };
  /** Quem TEVE o reajuste, com o antes, o depois e o incremento. */
  readonly comReajuste: ContaComReajuste[];
  readonly totalNaTaxa: { mrrAntes: number; incremento: number; clientes: number };
  readonly totalFora: { incremento: number; clientes: number };
}

export async function revisaoDoReajuste(db: pg.Pool): Promise<RevisaoDoReajuste> {
  const j = JANELA_DO_REAJUSTE;

  const { rows: contagem } = await db.query<Record<string, string>>(
    `${CTE_MODA}
     SELECT (SELECT round(delta * 100, 1) FROM var WHERE delta > $5::numeric
              GROUP BY 1 ORDER BY count(*) DESC, 1 DESC LIMIT 1)::text AS taxa,
            (SELECT count(*) FROM var WHERE delta > $5::numeric)::text      AS subiram,
            (SELECT count(*) FROM var WHERE abs(delta) <= $5::numeric)::text AS iguais,
            (SELECT count(*) FROM var WHERE delta < -$5::numeric)::text     AS cairam,
            (SELECT coalesce(sum(antes), 0) FROM var
              WHERE abs(delta) <= $5::numeric)::text                        AS mrr_iguais`,
    [...PARAMS, TOLERANCIA],
  );
  const taxaPct = Number(contagem[0]?.["taxa"] ?? 0);

  const { rows: fila } = await db.query<Record<string, string>>(
    `${CTE_MODA}
     SELECT DISTINCT ON (v.documento)
            v.documento, v.antes::text AS mrr,
            to_char(c.inicio, 'YYYY-MM-DD') AS desde,
            (extract(year FROM age($6::date, c.inicio)))::text AS aniversarios,
            vc.account_id::text AS account_id,
            coalesce(a.razao_social, oc.razao_social, v.documento) AS nome
       FROM var v
       LEFT JOIN ctr c ON c.documento = v.documento
       ${IDENTIFICA}
      WHERE abs(v.delta) <= $5::numeric
        AND c.inicio IS NOT NULL
        AND c.inicio <= ($6::date - interval '12 months')
      ORDER BY v.documento, v.antes DESC`,
    [...PARAMS, TOLERANCIA, j.reajuste],
  );

  const { rows: naoDevidos } = await db.query<{ n: string }>(
    `${CTE_MODA}
     SELECT count(*)::text AS n
       FROM var v LEFT JOIN ctr c ON c.documento = v.documento
      WHERE abs(v.delta) <= $5::numeric
        AND (c.inicio IS NULL OR c.inicio > ($6::date - interval '12 months'))`,
    [...PARAMS, TOLERANCIA, j.reajuste],
  );

  const { rows: subiu } = await db.query<Record<string, string>>(
    `${CTE_MODA}
     SELECT DISTINCT ON (v.documento)
            v.documento, v.antes::text, v.depois::text,
            round(v.delta * 100, 1)::text AS pct,
            vc.account_id::text AS account_id,
            coalesce(a.razao_social, oc.razao_social, v.documento) AS nome
       FROM var v
       ${IDENTIFICA}
      WHERE v.delta > $5::numeric
      ORDER BY v.documento, v.depois DESC`,
    [...PARAMS, TOLERANCIA],
  );

  const semReajusteVencidos: ContaSemReajuste[] = fila.map((r) => {
    const mrr = Number(r["mrr"]);
    return {
      documento: String(r["documento"]),
      accountId: (r["account_id"] as string | null) ?? null,
      razaoSocial: String(r["nome"] ?? ""),
      mrrMensal: mrr,
      contratoDesde: (r["desde"] as string | null) ?? null,
      aniversarios: Number(r["aniversarios"] ?? 0),
      perdaMensal: Math.round((mrr * taxaPct) / 100),
    };
  });
  semReajusteVencidos.sort((x, y) => y.perdaMensal - x.perdaMensal);

  const comReajuste: ContaComReajuste[] = subiu
    .map((r) => {
      const antes = Number(r["antes"]);
      const depois = Number(r["depois"]);
      const pct = Number(r["pct"]);
      return {
        documento: String(r["documento"]),
        accountId: (r["account_id"] as string | null) ?? null,
        razaoSocial: String(r["nome"] ?? ""),
        mrrAntes: antes,
        mrrDepois: depois,
        incremento: depois - antes,
        pct,
        naTaxa: Math.abs(pct - taxaPct) < 0.05,
      };
    })
    .sort((x, y) => y.incremento - x.incremento);

  const naTaxa = comReajuste.filter((c) => c.naTaxa);
  const fora = comReajuste.filter((c) => !c.naTaxa);

  const perdaMensal = semReajusteVencidos.reduce((s, c) => s + c.perdaMensal, 0);
  const meses = mesesDesde(j.reajuste, new Date());
  const mrrParado = Number(contagem[0]?.["mrr_iguais"] ?? 0);
  const ganhoMensal = Math.round((mrrParado * taxaPct) / 100);
  const ganhoMensalA4 = Math.round(mrrParado * 0.04);

  return {
    taxaPct,
    clientesNaTaxa: naTaxa.length,
    clientesQueSubiram: Number(contagem[0]?.["subiram"] ?? 0),
    clientesSemMudanca: Number(contagem[0]?.["iguais"] ?? 0),
    clientesQueCairam: Number(contagem[0]?.["cairam"] ?? 0),
    semReajusteVencidos,
    semReajusteNaoDevidos: Number(naoDevidos[0]?.n ?? 0),
    perdaMensal,
    mesesDesdeOReajuste: meses,
    perdaAcumulada: perdaMensal * meses,
    hipotese: {
      clientes: Number(contagem[0]?.["iguais"] ?? 0),
      mrrMensal: mrrParado,
      ganhoMensal,
      ganhoAcumulado: ganhoMensal * meses,
      ganhoMensalA4,
      ganhoAcumuladoA4: ganhoMensalA4 * meses,
    },
    comReajuste,
    totalNaTaxa: {
      clientes: naTaxa.length,
      mrrAntes: naTaxa.reduce((s, c) => s + c.mrrAntes, 0),
      incremento: naTaxa.reduce((s, c) => s + c.incremento, 0),
    },
    totalFora: {
      clientes: fora.length,
      incremento: fora.reduce((s, c) => s + c.incremento, 0),
    },
  };
}

/**
 * Quantos meses FECHADOS desde o mês do reajuste.
 *
 * Fechados, e não corridos: em 20/08 o mês de agosto ainda está sendo faturado,
 * e contá-lo inflaria a perda acumulada com um mês que não terminou. Exportada
 * para ter teste — é conta de calendário, e elas erram na virada do ano.
 */
export function mesesDesde(mesInicial: string, agora: Date): number {
  const [a, m] = mesInicial.split("-").map(Number);
  if (!a || !m) return 0;
  const meses = (agora.getUTCFullYear() - a) * 12 + (agora.getUTCMonth() + 1 - m);
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
  /**
   * O afiliado a que a conta pertence, quando o nome traz um entre parênteses.
   *
   * ┌─────────────────────────────────────────────────────────────────────────┐
   * │ "Loma Proteção Veicular (Hinova Mobile)" não tem faturamento nosso porque │
   * │ quem fatura é o AFILIADO — a conta existe, o clube roda, e a cobrança sai  │
   * │ pelo parceiro. Sem separar isso, a fila de 515 contas "sem vínculo" mistura │
   * │ duas coisas com ações opostas: 410 que estão certas assim e 105 que são a  │
   * │ pergunta de verdade.                                                     │
   * │                                                                          │
   * │ O nome do afiliado vem do parêntese porque é onde ele está — não existe    │
   * │ campo de afiliado no core. É convenção de nomenclatura lida como dado, e a │
   * │ tela diz isso: se alguém cadastrar "(matriz)" ou "(teste)", vai aparecer   │
   * │ aqui como afiliado, e é melhor aparecer do que ser silenciosamente         │
   * │ agrupado em outro lugar.                                                  │
   * │                                                                          │
   * │ Guardado em MAIÚSCULA para agrupar: a base tem "Hinova", "HINOVA",         │
   * │ "Playhub" e "PLAYHUB". `afiliadoExibido` preserva a grafia original.       │
   * └─────────────────────────────────────────────────────────────────────────┘
   */
  readonly afiliado: string | null;
  readonly afiliadoExibido: string | null;
}

export async function contasSemVinculoComOmie(
  db: pg.Pool,
  { somenteAtivas = true }: { somenteAtivas?: boolean } = {},
): Promise<ContaSemVinculo[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT a.id::text AS account_id, a.razao_social, a.cnpj, a.brand_id,
            h.hubspot_company_id, a.status_core,
            coalesce(a.usuarios_cadastrados, 0)::text AS usuarios_cadastrados,
            (oc.documento IS NOT NULL) AS tem_candidato,
            -- O ÚLTIMO parêntese, e não o primeiro: "MAIS CHECK-IN (Trul Hoteis)"
            -- e "Sócio Lance (Painel Principal) (Hinova Mobile)" — o afiliado vem
            -- por último quando há dois.
            nullif(trim(substring(a.razao_social from '\\(([^()]+)\\)[^()]*$')), '') AS afiliado
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
      afiliado: r["afiliado"] ? String(r["afiliado"]).toUpperCase() : null,
      afiliadoExibido: (r["afiliado"] as string | null) ?? null,
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

// ═══ 5. Os clientes ativos que estão faturando ═══════════════════════════════

export interface ContaAtiva {
  readonly accountId: string;
  readonly razaoSocial: string;
  readonly cnpj: string | null;
  readonly brandId: string | null;
  /** `2026-08` do último mês faturado. */
  readonly ultimoMes: string;
  /** O que faturou nesse último mês, em centavos. */
  readonly mrrMes: number;
  /** Os últimos 12 meses somados, em centavos. */
  readonly faturamento12m: number;
  /** Em quantos meses distintos já faturou — a idade da relação. */
  readonly meses: number;
  readonly usuariosCadastrados: number;
}

/**
 * Quem está ativo no painel E faturando — a contraparte das outras quatro listas.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ EXISTE PARA FECHAR A CONTA. Sem ela a tela só mostrava problema, e não dava │
 * │ para saber se 183 paradas é muito ou pouco: das 1.043 contas ativas no      │
 * │ painel, esta lista é a parte sadia. Com as cinco visões, a soma dá o todo e  │
 * │ cada número passa a ter denominador.                                       │
 * │                                                                            │
 * │ "Faturando" é o complemento exato de `contasQuePararamDeFaturar`: mesmo      │
 * │ recorte de cliente, mesma carência. Uma conta não pode aparecer nas duas.    │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export async function contasAtivasFaturando(db: pg.Pool): Promise<ContaAtiva[]> {
  const { rows } = await db.query<Record<string, string>>(
    `WITH fat AS (
       SELECT v.account_id,
              max(date_trunc('month', t.vencimento))               AS ultimo,
              count(DISTINCT date_trunc('month', t.vencimento))    AS meses,
              sum(t.valor_centavos) FILTER (
                WHERE t.vencimento >= date_trunc('month', current_date) - interval '11 months'
              )                                                    AS doze
         FROM core.vinculo_cliente v
         JOIN core.omie_titulo t ON t.documento = v.chave
        WHERE v.fonte = 'omie' AND t.situacao <> 'previsao' AND t.valor_centavos > 0
          AND ${ATE_O_MES_CORRENTE}
          AND ${E_CLIENTE('v.chave')}
        GROUP BY 1
     ),
     ultimo_mes AS (
       SELECT v.account_id, sum(t.valor_centavos) AS valor
         FROM core.vinculo_cliente v
         JOIN core.omie_titulo t ON t.documento = v.chave
         JOIN fat f ON f.account_id = v.account_id
        WHERE v.fonte = 'omie' AND t.situacao <> 'previsao' AND t.valor_centavos > 0
          AND date_trunc('month', t.vencimento) = f.ultimo
          AND ${ATE_O_MES_CORRENTE}
        GROUP BY 1
     )
     SELECT a.id::text AS account_id, a.razao_social, a.cnpj, a.brand_id,
            to_char(f.ultimo, 'YYYY-MM')        AS ultimo_mes,
            coalesce(u.valor, 0)::text          AS mrr_mes,
            coalesce(f.doze, 0)::text           AS faturamento12m,
            f.meses::text                       AS meses,
            coalesce(a.usuarios_cadastrados, 0)::text AS usuarios_cadastrados
       FROM core.account a
       JOIN fat f ON f.account_id = a.id
       LEFT JOIN ultimo_mes u ON u.account_id = a.id
      WHERE a.parent_account_id IS NULL
        AND a.status_core = 'active'
        -- O complemento EXATO de quem parou: mesma carência, sinal invertido.
        AND f.ultimo >= date_trunc('month', current_date) - ($1::int || ' months')::interval
      ORDER BY coalesce(u.valor, 0) DESC, a.razao_social`,
    [MESES_DE_CARENCIA],
  );
  return rows.map((r) => ({
    accountId: String(r["account_id"]),
    razaoSocial: String(r["razao_social"] ?? ""),
    cnpj: (r["cnpj"] as string | null) ?? null,
    brandId: (r["brand_id"] as string | null) ?? null,
    ultimoMes: String(r["ultimo_mes"]),
    mrrMes: Number(r["mrr_mes"]),
    faturamento12m: Number(r["faturamento12m"]),
    meses: Number(r["meses"]),
    usuariosCadastrados: Number(r["usuarios_cadastrados"]),
  }));
}
