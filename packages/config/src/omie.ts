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
      // "Já existe uma requisição desse método sendo executada": o Omie SERIALIZA o
      // mesmo método por app_key. Descoberto em 13/08/2026 consultando enquanto o
      // C20 varria — a consulta ad hoc levou a recusa, não o ciclo. Sem este ramo,
      // qualquer sondagem durante a janela do ciclo devolve zero registros e quem
      // olha conclui que o cliente não tem faturamento.
      if (falha && /já existe uma requisição|sendo executada/i.test(falha)) {
        await dormir(8000 * (i + 1))
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
): Promise<{ movimentos: MovimentoOmie[]; baixas: BaixaOmie[]; paginas: number; parcial: boolean }> {
  const movimentos: MovimentoOmie[] = []
  // As linhas com valor de título ZERO são movimento de caixa, não título. Já
  // vinham na mesma varredura e eram descartadas: guardá-las é de graça, e elas
  // carregam juros, multa e a data real do dinheiro.
  const baixas: BaixaOmie[] = []
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
      const codigoTitulo = Number(d['nCodTitulo'])
      if (valorCentavos <= 0) {
        if (Number.isFinite(codigoTitulo) && codigoTitulo > 0) {
          baixas.push({
            codigoTitulo,
            documento,
            pagamento: data(d['dDtPagamento']),
            pagoCentavos: centavos(s['nValPago']),
            jurosCentavos: centavos(s['nJuros']),
            multaCentavos: centavos(s['nMulta']),
            descontoCentavos: centavos(s['nDesconto']),
            categoria: (String(d['cCodCateg'] ?? '').trim() || null),
          })
        }
        continue
      }
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
  return { movimentos, baixas, paginas, parcial }
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

// ═══ Categorias ══════════════════════════════════════════════════════════════

export interface CategoriaOmie {
  codigo: string
  descricao: string
  categoriaSuperior: string | null
  natureza: string | null
  tipo: string | null
  contaReceita: boolean
  contaDespesa: boolean
  totalizadora: boolean
  inativa: boolean
}

/**
 * O plano de categorias. 225 na conta, em 5 páginas.
 *
 * Existe porque as telas mostravam `1.01.02` e ninguém fora do financeiro sabe o
 * que é. O nome estava a uma chamada de distância — e o de 1.01.02 é, literalmente,
 * "MRR".
 */
export async function lerCategorias(
  cred: CredencialOmie,
  { log = () => {} }: { log?: (m: string) => void } = {},
): Promise<{ categorias: CategoriaOmie[]; parcial: boolean }> {
  const categorias: CategoriaOmie[] = []
  let parcial = false
  let total = 1
  for (let p = 1; p <= total; p++) {
    const r = await chamarOmie(cred, 'geral/categorias', 'ListarCategorias', {
      pagina: p,
      registros_por_pagina: 50,
    })
    if (r.falha) {
      log(`categorias, página ${p}: ${r.falha.slice(0, 160)}`)
      parcial = true
      break
    }
    total = Number(r.corpo['total_de_paginas'] ?? p)
    const lote = (r.corpo['categoria_cadastro'] ?? []) as Record<string, unknown>[]
    if (lote.length === 0) break
    for (const c of lote) {
      const codigo = String(c['codigo'] ?? '').trim()
      if (!codigo) continue
      categorias.push({
        codigo,
        descricao: String(c['descricao'] ?? '').trim() || codigo,
        categoriaSuperior: (String(c['categoria_superior'] ?? '').trim() || null),
        natureza: (String(c['natureza'] ?? '').trim() || null),
        tipo: (String(c['tipo_categoria'] ?? '').trim() || null),
        contaReceita: c['conta_receita'] === 'S',
        contaDespesa: c['conta_despesa'] === 'S',
        totalizadora: c['totalizadora'] === 'S',
        inativa: c['conta_inativa'] === 'S',
      })
    }
  }
  return { categorias, parcial }
}

export async function gravarCategorias(
  db: pg.Pool,
  categorias: readonly CategoriaOmie[],
): Promise<number> {
  if (categorias.length === 0) return 0
  const unicas = porChave(categorias, (c) => c.codigo)
  const { rowCount } = await db.query(
    `INSERT INTO core.omie_categoria
       (codigo, descricao, categoria_superior, natureza, tipo,
        conta_receita, conta_despesa, totalizadora, inativa, sincronizado_em)
     SELECT x.codigo, x.descricao, x.categoria_superior, x.natureza, x.tipo,
            x.conta_receita, x.conta_despesa, x.totalizadora, x.inativa, now()
       FROM jsonb_to_recordset($1::jsonb) AS x(
         codigo text, descricao text, categoria_superior text, natureza text, tipo text,
         conta_receita boolean, conta_despesa boolean, totalizadora boolean, inativa boolean)
     ON CONFLICT (codigo) DO UPDATE SET
       descricao = EXCLUDED.descricao, categoria_superior = EXCLUDED.categoria_superior,
       natureza = EXCLUDED.natureza, tipo = EXCLUDED.tipo,
       conta_receita = EXCLUDED.conta_receita, conta_despesa = EXCLUDED.conta_despesa,
       totalizadora = EXCLUDED.totalizadora, inativa = EXCLUDED.inativa,
       sincronizado_em = now()`,
    [JSON.stringify(unicas.map((c) => ({
      codigo: c.codigo, descricao: c.descricao, categoria_superior: c.categoriaSuperior,
      natureza: c.natureza, tipo: c.tipo, conta_receita: c.contaReceita,
      conta_despesa: c.contaDespesa, totalizadora: c.totalizadora, inativa: c.inativa,
    })))],
  )
  return rowCount ?? 0
}

// ═══ Vendedores, contratos e baixas ══════════════════════════════════════════

export interface VendedorOmie {
  codigo: number
  nome: string
  email: string | null
  comissao: number | null
  inativo: boolean
}

export async function lerVendedores(cred: CredencialOmie): Promise<VendedorOmie[]> {
  const out: VendedorOmie[] = []
  let total = 1
  for (let p = 1; p <= total; p++) {
    const r = await chamarOmie(cred, 'geral/vendedores', 'ListarVendedores', {
      pagina: p, registros_por_pagina: 50,
    })
    if (r.falha) break
    total = Number(r.corpo['total_de_paginas'] ?? p)
    const lote = (r.corpo['cadastro'] ?? []) as Record<string, unknown>[]
    if (lote.length === 0) break
    for (const v of lote) {
      const codigo = Number(v['codigo'])
      if (!Number.isFinite(codigo)) continue
      out.push({
        codigo,
        nome: String(v['nome'] ?? '').trim() || String(codigo),
        email: (String(v['email'] ?? '').trim() || null),
        comissao: v['comissao'] === undefined ? null : Number(v['comissao']),
        inativo: v['inativo'] === 'S',
      })
    }
  }
  return out
}

export interface ContratoOmie {
  codigo: number
  numero: string | null
  codigoCliente: number | null
  situacao: string | null
  vigenciaInicio: string | null
  vigenciaFim: string | null
  diaFaturamento: number | null
  tipoFaturamento: string | null
  valorMensalCentavos: number
  codigoVendedor: number | null
  categoria: string | null
}

/**
 * Contratos de serviço. `nValTotMes` é o valor MENSAL — MRR na fonte.
 *
 * O documento do cliente não vem no contrato, só o código: a gravação resolve isso
 * com um join contra `core.omie_cliente`, que já está sincronizada.
 */
export async function lerContratos(
  cred: CredencialOmie,
  { log = () => {} }: { log?: (m: string) => void } = {},
): Promise<{ contratos: ContratoOmie[]; parcial: boolean }> {
  const contratos: ContratoOmie[] = []
  let parcial = false
  let total = 1
  for (let p = 1; p <= total; p++) {
    const r = await chamarOmie(cred, 'servicos/contrato', 'ListarContratos', {
      pagina: p, registros_por_pagina: 50,
    })
    if (r.falha) {
      log(`contratos, página ${p}: ${r.falha.slice(0, 140)}`)
      parcial = true
      break
    }
    total = Number(r.corpo['total_de_paginas'] ?? p)
    const lote = (r.corpo['contratoCadastro'] ?? []) as Record<string, unknown>[]
    if (lote.length === 0) break
    for (const c of lote) {
      const cab = (c['cabecalho'] ?? {}) as Record<string, unknown>
      const inf = (c['infAdic'] ?? {}) as Record<string, unknown>
      const codigo = Number(cab['nCodCtr'])
      if (!Number.isFinite(codigo)) continue
      contratos.push({
        codigo,
        numero: (String(cab['cNumCtr'] ?? '').trim() || null),
        codigoCliente: cab['nCodCli'] ? Number(cab['nCodCli']) : null,
        situacao: (String(cab['cCodSit'] ?? '').trim() || null),
        vigenciaInicio: data(cab['dVigInicial']),
        vigenciaFim: data(cab['dVigFinal']),
        diaFaturamento: cab['nDiaFat'] ? Number(cab['nDiaFat']) : null,
        tipoFaturamento: (String(cab['cTipoFat'] ?? '').trim() || null),
        valorMensalCentavos: centavos(cab['nValTotMes']),
        codigoVendedor: inf['nCodVend'] ? Number(inf['nCodVend']) : null,
        categoria: (String(inf['cCodCateg'] ?? '').trim() || null),
      })
    }
  }
  return { contratos, parcial }
}

export interface BaixaOmie {
  codigoTitulo: number
  documento: string
  pagamento: string | null
  pagoCentavos: number
  jurosCentavos: number
  multaCentavos: number
  descontoCentavos: number
  categoria: string | null
}

export async function gravarExtras(
  db: pg.Pool,
  d: {
    vendedores?: readonly VendedorOmie[]
    contratos?: readonly ContratoOmie[]
    baixas?: readonly BaixaOmie[]
  },
): Promise<{ vendedores: number; contratos: number; baixas: number }> {
  let vendedores = 0
  let contratos = 0
  let baixas = 0

  if (d.vendedores?.length) {
    const r = await db.query(
      `INSERT INTO core.omie_vendedor (codigo, nome, email, comissao, inativo, sincronizado_em)
       SELECT x.codigo, x.nome, x.email, x.comissao, x.inativo, now()
         FROM jsonb_to_recordset($1::jsonb) AS x(
           codigo bigint, nome text, email text, comissao numeric, inativo boolean)
       ON CONFLICT (codigo) DO UPDATE SET nome=EXCLUDED.nome, email=EXCLUDED.email,
         comissao=EXCLUDED.comissao, inativo=EXCLUDED.inativo, sincronizado_em=now()`,
      [JSON.stringify(porChave(d.vendedores, (v) => v.codigo))],
    )
    vendedores = r.rowCount ?? 0
  }

  for (const lote of emLotes(porChave(d.contratos ?? [], (c) => c.codigo), 500)) {
    const r = await db.query(
      `INSERT INTO core.omie_contrato
         (codigo, numero, codigo_cliente, documento, situacao, vigencia_inicio, vigencia_fim,
          dia_faturamento, tipo_faturamento, valor_mensal_centavos, codigo_vendedor, categoria,
          sincronizado_em)
       SELECT x.codigo, x.numero, x.codigo_cliente,
              -- O documento vem do cliente já sincronizado: o contrato só traz o
              -- código, e o documento é a chave por onde tudo se liga aqui.
              (SELECT o.documento FROM core.omie_cliente o WHERE o.codigo_omie = x.codigo_cliente),
              x.situacao, x.vigencia_inicio, x.vigencia_fim, x.dia_faturamento,
              x.tipo_faturamento, x.valor_mensal_centavos, x.codigo_vendedor, x.categoria, now()
         FROM jsonb_to_recordset($1::jsonb) AS x(
           codigo bigint, numero text, codigo_cliente bigint, situacao text,
           vigencia_inicio date, vigencia_fim date, dia_faturamento smallint,
           tipo_faturamento text, valor_mensal_centavos bigint, codigo_vendedor bigint,
           categoria text)
       ON CONFLICT (codigo) DO UPDATE SET
         numero=EXCLUDED.numero, codigo_cliente=EXCLUDED.codigo_cliente,
         documento=EXCLUDED.documento, situacao=EXCLUDED.situacao,
         vigencia_inicio=EXCLUDED.vigencia_inicio, vigencia_fim=EXCLUDED.vigencia_fim,
         dia_faturamento=EXCLUDED.dia_faturamento, tipo_faturamento=EXCLUDED.tipo_faturamento,
         valor_mensal_centavos=EXCLUDED.valor_mensal_centavos,
         codigo_vendedor=EXCLUDED.codigo_vendedor, categoria=EXCLUDED.categoria,
         sincronizado_em=now()`,
      [JSON.stringify(lote.map((c) => ({
        codigo: c.codigo, numero: c.numero, codigo_cliente: c.codigoCliente,
        situacao: c.situacao, vigencia_inicio: c.vigenciaInicio, vigencia_fim: c.vigenciaFim,
        dia_faturamento: c.diaFaturamento, tipo_faturamento: c.tipoFaturamento,
        valor_mensal_centavos: c.valorMensalCentavos, codigo_vendedor: c.codigoVendedor,
        categoria: c.categoria,
      })))],
    )
    contratos += r.rowCount ?? 0
  }

  const chaveDaBaixa = (b: BaixaOmie) => `${b.codigoTitulo}|${b.pagamento}|${b.pagoCentavos}`
  for (const lote of emLotes(porChave(d.baixas ?? [], chaveDaBaixa), 1000)) {
    const r = await db.query(
      `INSERT INTO core.omie_baixa
         (codigo_titulo, pagamento, documento, pago_centavos, juros_centavos,
          multa_centavos, desconto_centavos, categoria, sincronizado_em)
       SELECT x.codigo_titulo, x.pagamento, x.documento, x.pago_centavos, x.juros_centavos,
              x.multa_centavos, x.desconto_centavos, x.categoria, now()
         FROM jsonb_to_recordset($1::jsonb) AS x(
           codigo_titulo bigint, pagamento date, documento text, pago_centavos bigint,
           juros_centavos bigint, multa_centavos bigint, desconto_centavos bigint, categoria text)
       -- O alvo é o índice EXPRESSO da 0043, e não a lista de colunas: 3.391
       -- baixas não têm data, e NULL não se compara consigo mesmo num único.
       ON CONFLICT (codigo_titulo, coalesce(pagamento, DATE '0001-01-01'), pago_centavos)
       DO UPDATE SET
         documento=EXCLUDED.documento, juros_centavos=EXCLUDED.juros_centavos,
         multa_centavos=EXCLUDED.multa_centavos, desconto_centavos=EXCLUDED.desconto_centavos,
         categoria=EXCLUDED.categoria, sincronizado_em=now()`,
      [JSON.stringify(lote.map((b) => ({
        codigo_titulo: b.codigoTitulo, pagamento: b.pagamento, documento: b.documento,
        pago_centavos: b.pagoCentavos, juros_centavos: b.jurosCentavos,
        multa_centavos: b.multaCentavos, desconto_centavos: b.descontoCentavos,
        categoria: b.categoria,
      })))],
    )
    baixas += r.rowCount ?? 0
  }

  return { vendedores, contratos, baixas }
}
