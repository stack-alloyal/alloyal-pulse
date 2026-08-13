import type pg from 'pg'

/**
 * A ficha completa de um cliente: o que o Admin sabe e o que o Omie sabe.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O VÍNCULO É POR DOCUMENTO, e em DOIS níveis, porque medir mostrou que um    │
 * │ nível só não serve:                                                        │
 * │                                                                            │
 * │ · exato — o CNPJ da conta é o mesmo da ficha do Omie. Vale para 1.157 dos   │
 * │   1.457 clientes com tag `Cliente` (79,4%).                                │
 * │ · pela raiz (8 primeiros dígitos) — a Alloyal fatura a MATRIZ e atende      │
 * │   várias filiais/programas. Sem este nível, a filial aparece sem financeiro │
 * │   nenhum, como se não fosse cliente.                                       │
 * │                                                                            │
 * │ Qual nível casou vai JUNTO na resposta. "R$ 40 mil em aberto" quando o      │
 * │ vínculo é pela raiz significa "da matriz, que cobre esta e outras filiais", │
 * │ e a tela precisa dizer isso — senão alguém cobra a filial pelo valor do     │
 * │ grupo inteiro.                                                             │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

export type NivelDoVinculo = 'vinculado' | 'raiz' | 'nenhum'

export interface ContaDoAdmin {
  readonly id: string
  readonly razaoSocial: string
  readonly cnpj: string | null
  readonly brandId: string | null
  readonly branchId: string | null
  readonly hubspotCompanyId: string | null
  readonly statusCore: string | null
  readonly ativo: boolean
  readonly porte: string | null
  readonly setor: string | null
  readonly csmEmail: string | null
  readonly ownerComercialEmail: string | null
  readonly contatoEmail: string | null
  readonly usuariosCadastrados: number
  readonly usuariosAutorizados: number
  readonly logoUrl: string | null
  readonly criadoEm: Date | null
  readonly sincronizadoEm: Date | null
  readonly paiId: string | null
  readonly paiRazaoSocial: string | null
  readonly subs: number
}

export interface FichaOmieDoCliente {
  readonly documento: string
  readonly codigoOmie: string
  readonly razaoSocial: string
  readonly nomeFantasia: string | null
  readonly pessoaFisica: boolean
  readonly inativo: boolean
  readonly email: string | null
  readonly contato: string | null
  readonly telefone: string | null
  readonly cidade: string | null
  readonly estado: string | null
  readonly cadastradoEm: Date | null
  readonly alteradoEm: Date | null
  readonly tags: string[]
  readonly caracteristicas: Record<string, string>
  readonly hubspotId: string | null
  readonly sincronizadoEm: Date | null
}

export interface Faturamento {
  readonly codigoTitulo: string
  readonly categoria: string | null
  readonly status: string | null
  readonly emissao: Date | null
  readonly vencimento: Date | null
  readonly previsao: Date | null
  readonly pagamento: Date | null
  readonly valorCentavos: string
  readonly pagoCentavos: string
  readonly abertoCentavos: string
  readonly documento: string
}

export interface ResumoFinanceiro {
  readonly titulos: number
  readonly totalCentavos: number
  readonly pagoCentavos: number
  readonly abertoCentavos: number
  /**
   * O que já venceu, e o que ainda vai vencer — separados de propósito.
   *
   * Descoberto olhando a tela pronta da HINOVA: ela mostrava "Faturado
   * R$ 7,05 milhões", e o número somava parcelas com vencimento até 2043. Isso
   * não é faturamento, é carteira contratada. Quem lê "faturado" entende
   * "já cobramos", e agiria em cima de um número sete vezes maior que o real.
   */
  readonly titulosVencidos: number
  readonly vencidoCentavos: number
  readonly aVencerCentavos: number
  readonly titulosAVencer: number
  readonly primeiroVencimento: Date | null
  readonly ultimoVencimento: Date | null
  readonly ultimoPagamento: Date | null
  readonly proximaPrevisao: Date | null
  readonly categorias: { categoria: string; titulos: number; totalCentavos: number }[]
  /** Faturado por mês de vencimento. `futuro` marca o que ainda não venceu. */
  readonly porMes: { mes: string; titulos: number; totalCentavos: number; pagoCentavos: number; futuro: boolean }[]
}

export interface FichaDoCliente {
  readonly conta: ContaDoAdmin
  readonly omie: FichaOmieDoCliente | null
  readonly vinculo: NivelDoVinculo
  /** Documentos do Omie considerados — mais de um quando o vínculo é pela raiz. */
  readonly documentos: string[]
  readonly resumo: ResumoFinanceiro
  readonly faturamento: Faturamento[]
}

const CONTA = `
  a.id::text, a.razao_social AS "razaoSocial", a.cnpj, a.brand_id AS "brandId",
  a.branch_id AS "branchId", a.hubspot_company_id AS "hubspotCompanyId",
  a.status_core AS "statusCore", a.ativo, a.porte, a.setor,
  a.csm_email AS "csmEmail", a.owner_comercial_email AS "ownerComercialEmail",
  a.contato_email AS "contatoEmail", a.usuarios_cadastrados AS "usuariosCadastrados",
  a.usuarios_autorizados AS "usuariosAutorizados", a.logo_url AS "logoUrl",
  a.criado_em AS "criadoEm", a.sincronizado_em AS "sincronizadoEm",
  a.parent_account_id::text AS "paiId", p.razao_social AS "paiRazaoSocial",
  (SELECT count(*) FROM core.account f WHERE f.parent_account_id = a.id)::int AS subs`

export async function lerContaDoAdmin(db: pg.Pool, id: string): Promise<ContaDoAdmin | null> {
  const { rows } = await db.query<ContaDoAdmin>(
    `SELECT ${CONTA} FROM core.account a
       LEFT JOIN core.account p ON p.id = a.parent_account_id
      WHERE a.id = $1`,
    [id],
  )
  return rows[0] ?? null
}

/**
 * Resolve quais documentos do Omie pertencem a esta conta, e por qual nível.
 *
 * A ordem importa: tenta o exato primeiro. Cair na raiz quando existe ficha exata
 * traria o financeiro do grupo para uma conta que tem o próprio — e o número
 * ficaria maior que a realidade dela, sem nada na tela explicando por quê.
 */
export async function documentosDoOmie(
  db: pg.Pool,
  accountId: string,
  cnpj: string | null,
): Promise<{ documentos: string[]; vinculo: NivelDoVinculo }> {
  // O VÍNCULO GRAVADO VENCE. Ele é o que alguém decidiu, com motivo e trilha
  // (0038), e existe justamente porque a regra automática errou na Swile: casou o
  // CNPJ exato com a ficha morta e deixou R$ 1,5 milhão numa ficha que a regra não
  // alcançava. Deduzir de novo aqui desfaria a decisão em silêncio.
  const gravado = await db.query<{ chave: string }>(
    `SELECT chave FROM core.vinculo_cliente
      WHERE account_id = $1 AND fonte = 'omie' ORDER BY chave`,
    [accountId],
  )
  if (gravado.rows.length > 0) {
    return { documentos: gravado.rows.map((r) => r.chave), vinculo: 'vinculado' }
  }

  // Sem vínculo gravado, a raiz continua servindo para EXIBIR — a Alloyal fatura a
  // matriz e atende as filiais. A tela diz que o nível é a raiz, e o número é do
  // grupo.
  const doc = (cnpj ?? '').replace(/\D/g, '')
  if (doc.length === 14) {
    const raiz = await db.query<{ documento: string }>(
      'SELECT DISTINCT documento FROM core.omie_cliente WHERE length(documento) = 14 AND left(documento, 8) = $1 ORDER BY documento',
      [doc.slice(0, 8)],
    )
    if (raiz.rows.length > 0) {
      return { documentos: raiz.rows.map((r) => r.documento), vinculo: 'raiz' }
    }
  }
  return { documentos: [], vinculo: 'nenhum' }
}

export async function lerFichaOmie(db: pg.Pool, documento: string): Promise<FichaOmieDoCliente | null> {
  const { rows } = await db.query<FichaOmieDoCliente>(
    `SELECT documento, codigo_omie::text AS "codigoOmie", razao_social AS "razaoSocial",
            nome_fantasia AS "nomeFantasia", pessoa_fisica AS "pessoaFisica", inativo,
            email, contato, telefone, cidade, estado,
            cadastrado_em AS "cadastradoEm", alterado_em AS "alteradoEm",
            tags, caracteristicas, hubspot_id AS "hubspotId",
            sincronizado_em AS "sincronizadoEm"
       FROM core.omie_cliente WHERE documento = $1
      ORDER BY inativo, alterado_em DESC NULLS LAST, codigo_omie DESC
      LIMIT 1`,
    [documento],
  )
  return rows[0] ?? null
}

/**
 * O histórico de faturamento, INTEIRO — do que já venceu.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ `incluirFuturo` existe e é `false` por padrão, por decisão de 13/08/2026:   │
 * │ a tela mostra o passado. A base tem parcelas contratadas com vencimento até │
 * │ 2043 — na HINOVA são 712 delas, R$ 6,7 milhões contra R$ 356 mil já         │
 * │ vencidos. Misturadas, elas afogam o histórico real numa proporção de 19:1.  │
 * │                                                                            │
 * │ É opção e não regra fixa porque a carteira futura é informação legítima —   │
 * │ só não é "faturamento". Quando houver tela para ela, o parâmetro já está    │
 * │ aqui.                                                                      │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Sem `LIMIT`: a pergunta é "todo o histórico", e cortar em 100 faria a soma da
 * tela discordar do resumo sem nada avisar. A consulta usa o índice
 * `(documento, vencimento DESC)`.
 */
export async function lerFaturamento(
  db: pg.Pool,
  documentos: readonly string[],
  { incluirFuturo = false }: { incluirFuturo?: boolean } = {},
): Promise<Faturamento[]> {
  if (documentos.length === 0) return []
  const { rows } = await db.query<Faturamento>(
    `SELECT codigo_titulo::text AS "codigoTitulo", categoria, status, emissao, vencimento,
            previsao, pagamento, valor_centavos::text AS "valorCentavos",
            pago_centavos::text AS "pagoCentavos", aberto_centavos::text AS "abertoCentavos",
            documento
       FROM core.omie_titulo
      WHERE documento = ANY($1::text[])
        AND ($2::boolean OR vencimento IS NULL OR vencimento <= current_date)
      ORDER BY vencimento DESC NULLS LAST, codigo_titulo DESC`,
    [documentos, incluirFuturo],
  )
  return rows
}

export async function resumoFinanceiro(db: pg.Pool, documentos: readonly string[]): Promise<ResumoFinanceiro> {
  const vazio: ResumoFinanceiro = {
    titulos: 0, totalCentavos: 0, pagoCentavos: 0, abertoCentavos: 0,
    titulosVencidos: 0, vencidoCentavos: 0, aVencerCentavos: 0, titulosAVencer: 0,
    primeiroVencimento: null, ultimoVencimento: null, ultimoPagamento: null,
    proximaPrevisao: null, categorias: [], porMes: [],
  }
  if (documentos.length === 0) return vazio

  const [tot, cat, mes] = await Promise.all([
    db.query<Record<string, unknown>>(
      `SELECT count(*)::int titulos,
              coalesce(sum(valor_centavos) FILTER (WHERE vencimento IS NULL OR vencimento <= current_date),0)::bigint total,
              coalesce(sum(pago_centavos) FILTER (WHERE vencimento IS NULL OR vencimento <= current_date),0)::bigint pago,
              coalesce(sum(aberto_centavos) FILTER (WHERE vencimento IS NULL OR vencimento <= current_date),0)::bigint aberto,
              count(*) FILTER (WHERE vencimento IS NULL OR vencimento <= current_date)::int venc_n,
              coalesce(sum(valor_centavos) FILTER (WHERE vencimento IS NULL OR vencimento <= current_date),0)::bigint vencido,
              count(*) FILTER (WHERE vencimento > current_date)::int aven_n,
              coalesce(sum(valor_centavos) FILTER (WHERE vencimento > current_date),0)::bigint a_vencer,
              min(vencimento) primeiro, max(vencimento) ultimo,
              max(pagamento) ultimo_pagto,
              min(previsao) FILTER (WHERE aberto_centavos > 0) proxima
         FROM core.omie_titulo WHERE documento = ANY($1::text[])`,
      [documentos],
    ),
    db.query<{ categoria: string; titulos: number; total: string }>(
      `SELECT coalesce(categoria,'—') categoria, count(*)::int titulos,
              coalesce(sum(valor_centavos),0)::text total
         FROM core.omie_titulo
        WHERE documento = ANY($1::text[])
          AND (vencimento IS NULL OR vencimento <= current_date)
        GROUP BY 1 ORDER BY sum(valor_centavos) DESC`,
      [documentos],
    ),
    db.query<{ mes: string; titulos: number; total: string; pago: string; futuro: boolean }>(
      `SELECT to_char(date_trunc('month', vencimento),'YYYY-MM') mes, count(*)::int titulos,
              coalesce(sum(valor_centavos),0)::text total,
              coalesce(sum(pago_centavos),0)::text pago,
              bool_and(vencimento > current_date) futuro
         FROM core.omie_titulo
        WHERE documento = ANY($1::text[]) AND vencimento IS NOT NULL
          AND vencimento <= current_date
        GROUP BY 1 ORDER BY 1`,
      [documentos],
    ),
  ])

  const t = tot.rows[0] ?? {}
  return {
    // `titulos` é a contagem do que a tela MOSTRA — o passado. O total bruto
    // incluiria as parcelas futuras e o número não bateria com a tabela abaixo.
    titulos: Number(t['venc_n'] ?? 0),
    totalCentavos: Number(t['total'] ?? 0),
    pagoCentavos: Number(t['pago'] ?? 0),
    abertoCentavos: Number(t['aberto'] ?? 0),
    titulosVencidos: Number(t['venc_n'] ?? 0),
    vencidoCentavos: Number(t['vencido'] ?? 0),
    titulosAVencer: Number(t['aven_n'] ?? 0),
    aVencerCentavos: Number(t['a_vencer'] ?? 0),
    primeiroVencimento: (t['primeiro'] as Date | null) ?? null,
    ultimoVencimento: (t['ultimo'] as Date | null) ?? null,
    ultimoPagamento: (t['ultimo_pagto'] as Date | null) ?? null,
    proximaPrevisao: (t['proxima'] as Date | null) ?? null,
    categorias: cat.rows.map((c) => ({ categoria: c.categoria, titulos: c.titulos, totalCentavos: Number(c.total) })),
    porMes: mes.rows.map((m) => ({
      mes: m.mes, titulos: m.titulos, totalCentavos: Number(m.total),
      pagoCentavos: Number(m.pago), futuro: m.futuro,
    })),
  }
}

/** Tudo de uma vez, que é o que a página precisa. */
export async function fichaDoCliente(db: pg.Pool, id: string): Promise<FichaDoCliente | null> {
  const conta = await lerContaDoAdmin(db, id)
  if (!conta) return null

  const { documentos, vinculo } = await documentosDoOmie(db, id, conta.cnpj)
  const [omie, resumo, faturamento] = await Promise.all([
    documentos[0] ? lerFichaOmie(db, documentos[0]) : Promise.resolve(null),
    resumoFinanceiro(db, documentos),
    lerFaturamento(db, documentos),
  ])
  return { conta, omie, vinculo, documentos, resumo, faturamento }
}
