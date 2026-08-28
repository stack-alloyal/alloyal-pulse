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
  /* ┌───────────────────────────────────────────────────────────────────────┐
     │ VARRE TODO PACOTE QUE ESCREVE SQL, e antes varria só este.                │
     │                                                                         │
     │ Cometi este erro DOZE vezes. As últimas quatro foram fora de              │
     │ `packages/config`: em `@pulse/success` (duas), em `@pulse/db` e num        │
     │ arquivo de teste — todas fora do alcance do portão, e todas descobertas    │
     │ pelo build, que é o lugar onde a mensagem não aponta para a causa.         │
     │                                                                         │
     │ E inclui `.test.ts` agora: o teste de invariantes escreve SQL cru, e foi   │
     │ exatamente ali que a décima segunda apareceu. Excluir teste era uma        │
     │ economia sem motivo — o build quebra igual.                               │
     └───────────────────────────────────────────────────────────────────────┘ */
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const pacotes = ['config', 'success', 'db', 'contratos', 'metrics', 'mail', 'auth']
  const achados: string[] = []
  for (const pacote of pacotes) {
    const dir = join(raiz, pacote, 'src')
    let arquivos: string[]
    try {
      arquivos = readdirSync(dir).filter((f) => f.endsWith('.ts'))
    } catch {
      continue // pacote que não existe mais, ou sem src
    }
    for (const nome of arquivos) {
      /* ┌──────────────────────────────────────────────────────────────────┐
         │ ONDE O TEMPLATE LITERAL TERMINA, e não que prefixo a linha tem.    │
         │                                                                    │
         │ A décima terceira ocorrência (27/08/2026) estava numa moldura de   │
         │ caixa dentro de um bloco de comentário, dentro de um template      │
         │ literal de SQL. Linha de moldura não começa com marcador nenhum —  │
         │ começa com a barra vertical do desenho —, então o portão antigo,   │
         │ que olhava o prefixo, não a viu. O build viu, e apontou erro de    │
         │ sintaxe numa linha que é texto em português.                       │
         │                                                                    │
         │ A primeira tentativa de alargar contava crases por linha para      │
         │ saber se estava dentro de SQL. Deu SEIS falsos positivos: par de   │
         │ crase em prosa de JSDoc, aberto numa linha e fechado na seguinte,  │
         │ é indistinguível de fronteira de literal para um contador. Régua   │
         │ que acusa o inocente ensina a ignorar régua.                       │
         │                                                                    │
         │ Então este portão LÊ o arquivo como o compilador lê: um pequeno    │
         │ lexer que sabe distinguir comentário, aspas e template literal.    │
         │ E a pergunta deixa de ser "que prefixo tem a linha?" para ser      │
         │ "EM QUE LINHA o template acabou?". Se acabou numa linha que é      │
         │ desenho ou comentário, a crase dali é o defeito — porque o         │
         │ compilador fechou o literal ali, e o resto do SQL virou código.    │
         └──────────────────────────────────────────────────────────────────┘ */
      const fonte = readFileSync(join(dir, nome), 'utf8')
      // Linha onde cada template literal FECHA. Dentro de um literal, `/*` e
      // `--` não são comentário: são texto. Só a crase importa.
      const fechamentos: number[] = []
      let estado: 'codigo' | 'linha' | 'bloco' | 'aspa1' | 'aspa2' | 'literal' = 'codigo'
      let linha = 1
      let profundidade = 0
      for (let k = 0; k < fonte.length; k++) {
        const c = fonte[k]
        const prox = fonte[k + 1]
        if (c === '\n') linha++
        if (c === '\\') { k++; continue }
        switch (estado) {
          case 'codigo':
            if (c === '/' && prox === '/') { estado = 'linha'; k++ }
            else if (c === '/' && prox === '*') { estado = 'bloco'; k++ }
            else if (c === "'") estado = 'aspa1'
            else if (c === '"') estado = 'aspa2'
            else if (c === '`') estado = 'literal'
            break
          case 'linha':
            if (c === '\n') estado = 'codigo'
            break
          case 'bloco':
            if (c === '*' && prox === '/') { estado = 'codigo'; k++ }
            break
          case 'aspa1':
            if (c === "'" || c === '\n') estado = 'codigo'
            break
          case 'aspa2':
            if (c === '"' || c === '\n') estado = 'codigo'
            break
          case 'literal':
            // `${` devolve ao código até a chave fechar: é onde vivem os
            // pedaços de SQL compartilhados (${POSICAO}, ${COLUNAS}).
            if (c === '$' && prox === '{') { profundidade++; estado = 'codigo'; k++ }
            else if (c === '`') { fechamentos.push(linha); estado = 'codigo' }
            break
        }
        if (estado === 'codigo' && profundidade > 0 && c === '}') {
          profundidade--
          estado = 'literal'
        }
      }

      const linhas = fonte.split('\n')
      for (const n of fechamentos) {
        const texto = linhas[n - 1] ?? ''
        // Desenho de caixa, comentário SQL ou de bloco: nenhum desses é lugar
        // de um template literal terminar.
        if (/^\s*(│|--|\*|\/\*)/.test(texto) || texto.includes('│')) {
          achados.push(`${pacote}/${nome}:${n} · ${texto.trim().slice(0, 60)}`)
        }
      }
    }
  }
  assert.ok(achados.length >= 0, 'varredura executada')
  assert.deepEqual(
    achados,
    [],
    'crase em comentário SQL fecha o template literal e quebra o build numa linha que parece comentário',
  )
})
