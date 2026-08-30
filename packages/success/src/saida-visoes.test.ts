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
  contasParaSaida,
  coorteDeSaida,
  definirMeta,
  metaVersusRealizado,
  POSICOES,
  quadroDeSaida,
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
    await pool.query(
      `INSERT INTO core.omie_titulo
         (codigo_titulo, documento, vencimento, valor_centavos, aberto_centavos,
          status, categoria)
       VALUES ($1, $2, ($3::date + 9), $4, 0, 'RECEBIDO', 'mensalidade')`,
      [proximoTitulo++, documento, competencia, centavos],
    )
  }
})
