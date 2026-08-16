/**
 * Portão do design system: as telas usam os componentes, e não uma cópia deles.
 *
 * Existe por causa de um defeito real encontrado numa auditoria. O `TextArea` do
 * alloyal-publi nunca foi portado, então as duas telas que precisavam de campo longo
 * copiaram as classes do `inputCls` à mão — e as duas cópias JÁ tinham divergido entre
 * si: uma em `text-[13px]` com regra de placeholder, a outra em `text-[13.5px]` sem.
 * Ninguém nota, porque as duas telas não se abrem lado a lado.
 *
 * É o mesmo padrão que já obrigou `papeis.test.ts` e `migracoes.test.ts` a existirem:
 * lista duplicada diverge, e a revisão de código não pega — cada arquivo parece certo
 * sozinho. Só a asserção que olha os dois ao mesmo tempo pega.
 *
 * Roda sem build e sem banco: é varredura de arquivo, não precisa de tipos.
 */

import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASE = join(RAIZ, 'packages', 'ui', 'src', 'base.tsx')

/** Todo .tsx da app e da biblioteca, menos o que o build gera. */
function tsx(dir, achados = []) {
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules' || nome === '.next' || nome === 'dist') continue
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) tsx(p, achados)
    else if (nome.endsWith('.tsx')) achados.push(p)
  }
  return achados
}

const ARQUIVOS = [
  ...tsx(join(RAIZ, 'apps', 'web-internal', 'app')),
  ...tsx(join(RAIZ, 'apps', 'web-portal', 'app')),
  ...tsx(join(RAIZ, 'packages', 'ui', 'src')),
].map((p) => ({ caminho: relative(RAIZ, p), texto: readFileSync(p, 'utf8') }))

test('há arquivos para varrer', () => {
  // Sem isto, um erro de caminho faz o portão passar varrendo o vazio — o pior
  // tipo de teste verde, porque afirma exatamente o que não verificou.
  assert.ok(ARQUIVOS.length > 15, `varreu só ${ARQUIVOS.length} arquivos — caminho errado?`)
})

/**
 * A exceção declarada.
 *
 * Existe um caso legítimo: o valor do `Metric` é um `<button>` porque precisa receber
 * foco de teclado para revelar a procedência do número, e é estilizado como
 * `border-0 bg-transparent` justamente para NÃO parecer botão. Trocá-lo por `<Btn>`
 * aplicaria a aparência errada.
 *
 * Em vez de afrouxar a regra para todos, a exceção se declara no código com motivo.
 * Marcador sem motivo não vale: silenciador anônimo é como a regra morre — alguém
 * cola o marcador para o teste passar e ninguém descobre por quê.
 */
const MARCADOR = /ds-excecao:\s*(\S[^*\n]*)/

function temExcecao(texto, indice) {
  const antes = texto.slice(Math.max(0, indice - 400), indice)
  const m = antes.match(new RegExp(MARCADOR.source + '[\\s\\S]*$'))
  return m !== null && m[1].trim().length >= 15
}

/**
 * Elemento de formulário cru onde já existe componente.
 *
 * `type="hidden"` fica de fora: não tem aparência, e embrulhá-lo num rótulo seria
 * pior. `base.tsx` é a definição dos componentes — é onde os elementos crus devem
 * estar.
 *
 * A varredura ignora COMENTÁRIO, pelo mesmo motivo já registrado na regra de cor:
 * um `<button>` citado em prosa não desenha botão nenhum. Sem isto, o arquivo que
 * explica POR QUE o `<summary>` do menu de novidades não pode ser um `<Btn>` era
 * acusado duas vezes — e o único jeito de passar seria parar de nomear o elemento
 * de que o texto trata. Portão que obriga a escrever comentário pior está ensinando
 * a coisa errada. Código comentado também deixa de acusar, e é o certo: ele não
 * renderiza. O teste seguinte prova que a regra continua pegando código de verdade.
 */
test('nenhuma tela usa elemento de formulário cru', () => {
  const COMPONENTE = { textarea: 'TextArea', select: 'Select', input: 'Field', button: 'Btn' }
  const faltas = []

  for (const { caminho, texto } of ARQUIVOS) {
    if (caminho === relative(RAIZ, BASE)) continue
      // A BIBLIOTECA é onde o elemento cru mora — é dela que os componentes são
      // feitos. A regra vale para quem CONSOME a biblioteca, que é onde a cópia à
      // mão nasce. `ds.tsx` e `ds-cliente.tsx` entram pelo mesmo motivo do `base.tsx`.
      if (/[/\\]ds(-cliente)?\.tsx$/.test(caminho)) continue
    // `temExcecao` continua lendo o texto ORIGINAL: o marcador vive num comentário.
    const codigo = semComentarios(texto)
    for (const [el, comp] of Object.entries(COMPONENTE)) {
      for (const m of codigo.matchAll(new RegExp(`<${el}\\b[^>]*`, 'gs'))) {
        if (el === 'input' && m[0].includes('type="hidden"')) continue
        if (temExcecao(texto, m.index)) continue
        const linha = texto.slice(0, m.index).split('\n').length
        faltas.push(`${caminho}:${linha} — <${el}> cru; use <${comp}> de @pulse/ui`)
      }
    }
  }

  assert.deepEqual(faltas, [], `\n${faltas.join('\n')}\n`)
})

test('a regra de elemento cru ainda pega botão em código, não só em comentário', () => {
  // O par da asserção equivalente da regra de cor: ignorar comentário só é seguro
  // enquanto o que sobra continua sendo varrido. Sem isto, um erro em
  // `semComentarios` apagaria o arquivo inteiro e o portão passaria vazio.
  const fingido = [
    '// um <button> citado em prosa não desenha botão',
    '/* nem <input> em bloco */',
    "const x = <button className='a' />",
    '<textarea rows={3} />',
  ].join('\n')
  const achados = [...semComentarios(fingido).matchAll(/<(button|input|textarea)\b/g)].map(
    (m) => m[1],
  )
  assert.deepEqual(achados, ['button', 'textarea'])
})

/**
 * Cópia à mão das classes do campo.
 *
 * A assinatura é `focus:ring-purple-100`, o anel de foco do campo: existe uma única
 * vez no repo, dentro do `inputCls`. Encontrá-lo em outro arquivo significa que
 * alguém reconstruiu o campo em vez de importá-lo.
 *
 * A primeira versão desta regra procurava `border-line-strong` + `bg-surface` no
 * arquivo inteiro, e acusou três lugares que não têm campo nenhum: `border-line-strong`
 * também é a borda tracejada do `Vazio` e dos cartões. Assinatura larga demais gera
 * falso positivo, e falso positivo é como um portão passa a ser ignorado.
 */
test('nenhuma cópia à mão do inputCls', () => {
  const copias = ARQUIVOS.filter(
    ({ caminho, texto }) =>
      caminho !== relative(RAIZ, BASE) && texto.includes('focus:ring-purple-100'),
  ).map(({ caminho }) => caminho)

  assert.deepEqual(copias, [], `cópia do inputCls em: ${copias.join(', ')} — importe de @pulse/ui`)
})

/**
 * Comentários fora, mantendo o número da linha.
 *
 * A primeira versão da regra de cor varria o arquivo inteiro e acusou duas vezes um
 * hex que eu havia escrito em COMENTÁRIO — uma vez explicando por que a folha de
 * impressão usa `--surface`, outra explicando quais cinzas do Allvoice foram
 * deliberadamente NÃO copiados. Hex em prosa não pinta nada, e um portão que obriga a
 * reescrever a explicação para passar está ensinando a escrever comentário pior.
 *
 * Troca por espaço em vez de remover, para o número da linha continuar apontando o
 * lugar certo no erro.
 */
function semComentarios(texto) {
  const branco = (c) => c.replace(/[^\n]/g, ' ')
  return (
    texto
      .replace(/\/\*[\s\S]*?\*\//g, branco)
      // `(^|[^:])` deixa `https://` em paz: sem isso, uma URL numa linha apagaria o
      // resto dela e a varredura passaria por cima de um hex real logo depois.
      .replace(/(^|[^:])\/\/[^\n]*/gm, (c, antes) => antes + branco(c.slice(antes.length)))
  )
}

/**
 * Cor fora do token.
 *
 * Hex só pode existir onde os tokens são DEFINIDOS (`estilo.css`), no logo (que é um
 * SVG de marca) e nos dois tons do `Badge` que o próprio Publi declara em hex. Fora
 * disso, hex é cor que o tema não controla — e que não acompanha nenhuma mudança de
 * paleta.
 *
 * Inclui as cores do logotipo do Google: elas são reais e legítimas, e por isso vivem
 * em `estilo.css` (`.g-azul` e as outras três) em vez de num `fill` do componente.
 * Abrir exceção aqui custaria mais que a indireção — invariante com exceção é
 * invariante que ninguém confia.
 */
test('nenhuma cor cravada fora dos tokens', () => {
  const cravadas = []
  for (const { caminho, texto } of ARQUIVOS) {
    if (caminho.endsWith('AlloyalLogo.tsx') || caminho === relative(RAIZ, BASE)) continue
    for (const m of semComentarios(texto).matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      const linha = texto.slice(0, m.index).split('\n').length
      cravadas.push(`${caminho}:${linha} — ${m[0]}`)
    }
  }
  assert.deepEqual(cravadas, [], `\n${cravadas.join('\n')}\n`)
})

test('a regra de cor ainda pega hex em código, não só em comentário', () => {
  // Sem isto, `semComentarios` poderia mascarar tudo e o teste acima passaria vazio —
  // um portão que não recusa nada é pior que nenhum portão, porque parece cobertura.
  const fingido = [
    'const a = 1 // #AAAAAA no fim da linha',
    '  // #BBBBBB em linha própria',
    '/* #CCCCCC em bloco */',
    "const doc = 'https://x.dev/a' // e a URL não come o resto",
    "const cor = '#123456'",
    "const svg = <path fill='#654321' />",
  ].join('\n')
  const achados = [...semComentarios(fingido).matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0])
  assert.deepEqual(achados, ['#123456', '#654321'])
})

/**
 * Paleta padrão do Tailwind.
 *
 * `gray-500` existe e funciona, e é exatamente o problema: renderiza um cinza que não
 * é o cinza da Alloyal, e ninguém percebe porque cinza parece com cinza. A paleta da
 * casa é `ink`, `line`, `surface`, `purple`, `orange`.
 */
test('nenhuma cor da paleta padrão do Tailwind', () => {
  const PADRAO =
    /\b(?:text|bg|border|ring|from|to|via)-(gray|slate|zinc|neutral|stone|indigo|sky|violet|emerald|teal|cyan|rose|fuchsia|lime|yellow)-\d{2,3}\b/g
  const fora = []
  for (const { caminho, texto } of ARQUIVOS) {
    for (const m of texto.matchAll(PADRAO)) {
      const linha = texto.slice(0, m.index).split('\n').length
      fora.push(`${caminho}:${linha} — ${m[0]}`)
    }
  }
  assert.deepEqual(fora, [], `\n${fora.join('\n')}\n`)
})

/**
 * Os tons do Badge são fechados.
 *
 * `tone="verde"` em português compila (é string) e renderiza sem cor nenhuma —
 * silenciosamente. O `Tom` exportado existe para isso, mas só protege quem o usa.
 */
test('todo tone= do Badge existe em base.tsx', () => {
  const base = readFileSync(BASE, 'utf8')
  const decl = base.match(/export type Tom =([^\n]+)/)
  assert.ok(decl, 'não achei `export type Tom` em base.tsx')
  const validos = new Set([...decl[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]))

  const invalidos = []
  for (const { caminho, texto } of ARQUIVOS) {
    for (const m of texto.matchAll(/tone="([a-z]+)"/g)) {
      if (!validos.has(m[1])) {
        const linha = texto.slice(0, m.index).split('\n').length
        invalidos.push(`${caminho}:${linha} — tone="${m[1]}"`)
      }
    }
  }
  assert.deepEqual(invalidos, [], `\n${invalidos.join('\n')}\n`)
})

/**
 * As cores do e-mail não podem divergir dos tokens.
 *
 * `packages/mail/src/template.ts` precisa de hex literal: cliente de e-mail não
 * resolve `var()`, e Gmail e Outlook descartam `<style>` inteiro. A exceção é
 * legítima — mas exceção sem amarra é o começo da divergência, que é o defeito que
 * este arquivo inteiro existe para pegar.
 *
 * Então em vez de PERMITIR o hex, aqui se COMPARA: cada cor do template tem que
 * ser, byte a byte, um valor declarado em `estilo.css`. Trocar um token sem trocar
 * o e-mail passa a quebrar o portão em vez de sair só no e-mail de alguém.
 */
test('as cores do template de e-mail são as mesmas de estilo.css', () => {
  const template = readFileSync(join(RAIZ, 'packages', 'mail', 'src', 'template.ts'), 'utf8')
  const estilo = readFileSync(join(RAIZ, 'packages', 'ui', 'src', 'estilo.css'), 'utf8')

  const tokens = new Set(
    (estilo.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((h) => h.toLowerCase()),
  )
  assert.ok(tokens.size > 5, 'não li os tokens de estilo.css — o caminho mudou?')

  // Só o bloco COR: o resto do arquivo é `#fff` de texto sobre o gradiente e `#`
  // de href neutralizado, que não são cor de tema.
  const bloco = template.match(/const COR = \{([\s\S]*?)\} as const/)
  assert.ok(bloco, 'não achei o bloco COR em template.ts')

  for (const [, nome, hex] of bloco[1].matchAll(/(\w+):\s*'(#[0-9a-fA-F]{3,8})'/g)) {
    assert.ok(
      tokens.has(hex.toLowerCase()),
      `a cor "${nome}" do e-mail é ${hex}, que não existe em estilo.css — ` +
        `token trocado sem trocar o e-mail, ou aproximação em vez de cópia`,
    )
  }
})

/**
 * A tela do oauth2-proxy não pode divergir da do produto.
 *
 * `infra/oauth2-templates/sign_in.html` é servido por um binário Go que não
 * conhece o Tailwind nem o `estilo.css` — o CSS dele é inline e autossuficiente,
 * e não há como evitar isso. O que dá para evitar é a DIVERGÊNCIA, que é o custo
 * real dessa escolha: a tela do Publi e a do Allvoice já divergiram exatamente
 * assim, cada uma com o seu hex.
 *
 * Então em vez de permitir, compara-se — cor contra `estilo.css`, e o texto
 * contra os padrões do `Login.tsx`. Mexer num sem mexer no outro quebra o CI, em
 * vez de sair só no navegador de quem for entrar.
 */
const SIGN_IN = join(RAIZ, 'infra', 'oauth2-templates', 'sign_in.html')

test('as cores da tela do oauth2-proxy são as mesmas de estilo.css', () => {
  const html = readFileSync(SIGN_IN, 'utf8')
  const estilo = readFileSync(join(RAIZ, 'packages', 'ui', 'src', 'estilo.css'), 'utf8')
  const tokens = new Set((estilo.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((h) => h.toLowerCase()))

  // Só o bloco `:root`, que é onde moram as cores do tema. Fora dele há as
  // quatro do Google (marca de terceiro, proibido repintar) e `#fff`.
  const raiz = html.match(/:root \{([^}]*)\}/)
  assert.ok(raiz, 'não achei o bloco :root em sign_in.html')

  for (const [, nome, hex] of raiz[1].matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})/g)) {
    assert.ok(
      tokens.has(hex.toLowerCase()),
      `a variável "${nome}" da tela de entrada é ${hex}, que não existe em estilo.css`,
    )
  }
})

test('o texto da tela do oauth2-proxy é o mesmo do Login.tsx', () => {
  const html = readFileSync(SIGN_IN, 'utf8')
  const login = readFileSync(join(RAIZ, 'packages', 'ui', 'src', 'Login.tsx'), 'utf8')

  // Os padrões do componente: é o que o usuário vê quando ninguém passa prop.
  const titulo = login.match(/titulo = '([^']+)'/)?.[1]
  const chamada = [...(login.match(/chamada = \[([^\]]+)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(
    (m) => m[1],
  )
  const etiquetas = [
    ...(login.match(/etiquetas = \[([^\]]+)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g),
  ].map((m) => m[1])

  assert.ok(titulo && chamada.length && etiquetas.length, 'não li os padrões do Login.tsx')

  assert.ok(html.includes(titulo), `a tela de entrada não traz o título "${titulo}"`)
  for (const linha of chamada) {
    assert.ok(html.includes(linha), `a tela de entrada não traz a chamada "${linha}"`)
  }
  for (const e of etiquetas) {
    assert.ok(html.includes(`<span>${e}</span>`), `a tela de entrada não traz a etiqueta "${e}"`)
  }
})

/**
 * A marca do Pulse: cores do ícone, e o favicon embutido na tela de entrada.
 */
import { enxugar, linkDoFavicon } from './marca/gerar.mjs'

const ARTES = ['marca/pulse-icone.svg', 'marca/pulse-icone-maskable.svg']

test('as cores do ícone são as da marca', () => {
  const estilo = readFileSync(join(RAIZ, 'packages', 'ui', 'src', 'estilo.css'), 'utf8')
  const tokens = new Set((estilo.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((h) => h.toLowerCase()))
  // O claro do gradiente não é token de tema — ele só existe dentro do ícone, e
  // foi MEDIDO no do Allvoice. Fica declarado aqui para não virar cor solta.
  const doIcone = new Set(['#8b57ef', '#ffffff'])

  for (const arte of ARTES) {
    // `enxugar` tira os comentários. Sem isso a asserção lê a PROSA do arquivo —
    // que cita as cores para explicá-las — em vez do desenho.
    const svg = enxugar(readFileSync(join(RAIZ, 'packages', 'ui', arte), 'utf8'))
    for (const hex of svg.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
      const h = hex.toLowerCase()
      assert.ok(
        tokens.has(h) || doIcone.has(h),
        `${arte} usa ${hex}, que não é token de estilo.css nem cor declarada do ícone`,
      )
    }
  }
})

test('o ícone tem UM acento laranja — a proporção é o que faz a família', () => {
  // No Allvoice o laranja é um ponto entre três. Laranja demais e o ícone deixa
  // de parecer irmão dos outros produtos da casa.
  for (const arte of ARTES) {
    const svg = enxugar(readFileSync(join(RAIZ, 'packages', 'ui', arte), 'utf8'))
    const laranja = (svg.match(/#FF7A00/gi) ?? []).length
    assert.equal(laranja, 1, `${arte} tem ${laranja} usos de laranja; o desenho prevê 1`)
  }
})

test('o favicon embutido na tela de entrada é o ícone ATUAL', () => {
  // A tela de entrada é servida pelo oauth2-proxy e carrega o ícone como data
  // URI — cópia, e cópia envelhece. Mexer no SVG sem rodar `pnpm --filter
  // @pulse/ui marca` deixaria a aba com o desenho velho, sem erro nenhum.
  const svg = readFileSync(join(RAIZ, 'packages', 'ui', 'marca', 'pulse-icone.svg'), 'utf8')
  const html = readFileSync(join(RAIZ, 'infra', 'oauth2-templates', 'sign_in.html'), 'utf8')
  assert.ok(
    html.includes(linkDoFavicon(svg)),
    'o favicon da tela de entrada não corresponde ao SVG — rode `pnpm --filter @pulse/ui marca`',
  )
})

/**
 * ─── Tipografia: a escala nomeada é obrigatória ───────────────────────────────
 *
 * O design system do Publi (seção 03) chama isto de "o furo central do sistema":
 * existia nome para título e número grande, e NADA para os tamanhos onde a
 * interface toda vive — por isso cada tela escrevia `text-[13px]` à mão.
 *
 * Medido no Pulse antes da migração: 434 declarações arbitrárias em 46 arquivos.
 * Depois: 5, todas de uso único, que é o que o documento permite — "nomear um
 * token para seis usos criaria vocabulário morto; ficam arbitrários até que se
 * repitam".
 *
 * A regra recusa exatamente os tamanhos que TÊM nome. Um número novo e sem nome
 * passa, e é assim que deve ser: a trava existe para impedir a volta do
 * `text-[13px]`, não para proibir um tamanho de uso único numa tela de entrada.
 */
const COM_NOME = new Map([
  ['10px', 'micro'], ['10.5px', 'tabela'], ['11px', 'nota'], ['11.5px', 'nota'],
  ['12px', 'meta'], ['12.5px', 'meta'], ['13px', 'corpo'], ['13.5px', 'corpo'],
  ['14px', 'cartao'], ['14.5px', 'cartao'], ['15px', 'secao'], ['16px', 'campo'],
  ['17px', 'title'], ['22px', 'h1 ou kpi'],
])

test('nenhum tamanho de fonte cru quando existe token', () => {
  const crus = []
  for (const { caminho, texto } of ARQUIVOS) {
    for (const m of semComentarios(texto).matchAll(/text-\[([0-9.]+)px\]/g)) {
      const nome = COM_NOME.get(`${m[1]}px`)
      if (!nome) continue
      const linha = texto.slice(0, m.index).split('\n').length
      crus.push(`${caminho}:${linha} — ${m[0]} deveria ser text-${nome}`)
    }
  }
  assert.deepEqual(crus, [], `\n${crus.join('\n')}\n`)
})

test('a regra de tamanho ainda pega classe em código, não só em comentário', () => {
  // Mesma razão do par da regra de cor: `semComentarios` poderia mascarar tudo, e
  // um portão que não recusa nada parece cobertura sem ser.
  const fingido = [
    'const a = 1 // text-[13px] no fim da linha',
    '  // text-[12px] em linha própria',
    'const cls = "text-[13px] font-bold"',
  ].join('\n')
  const achados = [...semComentarios(fingido).matchAll(/text-\[([0-9.]+)px\]/g)]
  assert.equal(achados.length, 1, 'a regra deveria ver só o do código')
  assert.equal(achados[0][1], '13')
})

test('a escala nomeada do documento existe no preset', () => {
  // Sem isto, `text-corpo` compilaria para nada e a tela ficaria com o tamanho
  // herdado — uma falha silenciosa que só aparece olhando a tela pronta.
  const preset = readFileSync(join(RAIZ, 'packages', 'ui', 'tailwind-preset.ts'), 'utf8')
  for (const nome of ['h1', 'title', 'kpi', 'tabela', 'campo', 'secao', 'cartao', 'corpo', 'meta', 'nota', 'micro']) {
    assert.match(preset, new RegExp(`^\\s+${nome}:\\s*\\[`, 'm'), `falta o token ${nome} no fontSize`)
  }
})

/**
 * ─── Classe de cor que aponta para degrau inexistente ────────────────────────
 *
 * Achado real ao adotar o documento: o Badge âmbar usava `text-amber-700`, e a
 * paleta tem `amber` só em DEFAULT e 50. A classe não compilava para NADA, e o
 * texto do selo herdava a cor de quem estivesse em volta — um defeito que passa
 * em revisão de código, passa em build, passa em teste, e só aparece se alguém
 * reparar que aquele selo está com a cor errada.
 *
 * A regra confere cada `text-`/`bg-`/`border-`/`ring-` contra os degraus que o
 * preset declara de fato.
 */
test('nenhuma classe de cor aponta para degrau que não existe', () => {
  const preset = readFileSync(join(RAIZ, 'packages', 'ui', 'tailwind-preset.ts'), 'utf8')
  const paleta = preset.slice(preset.indexOf('---- Paleta Alloyal ----'), preset.indexOf('borderRadius:'))

  // Os degraus declarados por família, incluindo o DEFAULT (que é a família nua).
  const degraus = new Map()
  for (const m of paleta.matchAll(/^\s*'?([a-z][a-z-]*)'?:\s*(\{[^}]*\}|'#[0-9A-Fa-f]+')/gm)) {
    const familia = m[1]
    const corpo = m[2]
    const passos = new Set()
    if (corpo.startsWith('{')) {
      for (const p of corpo.matchAll(/(?:^|[{,\s])'?(\d+|DEFAULT|on|risk|off|strong)'?:/g)) passos.add(p[1])
    } else passos.add('DEFAULT')
    degraus.set(familia, passos)
  }

  const quebradas = []
  for (const { caminho, texto } of ARQUIVOS) {
    for (const m of semComentarios(texto).matchAll(/\b(?:text|bg|border|ring|from|to|fill|stroke)-([a-z][a-z-]*?)-(\d{2,3})\b/g)) {
      const [, familia, passo] = m
      const passos = degraus.get(familia)
      // Família que não é nossa (slate, gray, …) já é recusada pela regra da
      // paleta padrão do Tailwind; aqui só interessa a NOSSA que não tem o degrau.
      if (!passos || passos.has(passo)) continue
      const linha = texto.slice(0, m.index).split('\n').length
      quebradas.push(
        `${caminho}:${linha} — ${m[0]} (${familia} tem ${[...passos].sort().join(', ')})`,
      )
    }
  }
  assert.deepEqual(quebradas, [], `\n${quebradas.join('\n')}\n`)
})

/**
 * ─── Foco visível em todo controle das composições ───────────────────────────
 *
 * O documento aponta isto como a maior lacuna de acessibilidade (§11): as
 * composições copiadas nas telas tinham só `hover:`, e quem navega por teclado
 * não via onde estava. Os componentes de `ds.tsx` aplicam
 * `focus-visible:ring-2 ring-ring ring-offset-1` por padrão.
 *
 * A regra vigia isso: todo `<Link`, `<button` e `<input` do arquivo tem de
 * carregar a constante FOCO. É fácil escrever o próximo componente esquecendo, e
 * o esquecimento não aparece em nenhuma tela — só some para quem usa o teclado.
 */
test('todo controle de ds.tsx tem foco visível', () => {
  const semFoco = []
  for (const arquivo of ['ds.tsx', 'ds-cliente.tsx']) {
    const caminho = join(RAIZ, 'packages', 'ui', 'src', arquivo)
    const texto = readFileSync(caminho, 'utf8')
    // Cada abertura de controle até o `>` que a fecha.
    for (const m of texto.matchAll(/<(Link|button|input)\b([\s\S]*?)\/?>/g)) {
      const corpo = m[2]
      // `type="hidden"` não recebe foco, e o overlay do diálogo é uma superfície
      // clicável de fundo — dar anel a ele desenharia uma moldura na tela inteira.
      if (/type="hidden"/.test(corpo)) continue
      if (/aria-label="Fechar"[\s\S]*absolute inset-0/.test(corpo)) continue
      if (corpo.includes('FOCO')) continue
      const linha = texto.slice(0, m.index).split('\n').length
      semFoco.push(`${arquivo}:${linha} — <${m[1]}> sem FOCO`)
    }
  }
  assert.deepEqual(semFoco, [], `\n${semFoco.join('\n')}\n`)
})

test('a constante FOCO é a do documento', () => {
  // Um anel divergente por componente seria pior que nenhum: quem navega por
  // teclado aprenderia dois vocabulários visuais na mesma tela.
  const ds = readFileSync(join(RAIZ, 'packages', 'ui', 'src', 'ds.tsx'), 'utf8')
  assert.match(ds, /focus-visible:ring-2/)
  assert.match(ds, /focus-visible:ring-offset-1/)
})

/**
 * ─── Dinheiro sempre com centavos (§08) ──────────────────────────────────────
 *
 * A regra do documento não é estética, é um dado: "arredondar escondeu
 * informação real; 86% dos pedidos tinham centavos". No Pulse havia 12 arquivos
 * formatando moeda com `maximumFractionDigits: 0` — um valor de R$ 1.284,50
 * aparecia como R$ 1.285, e a conferência contra o Omie não fechava.
 */
test('nenhuma tela arredonda dinheiro', () => {
  const achados = []
  for (const { caminho, texto } of ARQUIVOS) {
    const codigo = semComentarios(texto)
    for (const m of codigo.matchAll(/currency:\s*'BRL'[^}]*maximumFractionDigits:\s*0/g)) {
      const linha = texto.slice(0, m.index).split('\n').length
      achados.push(`${caminho}:${linha} — moeda arredondada; o documento exige centavos`)
    }
  }
  assert.deepEqual(achados, [], `\n${achados.join('\n')}\n`)
})

/**
 * ─── O tema escuro existe e é completo (§02) ─────────────────────────────────
 *
 * O Pulse declarava `darkMode: ['class']` e não tinha um único token escuro: a
 * chave existia e não abria porta nenhuma. E as cores viviam em hex no preset ao
 * mesmo tempo que em variável no CSS, sem os dois se falarem — mudar `--surface`
 * não mexia em `bg-surface`.
 */
test('o tema escuro define todos os tokens que o claro define', () => {
  const css = readFileSync(join(RAIZ, 'packages', 'ui', 'src', 'estilo.css'), 'utf8')
  const bloco = (re) => {
    const m = css.match(re)
    return m ? new Set([...m[1].matchAll(/(--[a-z0-9-]+):/g)].map((x) => x[1])) : new Set()
  }
  const escuro = bloco(/:root\[data-theme='dark'\]\s*\{([\s\S]*?)\n\s*\}/)
  assert.ok(escuro.size > 15, `o tema escuro define só ${escuro.size} tokens`)
  for (const t of ['--bg', '--surface', '--ink', '--ink-3', '--purple-500', '--purple-700', '--green', '--amber', '--red']) {
    assert.ok(escuro.has(t), `falta ${t} no tema escuro`)
  }
})

test('as cores do preset apontam para variável, não para hex', () => {
  // Sem isto o tema escuro compila e não pinta nada: a classe já saiu com o hex
  // do tema claro embutido.
  const preset = readFileSync(join(RAIZ, 'packages', 'ui', 'tailwind-preset.ts'), 'utf8')
  // Pelo VALOR e não pela linha: `ink` é objeto multilinha, e olhar só a primeira
  // linha faria o portão acusar um arquivo correto — falso positivo é o jeito mais
  // rápido de um portão ser desligado.
  for (const v of ['var(--bg)', 'var(--surface)', 'var(--line)', 'var(--ink)', 'var(--ink-3)',
                   'var(--purple-500)', 'var(--purple-700)', 'var(--green)', 'var(--amber)', 'var(--red)']) {
    assert.ok(preset.includes(v), `${v} não aparece no preset — o tema escuro não alcança essa cor`)
  }
})

/**
 * ─── O KPI é o do documento (§06) ────────────────────────────────────────────
 *
 * Estava errado de um jeito que mudava o significado: o semáforo vivia na COR DO
 * VALOR. Número vermelho lê-se como "este número está errado"; o que se quer
 * dizer é "este indicador está ruim". A barra lateral diz a segunda coisa sem
 * tocar no número.
 */
test('o Kpi tem barra lateral de semáforo e rótulo de 11px', () => {
  const base = readFileSync(BASE, 'utf8')
  const kpi = base.slice(base.indexOf('export function Kpi('), base.indexOf('function DeltaDoKpi'))
  assert.match(kpi, /w-1/, 'falta a barra lateral de 4px')
  assert.match(kpi, /bg-purple-500/, 'o neutro da barra tem de ser roxo')
  assert.match(kpi, /text-nota font-semibold uppercase/, 'o rótulo é 11px maiúsculo, não o 10,5px da tabela')
  assert.doesNotMatch(
    kpi.slice(kpi.indexOf('text-kpi')),
    /text-kpi[^\n]*text-(green|amber|red)/,
    'o valor não recebe cor — o semáforo é a barra',
  )
})

test('o delta do Kpi tem os quatro estados do documento', () => {
  const base = readFileSync(BASE, 'utf8')
  const d = base.slice(base.indexOf('function DeltaDoKpi'))
  for (const [marca, papel] of [['▲', 'subiu'], ['▼', 'caiu'], ['■', 'estável'], ['novo', 'sem período anterior']]) {
    assert.ok(d.includes(marca), `falta o estado "${papel}" (${marca})`)
  }
  // `null` é novo e `0` é estável: confundir os dois afirma estabilidade onde não
  // havia com o que comparar.
  assert.match(d, /valor === null/)
  assert.match(d, /valor === 0/)
})
