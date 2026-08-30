/**
 * Portão: ação de servidor sem formulário que a chame.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ EXISTE POR UM DEFEITO MEU, publicado em produção em 26/08/2026.            │
 * │                                                                            │
 * │ Escrevi `registrarPedido` — a ÚNICA porta de entrada do fluxo de saída —,    │
 * │ com teste de unidade, gate de permissão e transação, e nunca liguei um       │
 * │ `<form action={...}>` a ela. A app subiu, os 765 testes passaram, e a tela   │
 * │ de Saídas ficou com os quatro KPI, o quadro, a lista e metade da coorte em   │
 * │ zero — porque `success.cancellation` não tinha como receber a primeira       │
 * │ linha. O relato do usuário foi "todas as informações estão zeradas".         │
 * │                                                                            │
 * │ Havia ainda uma segunda ação, `registrarSaida`, subconjunto da primeira e    │
 * │ também órfã desde `e131b8f`. Duas portas, nenhuma aberta.                   │
 * │                                                                            │
 * │ Teste de unidade não pega isto por construção: ele CHAMA a função, e é       │
 * │ justamente o chamar que faltava. O que pega é ler a árvore da app e          │
 * │ perguntar quem referencia cada ação exportada.                              │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O QUE ESTE PORTÃO NÃO PROVA: que o formulário funciona, ou que está numa    │
 * │ tela alcançável. Ele prova só que a ação é MENCIONADA em algum lugar da app  │
 * │ — o degrau mais baixo possível, e o que faltava. Provar que o campo certo    │
 * │ chega ao lugar certo é trabalho de teste de navegador, não de varredura.     │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// `../../..` porque este arquivo roda de `packages/config/dist/`.
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const APP = join(RAIZ, 'apps', 'web-internal', 'app')

function arquivos(dir: string, acc: string[] = []): string[] {
  let entradas
  try {
    entradas = readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entradas) {
    const caminho = join(dir, e.name)
    if (e.isDirectory()) arquivos(caminho, acc)
    else if (/\.tsx?$/.test(e.name)) acc.push(caminho)
  }
  return acc
}

const TODOS = arquivos(APP)

test('a árvore da app foi encontrada', () => {
  // Portão que não acha o que vigia é pior que portão nenhum: ele passa vazio e
  // ninguém descobre que parou de olhar.
  assert.ok(TODOS.length > 20, `só ${TODOS.length} arquivos em ${APP}`)
  assert.ok(
    TODOS.some((f) => f.endsWith('acoes.ts')),
    'nenhum arquivo de ações encontrado',
  )
})

test('toda ação de servidor exportada é chamada por alguém na app', () => {
  const definicoes = TODOS.filter((f) => /(^|[/\\])acoes\.ts$/.test(f))
  const orfas: string[] = []

  for (const arquivo of definicoes) {
    const fonte = readFileSync(arquivo, 'utf8')
    // `'use server'` é o que distingue módulo de ação de módulo comum. Sem a
    // diretiva, exportar função async é só exportar função async.
    if (!/^\s*['"]use server['"]/m.test(fonte)) continue

    const nomes = [...fonte.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]!)
    for (const nome of nomes) {
      // A palavra tem de aparecer em ALGUM outro arquivo da app. Uma ação
      // chamada só de dentro do próprio `acoes.ts` continua órfã para a tela.
      const usada = TODOS.some(
        (outro) =>
          outro !== arquivo &&
          new RegExp(`\\b${nome}\\b`).test(readFileSync(outro, 'utf8')),
      )
      if (!usada) orfas.push(`${relative(RAIZ, arquivo)} · ${nome}`)
    }
  }

  assert.deepEqual(
    orfas,
    [],
    'ação de servidor sem nenhum formulário ou componente que a chame — ' +
      'a tela que ela alimenta vai aparecer zerada, e os testes de unidade passam',
  )
})
