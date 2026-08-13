import type { Identidade } from '@pulse/auth'
import type pg from 'pg'

/**
 * A fila de conferência: onde duas fontes discordam sobre a mesma conta.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A regra de precedência é "Lecupon vence", e ela já está aplicada ao valor   │
 * │ gravado em `core.account`. Esta fila existe porque VENCER não é a mesma     │
 * │ coisa que ESTAR CERTA: nas 44 divergências medidas, os dois lados apontam   │
 * │ para empresas diferentes no HubSpot e uma das duas está errada em cada caso.│
 * │                                                                            │
 * │ Aplicar a regra e descartar o outro valor transformaria 44 erros conhecidos │
 * │ em 44 erros silenciosos — e ninguém procura o que não sabe que existe.      │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

export type EstadoConferencia = 'aberta' | 'resolvida' | 'ignorada'
export type Decisao = 'lecupon' | 'omie' | 'nenhum'

export class ConferenciaInvalidaError extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'ConferenciaInvalidaError'
  }
}

export interface ItemDeConferencia {
  readonly id: string
  readonly accountId: string
  readonly conta: string
  readonly cnpj: string | null
  readonly statusCore: string | null
  readonly campo: string
  readonly valorLecupon: string | null
  readonly valorOmie: string | null
  readonly detectadoEm: Date
  readonly estado: EstadoConferencia
  readonly decisao: Decisao | null
  readonly nota: string | null
  readonly decididoPor: string | null
  readonly decididoEm: Date | null
}

const COLUNAS = `
  c.id::text, c.account_id AS "accountId", a.razao_social AS conta, a.cnpj,
  a.status_core AS "statusCore", c.campo, c.valor_lecupon AS "valorLecupon",
  c.valor_omie AS "valorOmie", c.detectado_em AS "detectadoEm", c.estado,
  c.decisao, c.nota, c.decidido_por AS "decididoPor", c.decidido_em AS "decididoEm"`

export async function listarConferencia(
  db: pg.Pool,
  opts: { estado?: EstadoConferencia; campo?: string } = {},
): Promise<ItemDeConferencia[]> {
  const { rows } = await db.query<ItemDeConferencia>(
    `SELECT ${COLUNAS}
       FROM core.conferencia_fonte c
       JOIN core.account a ON a.id = c.account_id
      WHERE ($1::text IS NULL OR c.estado = $1)
        AND ($2::text IS NULL OR c.campo = $2)
      ORDER BY c.estado = 'aberta' DESC, c.detectado_em DESC, a.razao_social`,
    [opts.estado ?? null, opts.campo ?? null],
  )
  return rows
}

export async function lerConferencia(db: pg.Pool, id: string): Promise<ItemDeConferencia | null> {
  const { rows } = await db.query<ItemDeConferencia>(
    `SELECT ${COLUNAS} FROM core.conferencia_fonte c
       JOIN core.account a ON a.id = c.account_id WHERE c.id = $1::bigint`,
    [id],
  )
  return rows[0] ?? null
}

export interface ResumoDaFila {
  readonly abertas: number
  readonly resolvidas: number
  readonly ignoradas: number
}

export async function resumoDaFila(db: pg.Pool, campo?: string): Promise<ResumoDaFila> {
  const { rows } = await db.query<{ estado: string; n: string }>(
    `SELECT estado, count(*)::text n FROM core.conferencia_fonte
      WHERE ($1::text IS NULL OR campo = $1) GROUP BY estado`,
    [campo ?? null],
  )
  const de = (e: string) => Number(rows.find((r) => r.estado === e)?.n ?? 0)
  return { abertas: de('aberta'), resolvidas: de('resolvida'), ignoradas: de('ignorada') }
}

/**
 * Registra uma divergência. Idempotente por (conta, campo) enquanto aberta.
 *
 * `ON CONFLICT DO UPDATE` e não `DO NOTHING`: se o valor de um dos lados mudou desde a
 * detecção anterior, a fila tem que mostrar o valor de AGORA. Ignorar o conflito novo
 * porque já havia um aberto faria a pessoa conferir um par que não existe mais.
 */
export async function registrarDivergencia(
  db: pg.Pool,
  d: { accountId: string; campo: string; valorLecupon: string | null; valorOmie: string | null },
): Promise<'nova' | 'atualizada' | 'ignorada'> {
  if (d.valorLecupon === d.valorOmie) return 'ignorada'
  const { rows } = await db.query<{ nova: boolean }>(
    `INSERT INTO core.conferencia_fonte (account_id, campo, valor_lecupon, valor_omie)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (account_id, campo) WHERE estado = 'aberta'
       DO UPDATE SET valor_lecupon = EXCLUDED.valor_lecupon,
                     valor_omie    = EXCLUDED.valor_omie,
                     detectado_em  = now()
     RETURNING (xmax = 0) AS nova`,
    [d.accountId, d.campo, d.valorLecupon, d.valorOmie],
  )
  return rows[0]?.nova ? 'nova' : 'atualizada'
}

/**
 * Resolve um item. Exige decisão e, para `ignorada`, motivo escrito.
 *
 * A decisão NÃO reescreve `core.account`: a precedência já colocou o valor da Lecupon
 * lá, e trocá-lo por aqui criaria um caminho de escrita paralelo ao da sincronização —
 * que na próxima execução sobrescreveria a decisão em silêncio. O que a fila registra é
 * a CONFERÊNCIA; corrigir o dado errado é trabalho no sistema de origem.
 */
export async function decidir(
  db: pg.Pool,
  id: Identidade,
  conferenciaId: string,
  d: { decisao: Decisao; nota?: string; ignorar?: boolean },
): Promise<void> {
  const estado = d.ignorar ? 'ignorada' : 'resolvida'
  const nota = d.nota?.trim() ?? ''
  if (d.ignorar && nota.length < 10) {
    throw new ConferenciaInvalidaError(
      'ignorar uma divergência exige motivo escrito — é a saída mais fácil da fila, e a que some sem deixar rastro',
    )
  }
  const { rowCount } = await db.query(
    `UPDATE core.conferencia_fonte
        SET estado = $3, decisao = $4, nota = NULLIF($5,''),
            decidido_por = $2, decidido_em = now()
      WHERE id = $1::bigint AND estado = 'aberta'`,
    [conferenciaId, id.email, estado, d.decisao, nota],
  )
  if (rowCount === 0) {
    throw new ConferenciaInvalidaError('esta divergência já foi resolvida ou não existe')
  }
}

/** Reabre um item resolvido, quando a conferência se mostrou errada. */
export async function reabrir(db: pg.Pool, id: Identidade, conferenciaId: string): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE core.conferencia_fonte
        SET estado='aberta', decisao=NULL, decidido_por=NULL, decidido_em=NULL,
            nota = COALESCE(nota || ' · ', '') || 'reaberta por ' || $2
      WHERE id = $1::bigint AND estado <> 'aberta'`,
    [conferenciaId, id.email],
  )
  if (rowCount === 0) throw new ConferenciaInvalidaError('esta divergência já está aberta')
}

/**
 * Varre as duas cópias e mantém a fila em dia. Roda no fim do C20.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A fila existia e não se realimentava: as 44 divergências entraram por um    │
 * │ script meu, em 10/08/2026. Divergência nova nasceria muda, e ninguém        │
 * │ procura o que não sabe que existe — que é exatamente o argumento pelo qual  │
 * │ a fila foi criada. Uma fila que só enche à mão tem prazo de validade curto. │
 * │                                                                            │
 * │ ENCERRAR AUTOMATICAMENTE, quando as fontes voltam a concordar, é decisão e  │
 * │ não conveniência: um item aberto cujos dois valores hoje são iguais faz a   │
 * │ pessoa abrir, ler duas vezes o mesmo número e não entender o que se espera  │
 * │ dela. O encerramento fica com autor `ciclo C20` e nota dizendo o que houve, │
 * │ então ninguém confunde isso com conferência humana — e `reabrir` continua   │
 * │ disponível.                                                                │
 * │                                                                            │
 * │ O que o ciclo NUNCA faz é decidir uma divergência que ainda existe. Isso é  │
 * │ trabalho de gente, e é o motivo da fila.                                    │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export interface ReconciliacaoDaFila {
  readonly novas: number
  readonly atualizadas: number
  readonly encerradas: number
}

export async function reconciliarConferencia(db: pg.Pool): Promise<ReconciliacaoDaFila> {
  // O vínculo é por documento EXATO. Pela raiz não serve aqui: o HubSpot ID da
  // matriz não descreve a filial, e a divergência seria inventada por nós.
  const { rows } = await db.query<{ account_id: string; lecupon: string; omie: string }>(
    `SELECT a.id AS account_id,
            a.hubspot_company_id AS lecupon,
            o.hubspot_id AS omie
       FROM core.account a
       JOIN core.omie_cliente o
         ON o.documento = regexp_replace(coalesce(a.cnpj,''), '[^0-9]', '', 'g')
      WHERE a.hubspot_company_id IS NOT NULL
        AND o.hubspot_id IS NOT NULL
        AND a.hubspot_company_id <> o.hubspot_id`,
  )

  let novas = 0
  let atualizadas = 0
  for (const r of rows) {
    const efeito = await registrarDivergencia(db, {
      accountId: r.account_id,
      campo: 'hubspot_company_id',
      valorLecupon: r.lecupon,
      valorOmie: r.omie,
    })
    if (efeito === 'nova') novas++
    else if (efeito === 'atualizada') atualizadas++
  }

  // As que deixaram de divergir. `decisao = 'lecupon'` é literalmente verdade
  // quando os dois lados coincidem — o valor que vale é o da Lecupon, e o do Omie
  // é o mesmo.
  const { rowCount } = await db.query(
    `UPDATE core.conferencia_fonte c
        SET estado = 'resolvida', decisao = 'lecupon',
            decidido_por = 'ciclo C20', decidido_em = now(),
            nota = coalesce(c.nota || ' · ', '') ||
                   'as fontes passaram a concordar; encerrada pelo ciclo'
      WHERE c.estado = 'aberta'
        AND c.campo = 'hubspot_company_id'
        AND NOT EXISTS (
          SELECT 1
            FROM core.account a
            JOIN core.omie_cliente o
              ON o.documento = regexp_replace(coalesce(a.cnpj,''), '[^0-9]', '', 'g')
           WHERE a.id = c.account_id
             AND a.hubspot_company_id IS NOT NULL
             AND o.hubspot_id IS NOT NULL
             AND a.hubspot_company_id <> o.hubspot_id)`,
  )

  return { novas, atualizadas, encerradas: rowCount ?? 0 }
}
