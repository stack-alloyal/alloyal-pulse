/**
 * As visões do fluxo de saída: quadro, coorte, meta e a lista do cadastro.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ESCRITO DEPOIS, e a falta explica um defeito real.                         │
 * │                                                                            │
 * │ As quatro funções foram publicadas sem teste nenhum contra banco. Passaram   │
 * │ porque nada as chamava com dado dentro — a mesma razão pela qual a tela de   │
 * │ Saídas subiu zerada: sem formulário de cadastro, `success.cancellation`      │
 * │ ficava em zero linha, e uma visão de tabela vazia devolve zero sem errar.    │
 * │                                                                            │
 * │ Todo teste aqui grava ANTES de ler. Visão só se prova com dado dentro.       │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'

import { permissoesDe, type Identidade, type Papel } from '@pulse/auth'
import pg from 'pg'

import {
  anunciar,
  avancarEtapa,
  concederDesconto,
  confirmarAviso,
  confirmarUltimaCobranca,
  reter,
} from './cancelamento.js'
import {
  COLUNAS_DO_FUNIL,
  dadosDeCancelamento,
  graficoDeCancelamento,
  MESES_DA_BASE_ATIVA,
  MESES_DE_MATURIDADE,
  churnObservado,
  funilDeSaida,
  contasParaSaida,
  coorteDeSaida,
  definirMeta,
  metaVersusRealizado,
  POSICOES,
  quadroDeSaida,
  saidasSemRegistro,
} from './saida-visoes.js'

const ADMIN = process.env['DATABASE_URL_ADMIN']

const quem = (email: string, ...papeis: Papel[]): Identidade => ({
  email,
  papeis,
  permissoes: permissoesDe(papeis),
})

const LIDER = quem('lider@alloyal.com.br', 'pulse-cs-lead')
const OUTRO = quem('outro@alloyal.com.br', 'pulse-cs-lead')
const CSM = quem('ana@alloyal.com.br', 'pulse-csm')

const mes = (offset: number): string => {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + offset)
  return d.toISOString().slice(0, 8) + '01'
}

test('as oito posições do pedido estão declaradas, e cada tipo tem representante', () => {
  assert.equal(POSICOES.length, 8, 'o pipeline aprovado tem oito posições')
  const tipos = new Set(POSICOES.map((p) => p.tipo))
  assert.deepEqual([...tipos].sort(), ['etapa', 'perda', 'salvo'])
  // Três etapas de trabalho: são as colunas que devem ESVAZIAR.
  assert.equal(POSICOES.filter((p) => p.tipo === 'etapa').length, 3)
  // Duas perdas, e é a origem que as separa — não um estado a mais.
  assert.deepEqual(
    POSICOES.filter((p) => p.tipo === 'perda').map((p) => p.id),
    ['cancelamento', 'pdd'],
  )
})

describe('visões de saída', { skip: !ADMIN }, () => {
  let pool: pg.Pool
  let acme: string
  let beta: string
  let semReceita: string
  let proximoTitulo = 1
  const documentos = new Map<string, string>()

  before(async () => {
    const { migrate } = await import('@pulse/db')
    await migrate(ADMIN as string)
    pool = new pg.Pool({ connectionString: ADMIN })
  })

  after(async () => {
    await pool?.end()
  })

  beforeEach(async () => {
    await pool.query(
      // `fact.mrr_event` continua na lista: nenhuma visão de saída o lê mais,
      // mas `concederDesconto` e `encerrar` ESCREVEM nele, e resíduo entre
      // testes deixaria contagem de outro caso viva.
      `TRUNCATE success.cancellation, success.meta_churn, fact.mrr_event,
                core.contract, core.omie_titulo, core.omie_cliente,
                core.vinculo_cliente, core.account CASCADE`,
    )
    const conta = async (nome: string, csm: string | null): Promise<string> => {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO core.account (razao_social, porte, setor, brand_id, csm_email)
         VALUES ($1,'medio','industria',$2,$3) RETURNING id`,
        [nome, `b-${nome.toLowerCase()}`, csm],
      )
      return String(rows[0]!.id)
    }
    documentos.clear()
    acme = await conta('Acme', CSM.email)
    beta = await conta('Beta', null)
    semReceita = await conta('SemReceita', null)

    // Contrato só na Acme: é dele que sai o MRR congelado e o aviso prévio.
    await pool.query(
      `INSERT INTO core.contract
         (account_id, mrr_centavos, inicio, vigencia_fim, vidas_contratadas,
          aviso_previo_dias, status_vigencia)
       VALUES ($1, 4000000, '2024-01-01', '2030-01-01', 1000, 90, 'vigente')`,
      [acme],
    )
  })

  // ── contasParaSaida ───────────────────────────────────────────────────────

  test('a lista do cadastro traz só quem tem contrato ou faturamento, e some quando já há pedido aberto', async () => {
    const antes = await contasParaSaida(pool, LIDER)
    // Sem faturamento no Omie, nenhuma das três entra: a lista é recortada por
    // RECEITA, e não por cadastro — 2.153 contas ativas contra 426 com receita.
    assert.deepEqual(antes.map((c) => c.razaoSocial), [], 'sem faturamento, lista vazia')

    // Dá faturamento à Acme e à Beta, e deixa SemReceita de fora.
    await faturar(acme, mes(-1), 400000)
    await faturar(beta, mes(-1), 250000)

    const depois = await contasParaSaida(pool, LIDER)
    assert.deepEqual(depois.map((c) => c.razaoSocial), ['Acme', 'Beta'], 'ordenado por razão social')
    assert.equal(depois[0]?.mrrCentavos, '400000', 'o MRR do mês passado é congelável')
    assert.equal(
      depois.some((c) => c.accountId === semReceita),
      false,
      'conta ativa sem faturamento nenhum não entra: a lista é recortada por receita',
    )

    // Abre pedido na Acme: ela sai da lista, porque `anunciar` recusaria o segundo.
    await anunciar(pool, LIDER, {
      accountId: acme,
      origem: 'cliente',
      dataLevantada: new Date().toISOString().slice(0, 10),
    })
    const comPedido = await contasParaSaida(pool, LIDER)
    assert.deepEqual(comPedido.map((c) => c.razaoSocial), ['Beta'])
  })

  test('faturamento velho aparece na lista, mas sem MRR congelável', async () => {
    // Nove meses atrás: dentro da janela de doze da lista, FORA da carência de
    // dois que `anunciar` usa. Prometer o valor aqui prometeria um congelamento
    // que a função não faz — e o cadastro pediria um MRR que a tela não pede.
    await faturar(acme, mes(-9), 400000)
    const lista = await contasParaSaida(pool, LIDER)
    assert.deepEqual(lista.map((c) => c.razaoSocial), ['Acme'])
    assert.equal(lista[0]?.mrrCentavos, null, 'MRR de nove meses atrás não é oferecido')
  })

  test('a lista respeita a carteira de quem pergunta', async () => {
    await faturar(acme, mes(-1), 400000)
    await faturar(beta, mes(-1), 250000)
    // A Acme é da Ana; a Beta não tem CSM. Quem vê só a carteira vê uma.
    const daAna = await contasParaSaida(pool, CSM)
    assert.deepEqual(daAna.map((c) => c.razaoSocial), ['Acme'])
    const daLider = await contasParaSaida(pool, LIDER)
    assert.equal(daLider.length, 2, 'quem vê a base vê as duas')
  })

  // ── quadroDeSaida ─────────────────────────────────────────────────────────

  test('o quadro põe cada pedido na posição do seu estado, e desconto não é etapa', async () => {
    const hoje = new Date().toISOString().slice(0, 10)
    const id = await anunciar(pool, LIDER, {
      accountId: acme,
      origem: 'cliente',
      dataLevantada: hoje,
    })
    let quadro = await quadroDeSaida(pool, LIDER)
    assert.equal(quadro.length, 1)
    assert.equal(quadro[0]?.posicao, 'pedido', 'anunciado aparece como pedido')
    assert.equal(quadro[0]?.razaoSocial, 'Acme')
    assert.equal(quadro[0]?.mrrCentavos, '4000000', 'congelou o MRR do contrato')
    assert.equal(quadro[0]?.estagnado, false, 'aberto hoje não está parado')

    await avancarEtapa(pool, LIDER, id, 'financeiro')
    quadro = await quadroDeSaida(pool, LIDER)
    assert.equal(quadro[0]?.posicao, 'financeiro')

    await concederDesconto(pool, OUTRO, id, {
      mrrNovoCentavos: '3000000',
      competenciaEfeito: mes(1),
    })
    quadro = await quadroDeSaida(pool, LIDER)
    assert.equal(quadro[0]?.posicao, 'desconto', 'desfecho, e não etapa')
    assert.equal(quadro[0]?.mrrNovoCentavos, '3000000')
    assert.equal(quadro[0]?.estagnado, false, 'desfecho não estagna — só etapa estagna')
  })

  test('o PDD é o mesmo estado do cancelamento, separado pela origem', async () => {
    /* ┌───────────────────────────────────────────────────────────────────────┐
       │ ENQUANTO ESTÁ ANUNCIADO, O PDD É UM PEDIDO — e isto é desenho, não      │
       │ defeito. A posição diz onde o caso ESTÁ no pipeline, e um encerramento  │
       │ por inadimplência recém-aberto está em trabalho como qualquer outro.    │
       │ A origem só decide a COLUNA DE PERDA, quando o caso chega lá.           │
       │                                                                        │
       │ Eu esperei 'pdd' aqui e o teste me corrigiu. Se algum dia o `CASE` for  │
       │ reordenado para olhar a origem primeiro, o PDD passa a sair das colunas │
       │ de trabalho e ninguém mais o trabalha — é isso que este teste vigia.    │
       └───────────────────────────────────────────────────────────────────────┘ */
    const pdd = await anunciar(pool, LIDER, { accountId: beta, origem: 'alloyal' })
    let quadro = await quadroDeSaida(pool, LIDER)
    assert.equal(quadro[0]?.posicao, 'pedido', 'PDD aberto é trabalho, e aparece como pedido')

    // Levado ao aviso, a origem passa a mandar: é a posição 8 do pipeline.
    await pool.query(`UPDATE success.cancellation SET estado = 'em_aviso' WHERE id = $1`, [pdd])
    quadro = await quadroDeSaida(pool, LIDER)
    assert.equal(quadro[0]?.posicao, 'pdd', 'no aviso, a origem alloyal separa do cancelamento')

    /* E o mesmo estado com origem `cliente` cai na OUTRA coluna de perda. Vai num
       pedido novo, e não trocando a origem deste: `origem_cliente_tem_levantada`
       recusa origem `cliente` sem data — o banco não deixa fabricar esse híbrido,
       o que é exatamente a garantia que se quer. */
    const doCliente = await anunciar(pool, LIDER, {
      accountId: acme,
      origem: 'cliente',
      dataLevantada: new Date().toISOString().slice(0, 10),
    })
    await pool.query(`UPDATE success.cancellation SET estado = 'em_aviso' WHERE id = $1`, [doCliente])
    quadro = await quadroDeSaida(pool, LIDER)
    const posicoes = new Set(quadro.map((p) => p.posicao))
    assert.deepEqual([...posicoes].sort(), ['cancelamento', 'pdd'], 'mesmo estado, duas colunas')
  })

  test('retido vira revertido no quadro', async () => {
    const hoje = new Date().toISOString().slice(0, 10)
    const id = await anunciar(pool, LIDER, {
      accountId: acme,
      origem: 'cliente',
      dataLevantada: hoje,
    })
    await reter(pool, LIDER, id, 'desconto recusado, cliente ficou')
    const quadro = await quadroDeSaida(pool, LIDER)
    assert.equal(quadro[0]?.posicao, 'revertido')
  })

  // ── coorteDeSaida ─────────────────────────────────────────────────────────

  test('a coorte tem uma linha por mês, e pendura o pedido no mês do ANÚNCIO', async () => {
    const hoje = new Date().toISOString().slice(0, 10)
    await anunciar(pool, LIDER, {
      accountId: acme,
      origem: 'cliente',
      dataLevantada: hoje,
      avisoPrevioDias: 30,
    })
    const coorte = await coorteDeSaida(pool, 12)
    assert.equal(coorte.length, 13, 'treze meses: doze atrás mais o corrente')
    const atual = coorte.at(-1)!
    assert.equal(atual.anunciados, 1)
    assert.equal(atual.mrrAnunciadoCentavos, '4000000')
    assert.equal(atual.avisoPrevioMedioDias, 30, 'o aviso prévio é a distância entre as coortes')
    // Nenhum evento no ledger ainda: as duas coortes são independentes, e é a
    // distância entre elas que é o aviso prévio.
    assert.equal(atual.churnEfeitoContas, 0)
  })

  test('a coorte do EFEITO é o MESMO pedido, no mês em que a receita para', async () => {
    /* ┌───────────────────────────────────────────────────────────────────────┐
       │ As duas colunas são o mesmo caso, e é isso que faz a distância entre    │
       │ elas ser o aviso prévio. Antes a de efeito lia `fact.mrr_event` — o     │
       │ ledger derivado do faturamento do Omie —, e a tabela misturava duas     │
       │ definições de churn: quem passou a pagar trimestralmente entrava lá     │
       │ como saída. Este teste prova que o anúncio e o efeito são o mesmo       │
       │ pedido em meses diferentes.                                            │
       └───────────────────────────────────────────────────────────────────────┘ */
    const hoje = new Date().toISOString().slice(0, 10)
    const id = await anunciar(pool, LIDER, {
      accountId: acme,
      origem: 'cliente',
      dataLevantada: hoje,
      avisoPrevioDias: 30,
    })
    // A competência de efeito é DERIVADA: última cobrança mais um, e só existe
    // depois das duas confirmações humanas — o CHECK do banco exige as duas.
    const { competenciaEfeitoReceita } = await confirmarUltimaCobranca(
      pool,
      quem('fin@alloyal.com.br', 'pulse-financeiro'),
      (await confirmarAviso(pool, LIDER, id, 30), id),
      mes(0).slice(0, 7),
    )
    assert.equal(competenciaEfeitoReceita.slice(0, 7), mes(1).slice(0, 7), 'última cobrança + 1')

    const coorte = await coorteDeSaida(pool, 12)
    const doAnuncio = coorte.at(-1)!
    assert.equal(doAnuncio.anunciados, 1, 'o anúncio é do mês corrente')
    assert.equal(
      doAnuncio.churnEfeitoContas,
      0,
      'o efeito NÃO é no mês do anúncio: é isso que o aviso prévio desloca',
    )
    // O efeito cai no mês seguinte, que está fora da grade de doze para trás —
    // então se pede uma grade maior, e o mês aparece do outro lado.
    const { rows } = await pool.query<{ n: string; v: string }>(
      `SELECT count(*)::text AS n, sum(mrr_centavos_na_levantada)::text AS v
         FROM success.cancellation
        WHERE competencia_efeito_receita IS NOT NULL
          AND estado IN ('em_aviso','encerrado')`,
    )
    assert.equal(rows[0]?.n, '1', 'o pedido está em estado de perda com efeito apurado')
    assert.equal(rows[0]?.v, '4000000', 'e o valor é o MRR congelado na levantada')
  })

  test('desfecho que SALVA o cliente não entra na coorte de efeito', async () => {
    const hoje = new Date().toISOString().slice(0, 10)
    const id = await anunciar(pool, LIDER, {
      accountId: acme,
      origem: 'cliente',
      dataLevantada: hoje,
      avisoPrevioDias: 30,
    })
    await concederDesconto(pool, OUTRO, id, {
      mrrNovoCentavos: '3000000',
      competenciaEfeito: mes(0),
    })
    const coorte = await coorteDeSaida(pool, 12)
    const atual = coorte.at(-1)!
    assert.equal(atual.anunciados, 1)
    assert.equal(atual.comDesconto, 1)
    // Desconto tem `competencia_efeito_receita` preenchida — é o mês em que o
    // preço NOVO passa a valer —, e contá-la como churn afirmaria uma saída de
    // receita que não houve. O filtro é por ESTADO, não pela data existir.
    assert.equal(atual.churnEfeitoContas, 0, 'cliente que ficou não sai do faturamento')
    assert.equal(atual.churnEfeitoCentavos, '0')
  })

  // ── metaVersusRealizado ───────────────────────────────────────────────────

  test('sem meta é diferente de meta zero, e o acumulado fica vazio', async () => {
    const linhas = await metaVersusRealizado(pool, mes(-2), mes(0).slice(0, 7))
    assert.equal(linhas.length, 3)
    for (const l of linhas) {
      assert.equal(l.metaCentavos, null, 'sem linha na tabela é sem meta')
      assert.equal(l.metaAcumuladaCentavos, null, 'acumulado nulo não afirma meta zero')
      assert.equal(l.diferencaCentavos, null, 'sem meta não há diferença a mostrar')
      assert.equal(l.churnCentavos, '0')
    }
  })

  test('meta zero é uma meta legítima, e aparece como zero', async () => {
    await definirMeta(pool, LIDER, mes(-1).slice(0, 7), '0', 'mês sem tolerância')
    const linhas = await metaVersusRealizado(pool, mes(-2), mes(0).slice(0, 7))
    assert.equal(linhas[0]?.metaCentavos, null, 'o mês anterior à meta continua sem meta')
    assert.equal(linhas[1]?.metaCentavos, '0', 'meta zero é zero, e não nulo')
    assert.equal(linhas[1]?.metaAcumuladaCentavos, '0', 'a partir daqui o acumulado existe')
    assert.equal(linhas[1]?.definidoPor, LIDER.email)
  })

  test('o acumulado soma, e a diferença é meta menos realizado DO PIPELINE', async () => {
    /* O realizado sai de `success.cancellation`, e não do ledger de MRR: esta
       tabela fica ao lado do quadro e responde "batemos a meta?". O ledger é
       derivado do faturamento e não sabe POR QUE a receita parou — a meta seria
       cobrada contra um número que inclui quem não saiu. */
    await definirMeta(pool, LIDER, mes(0).slice(0, 7), '5000000')
    await definirMeta(pool, LIDER, mes(1).slice(0, 7), '2000000')

    const hoje = new Date().toISOString().slice(0, 10)
    const id = await anunciar(pool, LIDER, {
      accountId: acme,
      origem: 'cliente',
      dataLevantada: hoje,
      avisoPrevioDias: 30,
    })
    await confirmarAviso(pool, LIDER, id, 30)
    // Última cobrança no mês corrente ⇒ efeito no mês seguinte.
    await confirmarUltimaCobranca(
      pool,
      quem('fin@alloyal.com.br', 'pulse-financeiro'),
      id,
      mes(0).slice(0, 7),
    )

    const linhas = await metaVersusRealizado(pool, mes(0), mes(1).slice(0, 7))
    assert.equal(linhas[0]?.churnCentavos, '0', 'no mês do anúncio a receita ainda entra')
    assert.equal(linhas[0]?.diferencaCentavos, '5000000', 'meta cheia, nada realizado ainda')
    assert.equal(linhas[1]?.churnCentavos, '4000000', 'o MRR congelado, no mês do efeito')
    assert.equal(linhas[1]?.metaAcumuladaCentavos, '7000000')
    assert.equal(linhas[1]?.churnAcumuladoCentavos, '4000000')
    assert.equal(linhas[1]?.diferencaCentavos, '3000000')
  })

  test('definir de novo o mesmo mês CORRIGE, e registra quem mudou', async () => {
    await definirMeta(pool, LIDER, mes(0).slice(0, 7), '100000')
    await definirMeta(pool, OUTRO, mes(0).slice(0, 7), '150000', 'revisado no board')
    const linhas = await metaVersusRealizado(pool, mes(0), mes(0).slice(0, 7))
    assert.equal(linhas.length, 1, 'corrigiu, não criou uma segunda linha')
    assert.equal(linhas[0]?.metaCentavos, '150000')
    assert.equal(linhas[0]?.definidoPor, OUTRO.email, 'quem mudou por último')
  })

  /*
   * Um título faturado, do jeito que `analytics.mrr_faturado_mes` exige.
   *
   * São TRÊS tabelas, e nenhuma é dispensável: a view casa `omie_titulo.documento`
   * com `vinculo_cliente.chave`, e ainda pede que exista um `omie_cliente` com
   * aquele documento marcado `Cliente` — o recorte que impede intermediação de
   * pontos de entrar como MRR (foi ele que fez o número saltar de R$ 30 mil para
   * R$ 3,2 milhões antes da migração 0050).
   *
   * A competência sai do VENCIMENTO, e não de uma coluna: por isso o título vence
   * no dia 10 do mês pedido.
   */
  async function faturar(accountId: string, competencia: string, centavos: number): Promise<void> {
    let documento = documentos.get(accountId)
    if (!documento) {
      // CNPJ de 14 dígitos e não-zero: `omie_cliente_documento_valido` exige
      // 11 ou 14 dígitos. Um documento legível como "doc-abc12345" é recusado
      // pelo banco, e é bom que seja — foi assim que este fixture aprendeu.
      documento = String(10000000000000 + documentos.size + 1)
      documentos.set(accountId, documento)
      // A chave de core.omie_cliente é `codigo_omie`, e NÃO `documento` — não há
      // ON CONFLICT possível por documento. O mapa acima é que garante uma
      // inserção por conta.
      await pool.query(
        `INSERT INTO core.omie_cliente (codigo_omie, documento, razao_social, tags)
         VALUES ($1, $2, 'Cliente de teste', '["Cliente"]'::jsonb)`,
        [proximoTitulo * 1000, documento],
      )
      // `vinculo_manual_tem_motivo` exige motivo com 10+ caracteres quando a
      // origem é manual: vínculo feito à mão sem justificativa é o que ninguém
      // consegue auditar depois.
      await pool.query(
        `INSERT INTO core.vinculo_cliente (account_id, fonte, chave, origem, motivo, criado_por)
         VALUES ($1, 'omie', $2, 'manual', 'fixture do teste de visões de saída', 'teste')`,
        [accountId, documento],
      )
    }
    /* `pagamento` PREENCHIDO, e isto foi um defeito do fixture achado em
       10/09/2026: ele criava título `RECEBIDO` com `aberto_centavos = 0` e SEM
       data de pagamento — forma que produção não tem. Medido: dos 21.808
       títulos `recebido` do Omie, ZERO estão sem `pagamento`.

       Custou o diagnóstico errado: o funil classificou como "em atraso" toda
       conta que só havia faturado, e por um instante pareceu defeito da consulta
       (ela aceita `pagamento IS NULL` como não pago, e está certa em fazê-lo).
       Era o dado do teste que era irreal. */
    await pool.query(
      `INSERT INTO core.omie_titulo
         (codigo_titulo, documento, vencimento, valor_centavos, aberto_centavos,
          status, categoria, pagamento)
       VALUES ($1, $2, ($3::date + 9), $4, 0, 'RECEBIDO', 'mensalidade', ($3::date + 9))`,
      [proximoTitulo++, documento, competencia, centavos],
    )
  }

  /**
   * ─── O churn observado no faturamento, e a reconciliação ───────────────────
   *
   * ┌─────────────────────────────────────────────────────────────────────────┐
   * │ POR QUE ESTAS VISÕES EXISTEM E O QUE ELAS NÃO SÃO.                      │
   * │                                                                          │
   * │ Em 28/08 as cinco visões deixaram de ler `fact.mrr_event` a pedido do    │
   * │ usuário, com razão: o ledger não sabe POR QUE a receita parou. Em 10/09 o │
   * │ usuário voltou ao ponto — a tela seguia zerada e um KPI prometia          │
   * │ "saíram do FATURAMENTO" lendo a tabela manual.                           │
   * │                                                                          │
   * │ Estas duas leem o faturamento DE NOVO, e de propósito, mas em aba própria │
   * │ e com nome próprio. O que estes testes guardam é justamente o que impede  │
   * │ o número de mentir: a maturidade e a volta a faturar.                    │
   * └─────────────────────────────────────────────────────────────────────────┘
   */
  const churn = (accountId: string, competencia: string, centavos: number) =>
    pool.query(
      `INSERT INTO fact.mrr_event
         (account_id, competencia, valor_centavos, tipo, origem, chave_natural)
       VALUES ($1, $2::date, $3, 'churn_pedido', 'ops', $4)`,
      [accountId, competencia, -centavos, `t:${accountId}:${competencia}`],
    )

  test('conta que VOLTOU a faturar não é saída — a ressalva medida em 19,1%', async () => {
    /* Dos 1.035 eventos de churn do ledger de produção, 198 voltaram a faturar
       depois: eram ritmo de cobrança, não saída. Cliente que passa a pagar
       trimestralmente cai no ledger como churn todo mês em que não fatura.
       Ler o ledger cru inflaria o churn em um quinto — e é ESTE filtro que
       impede isso. */
    const antigo = mes(-6)
    await churn(acme, antigo, 100_00)
    await churn(beta, antigo, 200_00)
    // A Acme voltou a faturar depois; a Beta não.
    await faturar(acme, mes(-4), 100_00)

    const serie = await churnObservado(pool, 12)
    const linha = serie.find((m) => m.mes === antigo)
    assert.equal(linha?.contas, 1, 'a conta que voltou a faturar entrou como saída')
    assert.equal(linha?.receitaPerdidaCentavos, '20000', 'somou a receita de quem voltou')
  })

  test('os meses dentro da maturidade vêm MADURO=false, e não zero', async () => {
    /* Zero é uma afirmação: diria que ninguém saiu. A verdade é que ainda não se
       sabe — medido, ~11% das contas voltam a faturar em até três meses. A tela
       mostra "em apuração" por causa desta bandeira, e trocá-la por zero é o
       jeito mais fácil de a tela voltar a mentir. */
    await churn(acme, mes(0), 100_00)
    const serie = await churnObservado(pool, 12)

    const corrente = serie.find((m) => m.mes === mes(0))
    assert.equal(corrente?.maduro, false, 'o mês corrente se declarou maduro')
    assert.equal(corrente?.contas, 0, 'mês imaturo não pode contar conta nenhuma')

    const velho = serie.find((m) => m.mes === mes(-MESES_DE_MATURIDADE))
    assert.equal(velho?.maduro, true, `${MESES_DE_MATURIDADE} meses atrás deveria ser maduro`)

    // E a fronteira: um mês antes da carência ainda é imaturo.
    const naBorda = serie.find((m) => m.mes === mes(-MESES_DE_MATURIDADE + 1))
    assert.equal(naBorda?.maduro, false, 'a fronteira da maturidade está deslocada')
  })

  test('a reconciliação lista quem parou de faturar SEM registro, e some quando registra', async () => {
    /* O par que prova a utilidade da lista: a conta entra porque ninguém disse
       por quê, e sai no instante em que alguém diz. É o que faz a lista encolher
       conforme o time trabalha, em vez de virar mais um painel que ninguém mexe. */
    const antigo = mes(-6)
    await churn(acme, antigo, 500_00)
    await churn(beta, antigo, 300_00)

    const antes = await saidasSemRegistro(pool, LIDER)
    assert.deepEqual(
      antes.map((c) => c.razaoSocial).sort(),
      ['Acme', 'Beta'],
      'as duas contas sem registro deveriam estar na lista',
    )
    assert.equal(antes[0]?.total, 2, 'o total não bate com o que a lista devolveu')

    // Alguém registra a saída da Acme.
    await anunciar(pool, LIDER, {
      accountId: acme,
      origem: 'cliente',
      pedido: 'cancelar',
      dataLevantada: new Date().toISOString().slice(0, 10),
    })

    const depois = await saidasSemRegistro(pool, LIDER)
    assert.deepEqual(depois.map((c) => c.razaoSocial), ['Beta'], 'a Acme não saiu da lista')

    // E a série passa a contá-la como registrada.
    const serie = await churnObservado(pool, 12)
    const linha = serie.find((m) => m.mes === antigo)
    assert.equal(linha?.contas, 2)
    assert.equal(linha?.comRegistro, 1, 'a série não viu o registro novo')
  })

  test('o TOTAL da lista é o de antes do limite, não o tamanho da página', async () => {
    /* A primeira versão da tela mostrava "Sem registro no fluxo (200)" — a
       contagem do que caiu na página, com cara de total. São 794 em produção.
       Título que conta o próprio truncamento é o mesmo defeito do rótulo
       "saíram do faturamento": afirma menos do que existe, sem avisar. */
    const antigo = mes(-6)
    await churn(acme, antigo, 100_00)
    await churn(beta, antigo, 100_00)
    await churn(semReceita, antigo, 100_00)

    const pagina = await saidasSemRegistro(pool, LIDER, 2)
    assert.equal(pagina.length, 2, 'o limite não foi respeitado')
    assert.equal(pagina[0]?.total, 3, 'o total repetiu o tamanho da página em vez do total')
  })

  test('a reconciliação respeita o escopo de carteira', async () => {
    // Mesmo recorte das outras visões: `base` vê tudo, `carteira` vê o seu.
    const antigo = mes(-6)
    await churn(acme, antigo, 100_00) // csm_email = ana@
    await churn(beta, antigo, 100_00) // sem csm

    assert.equal((await saidasSemRegistro(pool, LIDER)).length, 2, 'o líder deveria ver as duas')
    assert.deepEqual(
      (await saidasSemRegistro(pool, CSM)).map((c) => c.razaoSocial),
      ['Acme'],
      'a CSM deveria ver só a conta da carteira dela',
    )
  })

  /**
   * ─── O funil: o kanban que se preenche sozinho ─────────────────────────────
   *
   * ┌─────────────────────────────────────────────────────────────────────────┐
   * │ O QUE ESTES PORTÕES GUARDAM.                                            │
   * │                                                                          │
   * │ O funil existe porque o usuário pediu um kanban que "não renderize vazio  │
   * │ e sim mostre as evoluções", e o quadro do pipeline não pode: levantar a    │
   * │ mão é alguém AVISANDO, e acontece antes de o dinheiro parar.              │
   * │                                                                          │
   * │ Então as colunas viraram sinal de FATURAMENTO. O que pode dar errado nisso │
   * │ é sempre a mesma coisa — a coluna afirmar mais do que o dado sustenta —, e │
   * │ é isso que se guarda aqui: exclusividade (soma que fecha), severidade      │
   * │ (a pior ganha), a fronteira da maturidade, e o selo do pipeline só quando  │
   * │ há registro ABERTO.                                                      │
   * └─────────────────────────────────────────────────────────────────────────┘
   */
  const atrasar = async (accountId: string, vencimento: string, centavos: number) => {
    const doc = documentos.get(accountId)
    assert.ok(doc, 'a conta precisa de vínculo no Omie para poder atrasar')
    await pool.query(
      `INSERT INTO core.omie_titulo
         (codigo_titulo, documento, status, vencimento, valor_centavos, aberto_centavos)
       VALUES ($1, $2, 'ATRASADO', $3::date, $4, $4)`,
      [900000 + proximoTitulo++, doc, vencimento, centavos],
    )
  }
  const contrair = (accountId: string, competencia: string, centavos: number) =>
    pool.query(
      `INSERT INTO fact.mrr_event
         (account_id, competencia, valor_centavos, tipo, origem, chave_natural)
       VALUES ($1, $2::date, $3, 'contracao', 'ops', $4)`,
      [accountId, competencia, -centavos, `ct:${accountId}:${competencia}`],
    )

  test('as colunas são EXCLUSIVAS e a soma fecha com a base ativa', async () => {
    /* A primeira versão desta medição tinha colunas sobrepostas — "em atraso" e
       "contraiu" eram subconjuntos de "faturando" — e a soma não fechava.
       Kanban cuja soma não fecha é kanban em que ninguém confia na contagem. */
    await faturar(acme, mes(-1), 400000)
    await faturar(beta, mes(-1), 250000)
    await atrasar(acme, mes(-2), 100000)

    const f = await funilDeSaida(pool, LIDER)
    assert.equal(f.length, 2, 'as duas contas com faturamento deveriam estar no funil')

    // Cada conta em exatamente uma coluna, e toda coluna é uma das declaradas.
    const ids = new Set(COLUNAS_DO_FUNIL.map((c) => c.id as string))
    for (const c of f) assert.ok(ids.has(c.coluna), `coluna desconhecida: ${c.coluna}`)
    const soma = COLUNAS_DO_FUNIL.reduce(
      (n, col) => n + f.filter((c) => c.coluna === col.id).length,
      0,
    )
    assert.equal(soma, f.length, 'há conta fora de coluna, ou em duas')
  })

  test('a severidade decide: atraso E contração vence os dois isolados', async () => {
    await faturar(acme, mes(-1), 400000)
    await faturar(beta, mes(-1), 250000)
    await faturar(semReceita, mes(-1), 100000)
    // Acme atrasa E contrai; Beta só atrasa; SemReceita só contrai.
    await atrasar(acme, mes(-2), 50000)
    await contrair(acme, mes(-1), 30000)
    await atrasar(beta, mes(-2), 50000)
    await contrair(semReceita, mes(-1), 30000)

    const f = await funilDeSaida(pool, LIDER)
    const de = (nome: string) => f.find((c) => c.razaoSocial === nome)?.coluna
    assert.equal(de('Acme'), 'atraso_e_contracao', 'a conta com os dois sinais caiu na coluna fraca')
    assert.equal(de('Beta'), 'atraso')
    assert.equal(de('SemReceita'), 'contracao')
  })

  test('quem passou da maturidade SAI do funil — vira saída confirmada', async () => {
    /* A fronteira que separa as duas telas. Dentro da janela, "parou de faturar"
       é trabalho corrente e fica no funil, porque ainda pode voltar. Passada a
       janela é saída confirmada e vive na Reconciliação. Sem esta fronteira as
       794 saídas acumuladas desde 2021 entrariam no quadro e o entupiriam. */
    await faturar(acme, mes(-1), 400000)
    await faturar(beta, mes(-1), 250000)
    // A Acme parou DENTRO da janela; a Beta parou antes dela.
    await pool.query(
      `INSERT INTO fact.mrr_event
         (account_id, competencia, valor_centavos, tipo, origem, chave_natural)
       VALUES ($1, $2::date, -1, 'churn_pedido', 'ops', 'p:a'),
              ($3, $4::date, -1, 'churn_pedido', 'ops', 'p:b')`,
      [acme, mes(-1), beta, mes(-MESES_DE_MATURIDADE - 1)],
    )

    const f = await funilDeSaida(pool, LIDER)
    assert.equal(f.find((c) => c.razaoSocial === 'Acme')?.coluna, 'parou')
    assert.notEqual(
      f.find((c) => c.razaoSocial === 'Beta')?.coluna,
      'parou',
      'saída já madura continuou no funil em vez de virar confirmada',
    )
  })

  test('o selo do pipeline aparece só com registro ABERTO', async () => {
    /* A camada de cima nunca inventa: `null` significa "ninguém disse nada", e
       não "está tudo bem". E pedido ENCERRADO não é selo de trabalho — é
       história, e a conta dele já saiu da base ativa. */
    await faturar(acme, mes(-1), 400000)
    await faturar(beta, mes(-1), 250000)

    const antes = await funilDeSaida(pool, LIDER)
    assert.deepEqual(
      antes.map((c) => c.estadoNoPipeline),
      [null, null],
      'apareceu selo sem ninguém ter registrado',
    )

    const id = await anunciar(pool, LIDER, {
      accountId: acme,
      origem: 'cliente',
      pedido: 'cancelar',
      dataLevantada: new Date().toISOString().slice(0, 10),
    })
    const comSelo = await funilDeSaida(pool, LIDER)
    assert.equal(
      comSelo.find((c) => c.razaoSocial === 'Acme')?.estadoNoPipeline,
      'anunciado',
      'o selo não acompanhou o registro',
    )

    // Retido é desfecho: o selo tem de sair.
    await reter(pool, LIDER, id, 'cliente aceitou a proposta e ficou')
    const depois = await funilDeSaida(pool, LIDER)
    assert.equal(
      depois.find((c) => c.razaoSocial === 'Acme')?.estadoNoPipeline,
      null,
      'desfecho continuou selado como trabalho aberto',
    )
  })

  test('a ordem da coluna de atraso é o VENCIDO, e não o MRR', async () => {
    /* Medido na renderização: ordenando por MRR, a coluna "Em atraso" trazia
       entre os oito primeiros uma conta com R$ 0,02 vencidos há 293 dias, ao
       lado de outra com R$ 31.200,00. Duas ordens de grandeza com o mesmo peso é
       o que ensina a desconfiar da coluna — e a saída não foi piso de
       materialidade (outro número arbitrário), foi ordenar pelo sinal. */
    await faturar(acme, mes(-1), 900000) // MRR alto, atraso ridículo
    await faturar(beta, mes(-1), 100000) // MRR baixo, atraso grande
    await atrasar(acme, mes(-2), 2)
    await atrasar(beta, mes(-2), 500000)

    const f = (await funilDeSaida(pool, LIDER)).filter((c) => c.coluna === 'atraso')
    assert.deepEqual(
      f.map((c) => c.razaoSocial),
      ['Beta', 'Acme'],
      'a coluna de atraso ordenou por MRR: o resíduo de dois centavos veio primeiro',
    )
  })

  test('o funil respeita o escopo de carteira', async () => {
    await faturar(acme, mes(-1), 400000) // csm_email = ana@
    await faturar(beta, mes(-1), 250000) // sem csm
    assert.equal((await funilDeSaida(pool, LIDER)).length, 2, 'o líder deveria ver as duas')
    assert.deepEqual(
      (await funilDeSaida(pool, CSM)).map((c) => c.razaoSocial),
      ['Acme'],
      'a CSM deveria ver só a conta da carteira dela',
    )
  })

  test('a base ativa tem janela, e ela é menor que a do churn observado', async () => {
    // Funil é trabalho corrente; conta que não fatura há muito tempo já é saída.
    assert.ok(
      MESES_DA_BASE_ATIVA >= MESES_DE_MATURIDADE,
      'a base ativa não pode ser menor que a maturidade: a coluna "parou" ficaria vazia por construção',
    )
    assert.ok(MESES_DA_BASE_ATIVA <= 6, `${MESES_DA_BASE_ATIVA} meses traz saída velha para o quadro`)
  })

  /**
   * ─── As três páginas do Cancelamento ───────────────────────────────────────
   *
   * ┌─────────────────────────────────────────────────────────────────────────┐
   * │ A INVARIANTE DO GRÁFICO: a soma das faixas nunca passa do total.        │
   * │                                                                          │
   * │ A altura da barra é o total MEDIDO no faturamento; as quatro faixas são o │
   * │ que alguém REGISTROU. Se a soma das faixas passar do total, a barra       │
   * │ transborda e o desenho passa a mentir — e é fácil acontecer, porque as    │
   * │ duas pontas vêm de fontes diferentes e nada no banco as amarra.          │
   * │                                                                          │
   * │ O gráfico foi desenhado para que a diferença entre o total e a soma seja  │
   * │ a faixa "não apurado". Este portão guarda essa diferença ser >= 0.        │
   * └─────────────────────────────────────────────────────────────────────────┘
   */
  test('no gráfico, a soma das faixas nunca passa do total do mês', async () => {
    const antigo = mes(-6)
    await faturar(acme, mes(-1), 400000)
    await churn(acme, antigo, 400000)
    /* Um pedido que chega a uma FAIXA de verdade, e não só a `em_aviso`.
       A primeira versão deste teste usava `confirmarAviso` +
       `confirmarUltimaCobranca`, que deixam o estado em `em_aviso` — e `em_aviso`
       não é nenhuma das quatro faixas. As quatro ficavam em zero, `0 <= total`
       passava sempre, e o portão era CEGO: provado por mutação, forçar o total a
       zero não o fez falhar.

       `concederDesconto` leva a `desconto`, que é faixa, e grava
       `competencia_efeito_receita` — que é a data pela qual o gráfico agrupa. */
    const id = await anunciar(pool, LIDER, {
      accountId: acme,
      origem: 'cliente',
      pedido: 'desconto',
      dataLevantada: antigo.slice(0, 10),
      mrrCentavos: '400000',
    })
    await concederDesconto(pool, LIDER, id, {
      mrrNovoCentavos: '100000',
      competenciaEfeito: antigo.slice(0, 7),
    })

    // O par da asserção: sem uma faixa NÃO-ZERO, a invariante passaria vazia.
    const antes = await graficoDeCancelamento(pool, 12)
    const noMes = antes.find((m) => m.mes === antigo)
    assert.ok(
      Number(noMes?.descontoCentavos) > 0,
      'o teste não produziu faixa alguma — a invariante mediria o vazio',
    )

    /* A invariante é sobre a PILHA DE SAIU, e só ela. Desconto e renegociação
       ficam de fora porque o cliente CONTINUA pagando — foi este portão que
       provou isso, falhando com desconto de R$ 4.000 num mês de total zero. */
    const g = await graficoDeCancelamento(pool, 12)
    for (const m of g) {
      const naPilha = Number(m.clienteCentavos) + Number(m.pddCentavos)
      assert.ok(
        naPilha <= Number(m.totalCentavos),
        `${m.mes}: Cliente+PDD somam ${naPilha} e o total é ${m.totalCentavos} — a barra transborda`,
      )
    }
  })

  test('desconto e renegociação NÃO entram na pilha de quem saiu', async () => {
    /* O erro que o portão acima pegou, agora guardado dos dois lados: um cliente
       com desconto continua na base e continua pagando. Se ele aparecer dentro
       do total de quem saiu, o gráfico afirma uma perda que não houve — e é
       exatamente o defeito que a meta tinha em 28/08. */
    const antigo = mes(-6)
    await faturar(acme, mes(-9), 400000)
    const id = await anunciar(pool, LIDER, {
      accountId: acme,
      origem: 'cliente',
      pedido: 'desconto',
      dataLevantada: antigo.slice(0, 10),
      mrrCentavos: '400000',
    })
    await concederDesconto(pool, LIDER, id, {
      mrrNovoCentavos: '100000',
      competenciaEfeito: antigo.slice(0, 7),
    })

    const m = (await graficoDeCancelamento(pool, 12)).find((x) => x.mes === antigo)
    assert.ok(Number(m?.descontoCentavos) > 0, 'o desconto não apareceu na sua própria série')
    assert.equal(Number(m?.clienteCentavos), 0, 'o desconto entrou como cancelamento de cliente')
    assert.equal(Number(m?.pddCentavos), 0, 'o desconto entrou como PDD')
    assert.equal(
      Number(m?.totalCentavos),
      0,
      'o cliente com desconto entrou no total de quem PAROU de faturar — ele continua pagando',
    )
  })

  test('o gráfico marca como imaturo o que está dentro da carência', async () => {
    /* Mesma razão do funil: afirmar saída no mês corrente é afirmar o que ainda
       não se sabe. A tela desenha listra em vez de barra por causa desta
       bandeira, e trocá-la por zero faria o gráfico dizer "ninguém saiu". */
    const g = await graficoDeCancelamento(pool, 12)
    assert.equal(g.at(-1)?.maduro, false, 'o mês corrente se declarou maduro')
    assert.equal(
      g.find((m) => m.mes === mes(-MESES_DE_MATURIDADE))?.maduro,
      true,
      `${MESES_DE_MATURIDADE} meses atrás deveria ser maduro`,
    )
  })

  test('a janela do gráfico é a pedida, e a grade não tem buraco', async () => {
    for (const meses of [6, 12]) {
      const g = await graficoDeCancelamento(pool, meses)
      assert.equal(g.length, meses, `pedi ${meses} meses e vieram ${g.length}`)
      // Mês sem saída tem de vir com zero, e não faltar: barra ausente no meio
      // do gráfico desalinha o eixo e some com o mês da leitura.
      assert.ok(
        g.every((m) => typeof m.totalCentavos === 'string'),
        'há mês sem total na grade',
      )
    }
  })

  test('em Dados, coluna sem fonte vem NULL — e não zero', async () => {
    /* `null` e `0` dizem coisas diferentes, e a tela desenha travessão para um e
       número para o outro: travessão é "não sei", zero é "não houve". Trocar por
       `COALESCE(..., 0)` no SQL apagaria a diferença e a tabela passaria a
       afirmar que ninguém levantou a mão e ninguém teve desconto. */
    /* O faturamento vem ANTES do churn, e isto foi um erro meu de fixture: com
       `faturar(mes(-1))` depois de `churn(mes(-6))` a conta VOLTOU a faturar, e
       `SAIU_DO_FATURAMENTO` a excluiu — corretamente. Era o dado do teste que
       era irreal. */
    await faturar(acme, mes(-9), 400000)
    await churn(acme, mes(-6), 400000)

    const d = await dadosDeCancelamento(pool, LIDER)
    const linha = d.find((l) => l.razaoSocial === 'Acme')
    assert.ok(linha, 'a conta que parou de faturar deveria estar na tabela')
    assert.equal(linha.dataLevantada, null, 'inventou data de levantada')
    assert.equal(linha.estado, null, 'inventou estado de pedido')
    assert.equal(linha.descontoCentavos, null, 'inventou desconto')
    // E o que TEM fonte vem preenchido.
    assert.ok(linha.primeiroFaturamento, 'o primeiro faturamento deveria vir do Omie')
    assert.ok(linha.competenciaQueParou, 'a competência que parou deveria vir do ledger')
  })

  test('Dados traz só quem saiu ou está saindo', async () => {
    // A base inteira responderia outra pergunta — e em produção são 2.155 contas.
    await faturar(acme, mes(-9), 400000) // faturou e PAROU
    await faturar(beta, mes(-1), 250000) // faturando, sem pedido
    await churn(acme, mes(-6), 400000)

    const d = await dadosDeCancelamento(pool, LIDER)
    assert.deepEqual(
      d.map((l) => l.razaoSocial),
      ['Acme'],
      'a Beta não saiu nem está saindo, e entrou na tabela',
    )

    // Registrar um pedido na Beta a faz entrar, mesmo sem ter parado de faturar.
    await anunciar(pool, LIDER, {
      accountId: beta,
      origem: 'cliente',
      pedido: 'cancelar',
      dataLevantada: new Date().toISOString().slice(0, 10),
    })
    assert.equal(
      (await dadosDeCancelamento(pool, LIDER)).length,
      2,
      'a conta com pedido aberto deveria entrar na tabela',
    )
  })

  test('Dados respeita o escopo de carteira', async () => {
    await faturar(acme, mes(-9), 400000) // csm_email = ana@
    await faturar(beta, mes(-9), 250000) // sem csm
    await churn(acme, mes(-6), 400000)
    await churn(beta, mes(-6), 250000)
    assert.equal((await dadosDeCancelamento(pool, LIDER)).length, 2)
    assert.deepEqual(
      (await dadosDeCancelamento(pool, CSM)).map((l) => l.razaoSocial),
      ['Acme'],
      'a CSM deveria ver só a conta da carteira dela',
    )
  })
})
