/**
 * Portão: credencial de cliente não chega à tela de conferência.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ Existe por um defeito que eu mesmo criei e só vi olhando a tela pronta. A   │
 * │ ideia de "mostrar todos os campos para quem confere" fazia a aba da Lecupon │
 * │ imprimir `api_secret`, `api_key` e `signature_secret` do cliente em texto   │
 * │ claro — numa página interna que vai para print e para tela compartilhada.   │
 * │                                                                            │
 * │ O teste vigia a REGRA, não a tela: qualquer campo novo que o fornecedor      │
 * │ acrescente com esses nomes já nasce oculto.                                │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// Lê o FONTE em TypeScript, e não o compilado: a expressão vive no `.ts`, e ler o
// `.js` faria o teste vigiar o resultado da compilação em vez da regra escrita.
// `..` porque este arquivo roda de `dist/` e o fonte está em `src/`.
const FONTE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'fontes-da-conta.ts'),
  'utf8',
)

/** A mesma expressão do módulo, lida do arquivo para não haver duas cópias. */
const SEGREDO = new RegExp(
  /const SEGREDO = \/([^/]+)\/i/.exec(FONTE)?.[1] ?? '(?!)',
  'i',
)

test('a expressão de segredo foi encontrada no módulo', () => {
  // Se alguém renomear a constante, este teste falha em vez de passar vazio —
  // um portão que não encontra o que vigia é pior que nenhum portão.
  assert.notEqual(SEGREDO.source, '(?!)')
})

test('os campos que a Lecupon devolve e são credencial ficam ocultos', () => {
  // Nomes REAIS observados na resposta da API em 10/08/2026.
  for (const campo of ['api_key', 'api_secret', 'signature_secret']) {
    assert.equal(SEGREDO.test(campo), true, `${campo} apareceria em texto claro`)
  }
})

test('variações de nome de credencial também são pegas', () => {
  for (const campo of ['apiKey', 'API_SECRET', 'client_secret', 'access_token',
                       'senha', 'password', 'passcode', 'credentials']) {
    assert.equal(SEGREDO.test(campo), true, `${campo} passaria`)
  }
})

test('campo comum NÃO é ocultado por engano', () => {
  // O outro modo de falha: uma expressão gulosa esconderia razão social e CNPJ, e a
  // tela deixaria de servir para conferir.
  for (const campo of ['cnpj', 'razao_social', 'nome_fantasia', 'status', 'cidade',
                       'estado', 'email', 'hubspot_company_id', 'user_count', 'name']) {
    assert.equal(SEGREDO.test(campo), false, `${campo} seria escondido sem motivo`)
  }
})

test('as DUAS fontes aplicam a regra', () => {
  // Lecupon e Omie montam a lista de campos em lugares diferentes do arquivo.
  // Proteger só uma deixaria a outra vazando.
  const usos = FONTE.match(/SEGREDO\.test\(/g) ?? []
  assert.ok(usos.length >= 2, `só ${usos.length} ponto(s) protegido(s) — falta uma fonte`)
})

test('o campo oculto continua aparecendo na lista', () => {
  // Sumir com a linha faria parecer que a fonte não tem aquele dado. Dizer "existe e
  // está oculto" é a informação certa para quem confere.
  assert.match(FONTE, /const OCULTO = '[^']*oculto[^']*'/)
  assert.equal(/campos.*filter.*SEGREDO/s.test(FONTE), false, 'a linha está sendo removida')
})

/**
 * PORTÃO — crase dentro de template literal de SQL.
 *
 * Cometi este erro TRÊS vezes num dia: escrever um comentário SQL usando crase
 * para destacar um identificador, dentro de uma string que é delimitada por crase.
 * A string fecha ali, e o TypeScript quebra com "',' expected" numa linha que
 * parece um comentário inofensivo — a mensagem não aponta para a causa.
 *
 * A regra é estreita de propósito: só linhas que começam com `--` (comentário
 * SQL) dentro de arquivos deste pacote. Crase em comentário de JSDoc é legítima e
 * fica de fora.
 */
test('nenhum comentário SQL usa crase', () => {
  // ┌───────────────────────────────────────────────────────────────────────┐
  // │ O QUE ESTA REGRA PEGA, E O QUE ELA NÃO TEM COMO PEGAR.                  │
  // │                                                                          │
  // │ Cometi este erro quatro vezes: crase num comentário DENTRO de um template │
  // │ literal de SQL. A string fecha ali, e o TypeScript quebra com             │
  // │ "',' expected" numa linha que parece um comentário inofensivo.            │
  // │                                                                          │
  // │ A regra olha linhas que começam com `--`, que é comentário SQL, e foi     │
  // │ assim que pegou três das quatro. A quarta estava num comentário de bloco  │
  // │ `/* */`, e essa NÃO é detectável por varredura: no instante em que a      │
  // │ crase aparece, o template já terminou e o resto virou código — não existe │
  // │ mais um "dentro da string" para procurar. Quem pega essa é o build.       │
  // │                                                                          │
  // │ Tentei acompanhar o estado das crases linha a linha e o resultado foi     │
  // │ pior: acusou JSDoc legítimo, onde crase é a marcação normal de código.    │
  // │ Portão que acusa o certo é desligado no primeiro dia.                     │
  // └───────────────────────────────────────────────────────────────────────┘
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
  const arquivos = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  const achados: string[] = []
  for (const nome of arquivos) {
    const linhas = readFileSync(join(dir, nome), 'utf8').split('\n')
    linhas.forEach((linha, i) => {
      if (/^\s*--/.test(linha) && linha.includes('`')) {
        achados.push(`${nome}:${i + 1} · ${linha.trim().slice(0, 70)}`)
      }
    })
  }
  assert.deepEqual(
    achados,
    [],
    'crase em comentário SQL fecha o template literal e quebra o build numa linha que parece comentário',
  )
})
