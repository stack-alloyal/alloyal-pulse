/**
 * A regra do arraste: qual coluna aceita qual cartão, e por que a outra não.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ MORA NO PACOTE, e não na app, por dois motivos concretos.                 │
 * │                                                                            │
 * │ Primeiro: isto é a mesma pergunta que `TRANSICOES` responde — quais         │
 * │ movimentos existem —, só recortada para o que um GESTO consegue fazer sem   │
 * │ pedir dado. Regra de domínio mora com o domínio.                            │
 * │                                                                            │
 * │ Segundo, e mais prático: aqui ela é TESTÁVEL. A app não tem suíte própria;   │
 * │ os portões vivem nos pacotes e o CI roda o `dist`. Enquanto isto estava em   │
 * │ `app/(interno)/saidas/`, a única verificação possível era ler o arquivo como │
 * │ texto — e a invariante que importa ("nunca aprovar o que a máquina de        │
 * │ estados proíbe") não se lê em texto, se executa.                            │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ UM LUGAR SÓ, e as duas pontas que dependem dele são de tipos diferentes.  │
 * │                                                                            │
 * │ A TELA precisa saber onde o cartão PODE cair, para acender a coluna certa   │
 * │ antes de a pessoa soltar. A AÇÃO precisa saber o que EXECUTAR quando ele    │
 * │ cai. Se cada uma tivesse a sua lista, a tela acenderia uma coluna que a     │
 * │ ação recusa — e o defeito apareceria só para quem arrastasse.               │
 * │                                                                            │
 * │ Então as duas chamam `movimento()`. Uma usa o `porque`, a outra usa o       │
 * │ `faz`, e nenhuma tem opinião própria sobre o que é permitido.               │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ISTO NÃO É O GUARDA. O guarda continua sendo o SQL de cada função de       │
 * │ `@pulse/success`: `avancarEtapa` só aceita `estado IN (etapas)`, `reter` só │
 * │ aceita pedido em andamento, `encerrar` cobra as três confirmações. Uma      │
 * │ Server Action é endpoint público e nada aqui impede um POST forjado.        │
 * │                                                                            │
 * │ O que esta função faz é decidir a AFORDÂNCIA e escrever a RECUSA em         │
 * │ português — "desconto precisa do MRR novo" em vez de "0 linhas afetadas".   │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ AS TRÊS COLUNAS QUE O ARRASTE NÃO ALCANÇA, e o motivo de cada uma:        │
 * │                                                                            │
 * │ · DESCONTO exige `mrrNovoCentavos` e `competenciaEfeito`. `concederDesconto`│
 * │   não tem padrão para eles — inventar um gravaria contração de valor errado │
 * │   no ledger, e o ledger é lido pelo fechamento mensal.                      │
 * │ · CANCELAMENTO ALLOYAL (PDD) e CANCELAMENTO são o MESMO estado separado     │
 * │   pela origem. Arrastar entre as duas seria reescrever quem pediu a saída.  │
 * │   Cada cartão tem exatamente uma das duas como destino, pela sua origem.    │
 * │ · O ENCERRAMENTO propriamente dito não é coluna: `encerrado` e `em_aviso`   │
 * │   dividem a coluna de perda, e encerrar cobra as três confirmações. Soltar  │
 * │   na coluna de perda confirma o AVISO, que é o passo de lá que um arraste   │
 * │   consegue dar sem pedir dado nenhum.                                       │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
import { ETAPAS_DE_TRABALHO, type EstadoSaida, type OrigemSaida } from './cancelamento.js'
import { POSICOES, type PosicaoDoQuadro } from './saida-visoes.js'

/** O cartão, reduzido ao que decide o movimento. */
export interface CartaoQueArrasta {
  readonly estado: EstadoSaida
  readonly origem: OrigemSaida
  readonly avisoPrevioDias: number | null
}

/**
 * A alçada de quem arrasta, nos mesmos dois eixos que as funções cobram.
 *
 * `fila` é `permissoes.fila !== 'nenhum' || configurar`; `distrato` é
 * `permissoes.aprovaDistrato !== 'nao'` — sem o escape do `configurar`, porque
 * `renegociar` não o concede.
 */
export interface PoderesDeArraste {
  readonly fila: boolean
  readonly distrato: boolean
}

/**
 * O que soltar executa — e o ESTADO em que o pedido termina.
 *
 * O `virar` não é decoração: é o que permite conferir, num teste, que nenhum
 * arraste aprovado contraria `TRANSICOES`. Sem ele a coerência entre o gesto e a
 * máquina de estados só se verificaria lendo as duas listas com o olho.
 */
export type Movimento =
  | {
      readonly ok: true
      readonly faz: 'etapa'
      readonly virar: (typeof ETAPAS_DE_TRABALHO)[number]
    }
  | { readonly ok: true; readonly faz: 'aviso'; readonly virar: 'em_aviso' }
  | { readonly ok: true; readonly faz: 'reter'; readonly virar: 'retido' }
  | { readonly ok: true; readonly faz: 'renegociar'; readonly virar: 'renegociado' }
  | { readonly ok: false; readonly porque: string }

const ETAPAS: readonly string[] = ETAPAS_DE_TRABALHO

/** Em etapa de trabalho é o único lugar de onde tudo ainda é possível. */
const emAndamento = (e: EstadoSaida) => ETAPAS.includes(e) || e === 'em_aviso'

const SEM_FILA = 'mover pedido exige acesso à fila de trabalho'

export function movimento(
  de: CartaoQueArrasta,
  para: PosicaoDoQuadro,
  poderes: PoderesDeArraste,
): Movimento {
  switch (para) {
    case 'pedido':
    case 'financeiro':
    case 'reversao': {
      const etapa = para === 'pedido' ? 'anunciado' : para
      if (de.estado === etapa) return { ok: false, porque: 'o cartão já está nesta coluna' }
      if (!ETAPAS.includes(de.estado)) {
        return {
          ok: false,
          porque:
            de.estado === 'em_aviso'
              ? 'o aviso prévio deste pedido já está correndo, e voltar para etapa de trabalho apagaria a data de fim do aviso'
              : 'desfecho registrado não volta para etapa de trabalho — se o cliente pedir de novo, o caminho é um pedido novo',
        }
      }
      if (!poderes.fila) return { ok: false, porque: SEM_FILA }
      return { ok: true, faz: 'etapa', virar: etapa }
    }

    case 'revertido': {
      if (!emAndamento(de.estado)) {
        return {
          ok: false,
          porque:
            de.estado === 'retido'
              ? 'o cartão já está nesta coluna'
              : 'só um pedido em andamento pode ser revertido; este já tem desfecho registrado',
        }
      }
      if (!poderes.fila) return { ok: false, porque: SEM_FILA }
      return { ok: true, faz: 'reter', virar: 'retido' }
    }

    case 'renegociado': {
      if (de.estado === 'renegociado') return { ok: false, porque: 'o cartão já está nesta coluna' }
      if (!ETAPAS.includes(de.estado)) {
        return {
          ok: false,
          porque:
            de.estado === 'em_aviso'
              ? 'com o aviso correndo a renegociação já não é este fluxo — o pedido tem desfecho decidido'
              : 'só um pedido em etapa de trabalho é renegociado',
        }
      }
      if (!poderes.distrato) {
        return { ok: false, porque: 'renegociar exige alçada de aprovação de distrato' }
      }
      // Sem MRR novo a renegociação não mexe na receita, e é assim que ela cabe
      // num arraste: mudou prazo ou parcela. Se o mensal mudou, o valor entra
      // pelo formulário do pedido — e é o formulário que cobra a competência.
      return { ok: true, faz: 'renegociar', virar: 'renegociado' }
    }

    case 'cancelamento':
    case 'pdd': {
      const daAlloyal = de.origem === 'alloyal'
      if (daAlloyal !== (para === 'pdd')) {
        return {
          ok: false,
          porque: daAlloyal
            ? 'a origem deste pedido é Alloyal: o destino dele é a coluna Cancelamento Alloyal (PDD)'
            : 'a origem deste pedido é o cliente: o destino dele é a coluna Cancelamento',
        }
      }
      if (!emAndamento(de.estado)) {
        return { ok: false, porque: 'este pedido já tem desfecho registrado' }
      }
      if (de.estado === 'em_aviso') {
        return {
          ok: false,
          porque:
            'o cartão já está nesta coluna, com o aviso correndo. O que falta para encerrar aparece no próprio pedido, em Em andamento',
        }
      }
      if (de.avisoPrevioDias === null) {
        return {
          ok: false,
          porque:
            'este pedido não tem aviso prévio em dias, e é ele que decide em que mês a receita para — confirme o aviso no pedido, em Em andamento',
        }
      }
      if (!poderes.fila) return { ok: false, porque: SEM_FILA }
      return { ok: true, faz: 'aviso', virar: 'em_aviso' }
    }

    case 'desconto':
      return {
        ok: false,
        porque:
          de.estado === 'desconto'
            ? 'o cartão já está nesta coluna'
            : 'desconto precisa do MRR novo e da competência de efeito, e arrastar não os informa — o formulário está no próprio pedido, em Em andamento',
      }
  }
}

/**
 * ─── A CONFIRMAÇÃO ANTES DE UM DESFECHO ─────────────────────────────────────
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ISTO EXISTE POR UM CASO REAL, medido em produção em 10/09/2026.           │
 * │                                                                            │
 * │ Havia UM pedido na base inteira: a conta Zanzar, registrada por uma pessoa │
 * │ do time às 18h42 e movida no mesmo dia para `retido`. Ela então tentou      │
 * │ mover o cartão de novo e não conseguiu — e reportou como "limitação de      │
 * │ alguns fluxos de movimentação dos cards".                                  │
 * │                                                                            │
 * │ A recusa estava CORRETA: `TRANSICOES` declara `retido: []`, e até o          │
 * │ `encerrar` recusa uma saída revertida ("se o cliente sair de novo, o        │
 * │ caminho é uma saída nova"). O problema não é a regra — é que UM ARRASTE     │
 * │ GRAVOU UM PONTO FINAL SEM PERGUNTAR. Com os botões antigos isso era muito   │
 * │ menos provável: só as três etapas eram alcançáveis, e cada uma tinha um     │
 * │ rótulo escrito. Ao abrir os desfechos para o gesto, eu tornei um            │
 * │ escorregão de mouse suficiente para escrever algo que não se desfaz.        │
 * │                                                                            │
 * │ Então: etapa de trabalho continua LIVRE — é reversível e é o que o usuário  │
 * │ pediu. Desfecho PERGUNTA. A assimetria é a informação: o que pede           │
 * │ confirmação é exatamente o que não tem volta.                              │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * O texto segue os quatro elementos do `PedidoDeConfirmacao` do design system:
 * `titulo` é o que VAI ACONTECER, `corpo` é por que importa, `saida` é a
 * alternativa, `pergunta` é o que se responde. Nunca "tem certeza?".
 *
 * `{cliente}` e `{dias}` são os dois únicos marcadores, trocados por quem
 * desenha o diálogo — o texto mora aqui porque a consequência é de domínio, e
 * quem sabe o nome do cliente é a tela.
 */
export interface ConfirmacaoDeArraste {
  readonly titulo: string
  readonly corpo: string
  readonly saida: string
  readonly pergunta: string
  /** Foco inicial no Cancelar. Verdadeiro quando o desfecho não se desfaz. */
  readonly destrutiva: boolean
}

/** Os marcadores que a tela troca. Lista fechada, conferida por teste. */
export const MARCADORES_DA_CONFIRMACAO = ['{cliente}', '{dias}'] as const

const VOLTA_PARA_ETAPA =
  'Para só mudar de etapa, solte numa das três primeiras colunas — aquelas se desfazem arrastando de volta.'

/**
 * O que perguntar antes de soltar em `para`. `null` = não pergunta.
 *
 * Etapa de trabalho devolve `null` porque o movimento se desfaz arrastando de
 * volta; qualquer outra coluna devolve texto, e é isso que o portão confere.
 */
export function confirmacaoDoArraste(para: PosicaoDoQuadro): ConfirmacaoDeArraste | null {
  switch (para) {
    case 'pedido':
    case 'financeiro':
    case 'reversao':
      return null

    case 'revertido':
      return {
        titulo: 'Registrar a retenção de {cliente}',
        corpo:
          'A receita não sai e nada entra no ledger — a retenção é a métrica de vitória do CS. ' +
          'E é PONTO FINAL: um pedido revertido não volta para etapa nenhuma, e nem o encerramento o aceita depois.',
        saida: VOLTA_PARA_ETAPA,
        pergunta: 'Registrar a retenção?',
        destrutiva: true,
      }

    case 'renegociado':
      return {
        titulo: 'Registrar a renegociação de {cliente}',
        corpo:
          'Renegociação mexe em prazo ou parcela, não no mensal — arrastar não informa MRR novo, ' +
          'então nada entra no ledger. E é PONTO FINAL: o pedido para aqui.',
        saida:
          'Se o mensal mudou, o caminho é o formulário do pedido em Em andamento, que cobra o MRR novo e a competência.',
        pergunta: 'Registrar a renegociação?',
        destrutiva: true,
      }

    case 'cancelamento':
    case 'pdd':
      return {
        titulo: 'Confirmar o aviso prévio de {dias} dias de {cliente}',
        corpo:
          'O cancelamento passa a correr: a data de fim do aviso é gravada e a tentativa de reversão acaba. ' +
          'É o campo que mais desloca receita entre meses.',
        // Este é o único desfecho com volta, e vale dizer qual é.
        saida: 'Dá para reverter depois: um pedido com aviso correndo ainda aceita a retenção.',
        pergunta: 'Confirmar o aviso e deixar o cancelamento correr?',
        destrutiva: false,
      }

    case 'desconto':
      // O arraste nunca chega aqui — `movimento` recusa antes. O texto existe
      // para o dia em que o desconto ganhar formulário no próprio soltar.
      return {
        titulo: 'Conceder desconto a {cliente}',
        corpo: 'Entra no ledger como CONTRAÇÃO, com a diferença contra o MRR congelado na levantada.',
        saida: 'Informe o MRR novo e a competência de efeito no formulário do pedido.',
        pergunta: 'Conceder o desconto?',
        destrutiva: true,
      }
  }
}

/** As colunas onde ESTE cartão pode cair. É o que a tela acende. */
export function alvosDoCartao(
  de: CartaoQueArrasta,
  poderes: PoderesDeArraste,
): PosicaoDoQuadro[] {
  return POSICOES.filter((p) => movimento(de, p.id, poderes).ok).map((p) => p.id)
}

/** O rótulo aprovado da coluna, para a mensagem dizer o nome que está na tela. */
export function rotuloDaColuna(id: PosicaoDoQuadro): string {
  return POSICOES.find((p) => p.id === id)?.rotulo ?? id
}

/** Lista de permissão para o que chega da rede — o mesmo padrão de `volta.ts`. */
export function colunaConhecida(v: string): PosicaoDoQuadro | null {
  return POSICOES.find((p) => p.id === v)?.id ?? null
}

/**
 * O que a ação de arraste devolve — e ela devolve, não redireciona.
 *
 * O tipo mora aqui e não em `acoes.ts` porque aquele arquivo é `'use server'`, e
 * um módulo de Server Action só exporta função assíncrona. É a mesma razão de
 * `volta.ts` existir.
 */
export type ResultadoDoArraste = { readonly ok: string } | { readonly erro: string }
