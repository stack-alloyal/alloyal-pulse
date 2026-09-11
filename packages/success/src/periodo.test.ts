/**
 * ─── O recorte de tempo do quadro ────────────────────────────────────────────
 *
 * Escrito em 11/09/2026, quando o kanban ganhou filtro de período. O pedido
 * trouxe os presets ("este trimestre", "ano", "todos") e a faixa aberta de duas
 * datas; a medição trouxe o resto.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ `hoje` ENTRA COMO ARGUMENTO, e o motivo é uma falha que este repositório   │
 * │ já teve: um teste de retenção passava num dia e falhava no seguinte porque │
 * │ dependia de `current_date`. Aqui a data é fixada, e virada de trimestre,   │
 * │ virada de ano e 29 de fevereiro viram casos de teste em vez de surpresa.   │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  dataConhecida,
  faixaDoPeriodo,
  PERIODO_PADRAO,
  PERIODOS,
  periodoConhecido,
  rotuloDaFaixa,
} from './periodo.js'

test('o trimestre começa no mês certo, nos quatro trimestres', () => {
  // A conta é `mes - (mes % 3)` com mês 0-based, e é onde um off-by-one passa
  // despercebido: ele só aparece nos meses do MEIO de cada trimestre.
  const casos: ReadonlyArray<readonly [string, string]> = [
    ['2026-01-01', '2026-01-01'], ['2026-02-14', '2026-01-01'], ['2026-03-31', '2026-01-01'],
    ['2026-04-01', '2026-04-01'], ['2026-05-15', '2026-04-01'], ['2026-06-30', '2026-04-01'],
    ['2026-07-01', '2026-07-01'], ['2026-08-20', '2026-07-01'], ['2026-09-11', '2026-07-01'],
    ['2026-10-01', '2026-10-01'], ['2026-11-05', '2026-10-01'], ['2026-12-31', '2026-10-01'],
  ]
  for (const [hoje, esperado] of casos) {
    assert.equal(faixaDoPeriodo('trimestre', hoje).desde, esperado, `trimestre de ${hoje}`)
  }
})

test('o ano começa em 1º de janeiro, inclusive no próprio 1º de janeiro', () => {
  assert.equal(faixaDoPeriodo('ano', '2026-01-01').desde, '2026-01-01')
  assert.equal(faixaDoPeriodo('ano', '2026-12-31').desde, '2026-01-01')
})

test('doze meses atrás sobrevive a 29 de fevereiro', () => {
  // 29/02/2024 menos um ano não existe. `Date.UTC` normaliza para 01/03/2023 em
  // vez de devolver data inválida — e data inválida aqui viraria `Invalid Date`
  // dentro de um `::date` do Postgres, que é erro 500 na tela.
  assert.equal(faixaDoPeriodo('doze_meses', '2024-02-29').desde, '2023-03-01')
  assert.equal(faixaDoPeriodo('doze_meses', '2026-09-11').desde, '2025-09-11')
  assert.equal(faixaDoPeriodo('doze_meses', '2026-01-01').desde, '2025-01-01')
})

test('"todos" não tem limite nenhum', () => {
  assert.deepEqual(faixaDoPeriodo('tudo', '2026-09-11'), { desde: null, ate: null })
})

test('duas datas invertidas viram a faixa lida ao contrário, não uma faixa vazia', () => {
  /* Quem digita 30/09 e depois 01/09 quis setembro, não quis zero cartão. Sem
     isto a tela ficaria vazia sem dizer por quê — e tela vazia é indistinguível
     de "não há nada", que é a mentira que este repositório passa o tempo
     consertando. */
  assert.deepEqual(
    faixaDoPeriodo('personalizado', '2026-09-11', { desde: '2026-09-30', ate: '2026-09-01' }),
    { desde: '2026-09-01', ate: '2026-09-30' },
  )
  // Já na ordem certa, passa intacta.
  assert.deepEqual(
    faixaDoPeriodo('personalizado', '2026-09-11', { desde: '2026-09-01', ate: '2026-09-30' }),
    { desde: '2026-09-01', ate: '2026-09-30' },
  )
  // Uma ponta só é faixa aberta, e vale.
  assert.deepEqual(
    faixaDoPeriodo('personalizado', '2026-09-11', { desde: '2026-01-01', ate: null }),
    { desde: '2026-01-01', ate: null },
  )
})

test('o que vem da URL passa por lista de permissão', () => {
  // Mesmo padrão de `volta.ts` e de `colunaConhecida`: compara com a lista, não
  // conserta a string. `searchParams` é entrada do usuário.
  assert.equal(periodoConhecido('ano'), 'ano')
  assert.equal(periodoConhecido('TRIMESTRE'), PERIODO_PADRAO)
  assert.equal(periodoConhecido(undefined), PERIODO_PADRAO)
  assert.equal(periodoConhecido("'; DROP TABLE"), PERIODO_PADRAO)

  assert.equal(dataConhecida('2026-09-11'), '2026-09-11')
  assert.equal(dataConhecida('11/09/2026'), null)
  assert.equal(dataConhecida('2026-13-45'), null, 'mês 13 e dia 45 não existem')
  assert.equal(dataConhecida('2026-09-11; DELETE'), null)
  assert.equal(dataConhecida(undefined), null)
})

test('o padrão é doze meses, e a escolha é medida', () => {
  /* Com os 485 tickets do HubSpot: `tudo` põe 432 cartões na tela e 345 numa
     coluna só; `trimestre` mostra 25 e esconde 2 pedidos EM ANDAMENTO — os de
     20/03 e 25/05, os mais parados do quadro. `doze_meses` mostra 159 e não
     esconde nenhum em andamento. */
  assert.equal(PERIODO_PADRAO, 'doze_meses')
  assert.ok(PERIODOS.some((p) => p.id === PERIODO_PADRAO), 'o padrão tem de estar na lista')
  assert.ok(PERIODOS.some((p) => p.id === 'tudo'), 'o usuário pediu a opção "todos"')
  assert.ok(PERIODOS.some((p) => p.id === 'trimestre'), 'o usuário pediu "este trimestre"')
  assert.ok(PERIODOS.some((p) => p.id === 'ano'), 'o usuário pediu "ano"')
  assert.ok(PERIODOS.some((p) => p.id === 'personalizado'), 'e a faixa aberta de duas datas')
})

test('o rótulo da faixa nunca fica vazio — o recorte não pode ser invisível', () => {
  // Uma tela que mostra menos sem dizer quanto menos é a mesma falha de esconder
  // cartão em silêncio.
  for (const p of PERIODOS) {
    const f = faixaDoPeriodo(p.id, '2026-09-11', { desde: '2026-01-01', ate: '2026-06-30' })
    assert.ok(rotuloDaFaixa(p.id, f).length > 3, `${p.id} sem rótulo`)
  }
  assert.match(
    rotuloDaFaixa('personalizado', { desde: '2026-01-01', ate: '2026-06-30' }),
    /01\/01\/2026.*30\/06\/2026/,
    'a faixa personalizada mostra as duas datas, em dia\\/mês\\/ano',
  )
  assert.match(
    rotuloDaFaixa('personalizado', { desde: null, ate: null }),
    /todos/i,
    'personalizado sem data nenhuma tem de dizer que está mostrando tudo',
  )
})
