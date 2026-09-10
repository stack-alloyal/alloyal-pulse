'use server'

import {
  anunciar,
  avancarEtapa,
  colunaConhecida,
  concederDesconto,
  confirmarAviso,
  confirmarMotivo,
  confirmarUltimaCobranca,
  definirMeta,
  encerrar,
  movimento,
  renegociar,
  reter,
  rotuloDaColuna,
  saidaPorId,
  SemPermissaoError,
  TransicaoInvalidaError,
  type CanalAnuncio,
  type MotivoSaida,
  type OrigemSaida,
  type PedidoDeSaida,
  type ResultadoDoArraste,
} from '@pulse/success'
import { redirect } from 'next/navigation'

import { destinoDeVolta } from './volta'

import { pool } from '../../../lib/db'
import { exigir, temEscopo } from '../../../lib/guarda'

/**
 * As ações do fluxo de saída.
 *
 * Cada uma reavalia a permissão: uma Server Action é endpoint público, e a tela
 * que desenhou o botão não é prova de nada. A alçada real mora em `@pulse/success`;
 * aqui só se garante que a pessoa está autenticada e tem acesso à ferramenta.
 *
 * O desfecho volta pela URL, e não por estado de cliente, para que a tela
 * funcione sem JavaScript — o time trabalha nela seis horas por dia e uma
 * confirmação de distrato não pode depender de um bundle carregar.
 *
 * Erro de transição volta como MENSAGEM. "Falta a confirmação do Financeiro" é
 * uma resposta de produto; uma pilha de exceção não é.
 */

const voltarPara = destinoDeVolta

async function tentar(fn: () => Promise<string>, volta: string): Promise<never> {
  let destino: string
  try {
    destino = `${volta}?ok=${encodeURIComponent(await fn())}`
  } catch (err) {
    if (err instanceof TransicaoInvalidaError || err instanceof SemPermissaoError) {
      destino = `${volta}?erro=${encodeURIComponent(err.message)}`
    } else {
      throw err
    }
  }
  // Fora do try: `redirect` sinaliza por exceção, e capturá-la aqui
  // transformaria todo redirecionamento numa mensagem de erro.
  redirect(destino)
}

export async function acaoConfirmarAviso(dados: FormData): Promise<void> {
  const id = await exigir((p) => temEscopo(p.fila), 'confirmação de aviso prévio')
  await tentar(async () => {
    await confirmarAviso(
      pool(),
      id,
      String(dados.get('id') ?? ''),
      Number(dados.get('avisoPrevioDias')),
    )
    return 'aviso prévio confirmado'
  }, voltarPara(dados))
}

export async function acaoConfirmarCobranca(dados: FormData): Promise<void> {
  const id = await exigir(
    (p) => temEscopo(p.fila) || p.aprovaDistrato !== 'nao',
    'confirmação de cobrança',
  )
  await tentar(async () => {
    const { competenciaEfeitoReceita } = await confirmarUltimaCobranca(
      pool(),
      id,
      String(dados.get('id') ?? ''),
      String(dados.get('competencia') ?? ''),
    )
    return `última cobrança confirmada · a receita sai em ${competenciaEfeitoReceita.slice(0, 7)}`
  }, voltarPara(dados))
}

export async function acaoReter(dados: FormData): Promise<void> {
  const id = await exigir((p) => temEscopo(p.fila), 'registro de retenção')
  const nota = String(dados.get('nota') ?? '').trim()
  await tentar(async () => {
    await reter(pool(), id, String(dados.get('id') ?? ''), nota || undefined)
    return 'retenção registrada — a receita nunca saiu'
  }, voltarPara(dados))
}

export async function acaoEncerrar(dados: FormData): Promise<void> {
  const id = await exigir((p) => p.aprovaDistrato !== 'nao' || p.configurar, 'aprovação de distrato')
  await tentar(async () => {
    const r = await encerrar(pool(), id, String(dados.get('id') ?? ''))
    return `encerrada · churn de receita em ${r.competenciaEfeitoReceita}`
  }, voltarPara(dados))
}

/**
 * Move entre as três etapas de trabalho.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O DESTINO VEM COMO ARGUMENTO, e não por `dados.get('para')`. MEDIDO.       │
 * │                                                                            │
 * │ A primeira versão lia um `<button type="submit" name="para" value=…>`, que  │
 * │ é o que o HTML manda: o navegador inclui o par do botão CLICADO. Server     │
 * │ Action não: o FormData que chega aqui não traz a entrada do submitter, e    │
 * │ `dados.get('para')` voltava VAZIO.                                         │
 * │                                                                            │
 * │ O sintoma era enganoso — o banco recusava com violação de                   │
 * │ `cancellation_estado_check`, e a primeira leitura foi que a restrição não   │
 * │ conhecia o estado. Estava errada: o CHECK lista os oito estados, e a linha  │
 * │ recusada tinha `estado` vazio. Foi o banco que impediu a corrupção.         │
 * │                                                                            │
 * │ `bind` resolve na raiz: o destino é fechado no servidor, não viaja em campo │
 * │ de formulário, e o tipo é conferido em compilação.                          │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
const ETAPAS = ['anunciado', 'financeiro', 'reversao'] as const
export type EtapaDeTrabalho = (typeof ETAPAS)[number]

export async function acaoAvancarEtapa(
  para: EtapaDeTrabalho,
  dados: FormData,
): Promise<void> {
  const id = await exigir((p) => temEscopo(p.contas), 'mover pedido de saída')
  const saidaId = String(dados.get('id') ?? '')
  await tentar(async () => {
    /* VALIDA antes de tocar no banco. O tipo cobre o caminho da tela; isto cobre
       o de fora dela, e a diferença é a mensagem: "etapa desconhecida" em vez de
       um erro de restrição que não diz a quem clicou o que fazer. */
    if (!(ETAPAS as readonly string[]).includes(para)) {
      throw new TransicaoInvalidaError(
        `etapa desconhecida: ${para || '(vazia)'}. As de trabalho são ${ETAPAS.join(', ')}`,
      )
    }
    await avancarEtapa(pool(), id, saidaId, para)
    return `pedido movido para ${para === 'anunciado' ? 'pedido' : para === 'financeiro' ? 'informações financeiras' : 'tentativa de reversão'}.`
  }, voltarPara(dados))
}

/**
 * Mover um cartão ARRASTANDO — e esta é a única ação do fluxo que NÃO redireciona.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O DEFEITO QUE ELA CONSERTA, na palavra de quem usou:                      │
 * │ "quando clico para movimentar o card ele volta para a Visão Geral e tenho  │
 * │ que ficar voltando para a aba Kanban".                                     │
 * │                                                                            │
 * │ A causa imediata era o kanban faltando na lista de `volta.ts` — já           │
 * │ corrigida, e agora impossível de repetir porque `TelaDoFluxo` é um tipo.    │
 * │ Mas a causa de fundo é que MOVER UM CARTÃO NÃO É NAVEGAR: mesmo acertando   │
 * │ o destino, cada movimento recarregava a tela e perdia a rolagem do quadro.  │
 * │                                                                            │
 * │ Então aqui não há `tentar` e não há `redirect`: o retorno é um objeto, quem │
 * │ chama é componente de cliente, e o quadro se atualiza no lugar.            │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O CLIENTE MANDA PARA ONDE, NUNCA O QUÊ.                                   │
 * │                                                                            │
 * │ Os dois argumentos são o id do pedido e o nome da coluna, e a coluna passa  │
 * │ por lista de permissão. Tudo o que se GRAVA sai do banco: o aviso prévio em │
 * │ dias vem de `saidaPorId`, não do arraste.                                   │
 * │                                                                            │
 * │ Isso é deliberado. `confirmarAviso` grava o campo que mais desloca receita  │
 * │ entre meses; se o número viajasse junto do arraste, um POST forjado         │
 * │ escreveria qualquer prazo sem passar por formulário nenhum.                 │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export async function acaoMoverCard(saidaId: string, para: string): Promise<ResultadoDoArraste> {
  const id = await exigir((p) => temEscopo(p.contas), 'mover cartão no quadro')

  const coluna = colunaConhecida(para)
  if (coluna === null) return { erro: 'coluna desconhecida' }

  const s = await saidaPorId(pool(), id, saidaId)
  if (s === null) return { erro: 'pedido não encontrado, ou não é de conta da sua carteira' }

  const mov = movimento(s, coluna, {
    fila: id.permissoes.fila !== 'nenhum' || id.permissoes.configurar,
    distrato: id.permissoes.aprovaDistrato !== 'nao',
  })
  if (!mov.ok) return { erro: mov.porque }

  try {
    switch (mov.faz) {
      case 'etapa':
        await avancarEtapa(pool(), id, saidaId, mov.virar)
        return { ok: `${s.conta}: movido para ${rotuloDaColuna(coluna)}.` }
      case 'reter':
        await reter(pool(), id, saidaId)
        return { ok: `${s.conta}: retenção registrada — a receita nunca saiu.` }
      case 'renegociar':
        await renegociar(pool(), id, saidaId, {})
        return {
          ok: `${s.conta}: renegociação registrada. Se o mensal mudou, informe o MRR novo no pedido.`,
        }
      case 'aviso':
        // O `!` é o que `movimento` acabou de provar: o caso `null` volta como
        // recusa antes de chegar aqui.
        await confirmarAviso(pool(), id, saidaId, s.avisoPrevioDias!)
        return {
          ok: `${s.conta}: aviso prévio de ${s.avisoPrevioDias} dias confirmado — o cancelamento está correndo.`,
        }
    }
  } catch (err) {
    if (err instanceof TransicaoInvalidaError || err instanceof SemPermissaoError) {
      return { erro: err.message }
    }
    throw err
  }
}

/**
 * Desconto concedido — e a mensagem diz CONTRAÇÃO em voz alta.
 *
 * Quem clica precisa saber que o efeito no ledger não é churn: é a diferença
 * entre "salvei o cliente" e "perdi o cliente", e a tela é o único lugar onde
 * essa distinção chega a quem tomou a decisão.
 */
export async function acaoDesconto(dados: FormData): Promise<void> {
  const id = await exigir((p) => temEscopo(p.contas), 'conceder desconto')
  const saidaId = String(dados.get('id') ?? '')
  const reais = String(dados.get('mrrNovo') ?? '').replace(/\./g, '').replace(',', '.')
  const competencia = String(dados.get('competencia') ?? '')
  const nota = String(dados.get('nota') ?? '').trim()
  await tentar(async () => {
    const centavos = Math.round(Number(reais) * 100)
    if (!Number.isFinite(centavos) || centavos < 0) {
      throw new TransicaoInvalidaError('o novo MRR tem de ser um valor em reais')
    }
    const r = await concederDesconto(pool(), id, saidaId, {
      mrrNovoCentavos: String(centavos),
      competenciaEfeito: competencia,
      ...(nota ? { nota } : {}),
    })
    const v = (Number(r.contracaoCentavos) / 100).toLocaleString('pt-BR', {
      style: 'currency', currency: 'BRL',
    })
    return `desconto registrado. Entrou no ledger como CONTRAÇÃO de ${v} em ${r.competencia.slice(0, 7)} — não como churn, porque o cliente ficou.`
  }, voltarPara(dados))
}

/** Renegociação: só gera evento de MRR se o mensal mudou. */
export async function acaoRenegociar(dados: FormData): Promise<void> {
  const id = await exigir((p) => temEscopo(p.contas), 'renegociar')
  const saidaId = String(dados.get('id') ?? '')
  const bruto = String(dados.get('mrrNovo') ?? '').trim()
  const competencia = String(dados.get('competencia') ?? '').trim()
  const nota = String(dados.get('nota') ?? '').trim()
  await tentar(async () => {
    const temNovoMrr = bruto !== ''
    const centavos = temNovoMrr
      ? Math.round(Number(bruto.replace(/\./g, '').replace(',', '.')) * 100)
      : null
    if (temNovoMrr && (!Number.isFinite(centavos) || (centavos ?? -1) < 0)) {
      throw new TransicaoInvalidaError('o novo MRR tem de ser um valor em reais, ou vazio se o mensal não mudou')
    }
    const r = await renegociar(pool(), id, saidaId, {
      ...(centavos !== null ? { mrrNovoCentavos: String(centavos) } : {}),
      ...(competencia ? { competenciaEfeito: competencia } : {}),
      ...(nota ? { nota } : {}),
    })
    return r.contracaoCentavos === null
      ? 'renegociação registrada. O mensal não mudou, então nada entrou no ledger de receita — mexeu no recebível, que é a inadimplência.'
      : `renegociação registrada, com efeito no MRR. Entrou no ledger em ${competencia}.`
  }, voltarPara(dados))
}

/** Confirma o motivo — e o gate de "outra pessoa" está em @pulse/success. */
export async function acaoConfirmarMotivo(dados: FormData): Promise<void> {
  const id = await exigir((p) => temEscopo(p.contas), 'confirmar motivo')
  const saidaId = String(dados.get('id') ?? '')
  const motivo = String(dados.get('motivo') ?? '') as MotivoSaida
  const detalhe = String(dados.get('detalhe') ?? '').trim()
  await tentar(async () => {
    await confirmarMotivo(pool(), id, saidaId, { motivo, ...(detalhe ? { detalhe } : {}) })
    return 'motivo confirmado. É este campo que sustenta toda a análise de churn.'
  }, voltarPara(dados))
}

/** Define a meta de churn de um mês. Exige `configurar`. */
export async function acaoDefinirMeta(dados: FormData): Promise<void> {
  const id = await exigir((p) => p.configurar, 'definir meta de churn')
  const competencia = String(dados.get('competencia') ?? '')
  const reais = String(dados.get('meta') ?? '').replace(/\./g, '').replace(',', '.')
  const nota = String(dados.get('nota') ?? '').trim()
  await tentar(async () => {
    const centavos = Math.round(Number(reais) * 100)
    if (!Number.isFinite(centavos) || centavos < 0) {
      throw new TransicaoInvalidaError('a meta tem de ser um valor em reais, não negativo')
    }
    await definirMeta(pool(), id, competencia, String(centavos), nota || undefined)
    return `meta de ${competencia} definida.`
  }, voltarPara(dados))
}

/** O registro da levantada passa a aceitar o tipo do pedido e o MRR digitado. */
/*
 * A ÚNICA porta de entrada do fluxo. Havia duas — esta e uma `registrarSaida`
 * anterior, subconjunto desta —, e NENHUMA das duas era chamada por formulário
 * algum: `success.cancellation` ficou em zero linha, e daí saíram todos os zeros
 * da tela. A duplicata foi removida junto com o defeito.
 *
 * O gate é `fila`, e não `contas`, para ser o MESMO que `anunciar` aplica lá
 * dentro. Com `contas`, o Comercial preenchia o formulário inteiro e recebia
 * "registrar saída exige acesso à fila de trabalho" no fim.
 */
export async function registrarPedido(dados: FormData): Promise<void> {
  const id = await exigir((p) => temEscopo(p.fila), 'registrar pedido de saída')
  const mrr = String(dados.get('mrr') ?? '').trim()
  const aviso = String(dados.get('avisoPrevioDias') ?? '').trim()
  await tentar(async () => {
    await anunciar(pool(), id, {
      accountId: String(dados.get('accountId') ?? ''),
      origem: (String(dados.get('origem') ?? 'cliente') || 'cliente') as OrigemSaida,
      pedido: (String(dados.get('pedido') ?? 'cancelar') || 'cancelar') as PedidoDeSaida,
      dataLevantada: String(dados.get('dataLevantada') ?? '') || undefined,
      canal: (String(dados.get('canal') ?? '') || undefined) as CanalAnuncio | undefined,
      quemComunicou: String(dados.get('quemComunicou') ?? '') || undefined,
      motivo: String(dados.get('motivo') ?? '') || undefined,
      motivoDetalhe: String(dados.get('motivoDetalhe') ?? '') || undefined,
      ...(mrr ? { mrrCentavos: String(Math.round(Number(mrr.replace(/\./g, '').replace(',', '.')) * 100)) } : {}),
      ...(aviso ? { avisoPrevioDias: Number(aviso) } : {}),
    })
    return 'pedido registrado.'
  }, voltarPara(dados))
}
