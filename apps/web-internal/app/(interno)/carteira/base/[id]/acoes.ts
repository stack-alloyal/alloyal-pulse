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

/**
 * Volta para a ficha, na MESMA vista de onde a ação partiu.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ `redirect` monta a URL do zero, então não existe "preservar" aqui: o que a  │
 * │ tela não mandar, se perde. Sem a `vista`, vincular uma identidade devolvia   │
 * │ a ficha com eixo, período, visão do gráfico e os dois filtros do histórico   │
 * │ de volta ao padrão — e a pessoa acabara de mudar justamente o dado que       │
 * │ estava olhando naquele recorte.                                            │
 * │                                                                            │
 * │ `ok`/`erro` entram DEPOIS da vista, de propósito: a mensagem da ação é a     │
 * │ única coisa que pode sobrescrever, e a vista que chega já vem sem elas.      │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
const volta = (
  id: string,
  params: Record<string, string>,
  vista = '',
) => {
  const p = new URLSearchParams(vista)
  for (const [k, v] of Object.entries(params)) p.set(k, v)
  revalidatePath(`/carteira/base/${id}`)
  redirect(`/carteira/base/${id}?${p.toString()}#identidades`)
}

export async function vincularIdentidade(dados: FormData): Promise<void> {
  const identidade = await exigir((p) => p.configurar, 'vincular identidade')
  const id = uuidOu404(String(dados.get('accountId') ?? ''))
  const fonte = String(dados.get('fonte') ?? 'omie') as 'omie' | 'hubspot'
  const chave = String(dados.get('chave') ?? '')
  const motivo = String(dados.get('motivo') ?? '')
  const vista = String(dados.get('vista') ?? '')

  try {
    await vincular(pool(), identidade, { accountId: id, fonte, chave, motivo })
  } catch (e) {
    if (e instanceof VinculoOcupadoError || e instanceof VinculoInvalidoError) {
      // A mensagem do erro é escrita para ser lida por quem clicou — inclusive o
      // nome da conta que já é dona. "Já existe" mandaria procurar no escuro.
      volta(id, { erro: e.message }, vista)
    }
    throw e
  }
  volta(id, { ok: `${chave} vinculado a esta conta.` }, vista)
}

export async function desvincularIdentidade(dados: FormData): Promise<void> {
  const identidade = await exigir((p) => p.configurar, 'desvincular identidade')
  const id = uuidOu404(String(dados.get('accountId') ?? ''))
  const fonte = String(dados.get('fonte') ?? 'omie') as 'omie' | 'hubspot'
  const chave = String(dados.get('chave') ?? '')
  const motivo = String(dados.get('motivo') ?? '')
  const vista = String(dados.get('vista') ?? '')

  try {
    await desvincular(pool(), identidade, { accountId: id, fonte, chave, motivo })
  } catch (e) {
    if (e instanceof VinculoInvalidoError) volta(id, { erro: e.message }, vista)
    throw e
  }
  volta(id, { ok: `${chave} desvinculado. O faturamento da conta mudou de valor.` }, vista)
}
