'use client'

import { Aviso, Btn, Field } from '@pulse/ui'
import { useActionState } from 'react'

import { emitirTokenDaApi } from '../acoes'

/**
 * O estado que a ação devolve. `ok` carrega o token CRU — e é a única vez que
 * ele existe fora da cabeça de quem o gerou: não vai para URL, log nem banco.
 */
export type EstadoDaEmissao =
  | { readonly estado: 'inicial' }
  | {
      readonly estado: 'ok'
      readonly token: string
      readonly id: string
      readonly expiraEm: string
      readonly descricao: string
    }
  | { readonly estado: 'erro'; readonly mensagem: string }

/**
 * O formulário de emissão.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ COMPONENTE DE CLIENTE por um motivo só: `useActionState`. Todas as outras   │
 * │ ações de Configurações redirecionam com uma mensagem na URL — e para um     │
 * │ token isso seria gravá-lo no log do proxy e no histórico do navegador.      │
 * │ Aqui a ação DEVOLVE o resultado e a tela o mostra uma vez. Recarregou,      │
 * │ sumiu: é o comportamento certo para um segredo.                            │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export function FormularioDeEmissao({ quem }: { quem: string }) {
  const [r, agir, pendente] = useActionState(emitirTokenDaApi, { estado: 'inicial' } as EstadoDaEmissao)

  if (r.estado === 'ok') {
    return (
      <div className="grid gap-3">
        <Aviso tom="ok" papel="status">
          Token emitido para <strong className="font-semibold">{r.descricao}</strong>, válido até{' '}
          <strong className="font-semibold">{r.expiraEm.slice(0, 10)}</strong>. Copie AGORA — o banco só
          guarda o hash, e esta é a única vez que ele aparece.
        </Aviso>
        <code className="block select-all break-all rounded border border-line bg-surface-2 px-3 py-2 font-mono text-corpo text-ink">
          {r.token}
        </code>
        <p className="text-nota text-ink-3">
          Use como <code>Authorization: Bearer {'<token>'}</code>. Id do token: <code>{r.id}</code> (é o
          que aparece na lista e na trilha; serve para revogar).
        </p>
      </div>
    )
  }

  return (
    <form action={agir} className="grid gap-3">
      {r.estado === 'erro' && (
        <Aviso tom="erro" papel="alert">
          {r.mensagem}
        </Aviso>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <Field
          label="Para quem / para quê"
          name="descricao"
          required
          minLength={3}
          placeholder="ETL de conciliação — MRR/Omie/HubSpot"
        />
        <Field
          label="Responsável (e-mail interno)"
          name="responsavel"
          type="email"
          required
          defaultValue={quem}
          placeholder="nome@alloyal.com.br"
        />
        <Field
          label="Validade (dias)"
          name="dias"
          type="number"
          required
          min={1}
          max={730}
          defaultValue={180}
        />
        <Field
          label="Motivo"
          name="motivo"
          required
          minLength={10}
          placeholder="Por que este token existe (mín. 10 caracteres)"
        />
      </div>
      <div className="flex items-center gap-3">
        <Btn type="submit" disabled={pendente}>
          {pendente ? 'Emitindo…' : 'Emitir token'}
        </Btn>
        <span className="text-nota text-ink-3">
          Só leitura, revogável a qualquer hora. A emissão fica na trilha de mudanças com o seu e-mail
          e o motivo.
        </span>
      </div>
    </form>
  )
}
