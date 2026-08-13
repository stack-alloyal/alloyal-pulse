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
  readonly categoriaNome: string | null
  readonly status: string | null
  readonly situacao: string
  readonly emissao: Date | null
  readonly vencimento: Date | null
  readonly previsao: Date | null
  readonly pagamento: Date | null
  readonly valorCentavos: string
  readonly pagoCentavos: string
  readonly abertoCentavos: string
  readonly documento: string
}

/**
 * O resumo por SITUAÇÃO, e não por data.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O corte por data estava errado nas duas direções, e a Swile provou: faltavam │
 * │ R$ 59.625 dela, que são UM título vencendo em 25/08 com status `A VENCER` —  │
 * │ a fatura do mês, emitida e não paga. "Vencimento <= hoje" a jogava fora como │
 * │ se fosse projeção.                                                          │
 * │                                                                            │
 * │ O Omie separa o que a data não separa:                                      │
 * │   A VENCER / ATRASADO / VENCE HOJE — título EMITIDO. É faturamento.         │
 * │   PREVISAO — recorrência projetada, NÃO emitida. Não é faturamento.         │
 * │   CANCELADO — foi faturado e cancelado. Conta como faturado, e à parte.     │
 * │                                                                            │
 * │ Medido: 66.012 títulos em PREVISAO (R$ 229,6 mi) contra R$ 141,5 mi de      │
 * │ faturamento real. O corte por data deixava entrar 31 PREVISAO com data      │
 * │ passada e deixava de fora 313 A VENCER com data futura.                     │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export interface ResumoFinanceiro {
  /** Faturado: tudo que foi emitido. Exclui previsão. */
  readonly titulos: number
  readonly totalCentavos: number
  readonly recebidoCentavos: number
  readonly recebidoTitulos: number
  readonly canceladoCentavos: number
  readonly canceladoTitulos: number
  readonly atrasadoCentavos: number
  readonly atrasadoTitulos: number
  readonly aVencerCentavos: number
  readonly aVencerTitulos: number
  /** Recorrência ainda não emitida. Fica FORA do faturado, de propósito. */
  readonly previsaoCentavos: number
  readonly previsaoTitulos: number
  readonly primeiroVencimento: Date | null
  readonly ultimoVencimento: Date | null
  readonly ultimoPagamento: Date | null
  readonly proximaPrevisao: Date | null
  readonly categorias: {
    categoria: string
    nome: string
    titulos: number
    totalCentavos: number
  }[]
  readonly porMes: {
    mes: string
    titulos: number
    totalCentavos: number
    pagoCentavos: number
  }[]
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
export interface FiltroDoFaturamento {
  /** `situacao` normalizada: recebido, cancelado, atrasado, a_vencer, previsao. */
  readonly situacao?: string
  readonly categoria?: string
  /** Previsão fica de fora por padrão: são 66 mil títulos que não foram faturados. */
  readonly incluirPrevisao?: boolean
}

/**
 * O histórico de faturamento, com o nome da categoria junto.
 *
 * Sem `LIMIT`: a pergunta é o histórico inteiro, e uma lista truncada faria a soma
 * da tela discordar dos totais acima. Usa o índice (documento, situacao, vencimento).
 */
export async function lerFaturamento(
  db: pg.Pool,
  documentos: readonly string[],
  f: FiltroDoFaturamento = {},
): Promise<Faturamento[]> {
  if (documentos.length === 0) return []
  const { rows } = await db.query<Faturamento>(
    `SELECT t.codigo_titulo::text AS "codigoTitulo", t.categoria,
            c.descricao AS "categoriaNome", t.status, t.situacao,
            t.emissao, t.vencimento, t.previsao, t.pagamento,
            t.valor_centavos::text AS "valorCentavos",
            t.pago_centavos::text AS "pagoCentavos",
            t.aberto_centavos::text AS "abertoCentavos",
            t.documento
       FROM core.omie_titulo t
       LEFT JOIN core.omie_categoria c ON c.codigo = t.categoria
      WHERE t.documento = ANY($1::text[])
        AND ($2::text IS NULL OR t.situacao = $2)
        AND ($3::text IS NULL OR t.categoria = $3)
        AND ($4::boolean OR t.situacao <> 'previsao')
      ORDER BY t.vencimento DESC NULLS LAST, t.codigo_titulo DESC`,
    [documentos, f.situacao ?? null, f.categoria ?? null, f.incluirPrevisao ?? false],
  )
  return rows
}

export async function resumoFinanceiro(
  db: pg.Pool,
  documentos: readonly string[],
): Promise<ResumoFinanceiro> {
  const vazio: ResumoFinanceiro = {
    titulos: 0, totalCentavos: 0, recebidoCentavos: 0, recebidoTitulos: 0,
    canceladoCentavos: 0, canceladoTitulos: 0, atrasadoCentavos: 0, atrasadoTitulos: 0,
    aVencerCentavos: 0, aVencerTitulos: 0, previsaoCentavos: 0, previsaoTitulos: 0,
    primeiroVencimento: null, ultimoVencimento: null, ultimoPagamento: null,
    proximaPrevisao: null, categorias: [], porMes: [],
  }
  if (documentos.length === 0) return vazio

  const [tot, cat, mes] = await Promise.all([
    db.query<Record<string, unknown>>(
      `SELECT
         count(*) FILTER (WHERE situacao <> 'previsao')::int titulos,
         coalesce(sum(valor_centavos) FILTER (WHERE situacao <> 'previsao'),0)::bigint total,
         coalesce(sum(valor_centavos) FILTER (WHERE situacao = 'recebido'),0)::bigint recebido,
         count(*) FILTER (WHERE situacao = 'recebido')::int recebido_n,
         coalesce(sum(valor_centavos) FILTER (WHERE situacao = 'cancelado'),0)::bigint cancelado,
         count(*) FILTER (WHERE situacao = 'cancelado')::int cancelado_n,
         coalesce(sum(valor_centavos) FILTER (WHERE situacao = 'atrasado'),0)::bigint atrasado,
         count(*) FILTER (WHERE situacao = 'atrasado')::int atrasado_n,
         coalesce(sum(valor_centavos) FILTER (WHERE situacao = 'a_vencer'),0)::bigint a_vencer,
         count(*) FILTER (WHERE situacao = 'a_vencer')::int a_vencer_n,
         coalesce(sum(valor_centavos) FILTER (WHERE situacao = 'previsao'),0)::bigint previsao,
         count(*) FILTER (WHERE situacao = 'previsao')::int previsao_n,
         min(vencimento) FILTER (WHERE situacao <> 'previsao') primeiro,
         max(vencimento) FILTER (WHERE situacao <> 'previsao') ultimo,
         max(pagamento) ultimo_pagto,
         min(vencimento) FILTER (WHERE situacao IN ('a_vencer','atrasado')) proxima
       FROM core.omie_titulo WHERE documento = ANY($1::text[])`,
      [documentos],
    ),
    db.query<{ categoria: string; nome: string; titulos: number; total: string }>(
      `SELECT coalesce(t.categoria,'—') categoria,
              coalesce(c.descricao, t.categoria, 'sem categoria') nome,
              count(*)::int titulos, coalesce(sum(t.valor_centavos),0)::text total
         FROM core.omie_titulo t
         LEFT JOIN core.omie_categoria c ON c.codigo = t.categoria
        WHERE t.documento = ANY($1::text[]) AND t.situacao <> 'previsao'
        GROUP BY 1, 2 ORDER BY sum(t.valor_centavos) DESC`,
      [documentos],
    ),
    db.query<{ mes: string; titulos: number; total: string; pago: string }>(
      `SELECT to_char(date_trunc('month', vencimento),'YYYY-MM') mes, count(*)::int titulos,
              coalesce(sum(valor_centavos),0)::text total,
              coalesce(sum(pago_centavos),0)::text pago
         FROM core.omie_titulo
        WHERE documento = ANY($1::text[]) AND vencimento IS NOT NULL
          AND situacao <> 'previsao'
        GROUP BY 1 ORDER BY 1`,
      [documentos],
    ),
  ])

  const t = tot.rows[0] ?? {}
  const n = (k: string) => Number(t[k] ?? 0)
  return {
    titulos: n('titulos'),
    totalCentavos: n('total'),
    recebidoCentavos: n('recebido'), recebidoTitulos: n('recebido_n'),
    canceladoCentavos: n('cancelado'), canceladoTitulos: n('cancelado_n'),
    atrasadoCentavos: n('atrasado'), atrasadoTitulos: n('atrasado_n'),
    aVencerCentavos: n('a_vencer'), aVencerTitulos: n('a_vencer_n'),
    previsaoCentavos: n('previsao'), previsaoTitulos: n('previsao_n'),
    primeiroVencimento: (t['primeiro'] as Date | null) ?? null,
    ultimoVencimento: (t['ultimo'] as Date | null) ?? null,
    ultimoPagamento: (t['ultimo_pagto'] as Date | null) ?? null,
    proximaPrevisao: (t['proxima'] as Date | null) ?? null,
    categorias: cat.rows.map((c) => ({
      categoria: c.categoria, nome: c.nome, titulos: c.titulos, totalCentavos: Number(c.total),
    })),
    porMes: mes.rows.map((m) => ({
      mes: m.mes, titulos: m.titulos, totalCentavos: Number(m.total), pagoCentavos: Number(m.pago),
    })),
  }
}

/** Tudo de uma vez, que é o que a página precisa. */
export async function fichaDoCliente(
  db: pg.Pool,
  id: string,
  filtro: FiltroDoFaturamento = {},
): Promise<FichaDoCliente | null> {
  const conta = await lerContaDoAdmin(db, id)
  if (!conta) return null

  const { documentos, vinculo } = await documentosDoOmie(db, id, conta.cnpj)
  const [omie, resumo, faturamento] = await Promise.all([
    documentos[0] ? lerFichaOmie(db, documentos[0]) : Promise.resolve(null),
    resumoFinanceiro(db, documentos),
    lerFaturamento(db, documentos, filtro),
  ])
  return { conta, omie, vinculo, documentos, resumo, faturamento }
}
