import type pg from 'pg'

/**
 * O estado da integração com o Omie, para a tela de Configurações.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A pergunta que esta tela responde é "posso confiar no número que vi?", e ela │
 * │ tem três partes que costumam ser confundidas:                              │
 * │                                                                            │
 * │ · a última execução terminou BEM?                                          │
 * │ · ela foi COMPLETA, ou parou no meio? (o C20 devolve `parcial`)             │
 * │ · o que está gravado é DAQUELA execução, ou sobrou de antes?                │
 * │                                                                            │
 * │ A terceira é a que ninguém pergunta e a que mais engana. Uma varredura que  │
 * │ falha na página 900 de 1.243 grava 900 páginas e deixa as outras com o dado │
 * │ da véspera — e a tela, sem isso, diz "sincronizado hoje".                   │
 * │                                                                            │
 * │ Daí `frescor`: a fração das linhas cujo `sincronizado_em` é da última       │
 * │ execução. 100% é varredura completa; 72% é uma que parou no meio.           │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

export interface ExecucaoDoOmie {
  readonly id: string
  readonly iniciadoEm: Date
  readonly terminadoEm: Date | null
  readonly status: string
  readonly linhasLidas: number | null
  readonly linhasGravadas: number | null
  readonly erro: string | null
  readonly detalhe: Record<string, unknown> | null
  readonly duracaoSegundos: number | null
}

export interface FrescorDaTabela {
  readonly tabela: string
  readonly linhas: number
  readonly atualizadas: number
  readonly percentual: number
  readonly maisAntigo: Date | null
  readonly maisRecente: Date | null
}

export interface EstadoDaIntegracao {
  readonly credencialCadastrada: boolean
  readonly ultima: ExecucaoDoOmie | null
  readonly execucoes: ExecucaoDoOmie[]
  readonly frescor: FrescorDaTabela[]
  readonly totalDeFalhasSeguidas: number
  /** A agenda declarada do ciclo, em cron. */
  readonly agenda: string
}

const COLUNAS = `
  id::text, iniciado_em AS "iniciadoEm", terminado_em AS "terminadoEm", status,
  linhas_lidas AS "linhasLidas", linhas_gravadas AS "linhasGravadas", erro, detalhe,
  CASE WHEN terminado_em IS NULL THEN NULL
       ELSE extract(epoch FROM terminado_em - iniciado_em)::int END AS "duracaoSegundos"`

export async function execucoesDoOmie(db: pg.Pool, limite = 15): Promise<ExecucaoDoOmie[]> {
  const { rows } = await db.query<ExecucaoDoOmie>(
    `SELECT ${COLUNAS} FROM ops.cycle_run WHERE ciclo = 'C20'
      ORDER BY iniciado_em DESC LIMIT $1`,
    [limite],
  )
  return rows
}

/**
 * Quanto de cada tabela veio da ÚLTIMA varredura.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A referência é o INÍCIO da última execução, e não uma janela em torno do    │
 * │ `max(sincronizado_em)`. A primeira versão usava janela de 10 minutos e a    │
 * │ tela ficou dizendo, ao mesmo tempo, "varredura parcial" e "100% atualizado" │
 * │ — porque duas execuções separadas por 6 minutos caíam na mesma janela.      │
 * │                                                                            │
 * │ Contradição na tela é pior que número ausente: quem lê escolhe a metade que │
 * │ prefere.                                                                    │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export async function frescorDoOmie(db: pg.Pool, desde: Date | null): Promise<FrescorDaTabela[]> {
  const { rows } = await db.query<FrescorDaTabela>(
    `SELECT * FROM (
       SELECT 'Clientes' tabela, count(*)::int linhas,
              count(*) FILTER (WHERE $1::timestamptz IS NULL OR sincronizado_em >= $1)::int atualizadas,
              min(sincronizado_em) AS "maisAntigo", max(sincronizado_em) AS "maisRecente"
         FROM core.omie_cliente
       UNION ALL
       SELECT 'Títulos', count(*)::int,
              count(*) FILTER (WHERE $1::timestamptz IS NULL OR sincronizado_em >= $1)::int,
              min(sincronizado_em), max(sincronizado_em)
         FROM core.omie_titulo
       UNION ALL
       SELECT 'Categorias', count(*)::int,
              count(*) FILTER (WHERE $1::timestamptz IS NULL OR sincronizado_em >= $1)::int,
              min(sincronizado_em), max(sincronizado_em)
         FROM core.omie_categoria
     ) x`,
    [desde],
  )
  return rows.map((r) => ({
    ...r,
    percentual: r.linhas > 0 ? Math.round((r.atualizadas / r.linhas) * 1000) / 10 : 0,
  }))
}

export async function estadoDaIntegracao(db: pg.Pool): Promise<EstadoDaIntegracao> {
  const execucoes = await execucoesDoOmie(db)
  const ultima = execucoes.find((e) => e.status !== 'rodando') ?? execucoes[0] ?? null
  const [frescor, cred] = await Promise.all([
    frescorDoOmie(db, ultima?.iniciadoEm ?? null),
    // `segredoExiste` faz SELECT na chave, que `pulse_api` PODE ler — só
    // `valor_cifrado` é que ela não alcança. Então a tela consegue dizer se a
    // credencial está cadastrada sem nunca poder decifrá-la.
    db.query<{ n: string }>(
      `SELECT count(*)::text n FROM ops.segredo WHERE chave IN ('omie.app_key','omie.app_secret')`,
    ),
  ])

  // Falhas seguidas contadas de trás para frente: a sequência que importa é a que
  // termina AGORA. Uma falha isolada há um mês não é alarme.
  let seguidas = 0
  for (const e of execucoes) {
    if (e.status === 'erro' || e.status === 'falha') seguidas++
    else if (e.status === 'ok' || e.status === 'inerte') break
  }

  return {
    credencialCadastrada: Number(cred.rows[0]?.n ?? 0) === 2,
    ultima,
    execucoes,
    frescor,
    totalDeFalhasSeguidas: seguidas,
    agenda: '10 4 * * *',
  }
}

export interface CategoriaNaTela {
  readonly codigo: string
  readonly descricao: string
  readonly natureza: string | null
  readonly totalizadora: boolean
  readonly inativa: boolean
  readonly contaReceita: boolean
  /** Quantos títulos e quanto valor esta categoria carrega na base. */
  readonly titulos: number
  readonly valorCentavos: number
  readonly sincronizadoEm: Date
}

/**
 * As categorias, com o peso de cada uma.
 *
 * Ordenadas por VALOR e não por código: a lista tem 225 linhas, e o que a pessoa
 * procura é "quais importam". Em ordem de código, `1.01.02` — que é o MRR e
 * responde por três quartos dos títulos — fica entre duas categorias vazias.
 */
export async function categoriasDoOmie(
  db: pg.Pool,
  { comMovimento = false }: { comMovimento?: boolean } = {},
): Promise<CategoriaNaTela[]> {
  const { rows } = await db.query<CategoriaNaTela>(
    `SELECT c.codigo, c.descricao, c.natureza, c.totalizadora, c.inativa,
            c.conta_receita AS "contaReceita", c.sincronizado_em AS "sincronizadoEm",
            coalesce(t.n, 0)::int titulos,
            coalesce(t.v, 0)::bigint AS "valorCentavos"
       FROM core.omie_categoria c
       LEFT JOIN (
              SELECT categoria, count(*) n, sum(valor_centavos) v
                FROM core.omie_titulo WHERE situacao <> 'previsao'
               GROUP BY categoria
            ) t ON t.categoria = c.codigo
      WHERE ($1::boolean = false OR coalesce(t.n,0) > 0)
      ORDER BY coalesce(t.v, 0) DESC, c.codigo`,
    [comMovimento],
  )
  return rows
}
