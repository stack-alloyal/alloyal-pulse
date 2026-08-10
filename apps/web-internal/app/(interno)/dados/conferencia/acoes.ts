'use server'

import { ConferenciaInvalidaError, decidir, reabrir, type Decisao } from '@pulse/config'
import { redirect } from 'next/navigation'

import { pool } from '../../../../lib/db'
import { exigir } from '../../../../lib/guarda'

/**
 * As ações da fila de conferência.
 *
 * Exigem `configurar`: decidir qual fonte vale sobre a identidade de um cliente é
 * decisão de plataforma, não de carteira. A checagem é aqui e não na tela — Server
 * Action é endpoint POST, e esconder o botão não impede o POST.
 */
const voltar = (rota: string, chave: string, texto: string): never =>
  redirect(`${rota}?${chave}=${encodeURIComponent(texto)}`)

export async function decidirConferencia(dados: FormData): Promise<void> {
  const id = await exigir((p) => p.configurar, 'fila de conferência')
  const item = String(dados.get('id') ?? '')
  const decisao = String(dados.get('decisao') ?? '') as Decisao
  const nota = String(dados.get('nota') ?? '')
  const ignorar = String(dados.get('ignorar') ?? '') === '1'
  try {
    await decidir(pool(), id, item, { decisao, nota, ignorar })
    voltar(
      '/dados/conferencia',
      'ok',
      ignorar ? 'Divergência ignorada, com o motivo registrado.' : `Conferido: vale o valor da ${decisao}.`,
    )
  } catch (err) {
    if (err instanceof ConferenciaInvalidaError) voltar(`/dados/conferencia/${item}`, 'erro', err.message)
    throw err
  }
}

export async function reabrirConferencia(dados: FormData): Promise<void> {
  const id = await exigir((p) => p.configurar, 'fila de conferência')
  const item = String(dados.get('id') ?? '')
  try {
    await reabrir(pool(), id, item)
    voltar(`/dados/conferencia/${item}`, 'ok', 'Reaberta para nova conferência.')
  } catch (err) {
    if (err instanceof ConferenciaInvalidaError) voltar(`/dados/conferencia/${item}`, 'erro', err.message)
    throw err
  }
}
