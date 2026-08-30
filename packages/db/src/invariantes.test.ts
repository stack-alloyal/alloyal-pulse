/**
 * PORTÃO DE CI — invariantes de domínio.
 *
 * Complementa `rls.test.ts`, que cobre isolamento entre clientes. Aqui estão as
 * regras de negócio que o BANCO impõe, e que existem porque disciplina de
 * processo não sobrevive a pressa: cada uma delas é uma forma conhecida de
 * produzir número errado que ninguém percebe.
 *
 * Requer Postgres. Sem DATABASE_URL_ADMIN os testes são pulados — e o CI trata
 * "pulado" como falha.
 */

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import pg from 'pg'

import { migrate } from './migrate.js'

const ADMIN = process.env['DATABASE_URL_ADMIN']
const CONTA = '11111111-2222-3333-4444-555555555555'

describe('invariantes de domínio', { skip: !ADMIN }, () => {
  let db: pg.Client

  before(async () => {
    await migrate(ADMIN as string)
    db = new pg.Client({ connectionString: ADMIN })
    await db.connect()
    await db.query(
      `INSERT INTO core.account (id, razao_social, porte, setor)
       VALUES ($1, 'Conta de invariante', 'medio', 'industria')
       ON CONFLICT (id) DO NOTHING`,
      [CONTA],
    )
  })

  after(async () => {
    // O teardown roda em try/finally: se a limpeza falhar, a conexão precisa
    // fechar mesmo assim — senão o processo não encerra e a suíte trava sem
    // dizer o motivo.
    try {
      await db?.query('DELETE FROM success.work_item WHERE account_id = $1', [CONTA])
      await db?.query('DELETE FROM success.cancellation WHERE account_id = $1', [CONTA])
      // Competência congelada não pode ser apagada — é justamente a invariante
      // testada aqui. Para limpar, o trigger é desligado explicitamente: é uma
      // escotilha de teste, e ela é visível de propósito.
      await db?.query('ALTER TABLE analytics.monthly_close DISABLE TRIGGER monthly_close_congelada')
      await db?.query(
        "DELETE FROM analytics.monthly_close WHERE competencia IN ('2026-05-01','2026-06-01')",
      )
      await db?.query('ALTER TABLE analytics.monthly_close ENABLE TRIGGER monthly_close_congelada')
    } finally {
      await db?.end()
    }
  })

  // ── Fila de trabalho ──────────────────────────────────────────────────────

  test('uma conta tem no máximo um item aberto por família de gatilho', async () => {
    // O mesmo atraso de pagamento não pode virar três notificações para um fato.
    // É assim que se ensina o time a silenciar a ferramenta.
    const inserir = (gatilho: string) =>
      db.query(
        `INSERT INTO success.work_item
           (account_id, gatilho, familia, prioridade, motivo, dono_email, prazo, competencia)
         VALUES ($1, $2, 'financeiro', 'alta', 'atraso de 63 dias', 'csm@alloyal.com.br', '2026-08-05', '2026-07-30')`,
        [CONTA, gatilho],
      )

    await inserir('G-01')
    await assert.rejects(inserir('G-02'), /duplicate key|work_item_uma_familia_aberta/i)

    // Fechado com desfecho libera a família para um item novo.
    await db.query(
      `UPDATE success.work_item
          SET estado = 'fechado', desfecho = 'resolvido',
              fechado_em = now(), fechado_por = 'csm@alloyal.com.br'
        WHERE account_id = $1 AND gatilho = 'G-01'`,
      [CONTA],
    )
    await inserir('G-02')
  })

  test('fechar item exige desfecho declarado', async () => {
    // Falso positivo é o único mecanismo que calibra o gatilho. Sem desfecho
    // obrigatório, a fila degrada em ruído e ninguém mede.
    await assert.rejects(
      db.query(
        `UPDATE success.work_item SET estado = 'fechado'
          WHERE account_id = $1 AND estado <> 'fechado'`,
        [CONTA],
      ),
      /fechar_exige_desfecho/,
    )
  })

  // ── Saída do cliente ──────────────────────────────────────────────────────

  test('o efeito na receita exige as duas confirmações humanas', async () => {
    // Errar o último mês de cobrança move receita entre competências DEPOIS de a
    // anterior estar congelada — e congelada não se corrige, só se ajusta na
    // corrente. Confirmação esquecida hoje é ajuste inexplicável meses depois.
    await assert.rejects(
      db.query(
        `INSERT INTO success.cancellation
           (account_id, origem, data_levantada, mrr_centavos_na_levantada, competencia_efeito_receita)
         VALUES ($1, 'cliente', '2026-07-15', 2480000, '2026-11-01')`,
        [CONTA],
      ),
      /efeito_receita_exige_duas_confirmacoes/,
    )
  })

  test('com as duas confirmações, o efeito na receita é aceito', async () => {
    await db.query(
      `INSERT INTO success.cancellation
         (account_id, origem, estado, data_levantada, mrr_centavos_na_levantada,
          aviso_previo_dias, aviso_confirmado_por, aviso_confirmado_em, data_fim_aviso,
          competencia_ultima_cobranca, cobranca_confirmada_por, cobranca_confirmada_em,
          competencia_efeito_receita, aprovado_por, aprovado_em,
          -- Desde a 0052, encerrado exige motivo CONFIRMADO: e o dado que
          -- sustenta toda a análise de churn, e é na hora de encerrar que alguém
          -- ainda lembra o que aconteceu. Sem ele o INSERT é recusado.
          criado_por, motivo, motivo_confirmado_por, motivo_confirmado_em)
       VALUES ($1, 'cliente', 'encerrado', '2026-07-15', 2480000,
               90, 'juridico@alloyal.com.br', now(), '2026-10-13',
               '2026-10-01', 'financeiro@alloyal.com.br', now(),
               '2026-11-01', 'financeiro@alloyal.com.br', now(),
               'csm@alloyal.com.br', 'custo', 'financeiro@alloyal.com.br', now())`,
      [CONTA],
    )
    const { rows } = await db.query<{ conta: string; receita: string }>(
      `SELECT data_levantada::text AS conta, competencia_efeito_receita::text AS receita
         FROM success.cancellation WHERE account_id = $1`,
      [CONTA],
    )
    // Os dois relógios: a conta é perdida em julho, a receita sai em novembro.
    assert.equal(rows[0]?.conta, '2026-07-15')
    assert.equal(rows[0]?.receita, '2026-11-01')
  })

  test('encerrado sem motivo confirmado é recusado pelo banco', async () => {
    // O motivo é o campo de que TODA a análise de churn depende, e o momento de
    // encerrar é o único em que alguém ainda lembra o que aconteceu. Deixar isso
    // como combinado de processo é o que faz a coluna chegar vazia em 40% dos
    // casos seis meses depois.
    await assert.rejects(
      () =>
        db.query(
          `INSERT INTO success.cancellation
             (account_id, origem, estado, data_levantada, mrr_centavos_na_levantada,
              aviso_confirmado_por, aviso_confirmado_em, competencia_ultima_cobranca,
              cobranca_confirmada_por, cobranca_confirmada_em,
              competencia_efeito_receita, aprovado_por, aprovado_em)
           VALUES ($1, 'cliente', 'encerrado', '2026-07-15', 100000,
                   'a@alloyal.com.br', now(), '2026-08-01',
                   'b@alloyal.com.br', now(), '2026-09-01', 'b@alloyal.com.br', now())`,
          [CONTA],
        ),
      /encerrado_tem_motivo_confirmado/,
    )
  })

  test('o motivo não pode ser confirmado por quem registrou', async () => {
    // Vem da prática de win/loss de vendas: quem conduziu o caso tem viés, e
    // "custo" é o motivo mais confortável de escrever. A garantia é do BANCO
    // porque combinado de processo é o que se rompe na semana corrida.
    await assert.rejects(
      () =>
        db.query(
          `INSERT INTO success.cancellation
             (account_id, origem, estado, data_levantada, mrr_centavos_na_levantada,
              criado_por, motivo, motivo_confirmado_por, motivo_confirmado_em)
           VALUES ($1, 'cliente', 'anunciado', '2026-07-15', 100000,
                   'mesma@alloyal.com.br', 'custo', 'mesma@alloyal.com.br', now())`,
          [CONTA],
        ),
      /motivo_confirmado_por_outra_pessoa/,
    )
  })

  test('saída pedida pelo cliente exige data da levantada e MRR congelado', async () => {
    await assert.rejects(
      db.query(`INSERT INTO success.cancellation (account_id, origem) VALUES ($1, 'cliente')`, [
        CONTA,
      ]),
      /origem_cliente_tem_levantada/,
    )
    // Encerramento iniciado pela Alloyal não tem levantada de mão — o
    // equivalente é a data da provisão.
    await db.query(`INSERT INTO success.cancellation (account_id, origem) VALUES ($1, 'alloyal')`, [
      CONTA,
    ])
  })

  // ── Fechamento mensal ─────────────────────────────────────────────────────

  test('a cascata de receita tem que fechar', async () => {
    // Número que fecha por construção é número que ninguém confia. O resíduo
    // existe justamente para a identidade fechar sem empurrar nada para churn.
    await assert.rejects(
      db.query(
        `INSERT INTO analytics.monthly_close
           (competencia, mrr_inicial_centavos, novo_centavos, mrr_final_centavos, contas_iniciais)
         VALUES ('2026-06-01', 100000, 5000, 999999, 10)`,
      ),
      /cascata_fecha/,
    )

    // Com o resíduo declarado, fecha.
    await db.query(
      `INSERT INTO analytics.monthly_close
         (competencia, mrr_inicial_centavos, novo_centavos, nao_atribuido_centavos,
          mrr_final_centavos, contas_iniciais)
       VALUES ('2026-06-01', 100000, 5000, -200, 104800, 10)`,
    )
  })

  test('competência congelada é imutável', async () => {
    // O comportamento que mais destrói confiança em BI: corrigir um contrato
    // antigo e o gráfico de seis meses atrás mudar sozinho.
    await db.query(
      `INSERT INTO analytics.monthly_close
         (competencia, mrr_inicial_centavos, novo_centavos, mrr_final_centavos,
          contas_iniciais, estado, congelado_por, congelado_em)
       VALUES ('2026-05-01', 100000, 5000, 105000, 10, 'congelada', 'data.owner@alloyal.com.br', now())`,
    )
    await assert.rejects(
      db.query(`UPDATE analytics.monthly_close SET novo_centavos = 9 WHERE competencia = '2026-05-01'`),
      /congelada/,
    )
    await assert.rejects(
      db.query(`DELETE FROM analytics.monthly_close WHERE competencia = '2026-05-01'`),
      /congelada/,
    )
  })

  // ── Contrato ──────────────────────────────────────────────────────────────

  test('vencimento de parcela só existe em receita pontual', async () => {
    // Sem separar setup de mensalidade, a taxa de implantação entra na cascata
    // recorrente e o NRR fica errado de forma consistente.
    await assert.rejects(
      db.query(
        `INSERT INTO core.contract (account_id, mrr_centavos, inicio, tipo_receita, vencimento_pontual)
         VALUES ($1, 100000, '2026-01-01', 'recorrente', '2026-03-01')`,
        [CONTA],
      ),
      /vencimento_so_em_pontual/,
    )
  })

  // ── Fila de exceção de identidade ─────────────────────────────────────────

  test('resolver exceção de identidade exige destino e autor', async () => {
    // Fila de trabalho, não log: resolver sem dizer para qual conta foi
    // devolveria o registro ao limbo de onde ele veio.
    await assert.rejects(
      db.query(
        `INSERT INTO ops.excecao_referencia (ciclo, fonte, payload, motivo, estado)
         VALUES ('C1', 'replica', '{}', 'sem_correspondencia', 'resolvida')`,
      ),
      /excecao_resolvida_tem_destino/,
    )
  })

  test('playbook ativo exige publicação, e só um por chave', async () => {
    const inserir = (v: number, ativo: boolean) =>
      db.query(
        `INSERT INTO success.playbook (chave, versao, titulo, conteudo, ativo, publicado_por, publicado_em)
         VALUES ('queda-adesao', $1, 'Queda de adesão', '...', $2, 'cs.lead@alloyal.com.br', now())`,
        [v, ativo],
      )
    await inserir(1, true)
    // Duas versões ativas da mesma chave: a fila não saberia qual anexar.
    await assert.rejects(inserir(2, true), /playbook_uma_versao_ativa|duplicate key/i)
    await inserir(2, false)
    await db.query(`DELETE FROM success.playbook WHERE chave = 'queda-adesao'`)
  })
  /* ┌───────────────────────────────────────────────────────────────────────┐
     │ QUEM APAGA PRECISA DO GRANT DE APAGAR.                                 │
     │                                                                        │
     │ Medido em 27/08/2026: o C22 NUNCA escreveu um evento em produção.       │
     │ `pulse_worker` tinha INSERT, SELECT e UPDATE em `fact.mrr_event` e NÃO   │
     │ DELETE, e `gerarEventosDeMrr` começa apagando os derivados da            │
     │ competência — é assim que ele é idempotente. Falhava em 2 segundos com   │
     │ "permission denied for table mrr_event".                                │
     │                                                                        │
     │ E ficou VERDE por uma semana: o ciclo pergunta `competenciasSemEventos`  │
     │ antes de escrever, e essa pergunta é só SELECT. Com o ledger cheio a     │
     │ resposta era "nenhuma pendente", ele gravava `ok` com zero linhas, e a   │
     │ parede de permissão nunca era tocada. Ciclo sem trabalho e ciclo sem     │
     │ PERMISSÃO registram exatamente a mesma coisa no painel.                 │
     │                                                                        │
     │ A lista é ESCRITA À MÃO, e isto é decisão. A primeira versão varria os   │
     │ `DELETE FROM` do fonte e exigia o grant do worker — e acusou quatro      │
     │ tabelas de `ops` que quem apaga é o `pulse_api`, na tela de              │
     │ configuração. `@pulse/config` é compartilhado entre a app e o worker, e  │
     │ o diretório do arquivo NÃO diz qual papel executa aquela linha. Um       │
     │ portão que erra o dono ensina a ignorar portão.                         │
     │                                                                        │
     │ O custo é ter de acrescentar uma linha aqui ao escrever um DELETE novo.  │
     │ É o custo certo: quem escreve o DELETE é quem sabe quem vai executá-lo.  │
     └───────────────────────────────────────────────────────────────────────┘ */
  test('quem apaga tem o grant de apagar', async () => {
    const APAGAM = [
      // O worker, nos ciclos:
      { papel: 'pulse_worker', tabela: 'fact.mrr_event', onde: 'gerarEventosDeMrr (C22)' },
      { papel: 'pulse_worker', tabela: 'fact.inadimplencia_titulo', onde: 'apurarCompetencia (C21)' },
      { papel: 'pulse_worker', tabela: 'metrics.daily_snapshot', onde: 'consolidação (C13)' },
      { papel: 'pulse_worker', tabela: 'core.omie_titulo', onde: 'carga do Omie (C20)' },
      // A app, nas telas de configuração:
      { papel: 'pulse_api', tabela: 'ops.configuracao', onde: 'loja.ts, tela de ajustes' },
      { papel: 'pulse_api', tabela: 'ops.segredo', onde: 'loja.ts, tela de segredos' },
      { papel: 'pulse_api', tabela: 'ops.user_role', onde: 'papeis.ts, tela de papéis' },
      { papel: 'pulse_api', tabela: 'ops.codigo_verificacao', onde: 'verificacao.ts, step-up' },
    ] as const

    const semGrant: string[] = []
    for (const { papel, tabela, onde } of APAGAM) {
      const { rows } = await db.query<{ pode: boolean }>(
        'SELECT has_table_privilege($1, $2, $3) AS pode',
        [papel, tabela, 'DELETE'],
      )
      if (rows[0]?.pode !== true) semGrant.push(`${papel} → ${tabela} (${onde})`)
    }
    assert.deepEqual(
      semGrant,
      [],
      'o código apaga destas tabelas e o papel não tem DELETE nelas — vai falhar com ' +
        '"permission denied" na primeira vez que houver trabalho, e o painel mostra verde até lá',
    )
  })
})
