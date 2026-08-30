/**
 * Churn real — as quatro datas.
 *
 * O exemplo que o PRD usa vira teste literal: levantada em 15/jul com 90 dias
 * de aviso entra no churn de CONTAS de julho e no churn de RECEITA de novembro.
 * Se algum dia esses dois números colapsarem num só, é aqui que se descobre.
 *
 * O resto do arquivo é sobre RECUSA. Errar o último mês de cobrança move receita
 * entre competências depois de a anterior estar congelada — e competência
 * congelada não se corrige, só se ajusta na corrente, com nota.
 */

import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'

import { permissoesDe, type Identidade, type Papel } from '@pulse/auth'
import pg from 'pg'

import {
  anunciar,
  competenciaDeEfeito,
  confirmarAviso,
  confirmarUltimaCobranca,
  encerrar,
  faltaParaEncerrar,
  fimDoAviso,
  listarSaidas,
  podeIr,
  resumoChurn,
  MOTIVOS_SAIDA,
  reter,
  rotuloDoMotivo,
  SemPermissaoError,
  TransicaoInvalidaError,
  type Saida,
  avancarEtapa,
  concederDesconto,
  confirmarMotivo,
  renegociar,
  DIAS_PARA_ESTAGNAR,
} from './cancelamento.js'

const ADMIN = process.env['DATABASE_URL_ADMIN']

const quem = (email: string, ...papeis: Papel[]): Identidade => ({
  email,
  papeis,
  permissoes: permissoesDe(papeis),
})

const CSM = quem('ana@alloyal.com.br', 'pulse-csm')
const LIDER = quem('lider@alloyal.com.br', 'pulse-cs-lead')
const FIN = quem('fin@alloyal.com.br', 'pulse-financeiro')

// ── As funções puras ────────────────────────────────────────────────────────

test('a competência de efeito é sempre o mês seguinte à última cobrança', () => {
  assert.equal(competenciaDeEfeito('2026-10-01'), '2026-11-01')
  assert.equal(competenciaDeEfeito('2026-12-01'), '2027-01-01', 'vira o ano')
  assert.equal(competenciaDeEfeito('2026-01-01'), '2026-02-01')
})

test('o fim do aviso é a levantada mais os dias do contrato', () => {
  // O exemplo do PRD: 15/jul + 90 dias = 13/out.
  assert.equal(fimDoAviso('2026-07-15', 90), '2026-10-13')
  assert.equal(fimDoAviso('2026-07-15', 30), '2026-08-14')
  assert.equal(fimDoAviso('2026-02-27', 3), '2026-03-02', 'atravessa o fim do mês')
})

test('retido e encerrado são terminais', () => {
  // Reabrir moveria receita entre competências já congeladas. Se o cliente
  // voltar, o evento certo é uma reativação nova.
  assert.equal(podeIr('anunciado', 'em_aviso'), true)
  assert.equal(podeIr('anunciado', 'retido'), true)
  assert.equal(podeIr('em_aviso', 'encerrado'), true)
  assert.equal(podeIr('retido', 'em_aviso'), false)
  assert.equal(podeIr('encerrado', 'em_aviso'), false)
})

test('o que falta para encerrar vem como lista, não como "não pode"', () => {
  // Sem a lista, um distrato fica parado três semanas até alguém descobrir qual
  // campo estava em branco.
  const vazia = {
    avisoConfirmadoPor: null,
    competenciaUltimaCobranca: null,
    cobrancaConfirmadaPor: null,
    aprovadoPor: null,
  } as unknown as Saida
  const falta = faltaParaEncerrar(vazia)
  assert.equal(falta.length, 3)
  assert.ok(falta.some((f) => /aviso prévio/.test(f)))
  assert.ok(falta.some((f) => /Financeiro/.test(f)))
  assert.ok(falta.some((f) => /aprovação/.test(f)))
})

// ── Contra banco ────────────────────────────────────────────────────────────

describe('fluxo de saída', { skip: !ADMIN }, () => {
  let pool: pg.Pool
  let acme: string

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
      `TRUNCATE success.cancellation, success.renewal, fact.mrr_event,
                metrics.daily_snapshot, core.contract, core.account CASCADE`,
    )
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO core.account (razao_social, porte, setor, brand_id, csm_email)
       VALUES ('Acme','medio','industria','b-acme',$1) RETURNING id`,
      [CSM.email],
    )
    acme = String(rows[0]!.id)
    await pool.query(
      `INSERT INTO core.contract
         (account_id, mrr_centavos, inicio, vigencia_fim, vidas_contratadas,
          aviso_previo_dias, status_vigencia)
       VALUES ($1, 4000000, '2024-01-01', '2027-01-01', 1000, 90, 'vigente')`,
      [acme],
    )
  })

  /** O caminho completo do exemplo do PRD. */
  async function ateEncerrar(): Promise<string> {
    const id = await anunciar(pool, CSM, {
      accountId: acme,
      origem: 'cliente',
      dataLevantada: '2026-07-15',
      canal: 'reuniao',
      quemComunicou: 'diretor de RH',
      motivo: 'custo',
    })
    await confirmarAviso(pool, CSM, id, 90)
    await confirmarUltimaCobranca(pool, FIN, id, '2026-10')
    await encerrar(pool, FIN, id)
    return id
  }

  // ── O exemplo do PRD, literal ─────────────────────────────────────────────

  test('levantada em 15/jul com 90 dias: contas em JULHO, receita em NOVEMBRO', async () => {
    const id = await ateEncerrar()
    const [s] = await listarSaidas(pool, LIDER)
    assert.equal(s?.id, id)
    assert.equal(s?.dataLevantada, '2026-07-15')
    assert.equal(s?.dataFimAviso, '2026-10-13', 'a retenção tem até aqui')
    assert.equal(s?.competenciaUltimaCobranca, '2026-10')
    assert.equal(s?.competenciaEfeitoReceita, '2026-11')

    const julho = await resumoChurn(pool, '2026-07-01')
    assert.equal(julho.contasQueLevantaram, 1, 'a conta sai em julho')
    assert.equal(julho.contasComEfeito, 0, 'a receita ainda não')
    assert.equal(
      julho.mrrComprometidoCentavos,
      '4000000',
      'saída comprometida, e o número de julho não muda por a saída já estar encerrada hoje',
    )

    const novembro = await resumoChurn(pool, '2026-11-01')
    assert.equal(novembro.contasQueLevantaram, 0)
    assert.equal(novembro.contasComEfeito, 1, 'a receita sai em novembro')
    assert.equal(novembro.mrrRealizadoCentavos, '4000000')
  })

  test('durante o aviso o MRR é comprometido, e não perda realizada', async () => {
    const id = await anunciar(pool, CSM, {
      accountId: acme,
      origem: 'cliente',
      dataLevantada: '2026-07-15',
    })
    await confirmarAviso(pool, CSM, id, 90)
    await confirmarUltimaCobranca(pool, FIN, id, '2026-10')

    for (const mes of ['2026-08-01', '2026-09-01', '2026-10-01']) {
      const r = await resumoChurn(pool, mes)
      assert.equal(r.mrrComprometidoCentavos, '4000000', `${mes}: ainda faturando`)
      assert.equal(r.mrrRealizadoCentavos, '0', `${mes}: a receita ainda não saiu`)
    }
  })

  // ── As duas confirmações ──────────────────────────────────────────────────

  test('sem a confirmação do aviso, a competência de efeito não é gravada', async () => {
    // É a invariante central: o banco recusa, e o módulo recusa antes com uma
    // frase que uma pessoa entende.
    const id = await anunciar(pool, CSM, {
      accountId: acme,
      origem: 'cliente',
      dataLevantada: '2026-07-15',
    })
    await confirmarUltimaCobranca(pool, FIN, id, '2026-10')

    const [s] = await listarSaidas(pool, LIDER)
    assert.equal(s?.competenciaUltimaCobranca, '2026-10')
    assert.equal(s?.competenciaEfeitoReceita, null, 'falta a outra confirmação')
  })

  test('encerrar sem as duas confirmações diz exatamente o que falta', async () => {
    const id = await anunciar(pool, CSM, {
      accountId: acme,
      origem: 'cliente',
      dataLevantada: '2026-07-15',
    })
    await assert.rejects(
      () => encerrar(pool, FIN, id),
      (e: Error) => {
        assert.ok(e instanceof TransicaoInvalidaError)
        assert.match(e.message, /aviso prévio/)
        assert.match(e.message, /Financeiro/)
        return true
      },
    )
  })

  test('só o Financeiro confirma o último mês de cobrança', async () => {
    // O CSM não sabe se a fatura saiu, foi rateada ou antecipada.
    const id = await anunciar(pool, CSM, {
      accountId: acme,
      origem: 'cliente',
      dataLevantada: '2026-07-15',
    })
    await assert.rejects(
      () => confirmarUltimaCobranca(pool, CSM, id, '2026-10'),
      SemPermissaoError,
    )
  })

  test('o aviso confirmado move a saída para em_aviso e recalcula o prazo', async () => {
    // O contrato diz 90, mas houve acordo de 60: é o campo que mais desloca
    // receita entre meses, e por isso é pessoa que confirma.
    const id = await anunciar(pool, CSM, {
      accountId: acme,
      origem: 'cliente',
      dataLevantada: '2026-07-15',
    })
    await confirmarAviso(pool, CSM, id, 60)
    const [s] = await listarSaidas(pool, LIDER)
    assert.equal(s?.estado, 'em_aviso')
    assert.equal(s?.avisoPrevioDias, 60)
    assert.equal(s?.dataFimAviso, '2026-09-13')
    assert.equal(s?.avisoConfirmadoPor, CSM.email)
  })

  // ── Congelamento no anúncio ───────────────────────────────────────────────

  test('o MRR é congelado na levantada e não segue o reajuste do contrato', async () => {
    // A perda tem que ser medida contra o valor que existia quando o cliente
    // decidiu sair — senão um reajuste durante o aviso mudaria o churn passado.
    const id = await anunciar(pool, CSM, {
      accountId: acme,
      origem: 'cliente',
      dataLevantada: '2026-07-15',
    })
    await pool.query('UPDATE core.contract SET mrr_centavos = 9900000 WHERE account_id = $1', [acme])

    const [s] = await listarSaidas(pool, LIDER)
    assert.equal(s?.mrrCentavosNaLevantada, '4000000')
    await confirmarAviso(pool, CSM, id, 90)
    await confirmarUltimaCobranca(pool, FIN, id, '2026-10')
    const { valorCentavos } = await encerrar(pool, FIN, id)
    assert.equal(valorCentavos, '-4000000', 'o ledger recebe o valor congelado')
  })

  // ── Retenção ──────────────────────────────────────────────────────────────

  test('reter é estado, não exclusão — a reversão fica medida', async () => {
    const id = await anunciar(pool, CSM, {
      accountId: acme,
      origem: 'cliente',
      dataLevantada: '2026-07-15',
    })
    await reter(pool, CSM, id, 'renegociado com desconto de 10%')

    const [s] = await listarSaidas(pool, LIDER)
    assert.equal(s?.estado, 'retido')
    assert.equal(s?.retidoPor, CSM.email)
    assert.ok(s?.retidoEm)
  })

  test('conta retida entra no bruto e sai no líquido, sem apagar o fato', async () => {
    const id = await anunciar(pool, CSM, {
      accountId: acme,
      origem: 'cliente',
      dataLevantada: '2026-07-15',
    })
    await reter(pool, CSM, id, undefined, '2026-07-20')
    const julho = await resumoChurn(pool, '2026-07-01')
    assert.equal(julho.contasQueLevantaram, 1, 'ela levantou a mão, e isso é um fato')
    assert.equal(julho.retidasDepois, 1, 'e foi revertida — o líquido é zero')
    assert.equal(julho.retidasNaCompetencia, 1, 'a vitória é contada no mês em que ocorreu')
    assert.equal(julho.mrrRetidoCentavos, '4000000')
  })

  test('saída retida não pode ser encerrada depois', async () => {
    const id = await anunciar(pool, CSM, {
      accountId: acme,
      origem: 'cliente',
      dataLevantada: '2026-07-15',
    })
    await reter(pool, CSM, id, undefined, '2026-07-20')
    await assert.rejects(
      () => encerrar(pool, FIN, id),
      (e: Error) => {
        assert.match(e.message, /revertida/)
        return true
      },
    )
  })

  // ── O ledger ──────────────────────────────────────────────────────────────

  test('encerrar grava o evento no ledger, na competência do EFEITO', async () => {
    await ateEncerrar()
    const { rows } = await pool.query<{ competencia: string; valor: string; tipo: string }>(
      `SELECT to_char(competencia,'YYYY-MM') competencia, valor_centavos::text valor, tipo
         FROM fact.mrr_event`,
    )
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.competencia, '2026-11', 'não a competência da levantada')
    assert.equal(rows[0]?.valor, '-4000000', 'churn entra negativo')
    assert.equal(rows[0]?.tipo, 'churn_pedido')
  })

  test('encerrar duas vezes não lança duas baixas de receita', async () => {
    // Dois cliques no botão de aprovar não podem virar dois eventos: o ledger é
    // append-only e a correção sairia como ajuste manual três meses depois.
    const id = await ateEncerrar()
    await assert.rejects(() => encerrar(pool, FIN, id), TransicaoInvalidaError)
    const { rows } = await pool.query<{ n: string }>('SELECT count(*) n FROM fact.mrr_event')
    assert.equal(rows[0]?.n, '1')
  })

  test('saída da Alloyal por inadimplência entra como churn_inadimplencia', async () => {
    const id = await anunciar(pool, LIDER, { accountId: acme, origem: 'alloyal', motivo: 'pdd' })
    await confirmarAviso(pool, LIDER, id, 0)
    await confirmarUltimaCobranca(pool, FIN, id, '2026-08')
    await encerrar(pool, FIN, id)
    const { rows } = await pool.query<{ tipo: string }>('SELECT tipo FROM fact.mrr_event')
    assert.equal(rows[0]?.tipo, 'churn_inadimplencia')
  })

  // ── Recusas de entrada ────────────────────────────────────────────────────

  test('levantada de mão sem data é recusada', async () => {
    // É a data do churn de contas: sem ela, o mês da perda é um palpite.
    await assert.rejects(
      () => anunciar(pool, CSM, { accountId: acme, origem: 'cliente' }),
      TransicaoInvalidaError,
    )
  })

  test('duas saídas abertas para a mesma conta são recusadas', async () => {
    // A segunda duplicaria o MRR comprometido, e o número que o board olha
    // apareceria dobrado.
    await anunciar(pool, CSM, {
      accountId: acme,
      origem: 'cliente',
      dataLevantada: '2026-07-15',
    })
    await assert.rejects(
      () =>
        anunciar(pool, CSM, {
          accountId: acme,
          origem: 'cliente',
          dataLevantada: '2026-07-20',
        }),
      (e: Error) => {
        assert.match(e.message, /já existe uma saída em andamento/)
        return true
      },
    )
  })

  test('encerrar fecha o contrato na data da última cobrança', async () => {
    // Sem isto o ledger diz que a receita saiu e a base de contratos diz que não,
    // e a cascata publica a diferença como resíduo não atribuído todo mês.
    await ateEncerrar()
    const { rows } = await pool.query<{
      encerrado_em: string
      vigencia_fim: string
      status: string
    }>(
      `SELECT to_char(encerrado_em,'YYYY-MM-DD') encerrado_em,
              to_char(vigencia_fim,'YYYY-MM-DD') vigencia_fim,
              status_vigencia status
         FROM core.contract WHERE account_id = $1`,
      [acme],
    )
    assert.equal(rows[0]?.encerrado_em, '2026-10-31', 'último dia da última competência cobrada')
    assert.equal(rows[0]?.status, 'encerrado')
    // O fim CONTRATADO não é sobrescrito: a diferença entre as duas datas é o
    // prazo restante, e é ela que caracteriza multa por rescisão antecipada.
    assert.equal(rows[0]?.vigencia_fim, '2027-01-01', 'o fim contratado fica intacto')
  })

  test('cliente que volta precisa de contrato novo, não de saída nova', async () => {
    // Depois de encerrada, a conta não tem contrato vigente — e é assim que deve
    // ser: não existe "sair" de um contrato que já terminou. O caminho de volta é
    // um contrato novo, que é o que uma reativação de fato é.
    await ateEncerrar()
    await assert.rejects(
      () =>
        anunciar(pool, CSM, {
          accountId: acme,
          origem: 'cliente',
          dataLevantada: '2027-01-10',
        }),
      (e: Error) => {
        // A invariante é "há MRR para congelar", e não "há contrato vigente": em
        // produção `core.contract` tem ZERO linhas, e exigir a FONTE em vez do
        // VALOR deixou o fluxo de saídas morto na porta de entrada por meses.
        assert.match(e.message, /não há MRR para congelar/)
        return true
      },
    )

    await pool.query(
      `INSERT INTO core.contract
         (account_id, mrr_centavos, inicio, vigencia_fim, vidas_contratadas,
          aviso_previo_dias, status_vigencia)
       VALUES ($1, 3000000, '2027-01-01', '2029-01-01', 800, 30, 'vigente')`,
      [acme],
    )
    const outra = await anunciar(pool, CSM, {
      accountId: acme,
      origem: 'cliente',
      dataLevantada: '2027-02-10',
    })
    assert.ok(outra, 'com contrato novo, uma saída nova é possível')
  })

  test('conta sem contrato vigente não tem o que congelar', async () => {
    await pool.query(`UPDATE core.contract SET status_vigencia = 'encerrado'`)
    await assert.rejects(
      () =>
        anunciar(pool, CSM, {
          accountId: acme,
          origem: 'cliente',
          dataLevantada: '2026-07-15',
        }),
      (e: Error) => {
        assert.match(e.message, /não há MRR para congelar/)
        return true
      },
    )
  })

  test('sem contrato, o MRR pode vir do faturado ou ser informado', async () => {
    // O caso que a versão anterior tornava impossível: cliente que parou de pagar
    // meses atrás e só agora formaliza a saída. Não há contrato vigente e não há
    // faturamento recente — e quem registra sabe o valor.
    await pool.query(`UPDATE core.contract SET status_vigencia = 'encerrado'`)
    const id = await anunciar(pool, CSM, {
      accountId: acme,
      origem: 'cliente',
      dataLevantada: '2026-07-15',
      mrrCentavos: '4200000',
    })
    const { rows } = await pool.query(
      'SELECT mrr_centavos_na_levantada::text AS mrr, pedido, criado_por FROM success.cancellation WHERE id = $1',
      [id],
    )
    assert.equal(rows[0]?.mrr, '4200000')
    assert.equal(rows[0]?.pedido, 'cancelar')
    assert.equal(rows[0]?.criado_por, CSM.email)
  })

  test('PDD passa sem MRR: cortar quem já não paga é o caso em que não há valor', async () => {
    await pool.query(`UPDATE core.contract SET status_vigencia = 'encerrado'`)
    const id = await anunciar(pool, FIN, { accountId: acme, origem: 'alloyal' })
    const { rows } = await pool.query(
      'SELECT origem, mrr_centavos_na_levantada FROM success.cancellation WHERE id = $1',
      [id],
    )
    assert.equal(rows[0]?.origem, 'alloyal')
    assert.equal(rows[0]?.mrr_centavos_na_levantada, null)
  })

  // ── Recorte ───────────────────────────────────────────────────────────────

  test('o CSM vê as saídas da própria carteira', async () => {
    await anunciar(pool, CSM, {
      accountId: acme,
      origem: 'cliente',
      dataLevantada: '2026-07-15',
    })
    const outro = quem('bruno@alloyal.com.br', 'pulse-csm')
    assert.equal((await listarSaidas(pool, CSM)).length, 1)
    assert.equal((await listarSaidas(pool, outro)).length, 0)
    assert.equal((await listarSaidas(pool, LIDER)).length, 1)
  })
  test('encerrar a saída fecha a renovação aberta da conta', async () => {
    // Dois módulos contando a mesma conta de formas opostas é como a previsão
    // passa a somar receita de quem já foi embora.
    await pool.query(
      `INSERT INTO success.renewal
         (account_id, contract_id, vigencia_fim, mrr_em_risco_centavos, estado)
       SELECT $1, id, vigencia_fim, mrr_centavos, 'em_negociacao'
         FROM core.contract WHERE account_id = $1`,
      [acme],
    )
    await ateEncerrar()
    const { rows } = await pool.query<{ estado: string; nota: string }>(
      'SELECT estado, nota FROM success.renewal WHERE account_id = $1',
      [acme],
    )
    assert.equal(rows[0]?.estado, 'perdida')
    assert.match(String(rows[0]?.nota), /saída encerrada/)
  })

  // ══ OS DESFECHOS QUE SALVAM O CLIENTE ═════════════════════════════════════

  test('desconto entra como CONTRAÇÃO no ledger, não como churn', async () => {
    // A consequência mais séria do desenho: três dos cinco desfechos salvam o
    // cliente. Lançar churn aqui contaria como perdido um cliente que está na
    // base, e a cascata em /receita mostraria uma conta perdida que não saiu.
    const id = await anunciar(pool, CSM, {
      accountId: acme,
      origem: 'cliente',
      dataLevantada: '2026-07-15',
      pedido: 'desconto',
    })
    const r = await concederDesconto(pool, FIN, id, {
      mrrNovoCentavos: '3000000',
      competenciaEfeito: '2026-08',
    })
    assert.equal(r.contracaoCentavos, '1000000')

    const { rows } = await pool.query<{ tipo: string; valor: string }>(
      'SELECT tipo, valor_centavos::text AS valor FROM fact.mrr_event WHERE account_id = $1',
      [acme],
    )
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.tipo, 'contracao')
    // NEGATIVO, como churn e ao contrário de expansão: é o sinal que torna o
    // agregado da cascata somável.
    assert.equal(rows[0]?.valor, '-1000000')

    const { rows: c } = await pool.query<{ estado: string; novo: string }>(
      'SELECT estado, mrr_novo_centavos::text AS novo FROM success.cancellation WHERE id = $1',
      [id],
    )
    assert.equal(c[0]?.estado, 'desconto')
    assert.equal(c[0]?.novo, '3000000')
  })

  test('desconto que não é desconto é recusado', async () => {
    const id = await anunciar(pool, CSM, {
      accountId: acme, origem: 'cliente', dataLevantada: '2026-07-15',
    })
    await assert.rejects(
      () => concederDesconto(pool, FIN, id, { mrrNovoCentavos: '4000000', competenciaEfeito: '2026-08' }),
      /igual ou maior não é desconto/,
    )
    // E nada foi gravado: a transação inteira volta atrás.
    const { rows } = await pool.query('SELECT count(*)::int n FROM fact.mrr_event')
    assert.equal(rows[0]?.n, 0)
  })

  test('renegociação que só mexe em prazo NÃO gera evento de receita', async () => {
    // É a diferença que a lista de desfechos esconde: parcelar dívida muda QUANDO
    // o dinheiro entra, não QUANTO entra por mês. Lançar contração aí contaria
    // como perda de receita recorrente uma mudança de prazo.
    const id = await anunciar(pool, CSM, {
      accountId: acme, origem: 'cliente', dataLevantada: '2026-07-15',
    })
    const r = await renegociar(pool, FIN, id, { nota: 'dívida em 6x' })
    assert.equal(r.contracaoCentavos, null)
    const { rows } = await pool.query('SELECT count(*)::int n FROM fact.mrr_event')
    assert.equal(rows[0]?.n, 0)
    const { rows: c } = await pool.query<{ estado: string }>(
      'SELECT estado FROM success.cancellation WHERE id = $1', [id],
    )
    assert.equal(c[0]?.estado, 'renegociado')
  })

  test('renegociação que muda o mensal exige a competência do efeito', async () => {
    const id = await anunciar(pool, CSM, {
      accountId: acme, origem: 'cliente', dataLevantada: '2026-07-15',
    })
    await assert.rejects(
      () => renegociar(pool, FIN, id, { mrrNovoCentavos: '3500000' }),
      /precisa da competência de efeito/,
    )
  })

  test('renegociar para CIMA entra como expansão, não como contração', async () => {
    // O ledger não pode mentir pelo nome do desfecho: renegociar para cima
    // acontece, e chamar isso de contração inverteria o sinal do mês.
    const id = await anunciar(pool, CSM, {
      accountId: acme, origem: 'cliente', dataLevantada: '2026-07-15',
    })
    await renegociar(pool, FIN, id, { mrrNovoCentavos: '4500000', competenciaEfeito: '2026-09' })
    const { rows } = await pool.query<{ tipo: string; valor: string }>(
      'SELECT tipo, valor_centavos::text AS valor FROM fact.mrr_event WHERE account_id = $1',
      [acme],
    )
    assert.equal(rows[0]?.tipo, 'expansao')
    assert.equal(rows[0]?.valor, '500000')
  })

  test('as etapas de trabalho movem, e a idade reinicia', async () => {
    const id = await anunciar(pool, CSM, {
      accountId: acme, origem: 'cliente', dataLevantada: '2026-07-15',
    })
    await avancarEtapa(pool, CSM, id, 'financeiro')
    await avancarEtapa(pool, CSM, id, 'reversao')
    const { rows } = await pool.query<{ estado: string; dias: number }>(
      `SELECT estado, (now()::date - etapa_desde::date) AS dias
         FROM success.cancellation WHERE id = $1`,
      [id],
    )
    assert.equal(rows[0]?.estado, 'reversao')
    assert.equal(Number(rows[0]?.dias), 0)
    // Mover para a etapa em que já está não faz nada, e recusa em voz alta.
    await assert.rejects(() => avancarEtapa(pool, CSM, id, 'reversao'), /não para a mesma/)
    assert.equal(DIAS_PARA_ESTAGNAR, 14)
  })

  test('quem registrou não confirma o próprio motivo', async () => {
    const id = await anunciar(pool, CSM, {
      accountId: acme, origem: 'cliente', dataLevantada: '2026-07-15',
    })
    await assert.rejects(
      () => confirmarMotivo(pool, CSM, id, { motivo: 'custo' }),
      /quem registrou o pedido não confirma o próprio motivo/,
    )
    await confirmarMotivo(pool, LIDER, id, { motivo: 'concorrente' })
    const { rows } = await pool.query<{ motivo: string; por: string }>(
      'SELECT motivo, motivo_confirmado_por AS por FROM success.cancellation WHERE id = $1',
      [id],
    )
    assert.equal(rows[0]?.motivo, 'concorrente')
    assert.equal(rows[0]?.por, LIDER.email)
  })

  test('encerrar confirma o motivo, porque quem aprova já é outra pessoa', async () => {
    // A decisão 4 sem custo de passo: exigir uma AÇÃO separada travaria o pedido
    // num time pequeno, e não precisa — encerrar já exige aprovaDistrato.
    const id = await ateEncerrar()
    const { rows } = await pool.query<{ por: string; aprovado: string }>(
      `SELECT motivo_confirmado_por AS por, aprovado_por AS aprovado
         FROM success.cancellation WHERE id = $1`,
      [id],
    )
    assert.equal(rows[0]?.por, FIN.email)
    assert.equal(rows[0]?.aprovado, FIN.email)
    assert.notEqual(rows[0]?.por, CSM.email)
  })
})

test('a taxonomia de motivos é fechada e tem rótulo legível', () => {
  // Com campo aberto, "preço", "custo", "caro" e "orçamento" viram quatro
  // motivos distintos, e "por que perdemos clientes" deixa de ter resposta.
  assert.equal(rotuloDoMotivo('baixa_adesao'), 'Baixa adesão')
  assert.equal(rotuloDoMotivo(null), null)
  assert.ok(MOTIVOS_SAIDA.length <= 10, 'taxonomia grande é preenchida no chute')
  assert.ok(MOTIVOS_SAIDA.some((m) => m.valor === 'outro'), 'sem "outro" a categoria errada é escolhida')
  for (const m of MOTIVOS_SAIDA) assert.ok(m.explica.length > 10, `${m.valor} sem explicação`)
})
