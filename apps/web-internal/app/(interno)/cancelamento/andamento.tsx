/**
 * A lista "Em andamento" e o cartão de cada pedido — a parte do fluxo em que se
 * TRABALHA um cancelamento: confirmar aviso, confirmar última cobrança, reter,
 * dar desconto, renegociar, confirmar motivo e encerrar.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POR QUE ISTO SAIU DA TELA DE SAÍDAS.                                      │
 * │                                                                            │
 * │ Em 10/09/2026 o usuário pediu um item de menu próprio para o cancelamento, │
 * │ com o fluxo dentro dele. E a separação tem conteúdo além da organização:   │
 * │ `/cancelamento` OPERA (quadro, cadastro, os sete formulários deste         │
 * │ arquivo) e `/saidas` ANALISA (funil, coorte, meta, reconciliação).         │
 * │                                                                            │
 * │ Ficou em arquivo próprio e não duplicado nas duas telas: sete formulários  │
 * │ copiados divergem no primeiro conserto, e é o defeito que os comentários   │
 * │ deste repositório mais citam.                                             │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
import {
  MOTIVOS_SAIDA,
  faltaParaEncerrar,
  rotuloDoMotivo,
  type Saida,
} from '@pulse/success'
import { Badge, Btn, Field, Select, cn } from '@pulse/ui'
import { Check } from 'lucide-react'

import { CampoDeVolta } from '../saidas/visoes'
import { type TelaDoFluxo } from '../saidas/volta'
import {
  acaoConfirmarAviso,
  acaoConfirmarCobranca,
  acaoConfirmarMotivo,
  acaoDesconto,
  acaoEncerrar,
  acaoRenegociar,
  acaoReter,
} from '../saidas/acoes'

const REAIS = (c: string | null) =>
  c === null
    ? '—'
    : (Number(c) / 100).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      })

const ESTADO: Record<string, { rotulo: string; tom: 'red' | 'amber' | 'green' | 'slate' }> = {
  anunciado: { rotulo: 'Anunciado', tom: 'red' },
  em_aviso: { rotulo: 'Em aviso', tom: 'amber' },
  retido: { rotulo: 'Retido', tom: 'green' },
  encerrado: { rotulo: 'Encerrado', tom: 'slate' },
}

const MES = (c: string | null) => c ?? '—'

function janela(s: Saida): { texto: string; cor: string } {
  if (s.estado === 'retido') return { texto: 'revertida', cor: 'text-green' }
  if (s.estado === 'encerrado') return { texto: 'encerrada', cor: 'text-ink-3' }
  if (s.dataFimAviso === null) {
    return { texto: 'aviso prévio não confirmado', cor: 'text-red' }
  }
  const d = s.diasParaFimDoAviso ?? 0
  if (d < 0) return { texto: `janela fechou há ${-d} d`, cor: 'text-ink-3' }
  if (d === 0) return { texto: 'fecha hoje', cor: 'text-red' }
  return { texto: `${d} d para reverter`, cor: d <= 15 ? 'text-red' : 'text-orange-700' }
}

/** A linha do tempo das quatro datas, com quem confirmou cada uma. */
function Datas({ s }: { s: Saida }) {
  // Numa saída revertida os dois últimos passos não estão PENDENTES, estão
  // dispensados: a receita nunca saiu, e nunca haverá última cobrança. Dizer
  // "aguarda o Financeiro" ali inventa uma tarefa que ninguém deve fazer — e
  // alguém a faria, porque a tela pediu.
  const revertida = s.estado === 'retido'
  const passos = [
    {
      rotulo: '1 · Levantada',
      valor: s.dataLevantada ?? (s.origem === 'alloyal' ? 'provisão' : '—'),
      nota: [s.canal, s.quemComunicou].filter(Boolean).join(' · ') || null,
      feito: s.dataLevantada !== null || s.origem === 'alloyal',
    },
    {
      rotulo: '2 · Fim do aviso',
      valor: s.dataFimAviso ?? '—',
      nota: s.avisoConfirmadoPor
        ? `${s.avisoPrevioDias} d · confirmado por ${s.avisoConfirmadoPor}`
        : 'aguarda confirmação de CS ou Jurídico',
      feito: s.avisoConfirmadoPor !== null,
    },
    {
      rotulo: '3 · Última cobrança',
      valor: MES(s.competenciaUltimaCobranca),
      nota: s.cobrancaConfirmadaPor
        ? `confirmado por ${s.cobrancaConfirmadaPor}`
        : revertida
          ? 'não se aplica — a saída foi revertida'
          : 'aguarda confirmação do Financeiro',
      feito: s.cobrancaConfirmadaPor !== null || revertida,
    },
    {
      rotulo: '4 · Efeito na receita',
      valor: MES(s.competenciaEfeitoReceita),
      // Derivada, nunca digitada — senão um dia o churn de receita e a última
      // cobrança discordam, e a diferença vira ajuste sem explicação.
      nota: s.competenciaEfeitoReceita
        ? 'derivada da última cobrança + 1'
        : revertida
          ? 'a receita nunca saiu'
          : 'depende das duas confirmações',
      feito: s.competenciaEfeitoReceita !== null || revertida,
    },
  ]
  return (
    <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {passos.map((p) => (
        <li
          key={p.rotulo}
          className={cn(
            'rounded-md border bg-surface-2 px-3 py-2',
            p.feito ? 'border-line' : 'border-dashed border-line-strong opacity-80',
          )}
        >
          <span className="flex items-center gap-1 text-tabela font-semibold uppercase tracking-[0.08em] text-ink-3">
            {p.feito && <Check className="h-3 w-3 text-green" />}
            {p.rotulo}
          </span>
          <strong className="mt-0.5 block tabular-nums text-cartao font-bold text-ink">
            {p.valor}
          </strong>
          {p.nota && <span className="mt-0.5 block text-nota text-ink-3">{p.nota}</span>}
        </li>
      ))}
    </ol>
  )
}

export function Linha({
  s,
  podeAprovar,
  volta,
}: {
  s: Saida
  podeAprovar: boolean
  volta: TelaDoFluxo
}) {
  const e = ESTADO[s.estado]!
  const j = janela(s)
  const aberta = s.estado === 'anunciado' || s.estado === 'em_aviso'
  const falta = faltaParaEncerrar(s)

  return (
    <li
      className={cn(
        'rounded-lg border border-line border-l-[3px] bg-surface p-[14px] shadow-sm',
        s.estado === 'anunciado' && 'border-l-red',
        s.estado === 'em_aviso' && 'border-l-amber',
        s.estado === 'retido' && 'border-l-green',
      )}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <strong className="text-cartao font-bold tracking-[-0.01em] text-ink">{s.conta}</strong>
        <Badge tone={e.tom}>{e.rotulo}</Badge>
        <span className="tabular-nums text-meta text-ink-3">
          {REAIS(s.mrrCentavosNaLevantada)}/mês
        </span>
        {s.origem === 'alloyal' && <Badge>encerramento pela Alloyal</Badge>}
        {s.motivo && <Badge tone="indigo">{rotuloDoMotivo(s.motivo)}</Badge>}
        <span className={cn('ml-auto text-meta font-semibold', j.cor)}>{j.texto}</span>
      </div>

      <div className="mt-3">
        <Datas s={s} />
      </div>

      {aberta && (
        <div className="mt-3 grid gap-2 border-t border-line pt-3">
          {!s.avisoConfirmadoPor && (
            <form action={acaoConfirmarAviso} className="flex flex-wrap items-end gap-2">
              <CampoDeVolta para={volta} />
              <input type="hidden" name="id" value={s.id} />
              <Field
                label="Aviso prévio (dias)"
                name="avisoPrevioDias"
                type="number"
                min={0}
                max={365}
                defaultValue={s.avisoPrevioDias ?? 30}
                required
                className="w-24"
              />
              {/* O contrato diz N, mas há acordo, renúncia e prorrogação — e é o
                  campo que mais desloca receita entre meses. */}
              <Btn type="submit" variant="ghost">
                Confirmar aviso
              </Btn>
            </form>
          )}

          {!s.cobrancaConfirmadaPor && (
            <form action={acaoConfirmarCobranca} className="flex flex-wrap items-end gap-2">
              <CampoDeVolta para={volta} />
              <input type="hidden" name="id" value={s.id} />
              <Field
                label="Última cobrança"
                name="competencia"
                type="month"
                required
                className="w-40"
              />
              <Btn type="submit" variant="ghost">
                Confirmar cobrança (Financeiro)
              </Btn>
            </form>
          )}

          <form action={acaoReter} className="flex flex-wrap items-end gap-2">
             <CampoDeVolta para={volta} />
            <input type="hidden" name="id" value={s.id} />
            <div className="min-w-[16em] flex-1">
              <Field
                label="Retenção"
                name="nota"
                type="text"
                placeholder="O que reverteu? (opcional)"
                maxLength={500}
              />
            </div>
            <Btn type="submit" variant="ghost">
              Registrar retenção
            </Btn>
          </form>

          {/* ┌──────────────────────────────────────────────────────────────┐
              │ OS DOIS DESFECHOS QUE SALVAM O CLIENTE PAGANDO MENOS.         │
              │                                                               │
              │ Ficam aqui, e não no quadro: os cartões do quadro têm largura  │
              │ de coluna, e estes precisam de valor em reais e competência —  │
              │ dois campos que decidem quanto e quando entra no ledger. Sem   │
              │ formulário eles não existiam na tela, e as posições 5 e 6 do   │
              │ pipeline eram inalcançáveis: o pedido só podia ser retido ou   │
              │ encerrado, que é o mundo de dois desfechos que este fluxo veio │
              │ substituir.                                                   │
              └──────────────────────────────────────────────────────────────┘ */}
          <form action={acaoDesconto} className="flex flex-wrap items-end gap-2">
            <CampoDeVolta para={volta} />
            <input type="hidden" name="id" value={s.id} />
            <Field
              label="Novo MRR (desconto)"
              name="mrrNovo"
              type="text"
              inputMode="decimal"
              placeholder="3.200,00"
              required
              className="w-40"
            />
            <Field label="Vale a partir de" name="competencia" type="month" required className="w-40" />
            <div className="min-w-[14em] flex-1">
              <Field label="Nota" name="nota" type="text" placeholder="o que foi combinado (opcional)" maxLength={500} />
            </div>
            <Btn type="submit" variant="ghost">
              Conceder desconto
            </Btn>
          </form>

          <form action={acaoRenegociar} className="flex flex-wrap items-end gap-2">
             <CampoDeVolta para={volta} />
            <input type="hidden" name="id" value={s.id} />
            {/* MRR VAZIO é o caso comum: parcelar dívida muda quando o dinheiro
                entra, não quanto entra por mês — e aí nada vai para o ledger de
                receita. O campo é opcional por isso, e o placeholder diz. */}
            <Field
              label="Novo MRR (se mudou)"
              name="mrrNovo"
              type="text"
              inputMode="decimal"
              placeholder="vazio = mensal igual"
              className="w-40"
            />
            <Field label="Vale a partir de" name="competencia" type="month" className="w-40" />
            <div className="min-w-[14em] flex-1">
              <Field label="Nota" name="nota" type="text" placeholder="prazo, parcelas, garantia" maxLength={500} />
            </div>
            <Btn type="submit" variant="ghost">
              Renegociar
            </Btn>
          </form>

          {/* O motivo confirmado é o que sustenta a análise, e o banco exige que
              venha de OUTRA pessoa que não a que abriu o pedido. */}
          <form action={acaoConfirmarMotivo} className="flex flex-wrap items-end gap-2">
            <CampoDeVolta para={volta} />
            <input type="hidden" name="id" value={s.id} />
            <Select
              label={s.motivoConfirmadoPor ? 'Motivo (confirmado)' : 'Confirmar motivo'}
              name="motivo"
              required
              defaultValue={s.motivo ?? ''}
              className="w-56"
            >
              <option value="" disabled>
                escolha o motivo…
              </option>
              {MOTIVOS_SAIDA.map((m) => (
                <option key={m.valor} value={m.valor}>
                  {m.rotulo}
                </option>
              ))}
            </Select>
            <div className="min-w-[14em] flex-1">
              <Field label="Detalhe" name="detalhe" type="text" placeholder="obrigatório em Outro" maxLength={500} />
            </div>
            <Btn type="submit" variant="ghost">
              {s.motivoConfirmadoPor ? 'Corrigir motivo' : 'Confirmar motivo'}
            </Btn>
          </form>

          {falta.length === 1 && falta[0]?.startsWith('aprovação') ? (
            podeAprovar ? (
              <form action={acaoEncerrar} className="flex flex-wrap items-center gap-3">
                <CampoDeVolta para={volta} />
                <input type="hidden" name="id" value={s.id} />
                {/* Encerrar grava no ledger e não se desfaz: o botão diz isso. */}
                <Btn type="submit" variant="danger">
                  Aprovar e encerrar
                </Btn>
                <span className="text-meta text-ink-3">
                  Grava o churn de receita em {MES(s.competenciaEfeitoReceita)}.
                </span>
              </form>
            ) : (
              <p className="text-meta text-ink-3">
                Pronta para encerrar — falta a aprovação de quem tem alçada de distrato.
              </p>
            )
          ) : (
            <p className="text-meta text-ink-3">Para encerrar, falta: {falta.join('; ')}</p>
          )}
        </div>
      )}

      {s.estado === 'retido' && s.retidoPor && (
        <p className="mt-2 text-meta text-ink-3">
          Revertida em {s.retidoEm} por {s.retidoPor} — a receita nunca saiu.
        </p>
      )}
    </li>
  )
}

