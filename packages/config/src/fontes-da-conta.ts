import type pg from 'pg'

/**
 * O que cada fonte diz sobre uma conta, para a tela mostrar lado a lado.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ERA AO VIVO, E NÃO PODIA SER. Descoberto em 13/08/2026, em produção: a      │
 * │ superfície web conecta como `pulse_api`, que tem SELECT por COLUNA em       │
 * │ `ops.segredo` — todas menos `valor_cifrado`. A aplicação web NÃO decifra    │
 * │ segredo, e isso é desenho deliberado da 0016: ela é a superfície exposta, e │
 * │ um furo nela não pode virar exfiltração das credenciais de integração.      │
 * │                                                                            │
 * │ O resultado era pior que uma tela quebrada: `usarSegredo` levantava         │
 * │ "permission denied for table segredo", o `catch` transformava isso em       │
 * │ `ok:false`, e a aba dizia "não respondeu" — culpando o Omie por uma         │
 * │ permissão do nosso banco. Quem conferisse concluiria que a API caiu.        │
 * │                                                                            │
 * │ Agora lê a CÓPIA sincronizada, que o worker mantém (C18 e C20), e cada aba  │
 * │ mostra QUANDO foi sincronizada. Perde-se o "agora"; ganha-se uma tela que   │
 * │ funciona e que não mente sobre a idade do que mostra.                      │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

export interface FonteConsultada {
  readonly fonte: 'lecupon' | 'omie' | 'pulse'
  readonly ok: boolean
  /** Quando não deu certo, o que houve — em texto que quem confere entende. */
  readonly erro?: string
  /** Pares rótulo/valor, na ordem em que fazem sentido para quem lê. */
  readonly campos: readonly { rotulo: string; valor: string }[]
}

/**
 * Campos que NUNCA vão para a tela, mesmo numa visão "todos os campos".
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ Descoberto olhando a tela pronta: a Lecupon devolve `api_secret`,           │
 * │ `signature_secret` e `api_key` do business no mesmo objeto que a razão      │
 * │ social. A ideia de "mostrar tudo para quem confere" despejava credencial de │
 * │ cliente numa página interna — que vai para print, para cache de navegador e │
 * │ para tela compartilhada em reunião.                                        │
 * │                                                                            │
 * │ O campo continua APARECENDO, com o valor trocado: sumir com a linha faria   │
 * │ parecer que a fonte não tem aquele dado, e quem confere não saberia que há  │
 * │ algo ali. Dizer "existe e está oculto" é a informação certa.                │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
const SEGREDO = /secret|api_?key|password|senha|passcode|token|credential/i

const OCULTO = '•••••• oculto — é credencial'

const texto = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'sim' : 'não'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** A conta como o Pulse a guarda hoje — o resultado da regra de precedência. */
export async function doPulse(db: pg.Pool, accountId: string): Promise<FonteConsultada> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT razao_social, cnpj, brand_id, hubspot_company_id, status_core, ativo,
            csm_email, owner_comercial_email, usuarios_cadastrados, usuarios_autorizados,
            contato_email, sincronizado_em, criado_em
       FROM core.account WHERE id = $1`,
    [accountId],
  )
  const r = rows[0]
  if (!r) return { fonte: 'pulse', ok: false, erro: 'conta não encontrada', campos: [] }
  const rotulos: [string, string][] = [
    ['Razão social', 'razao_social'], ['CNPJ', 'cnpj'], ['Brand', 'brand_id'],
    ['HubSpot ID', 'hubspot_company_id'], ['Situação', 'status_core'], ['Ativo', 'ativo'],
    ['CSM', 'csm_email'], ['Comercial', 'owner_comercial_email'],
    ['Usuários cadastrados', 'usuarios_cadastrados'], ['Usuários autorizados', 'usuarios_autorizados'],
    ['E-mail de contato', 'contato_email'], ['Sincronizado em', 'sincronizado_em'], ['Criado em', 'criado_em'],
  ]
  return { fonte: 'pulse', ok: true, campos: rotulos.map(([rot, k]) => ({ rotulo: rot, valor: texto(r[k]) })) }
}

/**
 * O que veio da Lecupon, da cópia que o C18 mantém em `core.account`.
 *
 * É o MESMO conteúdo da aba do Pulse, e isso não é redundância: a regra de
 * precedência diz "Lecupon vence", então o valor gravado É o da Lecupon. A aba
 * existe para deixar isso explícito — quem confere precisa ver de onde veio o
 * número que está valendo, e não deduzir.
 */
export async function daLecupon(db: pg.Pool, brandId: string): Promise<FonteConsultada> {
  if (!brandId) {
    return { fonte: 'lecupon', ok: false, campos: [], erro: 'a conta não tem Business ID' }
  }
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT brand_id, branch_id, razao_social, cnpj, hubspot_company_id, status_core, ativo,
            usuarios_cadastrados, usuarios_autorizados, contato_email, porte, setor,
            logo_url, sincronizado_em
       FROM core.account WHERE brand_id = $1`,
    [brandId],
  )
  const r = rows[0]
  if (!r) return { fonte: 'lecupon', ok: true, campos: [], erro: 'nenhum business com este ID' }
  return {
    fonte: 'lecupon',
    ok: true,
    campos: Object.keys(r).sort().map((k) => ({
      rotulo: k,
      valor: SEGREDO.test(k) ? OCULTO : texto(r[k]),
    })),
  }
}

/**
 * A ficha do Omie, da cópia sincronizada pelo C20.
 *
 * Traz TODOS os campos, tags e características — o C20 grava a ficha inteira, e
 * `caracteristicas` é jsonb justamente para não perder campo que a empresa criou
 * no Omie sem ninguém aqui saber.
 */
export async function doOmie(db: pg.Pool, cnpj: string): Promise<FonteConsultada> {
  const doc = (cnpj ?? '').replace(/\D/g, '')
  if (doc.length !== 11 && doc.length !== 14) {
    return { fonte: 'omie', ok: false, campos: [], erro: 'a conta não tem CNPJ ou CPF para buscar no Omie' }
  }
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT codigo_omie, documento, razao_social, nome_fantasia, pessoa_fisica, inativo,
            email, contato, telefone, cidade, estado, cadastrado_em, alterado_em,
            tags, caracteristicas, sincronizado_em
       FROM core.omie_cliente WHERE documento = $1
      ORDER BY inativo, alterado_em DESC NULLS LAST, codigo_omie DESC LIMIT 1`,
    [doc],
  )
  const r = rows[0]
  if (!r) {
    // "Não existe ficha" e "não consegui consultar" são coisas diferentes, e a tela
    // precisa distinguir: a primeira é informação sobre o cliente, a segunda é
    // problema nosso.
    return { fonte: 'omie', ok: true, campos: [], erro: 'nenhuma ficha com este documento no Omie' }
  }

  const campos: { rotulo: string; valor: string }[] = []
  // Características primeiro: são o que a conferência usa (idHubspot, MRR).
  for (const [k, v] of Object.entries((r['caracteristicas'] ?? {}) as Record<string, unknown>)) {
    campos.push({ rotulo: `característica · ${k}`, valor: SEGREDO.test(k) ? OCULTO : texto(v) })
  }
  campos.push({ rotulo: 'tags', valor: ((r['tags'] ?? []) as string[]).join(', ') || '—' })
  const rotulos: [string, string][] = [
    ['razão social', 'razao_social'], ['nome fantasia', 'nome_fantasia'],
    ['documento', 'documento'], ['código Omie', 'codigo_omie'],
    ['pessoa física', 'pessoa_fisica'], ['inativo', 'inativo'],
    ['e-mail', 'email'], ['contato', 'contato'], ['telefone', 'telefone'],
    ['cidade', 'cidade'], ['estado', 'estado'],
    ['data do cadastro', 'cadastrado_em'], ['última alteração', 'alterado_em'],
    ['sincronizado em', 'sincronizado_em'],
  ]
  for (const [rot, k] of rotulos) {
    campos.push({ rotulo: rot, valor: SEGREDO.test(k) ? OCULTO : texto(r[k]) })
  }
  return { fonte: 'omie', ok: true, campos }
}

/**
 * As três fontes, em paralelo e sem uma derrubar a outra.
 *
 * `allSettled` e não `all`: com `all`, o Omie fora do ar apagaria também a aba da
 * Lecupon — e a pessoa perderia a informação que estava disponível.
 */
export async function todasAsFontes(
  db: pg.Pool,
  conta: { id: string; brandId: string; cnpj: string | null },
): Promise<FonteConsultada[]> {
  const r = await Promise.allSettled([
    doPulse(db, conta.id),
    daLecupon(db, conta.brandId),
    doOmie(db, conta.cnpj ?? ''),
  ])
  const nomes = ['pulse', 'lecupon', 'omie'] as const
  return r.map((x, i) =>
    x.status === 'fulfilled'
      ? x.value
      : { fonte: nomes[i]!, ok: false, campos: [], erro: 'falha inesperada ao consultar' },
  )
}
