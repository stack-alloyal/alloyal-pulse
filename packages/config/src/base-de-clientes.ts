/**
 * A base de clientes vinda do core: main business, sub business e os números da carteira.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A HIERARQUIA JÁ VEM DO CORE e não é inferida aqui: `main_business_id` nulo   │
 * │ é main business; preenchido é sub business, e aponta para o pai. Na base de   │
 * │ 05/08/2026 são 1.926 main, 1.246 sub, e só 221 main têm filho — ou seja, a    │
 * │ maioria esmagadora é conta simples, e a seta de abrir só aparece onde há o    │
 * │ que abrir.                                                                  │
 * │                                                                            │
 * │ SOMAR PAI E FILHO NÃO DUPLICA. Conferido no dado antes de escrever o KPI:     │
 * │ "Ubiz Car (Principal)" tem 4 usuários cadastrados e os 73 filhos somam 89.    │
 * │ Se o pai já contivesse os filhos, o total da carteira sairia dobrado — é o    │
 * │ tipo de erro que ninguém percebe porque o número continua "parecendo certo".  │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

import type pg from "pg";

export interface KpisDaCarteira {
  readonly clientesTotal: number;
  readonly clientesAtivos: number;
  readonly mainBusinesses: number;
  readonly subBusinesses: number;
  /**
   * `authorized_user_count` do core: a base ELEGÍVEL, quem tem direito de se cadastrar.
   * Não é "usuário ativo" — e chamar de ativo faria a régua de engajamento parecer
   * muito melhor do que é.
   */
  readonly usuariosAutorizados: number;
  /** `user_count` do core: quem efetivamente criou cadastro. */
  readonly usuariosCadastrados: number;
  /**
   * `null` porque o dado NÃO EXISTE ainda, e zero mentiria dizendo "ninguém usou".
   * Vem das transações da réplica (ciclo C1), que depende do segredo `replica.url`.
   */
  readonly usuariosComCupom: number | null;
  readonly cuponsResgatados: number | null;
  /** Quantos clientes já têm logo — a varredura do C19 cobre ~900 por noite. */
  readonly comLogo: number;
}

export async function kpisDaCarteira(db: pg.Pool): Promise<KpisDaCarteira> {
  const { rows } = await db.query<{
    total: string;
    ativos: string;
    mains: string;
    subs: string;
    autorizados: string;
    cadastrados: string;
    com_logo: string;
  }>(
    `SELECT count(*)::text                                             AS total,
            count(*) FILTER (WHERE ativo)::text                        AS ativos,
            count(*) FILTER (WHERE parent_account_id IS NULL)::text     AS mains,
            count(*) FILTER (WHERE parent_account_id IS NOT NULL)::text AS subs,
            coalesce(sum(usuarios_autorizados), 0)::text                AS autorizados,
            coalesce(sum(usuarios_cadastrados), 0)::text                AS cadastrados,
            count(*) FILTER (WHERE logo_url IS NOT NULL)::text          AS com_logo
       FROM core.account`,
  );
  const r = rows[0]!;
  return {
    clientesTotal: Number(r.total),
    clientesAtivos: Number(r.ativos),
    mainBusinesses: Number(r.mains),
    subBusinesses: Number(r.subs),
    usuariosAutorizados: Number(r.autorizados),
    usuariosCadastrados: Number(r.cadastrados),
    // Ver o comentário do tipo: `null` é a resposta honesta enquanto o C1 não roda.
    usuariosComCupom: null,
    cuponsResgatados: null,
    comLogo: Number(r.com_logo),
  };
}

export interface LinhaDaBase {
  readonly id: string;
  readonly brandId: string | null;
  readonly hubspotCompanyId: string | null;
  readonly hubspotVinculo: string | null;
  readonly razaoSocial: string;
  readonly cnpj: string | null;
  readonly ativo: boolean;
  /** URL do logo em `assets.alloyal.com.br`, de "Customização do App" no core. */
  readonly logoUrl: string | null;
  /** De qual campo veio — a resposta para "por que este logo está deitado?". */
  readonly logoOrigem: string | null;
  readonly usuariosAutorizados: number;
  readonly usuariosCadastrados: number;
  /**
   * LTV: tudo que este cliente já pagou, em centavos.
   *
   * É o RECEBIDO e não o faturado — "quanto este cliente já nos deu" não conta
   * boleto que não entrou. Cancelado e a vencer ficam de fora por construção.
   */
  readonly ltvCentavos: number;
  /**
   * Em quantos meses. É a vida do cliente, do primeiro ao último vencimento.
   *
   * Vai junto do LTV e nunca sozinho: R$ 500 mil em 60 meses e R$ 500 mil em 6
   * são clientes diferentes, e o número sem o prazo esconde justamente isso.
   */
  readonly ltvMeses: number;
  /**
   * O último mês que teve faturamento, em centavos — o "quanto rende hoje".
   *
   * ┌─────────────────────────────────────────────────────────────────────────┐
   * │ É O ÚLTIMO MÊS COM MOVIMENTO, não o mês corrente.                        │
   * │                                                                          │
   * │ Fixar no mês corrente mostraria R$ 0 para todo cliente que vence no dia   │
   * │ 20 sempre que a tela fosse aberta antes do dia 20 — e zero se lê como     │
   * │ "parou de pagar", que é o oposto de "ainda não venceu". O rótulo do mês   │
   * │ vai junto (`mrrMesRotulo`) justamente para que a diferença entre "agosto  │
   * │ ainda não" e "não fatura desde março" apareça na própria célula.          │
   * │                                                                          │
   * │ Eixo: FATURADO por vencimento, o mesmo de `faturamento12m` — e diferente  │
   * │ do `ltvCentavos`, que é recebido. São duas perguntas: "quanto ele nos     │
   * │ deu" e "quanto ele cobra por mês".                                        │
   * └─────────────────────────────────────────────────────────────────────────┘
   */
  readonly mrrMesCentavos: number;
  /** `2026-07` do mês de `mrrMesCentavos`. `null` quando nunca houve. */
  readonly mrrMesRotulo: string | null;
  /**
   * Os últimos 12 meses de faturamento, do mais antigo para o mais recente.
   *
   * Cada posição é o valor faturado naquele mês, em centavos — zero quando não
   * houve. Vem junto da linha porque a pergunta "este cliente ainda fatura?" é a
   * primeira que se faz olhando a base, e hoje ela exigia abrir a ficha.
   *
   * Doze e não vinte e quatro: numa célula de tabela, vinte e quatro barras viram
   * ruído cinza. Doze cabe e ainda deixa ver o ritmo — mensal, trimestral, parado.
   */
  readonly faturamento12m: readonly number[];
  /** Quantos sub business pendem deste. Zero significa "não há o que abrir". */
  readonly subs: number;
  /** Soma dos filhos, para o main mostrar o tamanho do grupo sem abrir. */
  readonly subsUsuariosCadastrados: number;
}

export interface PaginaDaBase {
  readonly linhas: LinhaDaBase[];
  readonly total: number;
  readonly pagina: number;
  readonly porPagina: number;
}

const CAMPOS = `
  a.id::text, a.brand_id, a.razao_social, a.cnpj, a.ativo, a.logo_url, a.logo_origem,
  coalesce(a.usuarios_autorizados, 0)::text AS usuarios_autorizados,
  coalesce(a.usuarios_cadastrados, 0)::text AS usuarios_cadastrados,
  h.hubspot_company_id, h.vinculo AS hubspot_vinculo`;

function paraLinha(r: Record<string, unknown>): LinhaDaBase {
  return {
    id: String(r["id"]),
    // `null` vira doze zeros: a célula desenha sempre a mesma grade, e "sem
    // faturamento" fica visível como doze barras vazias em vez de espaço branco,
    // que se lê como coluna que não carregou.
    ltvCentavos: 0,
    ltvMeses: 0,
    mrrMesCentavos: 0,
    mrrMesRotulo: null,
    faturamento12m: Array.isArray(r["faturamento12m"])
      ? (r["faturamento12m"] as unknown[]).map((v) => Number(v ?? 0))
      : Array.from({ length: 12 }, () => 0),
    brandId: (r["brand_id"] as string | null) ?? null,
    hubspotCompanyId: (r["hubspot_company_id"] as string | null) ?? null,
    hubspotVinculo: (r["hubspot_vinculo"] as string | null) ?? null,
    razaoSocial: String(r["razao_social"] ?? ""),
    cnpj: (r["cnpj"] as string | null) ?? null,
    ativo: r["ativo"] === true,
    logoUrl: (r["logo_url"] as string | null) ?? null,
    logoOrigem: (r["logo_origem"] as string | null) ?? null,
    usuariosAutorizados: Number(r["usuarios_autorizados"] ?? 0),
    usuariosCadastrados: Number(r["usuarios_cadastrados"] ?? 0),
    subs: Number(r["subs"] ?? 0),
    subsUsuariosCadastrados: Number(r["subs_cadastrados"] ?? 0),
  };
}

/**
 * Os MAIN business, paginados.
 *
 * A busca cobre nome, CNPJ e os dois ids — é por um deles que a pessoa chega, e obrigar
 * a saber qual campo procurar transforma consulta em adivinhação. O CNPJ é comparado sem
 * pontuação nos dois lados, senão "26.989.697" não encontra "26989697".
 */
export async function mainBusinesses(
  db: pg.Pool,
  opcoes: {
    busca?: string;
    pagina?: number;
    /**
     * Quantas por página. **`0` significa TODAS** — vira `LIMIT NULL`, que no
     * Postgres é o mesmo que `LIMIT ALL`.
     *
     * Existe porque exportar mentalmente uma base de 1.959 linhas de 50 em 50 são
     * 40 idas e voltas. O teto de 200 continua valendo para os valores explícitos:
     * ele protege de `?pp=99999` na barra de endereço, e "todas" é uma escolha
     * declarada, não um número grande digitado por engano.
     */
    porPagina?: number;
    somenteAtivos?: boolean;
    /** Como organizar. `usuarios` é o padrão — ver o comentário do ORDER BY. */
    ordem?: "usuarios" | "autorizados" | "ltv" | "meses" | "mrr" | "nome";
  } = {},
): Promise<PaginaDaBase> {
  const todas = opcoes.porPagina === 0;
  const porPagina = todas ? 0 : Math.min(Math.max(opcoes.porPagina ?? 50, 1), 200);
  const pagina = todas ? 1 : Math.max(opcoes.pagina ?? 1, 1);
  const busca = (opcoes.busca ?? "").trim();
  const somenteAtivos = opcoes.somenteAtivos === true;
  const ordem = opcoes.ordem ?? "usuarios";

  // $1 = busca, $2 = somenteAtivos. Limite e deslocamento entram DEPOIS, só na
  // consulta paginada — na contagem eles não existem, e parâmetro declarado e não usado
  // faz o Postgres recusar com "could not determine data type of parameter".
  const filtro = `
    a.parent_account_id IS NULL
    AND ($2::boolean IS NOT TRUE OR a.ativo)
    AND ($1::text = '' OR
         a.razao_social ILIKE '%' || $1 || '%' OR
         a.brand_id = $1 OR
         h.hubspot_company_id = $1 OR
         -- ┌───────────────────────────────────────────────────────────────────┐
         -- │ A cláusula de CNPJ EXIGE pelo menos 6 dígitos, e os dois guardas    │
         -- │ vieram de defeito medido:                                          │
         -- │                                                                    │
         -- │ sem o "não vazio", buscar "SWILE" limpava os dígitos para '' e o     │
         -- │ LIKE virava '%%' — casava com TODAS as 1.926 contas, e a busca por   │
         -- │ nome simplesmente não filtrava;                                     │
         -- │                                                                    │
         -- │ sem o mínimo de 6, buscar "912" (um Business ID) trazia junto todo   │
         -- │ CNPJ que contivesse 912 em qualquer posição — 10 resultados para uma │
         -- │ busca exata.                                                       │
         -- └───────────────────────────────────────────────────────────────────┘
         (length(regexp_replace($1, '\\D', '', 'g')) >= 6 AND
          regexp_replace(coalesce(a.cnpj, ''), '\\D', '', 'g')
            LIKE '%' || regexp_replace($1, '\\D', '', 'g') || '%'))`;

  const { rows: cont } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM core.account a
       LEFT JOIN core.account_hubspot h ON h.account_id = a.id
      WHERE ${filtro}`,
    [busca, somenteAtivos],
  );

  const ORDENS: Record<string, string> = {
    // Maior primeiro: numa lista de 1.959 clientes, ordem alfabética põe na primeira
    // página quem tem 0 usuário e empurra o maior contrato para a página 30.
    usuarios: "(coalesce(a.usuarios_cadastrados, 0) + coalesce(f.cad, 0)) DESC, a.razao_social ASC",
    // Autorizados é o TETO do contrato; cadastrados é a adesão. Ordenar pelos dois
    // separadamente é o que deixa ver a diferença entre "cliente grande" e
    // "cliente que aderiu" — pela ordem de cadastrados as duas se confundem.
    autorizados: "coalesce(a.usuarios_autorizados, 0) DESC, a.razao_social ASC",
    ltv: "coalesce(l.pago, 0) DESC, a.razao_social ASC",
    // Meses é IDADE. É a única ordem que responde "quem está com a gente há mais
    // tempo" — o total responde "quem é grande", que costuma dar outra lista.
    meses: "coalesce(l.meses, 0) DESC, a.razao_social ASC",
    // MRR do mês é o PRESENTE: quem fatura mais hoje, não quem já faturou muito.
    // A diferença aparece no cliente antigo que encolheu — alto no total, baixo aqui.
    mrr: "coalesce(r.total, 0) DESC, a.razao_social ASC",
    nome: "a.razao_social ASC",
  };

  const { rows } = await db.query(
    `WITH ltv AS (
       SELECT v.account_id,
              sum(t.pago_centavos) pago,
              count(DISTINCT date_trunc('month', t.vencimento)) meses
         FROM core.vinculo_cliente v
         JOIN core.omie_titulo t ON t.documento = v.chave
        WHERE v.fonte = 'omie' AND t.situacao <> 'previsao'
        GROUP BY 1
     ),
     -- ┌────────────────────────────────────────────────────────────────────┐
     -- │ O ÚLTIMO MÊS COM MOVIMENTO, em SQL, para poder ORDENAR por ele.     │
     -- │                                                                     │
     -- │ É a MESMA regra que ultimoMesComMovimento aplica sobre a página já  │
     -- │ montada, e é a mesma de propósito: se a ordem usasse o mês corrente │
     -- │ e a coluna mostrasse o último com movimento, a lista viria          │
     -- │ ordenada por um número que não está escrito em lugar nenhum.        │
     -- │                                                                     │
     -- │ O HAVING é o que faz "com movimento" significar algo: sem ele um    │
     -- │ mês cujos títulos se anulam (cobrança + estorno) seria o último e   │
     -- │ devolveria zero, jogando o cliente para o fim da lista.             │
     -- └────────────────────────────────────────────────────────────────────┘
     mes AS (
       SELECT v.account_id, date_trunc('month', t.vencimento) m,
              sum(t.valor_centavos) total
         FROM core.vinculo_cliente v
         JOIN core.omie_titulo t ON t.documento = v.chave
        WHERE v.fonte = 'omie' AND t.situacao <> 'previsao'
          AND t.vencimento >= date_trunc('month', current_date) - interval '11 months'
          AND t.vencimento <  date_trunc('month', current_date) + interval '1 month'
        GROUP BY 1, 2
       HAVING sum(t.valor_centavos) <> 0
     ),
     mrr AS (
       SELECT DISTINCT ON (account_id) account_id, total
         FROM mes ORDER BY account_id, m DESC
     )
     SELECT ${CAMPOS},
            coalesce(f.n, 0)::text   AS subs,
            coalesce(f.cad, 0)::text AS subs_cadastrados
       FROM core.account a
       LEFT JOIN core.account_hubspot h ON h.account_id = a.id
       LEFT JOIN LATERAL (
         SELECT count(*) AS n, coalesce(sum(coalesce(s.usuarios_cadastrados, 0)), 0) AS cad
           FROM core.account s WHERE s.parent_account_id = a.id
       ) f ON true
       LEFT JOIN ltv l ON l.account_id = a.id
       LEFT JOIN mrr r ON r.account_id = a.id
      WHERE ${filtro}
      ORDER BY ${ORDENS[ordem] ?? ORDENS["usuarios"]}
      -- LIMIT NULL é "sem limite" no Postgres, e é assim que "todas" chega aqui:
      -- sem ramo de SQL alternativo, sem concatenação de número na consulta.
      LIMIT $3::bigint OFFSET $4::bigint`,
    [busca, somenteAtivos, todas ? null : porPagina, todas ? 0 : (pagina - 1) * porPagina],
  );

  const linhas = await preencherFaturamento(
    db,
    rows.map((r) => paraLinha(r as Record<string, unknown>)),
  );

  const total = Number(cont[0]?.n ?? 0);
  return {
    linhas,
    total,
    pagina,
    // Em "todas" a página É o total: quem lê `porPagina` para calcular quantas
    // páginas existem chega a 1, que é a verdade da tela.
    porPagina: todas ? Math.max(total, 1) : porPagina,
  };
}

/**
 * Preenche os 12 meses de faturamento das linhas da página, numa consulta só.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ERA UM `LATERAL` DENTRO DA CONSULTA PRINCIPAL, e custava 1.126 ms: ele roda │
 * │ uma vez POR LINHA, e cada execução varre doze meses de títulos. Numa página │
 * │ de 50, são 600 subconsultas para desenhar 600 barrinhas.                    │
 * │                                                                            │
 * │ Aqui é uma passada só, com os ids da página: agrupa por conta e por mês de  │
 * │ uma vez. O custo deixa de crescer com o tamanho da página.                  │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
async function preencherFaturamento(
  db: pg.Pool,
  linhas: LinhaDaBase[],
): Promise<LinhaDaBase[]> {
  if (linhas.length === 0) return linhas;
  const ids = linhas.map((l) => l.id);
  const [serie, ltv] = await Promise.all([
    db.query<{ account_id: string; mes: string; total: string }>(
      `SELECT v.account_id::text,
              to_char(date_trunc('month', t.vencimento), 'YYYY-MM') mes,
              sum(t.valor_centavos)::text total
         FROM core.vinculo_cliente v
         JOIN core.omie_titulo t ON t.documento = v.chave
        WHERE v.account_id = ANY($1::uuid[]) AND v.fonte = 'omie'
          AND t.situacao <> 'previsao'
          AND t.vencimento >= date_trunc('month', current_date) - interval '11 months'
          AND t.vencimento < date_trunc('month', current_date) + interval '1 month'
        GROUP BY 1, 2`,
      [ids],
    ),
    // O LTV é sobre TODA a história, não sobre a janela de doze meses.
    db.query<{ account_id: string; pago: string; meses: string }>(
      `SELECT v.account_id::text,
              coalesce(sum(t.pago_centavos), 0)::text pago,
              (count(DISTINCT date_trunc('month', t.vencimento)))::text meses
         FROM core.vinculo_cliente v
         JOIN core.omie_titulo t ON t.documento = v.chave
        WHERE v.account_id = ANY($1::uuid[]) AND v.fonte = 'omie'
          AND t.situacao <> 'previsao'
        GROUP BY 1`,
      [ids],
    ),
  ]);
  const rows = serie.rows;
  const porLtv = new Map(ltv.rows.map((r) => [r.account_id, r]));

  // Os doze rótulos de mês, do mais antigo ao atual. Montados aqui e não no SQL
  // porque a linha precisa das doze posições mesmo quando a conta não tem nenhuma.
  const hoje = new Date();
  const meses: string[] = [];
  for (let k = 11; k >= 0; k--) {
    const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - k, 1));
    meses.push(d.toISOString().slice(0, 7));
  }

  const porConta = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const m = porConta.get(r.account_id) ?? new Map<string, number>();
    m.set(r.mes, Number(r.total));
    porConta.set(r.account_id, m);
  }
  // Devolve linhas NOVAS em vez de mutar: `LinhaDaBase` é `readonly`, e o molde
  // existe para que ninguém escreva nela por engano mais adiante.
  return linhas.map((l) => {
    const m = porConta.get(l.id);
    const v = porLtv.get(l.id);
    const serie12 = meses.map((x) => m?.get(x) ?? 0);
    const ultimo = ultimoMesComMovimento(serie12, meses);
    return {
      ...l,
      ltvCentavos: Number(v?.pago ?? 0),
      ltvMeses: Number(v?.meses ?? 0),
      mrrMesCentavos: ultimo.centavos,
      mrrMesRotulo: ultimo.rotulo,
      faturamento12m: serie12,
    };
  });
}

/**
 * O último mês da série que teve valor, varrendo de trás para frente.
 *
 * Exportada para ter teste: é uma varredura de três linhas, e as três formas de
 * errar são silenciosas — pegar o mês corrente (zerado até o vencimento), parar
 * no primeiro zero em vez do último valor, ou devolver o mês 0 quando a série é
 * toda zero. Nenhuma delas quebra a tela; todas mentem sobre o cliente.
 */
export function ultimoMesComMovimento(
  serie: readonly number[],
  meses: readonly string[],
): { centavos: number; rotulo: string | null } {
  let i = serie.length - 1;
  while (i >= 0 && (serie[i] ?? 0) === 0) i--;
  if (i < 0) return { centavos: 0, rotulo: null };
  return { centavos: serie[i] ?? 0, rotulo: meses[i] ?? null };
}

/** Os sub business de UM main. Usado quando a linha é aberta. */
export async function subBusinesses(
  db: pg.Pool,
  mainId: string,
): Promise<LinhaDaBase[]> {
  /* Sem mapa de ordem e sem CTE: a lista de filhos de UM main tem dezenas de
     linhas, não milhares, e a ordem por cadastrados responde sozinha. Havia aqui
     um `ORDENS` completo e uma CTE de LTV — os dois mortos, nunca referenciados
     pela consulta, e crescendo junto a cada ordem nova que eu acrescentava. */
  const { rows } = await db.query(
    `SELECT ${CAMPOS}, 0 AS subs, 0 AS subs_cadastrados
       FROM core.account a
       LEFT JOIN core.account_hubspot h ON h.account_id = a.id
      WHERE a.parent_account_id = $1::uuid
      ORDER BY coalesce(a.usuarios_cadastrados, 0) DESC, a.razao_social ASC`,
    [mainId],
  );
  return rows.map((r) => paraLinha(r as Record<string, unknown>));
}

/**
 * As iniciais que viram a marca do cliente na lista.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ NÃO HÁ LOGO NA API DO CORE. Conferido nos 49 campos que `/businesses`        │
 * │ devolve: `banner` existe e é BOOLEANO — é flag de módulo, não imagem. Buscar  │
 * │ logo por domínio num serviço de favicon foi descartado por duas razões: a CSP │
 * │ da aplicação bloqueia imagem de terceiro, e o resultado seria o logo de quem  │
 * │ tem o domínio parecido — errado com cara de certo.                          │
 * │                                                                            │
 * │ Monograma é honesto: identifica sem afirmar nada que não sabemos.           │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export function iniciaisDoCliente(razaoSocial: string): string {
  const limpo = razaoSocial
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim();
  const partes = limpo
    .split(/\s+/)
    .filter((p) => p.length > 1 && !/^(de|da|do|e|ltda|me|sa)$/i.test(p));
  const escolhidas =
    partes.length > 0 ? partes : limpo.split(/\s+/).filter(Boolean);
  const letras = escolhidas.slice(0, 2).map((p) => p[0]!.toUpperCase());
  return letras.join("") || "?";
}

/**
 * A cor do monograma, derivada do id — estável entre cargas e entre telas.
 *
 * Determinística de propósito: cor sorteada faria o mesmo cliente mudar de cor a cada
 * render, e a pessoa perde a referência visual que a cor existe para dar.
 */
export function corDoCliente(chave: string): number {
  let h = 0;
  for (let i = 0; i < chave.length; i++)
    h = (h * 31 + chave.charCodeAt(i)) % 360;
  return h;
}
