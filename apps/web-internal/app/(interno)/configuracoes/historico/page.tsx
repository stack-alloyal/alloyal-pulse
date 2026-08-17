import { historicoDeMudancas } from '@pulse/config'
import { Badge, Card, Table, Vazio } from '@pulse/ui'

import { Corpo, Topo } from '../../casca'
import { pool } from '../../../../lib/db'
import { exigir } from '../../../../lib/guarda'

export const dynamic = 'force-dynamic'

/**
 * A trilha: o que mudou, quem mudou, quando e por quê.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ Existe por causa de uma pergunta que sempre aparece DEPOIS: "o número       │
 * │ piorou desde que mexeram no limiar". Sem trilha, ninguém consegue nem       │
 * │ confirmar que mexeram — e a calibração dos gatilhos perde a única           │
 * │ referência que tem para comparar antes e depois.                          │
 * │                                                                            │
 * │ Para SEGREDO, a trilha registra que mudou e nunca o valor. É CHECK no       │
 * │ banco, não convenção: a trilha não é cifrada, e gravar o token anterior     │
 * │ nela desfaria a cifra da tabela ao lado.                                   │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * A tabela é imutável por trigger. Registro de auditoria editável não é auditoria.
 */

const TOM: Record<string, 'slate' | 'indigo' | 'red' | 'amber'> = {
  configuracao: 'slate',
  papel: 'indigo',
  segredo: 'red',
}

const ROTULO: Record<string, string> = {
  configuracao: 'ajuste',
  papel: 'acesso',
  segredo: 'segredo',
}

function valor(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

export default async function Historico() {
  await exigir((p) => p.configurar, 'histórico de mudanças')
  const mudancas = await historicoDeMudancas(pool(), 200)

  return (
    <>
      <Topo
        href="/configuracoes"
        titulo="Histórico de mudanças"
        proposito="o que mudou, quem mudou e por quê"
      />
      <Corpo className="grid gap-5">
        {mudancas.length === 0 ? (
          <Vazio
            titulo="Nenhuma mudança registrada ainda."
            porque="A trilha começa a partir da primeira alteração feita pela tela. Valores mudados por SQL direto no banco não aparecem aqui — e é justamente por isso que a tela existe."
          />
        ) : (
          <Card title={`Últimas ${mudancas.length} mudanças`}>
            <Table
              cols={['Quando', 'O quê', 'Chave', 'De → para', 'Quem', 'Motivo']}
              rows={mudancas.map((m) => [
                <span className="whitespace-nowrap text-meta tabular-nums text-ink-2">
                  {new Date(m.quando).toLocaleString('pt-BR')}
                </span>,
                <Badge tone={TOM[m.tipo] ?? 'slate'}>{ROTULO[m.tipo] ?? m.tipo}</Badge>,
                <code className="text-meta">{m.chave}</code>,
                m.tipo === 'segredo' ? (
                  /* Dito e não deixado em branco: célula vazia se leria como falha de
                     registro, e o que houve foi uma decisão. */
                  <span className="text-meta text-ink-3">
                    valor não registrado — a trilha não é cifrada
                  </span>
                ) : (
                  <span className="text-meta tabular-nums">
                    <span className="text-ink-3">{valor(m.antes)}</span>
                    <span className="mx-1 text-ink-4">→</span>
                    <strong className="font-semibold text-ink">{valor(m.depois)}</strong>
                  </span>
                ),
                <span className="text-meta text-ink-2">{m.quem.split('@')[0]}</span>,
                m.motivo ? (
                  <span className="text-meta text-ink-2">{m.motivo}</span>
                ) : (
                  <span className="text-meta text-ink-4">sem motivo declarado</span>
                ),
              ])}
            />
          </Card>
        )}

        <p className="max-w-[80ch] text-corpo leading-relaxed text-ink-2">
          Esta tabela não aceita alteração nem remoção — o banco recusa por trigger. Correção é
          registro novo, nunca edição do anterior: trilha que se conserta não sustenta nenhuma
          conversa sobre o que aconteceu.
        </p>
      </Corpo>
    </>
  )
}
