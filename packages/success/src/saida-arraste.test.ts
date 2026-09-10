/**
 * ─── A regra do arraste ──────────────────────────────────────────────────────
 *
 * Escrita em 10/09/2026, quando o quadro trocou os botões de etapa pelo arraste.
 * O pedido foi este: "podemos retirar o fluxo de movimentação e deixar livre
 * para mover para qualquer quadro ao clicar e arrastar".
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ "LIVRE PARA QUALQUER QUADRO" NÃO É "QUALQUER COISA VALE", e a diferença   │
 * │ é o que este arquivo guarda.                                              │
 * │                                                                            │
 * │ Antes, o cartão alcançava só as três etapas. Agora alcança os desfechos     │
 * │ também — menos os dois que um gesto não consegue informar: desconto exige   │
 * │ o MRR novo, e a coluna PDD é origem e não transição.                        │
 * │                                                                            │
 * │ O teste que importa é o PRIMEIRO: nenhum arraste aprovado pode contrariar   │
 * │ `TRANSICOES`. É a primeira vez que a tabela guarda alguma coisa — até aqui  │
 * │ `podeIr` só era chamado pelo próprio teste, e por isso a tabela pôde ficar  │
 * │ meses divergindo do SQL sem que nada acusasse.                             │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ETAPAS_DE_TRABALHO,
  podeIr,
  TRANSICOES,
  type EstadoSaida,
  type OrigemSaida,
} from './cancelamento.js'
import {
  alvosDoCartao,
  colunaConhecida,
  movimento,
  rotuloDaColuna,
  type CartaoQueArrasta,
  type PoderesDeArraste,
} from './saida-arraste.js'
import { POSICOES } from './saida-visoes.js'

const TUDO: PoderesDeArraste = { fila: true, distrato: true }
const ESTADOS = Object.keys(TRANSICOES) as EstadoSaida[]
const ORIGENS: OrigemSaida[] = ['cliente', 'alloyal']

const cartao = (
  estado: EstadoSaida,
  origem: OrigemSaida = 'cliente',
  avisoPrevioDias: number | null = 30,
): CartaoQueArrasta => ({ estado, origem, avisoPrevioDias })

test('nenhum arraste aprovado contraria a máquina de estados', () => {
  /* A invariante inteira, por força bruta: 8 estados × 2 origens × 8 colunas ×
     2 casos de aviso. Se alguém acrescentar uma coluna, uma etapa ou uma
     transição, é aqui que a incoerência aparece. */
  const violacoes: string[] = []
  for (const estado of ESTADOS) {
    for (const origem of ORIGENS) {
      for (const aviso of [30, null]) {
        for (const pos of POSICOES) {
          const m = movimento(cartao(estado, origem, aviso), pos.id, TUDO)
          if (!m.ok) continue
          if (!podeIr(estado, m.virar)) {
            violacoes.push(`${estado} → ${pos.id} viraria ${m.virar}, que TRANSICOES não permite`)
          }
        }
      }
    }
  }
  assert.deepEqual(violacoes, [])
})

test('a invariante ainda pega uma incoerência', () => {
  /* Mutação: o teste de cima só vale se a conferência de fato reprovar algo.
     `reversao → retido` é permitido; `retido → qualquer coisa` não é, e é por
     isso que cartão em desfecho não tem alvo nenhum. */
  assert.equal(podeIr('reversao', 'retido'), true)
  assert.equal(podeIr('retido', 'em_aviso'), false)
  assert.deepEqual(alvosDoCartao(cartao('retido'), TUDO), [])
})

test('as três etapas se alcançam nos dois sentidos', () => {
  // O pedido do usuário — "a seta de pedido para voltar e não continuar" — e o
  // que o SQL de `avancarEtapa` sempre aceitou.
  assert.ok(movimento(cartao('reversao'), 'pedido', TUDO).ok, 'reversão não volta para pedido')
  assert.ok(movimento(cartao('financeiro'), 'pedido', TUDO).ok, 'financeiro não volta para pedido')
  assert.ok(movimento(cartao('anunciado'), 'reversao', TUDO).ok, 'pedido não avança para reversão')
  // E nunca para a própria coluna: `avancarEtapa` recusa `estado = $3`.
  for (const e of ETAPAS_DE_TRABALHO) {
    const coluna = e === 'anunciado' ? 'pedido' : e
    const m = movimento(cartao(e), coluna, TUDO)
    assert.equal(m.ok, false, `${e} aceitou soltar na própria coluna`)
  }
})

test('desconto e PDD recusam o arraste, e dizem o motivo', () => {
  /* As duas colunas que o gesto não alcança, e é por informação faltando — não
     por proibição. A mensagem tem de dizer O QUE falta, senão a pessoa fica
     tentando de novo. */
  const d = movimento(cartao('anunciado'), 'desconto', TUDO)
  assert.equal(d.ok, false)
  assert.match(d.ok === false ? d.porque : '', /MRR novo e da competência/)

  const p = movimento(cartao('anunciado', 'cliente'), 'pdd', TUDO)
  assert.equal(p.ok, false)
  assert.match(p.ok === false ? p.porque : '', /origem/)
})

test('a origem decide qual das duas colunas de perda aceita o cartão', () => {
  /* `cancelamento` e `pdd` são o MESMO estado separado pela origem. Cada cartão
     tem exatamente uma das duas como destino — soltar na outra devolve a
     explicação em vez de mover o cartão para uma coluna que ele não ocuparia. */
  assert.ok(movimento(cartao('anunciado', 'cliente'), 'cancelamento', TUDO).ok)
  assert.equal(movimento(cartao('anunciado', 'cliente'), 'pdd', TUDO).ok, false)
  assert.ok(movimento(cartao('anunciado', 'alloyal'), 'pdd', TUDO).ok)
  assert.equal(movimento(cartao('anunciado', 'alloyal'), 'cancelamento', TUDO).ok, false)
})

test('sem aviso prévio em dias a coluna de perda recusa', () => {
  /* `confirmarAviso` grava o campo que mais desloca receita entre meses. O
     arraste não informa número nenhum: ele só confirma o que já está no pedido.
     Sem valor gravado, não há o que confirmar. */
  const m = movimento(cartao('anunciado', 'cliente', null), 'cancelamento', TUDO)
  assert.equal(m.ok, false)
  assert.match(m.ok === false ? m.porque : '', /aviso prévio em dias/)
})

test('o aviso já correndo só aceita a retenção', () => {
  // `em_aviso` é o único estado não terminal fora das etapas: `reter` o aceita,
  // e é a janela em que o cancelamento ainda pode ser revertido.
  assert.deepEqual(alvosDoCartao(cartao('em_aviso'), TUDO), ['revertido'])
})

test('a alçada some da lista de alvos, e não vira erro depois de soltar', () => {
  /* Coluna que a pessoa não pode usar não acende — é o mesmo princípio do Chip
     apagado do design system. E `renegociar` não abre exceção para
     `configurar`, então `distrato: false` fecha a coluna mesmo para quem
     configura. */
  const semDistrato: PoderesDeArraste = { fila: true, distrato: false }
  assert.ok(!alvosDoCartao(cartao('anunciado'), semDistrato).includes('renegociado'))
  assert.ok(alvosDoCartao(cartao('anunciado'), semDistrato).includes('revertido'))

  const semFila: PoderesDeArraste = { fila: false, distrato: true }
  // Sem fila sobra só o que a alçada de distrato abre.
  assert.deepEqual(alvosDoCartao(cartao('anunciado'), semFila), ['renegociado'])
})

test('todo desfecho registrado é cartão parado', () => {
  // Se um desfecho ganhasse alvo, o quadro passaria a oferecer a reabertura de
  // uma competência já fechada. É a regra que `TRANSICOES` chama de terminal.
  for (const e of ['retido', 'desconto', 'renegociado', 'encerrado'] as const) {
    for (const origem of ORIGENS) {
      assert.deepEqual(alvosDoCartao(cartao(e, origem), TUDO), [], `${e} (${origem}) tem alvo`)
    }
  }
})

test('coluna que chega da rede passa por lista de permissão', () => {
  // O mesmo padrão de `volta.ts`: compara com a lista, não conserta a string.
  assert.equal(colunaConhecida('pedido'), 'pedido')
  assert.equal(colunaConhecida('../../etc/passwd'), null)
  assert.equal(colunaConhecida(''), null)
  assert.equal(colunaConhecida('PEDIDO'), null)
})

test('todo alvo aprovado é uma posição do quadro, e tem rótulo', () => {
  /* A mensagem de sucesso diz o nome da coluna. Se um alvo não fosse posição, a
     mensagem cairia no id cru — "movido para pdd" em vez de "Cancelamento
     Alloyal (PDD)". */
  const ids = POSICOES.map((p) => p.id)
  for (const estado of ESTADOS) {
    for (const origem of ORIGENS) {
      for (const a of alvosDoCartao(cartao(estado, origem), TUDO)) {
        assert.ok(ids.includes(a), `${a} não é posição do quadro`)
        assert.notEqual(rotuloDaColuna(a), a, `${a} não tem rótulo aprovado`)
      }
    }
  }
})
