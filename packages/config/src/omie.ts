import type pg from 'pg'

import { usarSegredo } from './uso.js'

/**
 * A API do Omie, e a cópia dela dentro do Pulse.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ MEDIDO CONTRA A CONTA REAL em 13/08/2026, não lido na documentação:        │
 * │                                                                            │
 * │ · 9.630 fichas de cliente, 193 páginas de 50, ~103 s a varredura inteira.  │
 * │ · 124.079 lançamentos a receber, 1.243 páginas de 100, ~15 min.            │
 * │ · 1.674 fichas com a tag `Cliente`; 1.457 CNPJ, 214 CPF, 3 sem documento.  │
 * │ · `exibir_caracteristicas: 'S'` traz tags E características NO LOTE, e são │
 * │   idênticas às do `ConsultarCliente` — conferido campo a campo. Sem a flag  │
 * │   vêm vazias. Em 10/08 varri 1.455 fichas uma a uma sem precisar.          │
 * │ · O teto de página é 50 em clientes e 100 no financeiro. Pedir 500 devolve │
 * │   100 sem reclamar, e quem confiar no número pedido conclui que a base é   │
 * │   menor do que é.                                                          │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

const BASE = 'https://app.omie.com.br/api/v1'
const dormir = (ms: number) => new Promise((s) => setTimeout(s, ms))

export class OmieSemCredencialError extends Error {
  constructor() {
    super('credenciais do Omie não cadastradas (omie.app_key e omie.app_secret em Configurações → Segredos)')
    this.name = 'OmieSemCredencialError'
  }
}

export interface CredencialOmie {
  readonly key: string
  readonly secret: string
}

export async function credencialDoOmie(db: pg.Pool): Promise<CredencialOmie | null> {
  try {
    return {
      key: await usarSegredo(db, 'omie.app_key'),
      secret: await usarSegredo(db, 'omie.app_secret'),
    }
  } catch {
    return null
  }
}

export interface RespostaOmie {
  readonly status: number
  readonly corpo: Record<string, unknown>
  /** `faultstring` do Omie, que ele devolve com HTTP 200. */
  readonly falha: string | null
}

/**
 * Uma chamada, com as duas defesas que o Omie EXIGE de quem varre a base.
 *
 * · REDUNDANT — "Consumo redundante detectado. Aguarde N segundos". Ele recusa a
 *   MESMA chamada repetida numa janela curta. Pega retry ingênuo e pega quem
 *   repete a página 1 para conferir algo. A resposta traz o N; obedecer ao número
 *   dele custa menos que chutar um backoff.
 *
 * · HTTP 200 com `faultstring` — credencial inválida NÃO vem como 401. Tratar por
 *   status faria credencial errada parecer sucesso com zero registros.
 *
 * E um 404 vem como `{error:{status_code:404}}`, sem `faultstring`: quem checa só
 * `faultstring` conclui que o endpoint existe. Foi o erro que cometi sondando
 * `ListarTitulos`, que não existe.
 */
export async function chamarOmie(
  cred: CredencialOmie,
  endpoint: string,
  call: string,
  param: Record<string, unknown>,
  { tentativas = 6 }: { tentativas?: number } = {},
): Promise<RespostaOmie> {
  let ultimo: unknown
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(`${BASE}/${endpoint}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ call, app_key: cred.key, app_secret: cred.secret, param: [param] }),
        signal: AbortSignal.timeout(60_000),
      })
      const corpo = (await r.json().catch(() => ({}))) as Record<string, unknown>
      const falha = (corpo['faultstring'] as string | undefined) ?? null

      if (falha && /REDUNDANT|redundante/i.test(falha)) {
        const seg = Number(/Aguarde\s+(\d+)/i.exec(falha)?.[1] ?? 30)
        await dormir((seg + 1) * 1000)
        continue
      }
      if (r.status === 429 || (falha && /too many|limite/i.test(falha))) {
        await dormir(5000 * (i + 1))
        continue
      }
      return { status: r.status, corpo, falha }
    } catch (e) {
      ultimo = e
      await dormir(1500 * (i + 1))
    }
  }
  throw ultimo instanceof Error ? ultimo : new Error(`${call}: esgotou as tentativas`)
}

const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '')

/** CNPJ ou CPF, e não uma sequência de zeros que só tem o formato certo. */
export const documentoUtil = (d: string): boolean =>
  (d.length === 11 || d.length === 14) && !/^0+$/.test(d)

/** dd/mm/aaaa → aaaa-mm-dd. O Omie devolve no formato brasileiro, que ordena errado. */
const data = (v: unknown): string | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v ?? ''))
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

/**
 * Reais (float) → centavos (inteiro).
 *
 * `Math.round` e não `Math.trunc`: 0.1+0.2 em float é 0.30000000000000004, e
 * truncar transforma R$ 1.234,56 em R$ 1.234,55. Somar 124 mil desses erra o
 * suficiente para alguém conferir contra o Omie e não bater.
 */
const centavos = (v: unknown): number => Math.round(Number(v ?? 0) * 100)

export interface FichaOmie {
  documento: string
  codigoOmie: number
  razaoSocial: string
  nomeFantasia: string | null
  pessoaFisica: boolean
  inativo: boolean
  email: string | null
  contato: string | null
  telefone: string | null
  cidade: string | null
  estado: string | null
  cadastradoEm: string | null
  alteradoEm: string | null
  tags: string[]
  caracteristicas: Record<string, string>
}

function comoFicha(f: Record<string, unknown>): FichaOmie | null {
  const documento = soDigitos(f['cnpj_cpf'])
  // Sem documento não há vínculo com o Pulse, e `00000000000` é pior que vazio:
  // 78 fichas o usam — "Cliente Consumidor", GitHub, Slack, Mapbox, Notion. Tratá-lo
  // como documento faria 78 empresas virarem uma.
  if (!documentoUtil(documento)) return null
  const info = (f['info'] ?? {}) as Record<string, unknown>
  const ddd = String(f['telefone1_ddd'] ?? '')
  const num = String(f['telefone1_numero'] ?? '')
  return {
    documento,
    codigoOmie: Number(f['codigo_cliente_omie']),
    razaoSocial: String(f['razao_social'] ?? '').trim() || documento,
    nomeFantasia: (String(f['nome_fantasia'] ?? '').trim() || null),
    pessoaFisica: f['pessoa_fisica'] === 'S',
    inativo: f['inativo'] === 'S',
    email: (String(f['email'] ?? '').trim() || null),
    contato: (String(f['contato'] ?? '').trim() || null),
    telefone: (ddd + num).trim() || null,
    cidade: (String(f['cidade'] ?? '').trim() || null),
    estado: (String(f['estado'] ?? '').trim() || null),
    cadastradoEm: data(info['dInc']),
    alteradoEm: data(info['dAlt']),
    tags: ((f['tags'] ?? []) as Record<string, unknown>[]).map((t) => String(t['tag'] ?? '')).filter(Boolean),
    caracteristicas: Object.fromEntries(
      ((f['caracteristicas'] ?? []) as Record<string, unknown>[])
        .filter((c) => c['campo'])
        .map((c) => [String(c['campo']), String(c['conteudo'] ?? '')]),
    ),
  }
}

export interface ResumoOmie {
  readonly fichas: number
  readonly movimentos: number
  readonly paginasFichas: number
  readonly paginasMovimentos: number
  readonly parcial: boolean
}

/**
 * Varre as fichas de cliente. Para em página VAZIA, nunca na contagem esperada:
 * `total_de_registros` muda durante a varredura, e confiar nele já me fez relatar
 * uma base menor do que era.
 */
export async function lerFichas(
  cred: CredencialOmie,
  { log = () => {} }: { log?: (m: string) => void } = {},
): Promise<{ fichas: FichaOmie[]; paginas: number; parcial: boolean }> {
  const fichas: FichaOmie[] = []
  let paginas = 0
  let parcial = false
  let total = 1

  for (let p = 1; p <= total; p++) {
    const r = await chamarOmie(cred, 'geral/clientes', 'ListarClientes', {
      pagina: p,
      registros_por_pagina: 50,
      exibir_caracteristicas: 'S',
    })
    if (r.falha) {
      log(`fichas, página ${p}: ${r.falha.slice(0, 160)}`)
      parcial = true
      break
    }
    total = Number(r.corpo['total_de_paginas'] ?? p)
    const lote = (r.corpo['clientes_cadastro'] ?? []) as Record<string, unknown>[]
    if (lote.length === 0) break
    paginas = p
    for (const f of lote) {
      const ficha = comoFicha(f)
      if (ficha) fichas.push(ficha)
    }
  }
  return { fichas, paginas, parcial }
}

export interface MovimentoOmie {
  codigoTitulo: number
  documento: string
  codigoCliente: number | null
  categoria: string | null
  status: string | null
  emissao: string | null
  vencimento: string | null
  previsao: string | null
  pagamento: string | null
  valorCentavos: number
  pagoCentavos: number
  abertoCentavos: number
  liquidado: string | null
}

/** Lançamentos a receber. `cNatureza: 'R'` separa de contas a pagar. */
export async function lerMovimentos(
  cred: CredencialOmie,
  { log = () => {}, desde }: { log?: (m: string) => void; desde?: string } = {},
): Promise<{ movimentos: MovimentoOmie[]; paginas: number; parcial: boolean }> {
  const movimentos: MovimentoOmie[] = []
  let paginas = 0
  let parcial = false
  let total = 1

  for (let p = 1; p <= total; p++) {
    const r = await chamarOmie(cred, 'financas/mf', 'ListarMovimentos', {
      nPagina: p,
      nRegPorPagina: 100,
      cNatureza: 'R',
      ...(desde ? { dDtPagtoDe: desde } : {}),
    })
    if (r.falha) {
      log(`movimentos, página ${p}: ${r.falha.slice(0, 160)}`)
      parcial = true
      break
    }
    total = Number(r.corpo['nTotPaginas'] ?? p)
    const lote = (r.corpo['movimentos'] ?? []) as Record<string, unknown>[]
    if (lote.length === 0) break
    paginas = p
    for (const m of lote) {
      const d = (m['detalhes'] ?? {}) as Record<string, unknown>
      const s = (m['resumo'] ?? {}) as Record<string, unknown>
      const documento = soDigitos(d['cCPFCNPJCliente'])
      if (!documentoUtil(documento)) continue
      // `ListarMovimentos` mistura TÍTULO e BAIXA na mesma lista, e só o valor as
      // separa: título tem `nValorTitulo > 0`, baixa tem zero. Reconciliado contra
      // `ListarContasReceber` — mesmos códigos, mesmo total (ver migration 0037).
      // Guardar as duas somaria o recebimento duas vezes.
      const valorCentavos = centavos(d['nValorTitulo'])
      if (valorCentavos <= 0) continue
      const codigoTitulo = Number(d['nCodTitulo'])
      if (!Number.isFinite(codigoTitulo) || codigoTitulo <= 0) continue
      movimentos.push({
        codigoTitulo,
        documento,
        codigoCliente: d['nCodCliente'] ? Number(d['nCodCliente']) : null,
        categoria: (String(d['cCodCateg'] ?? '').trim() || null),
        status: (String(d['cStatus'] ?? '').trim() || null),
        emissao: data(d['dDtEmissao']),
        vencimento: data(d['dDtVenc']),
        previsao: data(d['dDtPrevisao']),
        pagamento: data(d['dDtPagamento']),
        valorCentavos,
        pagoCentavos: centavos(s['nValPago']),
        abertoCentavos: centavos(s['nValAberto']),
        liquidado: (String(s['cLiquidado'] ?? '').trim() || null),
      })
    }
  }
  return { movimentos, paginas, parcial }
}

/**
 * Deduplica por chave, mantendo a ÚLTIMA ocorrência.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ Não é zelo preventivo: derrubou o C20 na primeira execução em produção, em  │
 * │ 13/08/2026, depois de 17 minutos de varredura. `ON CONFLICT DO UPDATE`      │
 * │ recusa o lote inteiro com "cannot affect row a second time" quando a MESMA  │
 * │ chave aparece duas vezes no comando — o Postgres não sabe qual das duas     │
 * │ deveria vencer, e não escolhe por você.                                     │
 * │                                                                            │
 * │ E as chaves repetem por dois motivos reais: o Omie tem 21 títulos com       │
 * │ código duplicado, e a paginação de 193 páginas anda enquanto a base muda —  │
 * │ um registro pode aparecer em duas páginas.                                  │
 * │                                                                            │
 * │ A ÚLTIMA vence porque a varredura vai da página 1 em diante: quando um      │
 * │ registro reaparece adiante, a ocorrência mais recente é a melhor aposta.    │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
function porChave<T>(itens: readonly T[], chave: (t: T) => number | string): T[] {
  const m = new Map<number | string, T>()
  for (const i of itens) m.set(chave(i), i)
  return [...m.values()]
}

/**
 * Grava as duas cópias. `ON CONFLICT DO UPDATE` em vez de apagar e reinserir:
 * apagar deixaria a tela vazia durante a carga, e uma carga PARCIAL apagaria dado
 * bom para gravar menos do que havia.
 */
export async function gravarOmie(
  db: pg.Pool,
  dados: { fichas?: FichaOmie[]; movimentos?: MovimentoOmie[] },
): Promise<{ fichas: number; movimentos: number }> {
  let fichas = 0
  let movimentos = 0

  for (const lote of emLotes(porChave(dados.fichas ?? [], (f) => f.codigoOmie), 500)) {
    const { rowCount } = await db.query(
      `INSERT INTO core.omie_cliente
         (documento, codigo_omie, razao_social, nome_fantasia, pessoa_fisica, inativo,
          email, contato, telefone, cidade, estado, cadastrado_em, alterado_em,
          tags, caracteristicas, sincronizado_em)
       SELECT x.documento, x.codigo_omie, x.razao_social, x.nome_fantasia, x.pessoa_fisica,
              x.inativo, x.email, x.contato, x.telefone, x.cidade, x.estado,
              x.cadastrado_em, x.alterado_em, x.tags, x.caracteristicas, now()
         FROM jsonb_to_recordset($1::jsonb) AS x(
           documento text, codigo_omie bigint, razao_social text, nome_fantasia text,
           pessoa_fisica boolean, inativo boolean, email text, contato text, telefone text,
           cidade text, estado text, cadastrado_em date, alterado_em date,
           tags jsonb, caracteristicas jsonb)
       ON CONFLICT (codigo_omie) DO UPDATE SET
         documento = EXCLUDED.documento, razao_social = EXCLUDED.razao_social,
         nome_fantasia = EXCLUDED.nome_fantasia, pessoa_fisica = EXCLUDED.pessoa_fisica,
         inativo = EXCLUDED.inativo, email = EXCLUDED.email, contato = EXCLUDED.contato,
         telefone = EXCLUDED.telefone, cidade = EXCLUDED.cidade, estado = EXCLUDED.estado,
         cadastrado_em = EXCLUDED.cadastrado_em, alterado_em = EXCLUDED.alterado_em,
         tags = EXCLUDED.tags, caracteristicas = EXCLUDED.caracteristicas,
         sincronizado_em = now()`,
      [JSON.stringify(lote.map((f) => ({
        documento: f.documento, codigo_omie: f.codigoOmie, razao_social: f.razaoSocial,
        nome_fantasia: f.nomeFantasia, pessoa_fisica: f.pessoaFisica, inativo: f.inativo,
        email: f.email, contato: f.contato, telefone: f.telefone, cidade: f.cidade,
        estado: f.estado, cadastrado_em: f.cadastradoEm, alterado_em: f.alteradoEm,
        tags: f.tags, caracteristicas: f.caracteristicas,
      })))],
    )
    fichas += rowCount ?? 0
  }

  for (const lote of emLotes(porChave(dados.movimentos ?? [], (m) => m.codigoTitulo), 1000)) {
    const { rowCount } = await db.query(
      `INSERT INTO core.omie_titulo
         (codigo_titulo, documento, codigo_cliente, categoria, status, emissao, vencimento,
          previsao, pagamento, valor_centavos, pago_centavos, aberto_centavos, liquidado,
          sincronizado_em)
       SELECT x.codigo_titulo, x.documento, x.codigo_cliente, x.categoria, x.status,
              x.emissao, x.vencimento, x.previsao, x.pagamento, x.valor_centavos,
              x.pago_centavos, x.aberto_centavos, x.liquidado, now()
         FROM jsonb_to_recordset($1::jsonb) AS x(
           codigo_titulo bigint, documento text, codigo_cliente bigint, categoria text,
           status text, emissao date, vencimento date, previsao date, pagamento date,
           valor_centavos bigint, pago_centavos bigint, aberto_centavos bigint, liquidado text)
       ON CONFLICT (codigo_titulo) DO UPDATE SET
         documento = EXCLUDED.documento, codigo_cliente = EXCLUDED.codigo_cliente,
         categoria = EXCLUDED.categoria, status = EXCLUDED.status, emissao = EXCLUDED.emissao,
         vencimento = EXCLUDED.vencimento, previsao = EXCLUDED.previsao,
         pagamento = EXCLUDED.pagamento, valor_centavos = EXCLUDED.valor_centavos,
         pago_centavos = EXCLUDED.pago_centavos, aberto_centavos = EXCLUDED.aberto_centavos,
         liquidado = EXCLUDED.liquidado, sincronizado_em = now()`,
      [JSON.stringify(lote.map((m) => ({
        codigo_titulo: m.codigoTitulo, documento: m.documento, codigo_cliente: m.codigoCliente,
        categoria: m.categoria, status: m.status, emissao: m.emissao, vencimento: m.vencimento,
        previsao: m.previsao, pagamento: m.pagamento, valor_centavos: m.valorCentavos,
        pago_centavos: m.pagoCentavos, aberto_centavos: m.abertoCentavos, liquidado: m.liquidado,
      })))],
    )
    movimentos += rowCount ?? 0
  }

  return { fichas, movimentos }
}

function* emLotes<T>(itens: readonly T[], n: number): Generator<T[]> {
  for (let i = 0; i < itens.length; i += n) yield itens.slice(i, i + n)
}
