'use server'

import {
  anunciar,
  avancarEtapa,
  concederDesconto,
  confirmarAviso,
  confirmarMotivo,
  confirmarUltimaCobranca,
  definirMeta,
  encerrar,
  renegociar,
  reter,
  SemPermissaoError,
  TransicaoInvalidaError,
  type CanalAnuncio,
  type MotivoSaida,
  type OrigemSaida,
  type PedidoDeSaida,
} from '@pulse/success'
import { redirect } from 'next/navigation'

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

async function tentar(fn: () => Promise<string>): Promise<never> {
  let destino: string
  try {
    destino = `/saidas?ok=${encodeURIComponent(await fn())}`
  } catch (err) {
    if (err instanceof TransicaoInvalidaError || err instanceof SemPermissaoError) {
      destino = `/saidas?erro=${encodeURIComponent(err.message)}`
    } else {
      throw err
    }
  }
  // Fora do try: `redirect` sinaliza por exceção, e capturá-la aqui
  // transformaria todo redirecionamento numa mensagem de erro.
  redirect(destino)
}

export async function registrarSaida(dados: FormData): Promise<void> {
  const id = await exigir((p) => temEscopo(p.fila), 'registro de saída')
  const canal = String(dados.get('canal') ?? '')
  const quem = String(dados.get('quemComunicou') ?? '').trim()
  const motivo = String(dados.get('motivo') ?? '').trim()
  const data = String(dados.get('dataLevantada') ?? '')
  await tentar(async () => {
    await anunciar(pool(), id, {
      accountId: String(dados.get('accountId') ?? ''),
      origem: String(dados.get('origem') ?? 'cliente') as OrigemSaida,
      ...(data ? { dataLevantada: data } : {}),
      ...(canal ? { canal: canal as CanalAnuncio } : {}),
      ...(quem ? { quemComunicou: quem } : {}),
      ...(motivo ? { motivo } : {}),
    })
    return 'saída registrada'
  })
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
  })
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
  })
}

export async function acaoReter(dados: FormData): Promise<void> {
  const id = await exigir((p) => temEscopo(p.fila), 'registro de retenção')
  const nota = String(dados.get('nota') ?? '').trim()
  await tentar(async () => {
    await reter(pool(), id, String(dados.get('id') ?? ''), nota || undefined)
    return 'retenção registrada — a receita nunca saiu'
  })
}

export async function acaoEncerrar(dados: FormData): Promise<void> {
  const id = await exigir((p) => p.aprovaDistrato !== 'nao' || p.configurar, 'aprovação de distrato')
  await tentar(async () => {
    const r = await encerrar(pool(), id, String(dados.get('id') ?? ''))
    return `encerrada · churn de receita em ${r.competenciaEfeitoReceita}`
  })
}

/** Move entre as três etapas de trabalho. */
export async function acaoAvancarEtapa(dados: FormData): Promise<void> {
  const id = await exigir((p) => temEscopo(p.contas), 'mover pedido de saída')
  const saidaId = String(dados.get('id') ?? '')
  const para = String(dados.get('para') ?? '') as 'anunciado' | 'financeiro' | 'reversao'
  await tentar(async () => {
    await avancarEtapa(pool(), id, saidaId, para)
    return `pedido movido para ${para === 'anunciado' ? 'pedido' : para === 'financeiro' ? 'informações financeiras' : 'tentativa de reversão'}.`
  })
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
  })
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
  })
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
  })
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
  })
}

/** O registro da levantada passa a aceitar o tipo do pedido e o MRR digitado. */
export async function registrarPedido(dados: FormData): Promise<void> {
  const id = await exigir((p) => temEscopo(p.contas), 'registrar pedido de saída')
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
  })
}
