/**
 * PORTÃO — a gravação do Omie contra dado repetido.
 *
 * Existe por causa de uma falha real: o C20 rodou 17 minutos em produção, leu
 * 9.498 fichas e 90.062 títulos, e MORREU na gravação com
 * "ON CONFLICT DO UPDATE command cannot affect row a second time".
 *
 * A causa não é exótica. O Omie tem 21 títulos com código duplicado, e uma
 * varredura de 193 páginas anda enquanto a base muda — um registro reaparece.
 * O Postgres recusa o comando inteiro quando a mesma chave vem duas vezes,
 * porque não tem como saber qual das duas deveria vencer.
 *
 * Estes testes usam a mesma função que o ciclo usa, com um banco de mentira que
 * captura o SQL: o que se verifica é o que de fato vai para o banco.
 */

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  documentoUtil,
  gravarExtras,
  gravarOmie,
  type BaixaOmie,
  type FichaOmie,
  type MovimentoOmie,
} from './omie.js'

/** Um `pg.Pool` de mentira que guarda os parâmetros de cada consulta. */
function bancoFalso() {
  const chamadas: { sql: string; params: unknown[] }[] = []
  return {
    chamadas,
    pool: {
      query: async (sql: string, params: unknown[]) => {
        chamadas.push({ sql, params })
        // `rowCount` é o que `gravarOmie` soma; devolver o tamanho do lote imita
        // um INSERT que gravou tudo.
        const linhas = JSON.parse(String(params[0])) as unknown[]
        return { rowCount: linhas.length, rows: [] }
      },
    } as never,
  }
}

const ficha = (codigoOmie: number, documento: string, razaoSocial = 'X'): FichaOmie => ({
  documento, codigoOmie, razaoSocial, nomeFantasia: null, pessoaFisica: false, inativo: false,
  email: null, contato: null, telefone: null, cidade: null, estado: null,
  cadastradoEm: null, alteradoEm: null, tags: [], caracteristicas: {},
})

const titulo = (codigoTitulo: number, documento: string, valorCentavos = 1000): MovimentoOmie => ({
  codigoTitulo, documento, codigoCliente: null, categoria: null, status: null,
  emissao: null, vencimento: null, previsao: null, pagamento: null,
  valorCentavos, pagoCentavos: 0, abertoCentavos: 0, liquidado: null,
})

describe('gravação do Omie', () => {
  test('a mesma ficha repetida vai UMA vez para o banco', async () => {
    const { pool, chamadas } = bancoFalso()
    await gravarOmie(pool, { fichas: [ficha(1, '11222333000181'), ficha(1, '11222333000181')] })
    const enviadas = JSON.parse(String(chamadas[0]?.params[0])) as { codigo_omie: number }[]
    assert.equal(enviadas.length, 1, 'chave repetida no lote derruba o INSERT inteiro')
  })

  test('o mesmo título repetido vai UMA vez — foi o que matou o C20', async () => {
    const { pool, chamadas } = bancoFalso()
    await gravarOmie(pool, { movimentos: [titulo(7, '11222333000181'), titulo(7, '11222333000181')] })
    const enviadas = JSON.parse(String(chamadas[0]?.params[0])) as unknown[]
    assert.equal(enviadas.length, 1)
  })

  test('vence a ÚLTIMA ocorrência, que é a mais recente da varredura', async () => {
    // A varredura vai da página 1 em diante; se um registro reaparece adiante, a
    // ocorrência posterior é a aposta melhor. Trocar para "a primeira vence"
    // gravaria o valor velho e ninguém notaria.
    const { pool, chamadas } = bancoFalso()
    await gravarOmie(pool, { movimentos: [titulo(7, '11222333000181', 100), titulo(7, '11222333000181', 999)] })
    const enviadas = JSON.parse(String(chamadas[0]?.params[0])) as { valor_centavos: number }[]
    assert.equal(enviadas[0]?.valor_centavos, 999)
  })

  test('registros distintos não são deduplicados por engano', async () => {
    const { pool, chamadas } = bancoFalso()
    await gravarOmie(pool, {
      movimentos: [titulo(1, '11222333000181'), titulo(2, '11222333000181'), titulo(3, '99888777000166')],
    })
    const enviadas = JSON.parse(String(chamadas[0]?.params[0])) as unknown[]
    assert.equal(enviadas.length, 3, 'dedup pela chave errada apagaria títulos legítimos do mesmo cliente')
  })

  test('lote vazio não emite consulta', async () => {
    const { pool, chamadas } = bancoFalso()
    const r = await gravarOmie(pool, { fichas: [], movimentos: [] })
    assert.equal(chamadas.length, 0)
    assert.deepEqual(r, { fichas: 0, movimentos: 0 })
  })
})

describe('baixas', () => {
  const baixa = (codigoTitulo: number, pagamento: string | null, pagoCentavos = 0): BaixaOmie => ({
    codigoTitulo, documento: '11222333000181', pagamento, pagoCentavos,
    jurosCentavos: 0, multaCentavos: 0, descontoCentavos: 0, categoria: null,
  })

  test('baixa SEM data de pagamento é gravada', async () => {
    // Derrubou o C20 depois de 15 minutos de varredura: `pagamento` estava na
    // PRIMARY KEY, que proíbe nulo, e 3.391 das 25.074 baixas não têm data.
    const { pool, chamadas } = bancoFalso()
    await gravarExtras(pool, { baixas: [baixa(1, null)] })
    const enviadas = JSON.parse(String(chamadas[0]?.params[0])) as { pagamento: string | null }[]
    assert.equal(enviadas.length, 1)
    assert.equal(enviadas[0]?.pagamento, null)
  })

  test('duas baixas iguais sem data contam como uma', async () => {
    // A chave natural inclui a data. Com duas nulas, a deduplicação em JS é a
    // única defesa antes do banco — e sem ela o INSERT inteiro seria recusado.
    const { pool, chamadas } = bancoFalso()
    await gravarExtras(pool, { baixas: [baixa(1, null), baixa(1, null)] })
    const enviadas = JSON.parse(String(chamadas[0]?.params[0])) as unknown[]
    assert.equal(enviadas.length, 1)
  })

  test('mesma data e valores diferentes são baixas distintas', async () => {
    // Título que recebe parcial e depois o resto no mesmo dia. Colapsar as duas
    // faria o total recebido encolher em silêncio.
    const { pool, chamadas } = bancoFalso()
    await gravarExtras(pool, { baixas: [baixa(1, '2026-02-02', 100), baixa(1, '2026-02-02', 900)] })
    const enviadas = JSON.parse(String(chamadas[0]?.params[0])) as unknown[]
    assert.equal(enviadas.length, 2)
  })
})

describe('documento do Omie', () => {
  test('aceita CNPJ e CPF', () => {
    assert.equal(documentoUtil('11222333000181'), true)
    assert.equal(documentoUtil('12345678901'), true)
  })

  test('recusa a sequência de zeros — 78 fichas a usam', () => {
    // "Cliente Consumidor", GitHub, Slack, Mapbox, Notion. Tem o formato de CPF e
    // não identifica ninguém; agrupá-las faria 78 empresas virarem uma.
    assert.equal(documentoUtil('00000000000'), false)
    assert.equal(documentoUtil('00000000000000'), false)
  })

  test('recusa comprimento fora de 11 e 14', () => {
    assert.equal(documentoUtil(''), false)
    assert.equal(documentoUtil('123'), false)
    assert.equal(documentoUtil('112223330001812'), false)
  })
})
