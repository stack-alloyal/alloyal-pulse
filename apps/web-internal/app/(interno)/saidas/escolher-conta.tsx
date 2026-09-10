'use client'

/**
 * O campo de cliente do cadastro: digita e vai mostrando.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POR QUE COMPONENTE DE CLIENTE, quando toda a tela funciona sem JavaScript. │
 * │                                                                            │
 * │ O pedido foi "ao clicar em cliente, ter a opção de ir digitando em um campo │
 * │ e ir mostrando". Em produção o select tem 410 opções — rolar 410 num        │
 * │ dropdown nativo é o que faz alguém desistir de registrar, que é exatamente  │
 * │ o problema que esta tela tem.                                              │
 * │                                                                            │
 * │ `<datalist>` resolveria sem JS e foi a primeira ideia, mas não serve: ele   │
 * │ preenche o input com o VALUE da opção, e o value aqui é um UUID. A pessoa   │
 * │ escolheria "4redes" e veria `55e5ea86-df91-…` no campo.                     │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ E CONTINUA FUNCIONANDO SEM JAVASCRIPT, sem `<noscript>` e sem duplicar.   │
 * │                                                                            │
 * │ O HTML que o servidor manda já contém o `<select name="accountId">` com    │
 * │ TODAS as opções — é um select de verdade, submetível. O JavaScript só       │
 * │ ESTREITA a lista conforme se digita. Sem bundle carregado, a pessoa vê a    │
 * │ lista inteira e escolhe do jeito antigo; nada quebra, nada falta.           │
 * │                                                                            │
 * │ É a mesma razão pela qual os botões de etapa são `formAction` e não         │
 * │ arrastar: o time trabalha nesta tela e o cadastro não pode depender de um   │
 * │ bundle.                                                                    │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
import { Field, Select } from '@pulse/ui'
import * as React from 'react'

export interface ContaParaEscolher {
  readonly accountId: string
  readonly razaoSocial: string
  readonly mrrCentavos: string | null
}

const BRL = (c: string) =>
  (Number(c) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  })

/** Sem acento e em minúscula: quem digita "sao" tem de achar "São". */
const dobrar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

export function EscolherConta({ contas }: { contas: readonly ContaParaEscolher[] }) {
  const [busca, setBusca] = React.useState('')
  const alvo = dobrar(busca.trim())

  const filtradas = React.useMemo(
    () => (alvo === '' ? contas : contas.filter((c) => dobrar(c.razaoSocial).includes(alvo))),
    [contas, alvo],
  )

  /* `size` faz o select virar LISTA visível em vez de dropdown, e é o "ir
     mostrando" do pedido: o resultado aparece embaixo do campo conforme se
     digita, sem precisar abrir nada. Seis linhas cabem sem esticar o formulário. */
  return (
    <div className="grid gap-1.5">
      <Field
        type="search"
        label="Cliente"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="digite para filtrar…"
        aria-controls="lista-de-contas"
        autoComplete="off"
      />
      {/* A altura ACOMPANHA o resultado: com `size={6}` fixo, filtrar para duas
          contas deixava quatro linhas de vazio embaixo — visto na renderização.
          Mínimo de dois para a lista não virar um campo de uma linha, que
          pareceria dropdown e não lista. */}
      <Select
        id="lista-de-contas"
        name="accountId"
        required
        size={Math.min(6, Math.max(2, filtradas.length))}
        defaultValue=""
        aria-label="Cliente"
        className="h-auto"
      >
        {filtradas.length === 0 ? (
          <option value="" disabled>
            nenhuma conta com “{busca.trim()}”
          </option>
        ) : (
          filtradas.map((c) => (
            <option key={c.accountId} value={c.accountId}>
              {c.razaoSocial}
              {c.mrrCentavos === null ? ' · MRR a informar' : ` · ${BRL(c.mrrCentavos)}/mês`}
            </option>
          ))
        )}
      </Select>
      <p className="text-nota text-ink-3">
        {filtradas.length === contas.length
          ? `${contas.length} conta(s) disponíveis`
          : `${filtradas.length} de ${contas.length}`}
      </p>
    </div>
  )
}
