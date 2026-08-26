import type { Identidade } from '@pulse/auth'
import type pg from 'pg'

/**
 * T3 — A carteira. A tela do "onde eu olho".
 *
 * A fila mostra 12 itens; a carteira tem 30 contas. As 18 que não geraram item hoje
 * não são invisíveis — são o trabalho que ainda não virou urgente, e é olhando para
 * elas que se evita que virem.
 *
 * A ordem é a decisão de produto desta tela. Por faixa de risco só, o CSM começa por
 * uma conta crítica de R$ 800 e deixa uma conta em risco de R$ 40 mil para depois.
 * Por MRR só, ele começa pela maior mesmo quando ela está saudável. A ordem é o
 * PRODUTO dos dois — risco ponderado por receita — que é a única que responde "qual
 * conversa eu tenho hoje".
 */

/** Peso de cada faixa na ordenação. Só a diferença relativa importa. */
export const PESO_FAIXA: Readonly<Record<string, number>> = {
  critico: 8,
  risco: 4,
  atencao: 2,
  saudavel: 1,
}

export interface ContaDaCarteira {
  id: string
  razaoSocial: string
  porte: string | null
  setor: string | null
  csmEmail: string | null
  mrrCentavos: string | null
  faixa: string | null
  scoreComposto: number | null
  scoreParcial: boolean
  /** Os quatro números do cabeçalho do Cliente 360, aqui em coluna. */
  adesao30d: number | null
  coberturaCadastral: number | null
  diasAtrasoMax: number | null
  /**
   * Quanto a conta deve em títulos vencidos, da foto mais recente da
   * inadimplência. Nulo é "nada em atraso", e não "não sei": a foto cobre a base
   * inteira, então ausência ali é ausência de dívida.
   */
  abertoCentavos: string | null
  /** Desse aberto, o que tem até 90 dias — a parte que responde a cobrança. */
  abertoRecenteCentavos: string | null
  /** A competência da foto de onde o atraso desta conta veio. */
  fotoDoAtraso: string | null
  diasDesdeUltimoContato: number | null
  competencia: string | null
  /** Falso quando o snapshot saiu com fonte faltando. */
  completo: boolean
  itensAbertos: number
  /** Dias até a vigência acabar; negativo se passou. */
  diasParaVigencia: number | null
  /** Cláusulas propostas e não conferidas — dado que ainda não decide. */
  clausulasPropostas: number
  /**
   * Risco × receita. É a ordem da tela, e vem calculado do banco para a
   * paginação futura não precisar carregar tudo em memória para ordenar.
   */
  pesoDeAtencao: number
}

export interface Carteira {
  contas: ContaDaCarteira[]
  /** Verdadeiro quando a pessoa enxerga a base inteira. */
  visaoDaBase: boolean
  /** Contas sem sinal calculado — nem saudáveis nem em risco: sem resposta. */
  semSinal: number
}

/**
 * Carrega a carteira.
 *
 * `semSinal` é contado à parte de propósito. Conta sem sinal calculado não é conta
 * saudável: é conta sobre a qual não se sabe nada, e somá-la ao verde faria a
 * carteira parecer melhor do que é — exatamente a leitura que atrasa a descoberta
 * de um problema.
 */
export async function carregarCarteira(
  db: pg.Pool,
  id: Identidade,
  opts: { faixa?: string; hoje?: string } = {},
): Promise<Carteira> {
  if (id.permissoes.contas === 'nenhum') {
    return { contas: [], visaoDaBase: false, semSinal: 0 }
  }
  const daBase = id.permissoes.contas === 'base'
  const hoje = opts.hoje ?? new Date().toISOString().slice(0, 10)

  const { rows } = await db.query<Record<string, unknown>>(
    `WITH ultima AS (SELECT max(competencia) c FROM metrics.daily_snapshot),
     /* ┌───────────────────────────────────────────────────────────────────────┐
        │ CTE E NÃO LATERAL, e a diferença medida foi de 4,3 SEGUNDOS.            │
        │                                                                       │
        │ A primeira versão buscava o MRR com um LEFT JOIN LATERAL na view por    │
        │ conta. A view analytics.mrr_faturado_mes nao e materializada: varre 90  │
        │ mil títulos e monta a grade de meses —, então o LATERAL a reavaliava     │
        │ para cada uma das 1.964 contas raiz. EXPLAIN ANALYZE: 4.319 ms só nisso. │
        │                                                                       │
        │ DISTINCT ON (account_id) com ORDER BY competencia DESC da o mesmo       │
        │ "ultimo mes de cada conta" avaliando a view UMA vez.                    │
        └───────────────────────────────────────────────────────────────────────┘ */
     mrr_recente AS (
       SELECT DISTINCT ON (account_id) account_id, mrr_centavos
         FROM analytics.mrr_faturado_mes
        WHERE competencia >= date_trunc('month', $3::date) - interval '2 months'
        ORDER BY account_id, competencia DESC
     ),
     -- Mesmo motivo: uma agregação em vez de uma por linha.
     -- A competência da foto, para a TELA poder dizer de quando é o número.
     foto AS (SELECT max(competencia) c FROM fact.inadimplencia_titulo),
     atraso AS (
       SELECT account_id,
              max(dias_atraso)     AS dias_atraso,
              sum(valor_centavos)  AS aberto_centavos,
              /* ┌─────────────────────────────────────────────────────────────┐
                 │ O RECENTE POR TÍTULO, e não por conta. A primeira versão do   │
                 │ KPI filtrava pelo PIOR atraso da conta, e as duas coisas são  │
                 │ perguntas diferentes: uma conta com um título de 20 dias e    │
                 │ outro de 400 tem pior atraso de 400, e ainda assim deve       │
                 │ dinheiro recente e cobrável.                                  │
                 │                                                              │
                 │ Medido: dava 34 contas contra as 53 da fila da inadimplência.  │
                 │ Um KPI que sub-conta a própria fila da tela vizinha é pior     │
                 │ que KPI nenhum — ele faz duvidar da fila.                      │
                 └─────────────────────────────────────────────────────────────┘ */
              coalesce(sum(valor_centavos) FILTER (WHERE dias_atraso <= 90), 0)
                                   AS aberto_recente_centavos
         FROM fact.inadimplencia_titulo
        WHERE movimento IN ('permaneceu', 'entrou')
          AND account_id IS NOT NULL
          AND competencia = (SELECT c FROM foto)
        GROUP BY 1
     )
     SELECT a.id, a.razao_social, a.porte, a.setor, a.csm_email,
            /* ┌───────────────────────────────────────────────────────────────┐
               │ O MRR CAI PARA O FATURADO quando não há contrato, e a coluna     │
               │ inteira vivia em branco por isso: core.contract tem ZERO linhas  │
               │ — o ciclo C5, que a alimentaria do HubSpot, não está ligado.      │
               │                                                                  │
               │ analytics.mrr_faturado_mes e a mesma fonte que a cascata usa, e  │
               │ é isso que importa: a carteira e a cascata precisam concordar     │
               │ sobre o MRR do mesmo cliente, senão a pessoa abre as duas e não   │
               │ sabe em qual acreditar. Ver as migrações 0049 e 0050.             │
               └───────────────────────────────────────────────────────────────┘ */
            coalesce(ct.mrr_centavos, fm.mrr_centavos)::text AS mrr,
            (ct.mrr_centavos IS NULL AND fm.mrr_centavos IS NOT NULL) AS mrr_faturado,
            /* O atraso vem da inadimplência, que é apurada. A daily_snapshot
               também está vazia — depende dos ciclos C2/C3/C8, declarados e não
               implementados —, então estas duas colunas nunca tiveram valor. */
            coalesce(s.dias_atraso_max, ina.dias_atraso)::int AS dias_atraso_max_efetivo,
            ina.aberto_centavos::text               AS aberto_centavos,
            ina.aberto_recente_centavos::text       AS aberto_recente_centavos,
            to_char((SELECT c FROM foto), 'YYYY-MM-DD') AS foto_do_atraso,
            sg.faixa_final, sg.score_composto, sg.parcial AS score_parcial,
            to_char(s.competencia,'YYYY-MM-DD')     AS competencia,
            s.completo,
            s.vidas_elegiveis, s.vidas_ativas_30d, s.vidas_contratadas,
            s.dias_atraso_max, s.dias_desde_ultimo_contato,
            (ct.vigencia_fim - $3::date)            AS dias_vigencia,
            COALESCE(wi.n, 0)                       AS itens,
            COALESCE(cl.n, 0)                       AS propostas
       FROM core.account a
       LEFT JOIN LATERAL (
         SELECT mrr_centavos, vigencia_fim FROM core.contract
          WHERE account_id = a.id AND status_vigencia = 'vigente'
          ORDER BY inicio DESC LIMIT 1
       ) ct ON true
       LEFT JOIN metrics.daily_snapshot s
              ON s.account_id = a.id AND s.competencia = (SELECT c FROM ultima)
       /* O MRR faturado do último mês com movimento DENTRO DA CARÊNCIA (a janela
          está na CTE mrr_recente, acima). Sem a carência, o somatório da
          carteira deu R$ 3,56 mi contra R$ 1,37 mi de faturamento real: mostrava
          o MRR de 2022 de quem parou em 2022. Cliente que parou não tem MRR — tem
          histórico. Três meses porque quem vence dia 25 tem o mês corrente ainda
          vazio, e dois fechados é a carência da revisão (MESES_DE_CARENCIA = 2). */
       LEFT JOIN mrr_recente fm ON fm.account_id = a.id
       LEFT JOIN atraso ina ON ina.account_id = a.id
       LEFT JOIN metrics.signal sg
              ON sg.account_id = a.id AND sg.competencia = (SELECT c FROM ultima)
       -- Itens VISÍVEIS: o de modo sombra não é trabalho de ninguém, e contá-lo
       -- aqui faria a carteira parecer mais carregada do que está.
       LEFT JOIN LATERAL (
         SELECT count(*)::int n FROM success.work_item
          WHERE account_id = a.id AND estado IN ('aberto','backlog') AND NOT modo_sombra
       ) wi ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::int n FROM contracts.clause
          WHERE account_id = a.id AND estado = 'proposta' AND valido_ate IS NULL
       ) cl ON true
      WHERE ($1::boolean OR a.csm_email = $2)
        AND ($4::text IS NULL OR sg.faixa_final = $4)`,
    [daBase, id.email, hoje, opts.faixa ?? null],
  )

  const num = (r: Record<string, unknown>, k: string): number | null =>
    r[k] === null || r[k] === undefined ? null : Number(r[k])

  const contas = rows.map((r): ContaDaCarteira => {
    const elegiveis = num(r, 'vidas_elegiveis')
    const ativas = num(r, 'vidas_ativas_30d')
    const contratadas = num(r, 'vidas_contratadas')
    const faixa = r['faixa_final'] === null ? null : String(r['faixa_final'])
    const mrr = r['mrr'] === null ? null : String(r['mrr'])

    return {
      id: String(r['id']),
      razaoSocial: String(r['razao_social']),
      porte: r['porte'] === null ? null : String(r['porte']),
      setor: r['setor'] === null ? null : String(r['setor']),
      csmEmail: r['csm_email'] === null ? null : String(r['csm_email']),
      mrrCentavos: mrr,
      faixa,
      scoreComposto: num(r, 'score_composto'),
      scoreParcial: r['score_parcial'] === true,
      adesao30d: elegiveis && elegiveis > 0 && ativas !== null ? ativas / elegiveis : null,
      coberturaCadastral:
        contratadas && contratadas > 0 && elegiveis !== null ? elegiveis / contratadas : null,
      diasAtrasoMax: num(r, 'dias_atraso_max_efetivo'),
      abertoCentavos: r['aberto_centavos'] === null ? null : String(r['aberto_centavos']),
      abertoRecenteCentavos:
        r['aberto_recente_centavos'] === null ? null : String(r['aberto_recente_centavos']),
      fotoDoAtraso: r['foto_do_atraso'] === null ? null : String(r['foto_do_atraso']),
      diasDesdeUltimoContato: num(r, 'dias_desde_ultimo_contato'),
      competencia: r['competencia'] === null ? null : String(r['competencia']),
      completo: r['completo'] === true,
      itensAbertos: Number(r['itens'] ?? 0),
      diasParaVigencia: num(r, 'dias_vigencia'),
      clausulasPropostas: Number(r['propostas'] ?? 0),
      // Conta sem faixa recebe peso de `atencao`: ela não é saudável — é
      // desconhecida, e desconhecido não pode afundar na lista.
      pesoDeAtencao: (PESO_FAIXA[faixa ?? 'atencao'] ?? 2) * (mrr === null ? 0 : Number(mrr) / 100),
    }
  })

  contas.sort((a, b) => b.pesoDeAtencao - a.pesoDeAtencao || a.razaoSocial.localeCompare(b.razaoSocial))

  return {
    contas,
    visaoDaBase: daBase,
    semSinal: contas.filter((c) => c.faixa === null).length,
  }
}

export interface ResumoCarteira {
  total: number
  mrrTotalCentavos: string
  porFaixa: Array<{ faixa: string; contas: number; mrrCentavos: string }>
  /**
   * A competência da foto de inadimplência que estes números descrevem.
   *
   * ┌───────────────────────────────────────────────────────────────────────────┐
   * │ EXISTE PORQUE A CARTEIRA E A INADIMPLÊNCIA DÃO NÚMEROS DIFERENTES, e as     │
   * │ duas estão certas — só respondem em datas diferentes.                       │
   * │                                                                            │
   * │ Aqui o atraso vem da FOTO mensal, como todo o resto desta tela (adesão,      │
   * │ cobertura e sinal saem de `metrics.daily_snapshot`). A tela de inadimplência │
   * │ calcula HOJE, do faturamento cru. Medido em 26/08: R$ 304.726 na foto de     │
   * │ 1º/ago contra R$ 391.924 hoje — 25 dias de vencimento novo no meio.         │
   * │                                                                            │
   * │ Some daí uma segunda diferença: esta tela conta por CONTA e a inadimplência  │
   * │ por CNPJ, e 21 CNPJ em atraso não têm vínculo com conta nenhuma.             │
   * │                                                                            │
   * │ A tela mostra a data ao lado do número. O conserto de verdade seria uma      │
   * │ view de inadimplência de HOJE que as duas lessem — está anotado, e é         │
   * │ trabalho de outro dia.                                                     │
   * └───────────────────────────────────────────────────────────────────────────┘
   */
  fotoDoAtraso: string | null
  /** Contas com título vencido em aberto. */
  contasEmAtraso: number
  abertoTotalCentavos: string
  /** Das em atraso, as com até 90 dias — a parte que responde a cobrança. */
  contasEmAtrasoRecente: number
  abertoRecenteCentavos: string
  /** O pior atraso da carteira, em dias. Zero quando não há nenhum. */
  maiorAtrasoDias: number
  /** Contas sem nenhum item aberto — o trabalho que ainda não virou urgente. */
  semItem: number
  /** Contas com dado parcial: o número delas não é comparável ao das outras. */
  parciais: number
  comClausulaProposta: number
}

/**
 * O resumo da carteira.
 *
 * `semItem` é o número que a fila não mostra: são as contas que não geraram trabalho
 * hoje. Metade delas está bem; a outra metade é onde o próximo problema nasce, e é a
 * única forma de olhar para ele antes de virar item.
 */
export function resumir(carteira: Carteira): ResumoCarteira {
  const porFaixa = new Map<string, { contas: number; mrr: number }>()
  let mrrTotal = 0

  for (const c of carteira.contas) {
    const mrr = c.mrrCentavos === null ? 0 : Number(c.mrrCentavos)
    mrrTotal += mrr
    const k = c.faixa ?? 'sem_sinal'
    const atual = porFaixa.get(k) ?? { contas: 0, mrr: 0 }
    porFaixa.set(k, { contas: atual.contas + 1, mrr: atual.mrr + mrr })
  }

  const ordem = ['critico', 'risco', 'atencao', 'saudavel', 'sem_sinal']
  const emAtraso = carteira.contas.filter((c) => Number(c.abertoCentavos ?? 0) > 0)
  // Quem tem QUALQUER valor com até 90 dias, e não quem tem o pior atraso abaixo
  // de 90: a segunda leitura perde a conta que deve recente E antigo, que é
  // justamente a que mais precisa de ligação.
  const recentes = emAtraso.filter((c) => Number(c.abertoRecenteCentavos ?? 0) > 0)
  return {
    total: carteira.contas.length,
    mrrTotalCentavos: String(mrrTotal),
    porFaixa: [...porFaixa.entries()]
      .sort(([a], [b]) => ordem.indexOf(a) - ordem.indexOf(b))
      .map(([faixa, v]) => ({ faixa, contas: v.contas, mrrCentavos: String(v.mrr) })),
    /* ┌───────────────────────────────────────────────────────────────────────┐
       │ OS AGREGADOS DE ATRASO SAEM DAS MESMAS LINHAS que a lista mostra, e não  │
       │ de uma consulta própria.                                                 │
       │                                                                         │
       │ É o que garante que o KPI e a tabela concordem: numa tela onde o KPI vem  │
       │ de um SELECT e a lista de outro, filtrar por faixa faz os dois            │
       │ divergirem — e quem lê não tem como saber qual dos dois está certo.      │
       │                                                                         │
       │ `<= 90` é o mesmo corte da inadimplência (DIAS_CORRENTE), repetido aqui   │
       │ como número porque `@pulse/success` não depende de `@pulse/config`. Há    │
       │ portão comparando os dois.                                              │
       └───────────────────────────────────────────────────────────────────────┘ */
    fotoDoAtraso: carteira.contas.find((c) => c.fotoDoAtraso)?.fotoDoAtraso ?? null,
    contasEmAtraso: emAtraso.length,
    abertoTotalCentavos: String(emAtraso.reduce((s, c) => s + Number(c.abertoCentavos ?? 0), 0)),
    contasEmAtrasoRecente: recentes.length,
    abertoRecenteCentavos: String(
      recentes.reduce((s, c) => s + Number(c.abertoRecenteCentavos ?? 0), 0),
    ),
    maiorAtrasoDias: emAtraso.reduce((m, c) => Math.max(m, c.diasAtrasoMax ?? 0), 0),
    semItem: carteira.contas.filter((c) => c.itensAbertos === 0).length,
    parciais: carteira.contas.filter((c) => c.competencia !== null && !c.completo).length,
    comClausulaProposta: carteira.contas.filter((c) => c.clausulasPropostas > 0).length,
  }
}
