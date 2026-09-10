'use client'
/**
 * O arraste do quadro: pegar o cartão e soltar na coluna.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O QUE ISTO SUBSTITUI, e a frase que pediu a troca:                        │
 * │ "quando clico para movimentar o card ele volta para a Visão Geral e tenho  │
 * │ que ficar voltando para a aba Kanban. Acredito que podemos retirar o fluxo │
 * │ de movimentação e deixar livre para mover para qualquer quadro ao clicar e │
 * │ arrastar".                                                                 │
 * │                                                                            │
 * │ Antes, cada cartão em etapa carregava uma fileira de botões `→ financeiro`,│
 * │ `← pedido`, cada um um `submit` de Server Action que terminava em           │
 * │ `redirect`. Duas consequências: só as TRÊS etapas eram alcançáveis (os      │
 * │ desfechos exigiam abrir o pedido), e todo movimento recarregava a tela.     │
 * │                                                                            │
 * │ Agora o cartão vai para qualquer coluna que a regra aceite, e a tela NÃO    │
 * │ navega: a ação devolve um objeto e o quadro se atualiza no lugar com         │
 * │ `router.refresh()`.                                                        │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ARRASTAR EXIGE JAVASCRIPT, e isto é uma PERDA que vale dizer em voz alta.  │
 * │                                                                            │
 * │ Todo formulário deste fluxo funciona sem JavaScript de propósito — o time   │
 * │ trabalha nele seis horas por dia. Um arraste não tem versão sem script, e   │
 * │ também não tem versão por teclado: quem navega por teclado ou está sem      │
 * │ bundle não move cartão AQUI.                                               │
 * │                                                                            │
 * │ O que segura a perda é que o quadro não é o único caminho. Em `/saidas` o    │
 * │ `Quadro` simples mantém os botões de etapa, e a seção Em andamento mantém    │
 * │ os SETE desfechos como formulário — tudo `<form action=…>` puro, teclado e   │
 * │ sem script. O kanban virou o atalho de mouse; o caminho acessível continua   │
 * │ inteiro, só não é este.                                                     │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ETAPA É LIVRE, DESFECHO PERGUNTA — e a assimetria nasceu de um caso real. │
 * │                                                                            │
 * │ Em produção, em 10/09/2026, havia UM pedido: a conta Zanzar, registrada     │
 * │ por alguém do time às 18h42 e movida no mesmo dia para `retido`. A pessoa   │
 * │ tentou mover o cartão de novo, não conseguiu, e reportou como "limitação de │
 * │ alguns fluxos de movimentação dos cards".                                  │
 * │                                                                            │
 * │ A recusa estava certa — `retido` é ponto final, e nem o encerramento aceita │
 * │ uma saída revertida. O defeito estava ANTES: um arraste gravou o ponto      │
 * │ final SEM PERGUNTAR. Com os botões antigos era muito menos provável, porque │
 * │ só as três etapas eram alcançáveis e cada uma tinha rótulo escrito. Ao      │
 * │ abrir os desfechos para o gesto, eu tornei um escorregão de mouse           │
 * │ suficiente para escrever algo que não se desfaz.                           │
 * │                                                                            │
 * │ Então etapa continua LIVRE (é reversível, e é o que foi pedido) e desfecho  │
 * │ abre o `Confirmar` do design system. O que pede confirmação é exatamente o  │
 * │ que não tem volta — a assimetria é a informação.                            │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A COLUNA QUE RECUSA AINDA ACEITA O SOLTAR, e é escolha e não descuido.    │
 * │                                                                            │
 * │ Dava para bloquear o `drop` nas colunas inválidas (basta não chamar          │
 * │ `preventDefault` no `dragover`). O cursor viraria "proibido" e nada mais    │
 * │ aconteceria — e a pessoa ficaria sem saber POR QUE aquela coluna não aceita  │
 * │ o cartão dela.                                                             │
 * │                                                                            │
 * │ Então a coluna inválida fica APAGADA enquanto o arraste acontece — a        │
 * │ resposta visual está lá antes de soltar —, mas o soltar passa e volta com a │
 * │ razão escrita: "desconto precisa do MRR novo e da competência de efeito".   │
 * │ É a mesma decisão de `faltaParaEncerrar`: explicar o que falta, em vez de   │
 * │ dizer não.                                                                 │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
import { Aviso, cn, Confirmar, type PedidoDeConfirmacao } from '@pulse/ui'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { acaoMoverCard } from '../../saidas/acoes'

/**
 * O texto de confirmação por coluna, pronto do servidor.
 *
 * Chega como prop e não por import: `confirmacaoDoArraste` mora em
 * `@pulse/success`, e importar o pacote de domínio aqui arrastaria o domínio
 * inteiro para o bundle do navegador. São oito entradas, calculadas uma vez.
 */
export interface TextoDaConfirmacao {
  readonly titulo: string
  readonly corpo: string
  readonly saida: string
  readonly pergunta: string
  readonly destrutiva: boolean
}

/** O cartão em voo: de onde saiu, e onde ele pode cair. */
interface EmVoo {
  readonly alvos: readonly string[]
  readonly origem: string
}

interface Contexto {
  readonly voo: EmVoo | null
  readonly pendente: boolean
  readonly soltar: (para: string, saidaId: string) => void
}

/** O arraste esperando resposta do diálogo. */
interface AConfirmar {
  readonly para: string
  readonly saidaId: string
  readonly pedido: PedidoDeConfirmacao
}

const Ctx = React.createContext<Contexto>({
  voo: null,
  pendente: false,
  soltar: () => undefined,
})

/**
 * O quadro com o arraste ligado.
 *
 * Os cartões chegam como `children` prontos do SERVIDOR: quem sabe se um cartão
 * pode ir para a coluna X é `movimento()`, que mora no servidor com o domínio.
 * Este componente não repete a regra — lê o resultado dela em `data-alvos`, que
 * o cartão traz escrito. É o que impede a tela de acender uma coluna que a ação
 * vai recusar.
 */
export function Arraste({
  children,
  confirmacoes,
}: {
  children: React.ReactNode
  /** Por id de coluna. Ausente = soltar ali não pergunta (etapa de trabalho). */
  confirmacoes: Readonly<Record<string, TextoDaConfirmacao>>
}) {
  const rota = useRouter()
  const [voo, setVoo] = React.useState<EmVoo | null>(null)
  const [msg, setMsg] = React.useState<{ ok?: string; erro?: string } | null>(null)
  const [confirmar, setConfirmar] = React.useState<AConfirmar | null>(null)
  const [pendente, iniciar] = React.useTransition()

  function pegar(e: React.DragEvent) {
    const alvo = e.target as HTMLElement | null
    const cartao = alvo?.closest?.('[data-saida]') as HTMLElement | null
    if (!cartao) return
    // `text/plain` e não um tipo próprio: é o único que o Firefox exige para
    // considerar que um arraste começou de verdade.
    e.dataTransfer.setData('text/plain', cartao.dataset['saida'] ?? '')
    e.dataTransfer.effectAllowed = 'move'
    setVoo({
      alvos: (cartao.dataset['alvos'] ?? '').split(' ').filter(Boolean),
      origem: cartao.dataset['posicao'] ?? '',
    })
  }

  function soltar(para: string, saidaId: string) {
    if (saidaId === '') return
    // Soltar na própria coluna é gesto abortado, não pedido: silêncio.
    if (voo !== null && voo.origem === para) return

    /* O DESVIO PELO DIÁLOGO. O texto vem do servidor; o nome do cliente e os
       dias de aviso vêm do próprio cartão, que os traz escritos — é por isso
       que a substituição acontece aqui e não lá.
       ┌─────────────────────────────────────────────────────────────────────┐
       │ SÓ PERGUNTA O QUE VAI ACONTECER. A primeira versão abria o diálogo   │
       │ pela coluna, sem olhar se ELA aceita este cartão — e o Desconto tem  │
       │ texto de confirmação (para o dia em que ganhar formulário no soltar).│
       │ Resultado, pego pelo teste de navegador: soltar em Desconto abria    │
       │ "Conceder desconto a X?", a pessoa confirmava, e só então vinha a    │
       │ recusa. Confirmar antes de recusar é pior que recusar.               │
       │                                                                      │
       │ `voo.alvos` é a lista que o SERVIDOR escreveu no cartão. Coluna fora │
       │ dela vai direto à ação, que devolve o motivo escrito.                │
       └─────────────────────────────────────────────────────────────────────┘ */
    const texto = voo !== null && voo.alvos.includes(para) ? confirmacoes[para] : undefined
    if (texto !== undefined) {
      const cartao = document.querySelector(`[data-saida="${CSS.escape(saidaId)}"]`)
      const nome = cartao?.getAttribute('data-nome') ?? 'este cliente'
      const dias = cartao?.getAttribute('data-aviso') ?? '?'
      const trocar = (t: string) => t.replaceAll('{cliente}', nome).replaceAll('{dias}', dias)
      setMsg(null)
      setConfirmar({
        para,
        saidaId,
        pedido: {
          titulo: trocar(texto.titulo),
          corpo: trocar(texto.corpo),
          saida: trocar(texto.saida),
          pergunta: trocar(texto.pergunta),
          destrutiva: texto.destrutiva,
        },
      })
      return
    }
    executar(para, saidaId)
  }

  function executar(para: string, saidaId: string) {
    setMsg(null)
    iniciar(async () => {
      const r = await acaoMoverCard(saidaId, para)
      if ('erro' in r) {
        setMsg({ erro: r.erro })
        return
      }
      setMsg({ ok: r.ok })
      // `refresh` e não `push`: mesma URL, mesma rolagem, mesma aba. É o
      // conserto da queixa.
      rota.refresh()
    })
  }

  const ctx = React.useMemo<Contexto>(() => ({ voo, pendente, soltar }), [voo, pendente])

  return (
    <Ctx.Provider value={ctx}>
    <div className="flex min-h-0 flex-1 flex-col" onDragStart={pegar} onDragEnd={() => setVoo(null)}>
      {/* A região existe SEMPRE no DOM, vazia, para o leitor de tela anunciar a
          mensagem quando ela chega. Vazia ela tem altura zero. */}
      <div aria-live="polite" className="shrink-0 px-4 md:px-8">
        {pendente ? (
          <div className="pt-3">
            <Aviso tom="info">movendo o cartão…</Aviso>
          </div>
        ) : msg?.erro !== undefined ? (
          <div className="pt-3">
            <Aviso tom="erro">{msg.erro}</Aviso>
          </div>
        ) : msg?.ok !== undefined ? (
          <div className="pt-3">
            <Aviso tom="ok">{msg.ok}</Aviso>
          </div>
        ) : null}
      </div>

      {/* As medidas do Allvoice: largura fixa por coluna e rolagem horizontal. */}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4 md:p-5">{children}</div>

      <Confirmar
        aberto={confirmar !== null}
        pedido={confirmar?.pedido ?? null}
        onCancelar={() => setConfirmar(null)}
        onConfirmar={() => {
          const c = confirmar
          setConfirmar(null)
          if (c !== null) executar(c.para, c.saidaId)
        }}
      />
    </div>
    </Ctx.Provider>
  )
}

export function Coluna({
  id,
  rotulo,
  explica,
  terminal,
  ponto,
  contagem,
  soma,
  children,
}: {
  id: string
  rotulo: string
  explica: string
  terminal: boolean
  ponto: string
  contagem: number
  soma: string | null
  children: React.ReactNode
}) {
  const { voo, pendente, soltar } = React.useContext(Ctx)
  const [sobre, setSobre] = React.useState(false)

  const arrastando = voo !== null
  const aceita = arrastando && voo.alvos.includes(id)
  const propria = arrastando && voo.origem === id

  return (
    <section
      data-alvo={id}
      onDragOver={(e) => {
        // Sem `preventDefault` o navegador não deixa soltar — inclusive na coluna
        // que recusa, onde soltar é o que traz a explicação.
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (!sobre) setSobre(true)
      }}
      onDragLeave={(e) => {
        // Entrar num cartão FILHO dispara `dragleave` na coluna. Sem esta
        // conferência o realce pisca a cada cartão que o cursor cruza.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSobre(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setSobre(false)
        if (!pendente) soltar(id, e.dataTransfer.getData('text/plain'))
      }}
      className={cn(
        // `transition` e não `transition-colors`: o apagar da coluna que recusa é
        // OPACIDADE, e `transition-colors` não a inclui — ela piscava.
        'flex h-full w-72 shrink-0 flex-col rounded-lg border bg-surface-2 transition duration-150',
        terminal ? 'border-dashed' : '',
        /* O realce parte do par `border-purple-500 bg-purple-50` que o design
           system usa para "selecionado", e acrescenta ANEL.
           ┌─────────────────────────────────────────────────────────────────┐
           │ O ANEL NÃO É ENFEITE — as duas primeiras tentativas foram        │
           │ MEDIDAS na captura e não liam:                                   │
           │  · borda de 1px sozinha quase não se distingue da coluna comum;  │
           │  · `bg-purple-50` (243 236 254) sobre `surface-2` é diferença de │
           │    luminância pequena demais para ser vista de relance.          │
           │ `ring` e não `border-2` porque anel não ocupa espaço: trocar a    │
           │ largura da borda deslocaria o conteúdo da coluna em 1px a cada    │
           │ arraste. O anel engrossa sob o cursor, então "válida" e "é esta"  │
           │ são dois degraus do mesmo sinal.                                  │
           └─────────────────────────────────────────────────────────────────┘ */
        aceita
          ? sobre
            ? 'border-purple-500 bg-purple-100 ring-2 ring-purple-500'
            : 'border-purple-500 bg-purple-50 ring-1 ring-purple-500'
          : 'border-line',
        // Apagar a coluna que recusa é a resposta ANTES de soltar; a razão vem
        // depois, escrita, se a pessoa soltar mesmo assim.
        arrastando && !aceita && !propria ? 'opacity-40' : '',
      )}
    >
      <header className="flex shrink-0 items-start gap-2 px-3 py-2.5">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ponto}`} />
        {/* Duas LINHAS e não truncar. Os rótulos de lá são curtos ("Fila",
            "Aberta"); os nossos são os nomes aprovados do pedido do usuário —
            "Pedido de cancelamento ou desconto" tem 34 caracteres e truncava em
            "Pedido de cancelamento …", que não distingue nada. */}
        <h3
          className="min-w-0 flex-1 text-cartao font-semibold leading-snug text-ink-2 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden"
          title={explica}
        >
          {rotulo}
        </h3>
        <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 font-mono text-nota text-ink-3">
          {contagem}
        </span>
      </header>

      {soma !== null && (
        <p className="shrink-0 px-3 pb-1.5 text-nota tabular-nums text-ink-3">{soma}</p>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {contagem === 0 ? (
          <p className="px-1 py-3 text-center text-nota text-ink-4">
            {arrastando && aceita ? 'solte aqui' : terminal ? 'nenhum desfecho aqui' : 'vazio'}
          </p>
        ) : (
          children
        )}
      </div>
    </section>
  )
}
