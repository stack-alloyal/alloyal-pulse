import type pg from 'pg'

import { cabecalhos, type CredencialDoCore } from './core-lecupon.js'
import { usarSegredo } from './uso.js'

/**
 * O que cada fonte diz sobre uma conta, para a tela mostrar lado a lado.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ Buscado AO VIVO, e não do que está sincronizado. A fila existe para alguém  │
 * │ decidir qual fonte está certa: mostrar a cópia do Pulse responderia com o   │
 * │ valor que a regra de precedência já escolheu, e a pessoa confirmaria a      │
 * │ própria regra em vez de conferir o dado.                                   │
 * │                                                                            │
 * │ Cada fonte falha por conta própria. Se o Omie estiver fora do ar, a aba da  │
 * │ Lecupon continua útil — e a aba do Omie DIZ que não respondeu, em vez de    │
 * │ aparecer vazia como se não houvesse cadastro lá.                           │
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

const TEMPO_LIMITE_MS = 12_000

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

/** O business como a Lecupon o devolve agora. */
export async function daLecupon(db: pg.Pool, brandId: string): Promise<FonteConsultada> {
  let c: CredencialDoCore
  try {
    c = {
      token: await usarSegredo(db, 'lecupon.employee_token'),
      email: await usarSegredo(db, 'lecupon.employee_email'),
      tenantCnpj: await usarSegredo(db, 'lecupon.tenant_cnpj').catch(() => ''),
      base: 'https://api.lecupon.com/client/v3',
    }
  } catch (err) {
    return {
      fonte: 'lecupon', ok: false, campos: [],
      erro: err instanceof Error ? err.message : 'credencial da Lecupon indisponível',
    }
  }
  try {
    const r = await fetch(`${c.base}/businesses/${encodeURIComponent(brandId)}`, {
      headers: cabecalhos(c),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    })
    if (!r.ok) {
      return { fonte: 'lecupon', ok: false, campos: [], erro: `a Lecupon respondeu ${r.status}` }
    }
    const corpo = (await r.json()) as Record<string, unknown>
    const b = (corpo['business'] ?? corpo) as Record<string, unknown>
    // Todos os campos, ordenados: quem confere não sabe de antemão qual vai esclarecer
    // a dúvida, e esconder campo é o que obriga a abrir o sistema de origem.
    return {
      fonte: 'lecupon', ok: true,
      campos: Object.keys(b)
        .sort()
        .map((k) => ({ rotulo: k, valor: SEGREDO.test(k) ? OCULTO : texto(b[k]) })),
    }
  } catch (err) {
    return {
      fonte: 'lecupon', ok: false, campos: [],
      erro: `não foi possível falar com a Lecupon (${err instanceof Error ? err.message : 'erro de rede'})`,
    }
  }
}

/** A ficha do Omie, pelo CNPJ. Inclui as características, que só vêm no consultar. */
export async function doOmie(db: pg.Pool, cnpj: string): Promise<FonteConsultada> {
  let key: string, secret: string
  try {
    key = await usarSegredo(db, 'omie.app_key')
    secret = await usarSegredo(db, 'omie.app_secret')
  } catch (err) {
    return {
      fonte: 'omie', ok: false, campos: [],
      erro: err instanceof Error ? err.message : 'credencial do Omie indisponível',
    }
  }
  const so = cnpj.replace(/\D/g, '')
  try {
    // O `ConsultarCliente` não aceita CNPJ como chave — só código. Então localiza pelo
    // documento na listagem e consulta pelo código. Duas chamadas, e é o caminho que a
    // API oferece.
    const busca = await fetch('https://app.omie.com.br/api/v1/geral/clientes/', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      body: JSON.stringify({
        call: 'ListarClientes', app_key: key, app_secret: secret,
        param: [{ pagina: 1, registros_por_pagina: 5, clientesFiltro: { cnpj_cpf: so } }],
      }),
    })
    const lista = (await busca.json()) as Record<string, unknown>
    if (lista['faultstring']) {
      return { fonte: 'omie', ok: false, campos: [], erro: String(lista['faultstring']).slice(0, 180) }
    }
    const fichas = (lista['clientes_cadastro'] ?? []) as Record<string, unknown>[]
    const ficha = fichas.find((f) => String(f['cnpj_cpf'] ?? '').replace(/\D/g, '') === so)
    if (!ficha) {
      return { fonte: 'omie', ok: true, campos: [], erro: 'nenhuma ficha com este CNPJ no Omie' }
    }
    const det = await fetch('https://app.omie.com.br/api/v1/geral/clientes/', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      body: JSON.stringify({
        call: 'ConsultarCliente', app_key: key, app_secret: secret,
        param: [{ codigo_cliente_omie: ficha['codigo_cliente_omie'] }],
      }),
    })
    const d = (await det.json()) as Record<string, unknown>
    const campos: { rotulo: string; valor: string }[] = []
    for (const k of Object.keys(d).sort()) {
      if (k === 'caracteristicas' || k === 'tags') continue
      campos.push({ rotulo: k, valor: SEGREDO.test(k) ? OCULTO : texto(d[k]) })
    }
    // Tags e características em destaque: são o que a conferência usa.
    const tags = (d['tags'] ?? []) as Record<string, unknown>[]
    campos.unshift({ rotulo: 'tags', valor: tags.map((t) => String(t['tag'] ?? '')).join(', ') || '—' })
    for (const c of (d['caracteristicas'] ?? []) as Record<string, unknown>[]) {
      campos.unshift({ rotulo: `característica · ${String(c['campo'])}`, valor: texto(c['conteudo']) })
    }
    return { fonte: 'omie', ok: true, campos }
  } catch (err) {
    return {
      fonte: 'omie', ok: false, campos: [],
      erro: `não foi possível falar com o Omie (${err instanceof Error ? err.message : 'erro de rede'})`,
    }
  }
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
    conta.cnpj
      ? doOmie(db, conta.cnpj)
      : Promise.resolve<FonteConsultada>({
          fonte: 'omie', ok: false, campos: [], erro: 'a conta não tem CNPJ para buscar no Omie',
        }),
  ])
  const nomes = ['pulse', 'lecupon', 'omie'] as const
  return r.map((x, i) =>
    x.status === 'fulfilled'
      ? x.value
      : { fonte: nomes[i]!, ok: false, campos: [], erro: 'falha inesperada ao consultar' },
  )
}
