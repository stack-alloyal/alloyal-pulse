'use server'

import { desvincular, vincular, VinculoInvalidoError, VinculoOcupadoError } from '@pulse/config'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { pool } from '../../../../../lib/db'
import { exigir } from '../../../../../lib/guarda'
import { uuidOu404 } from '../../../../../lib/parametro'

/**
 * Vincular e desvincular identidade do cliente.
 *
 * Exige `configurar` e não `contas`: quem lê a ficha não decide identidade. Um
 * vínculo muda o faturamento que o cliente inteiro passa a mostrar, e isso é
 * mudança de dado, não de visão.
 */

const volta = (id: string, params: Record<string, string>) => {
  revalidatePath(`/carteira/base/${id}`)
  redirect(`/carteira/base/${id}?${new URLSearchParams(params).toString()}#identidades`)
}

export async function vincularIdentidade(dados: FormData): Promise<void> {
  const identidade = await exigir((p) => p.configurar, 'vincular identidade')
  const id = uuidOu404(String(dados.get('accountId') ?? ''))
  const fonte = String(dados.get('fonte') ?? 'omie') as 'omie' | 'hubspot'
  const chave = String(dados.get('chave') ?? '')
  const motivo = String(dados.get('motivo') ?? '')

  try {
    await vincular(pool(), identidade, { accountId: id, fonte, chave, motivo })
  } catch (e) {
    if (e instanceof VinculoOcupadoError || e instanceof VinculoInvalidoError) {
      // A mensagem do erro é escrita para ser lida por quem clicou — inclusive o
      // nome da conta que já é dona. "Já existe" mandaria procurar no escuro.
      volta(id, { erro: e.message })
    }
    throw e
  }
  volta(id, { ok: `${chave} vinculado a esta conta.` })
}

export async function desvincularIdentidade(dados: FormData): Promise<void> {
  const identidade = await exigir((p) => p.configurar, 'desvincular identidade')
  const id = uuidOu404(String(dados.get('accountId') ?? ''))
  const fonte = String(dados.get('fonte') ?? 'omie') as 'omie' | 'hubspot'
  const chave = String(dados.get('chave') ?? '')
  const motivo = String(dados.get('motivo') ?? '')

  try {
    await desvincular(pool(), identidade, { accountId: id, fonte, chave, motivo })
  } catch (e) {
    if (e instanceof VinculoInvalidoError) volta(id, { erro: e.message })
    throw e
  }
  volta(id, { ok: `${chave} desvinculado. O faturamento da conta mudou de valor.` })
}
