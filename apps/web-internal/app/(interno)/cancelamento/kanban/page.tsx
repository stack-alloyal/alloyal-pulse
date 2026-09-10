/**
 * `/cancelamento` — a tela em que se OPERA um cancelamento.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POR QUE UMA TELA PRÓPRIA, e não mais uma aba em Saídas.                   │
 * │                                                                            │
 * │ Pedido pelo usuário em 10/09/2026: "criar no menu um item de cancelamento  │
 * │ e inserir o fluxo de cancelamento nele, com fluxo de inserir um novo card   │
 * │ selecionando o cliente".                                                   │
 * │                                                                            │
 * │ E a divisão tem conteúdo além da organização. Antes, uma tela só respondia  │
 * │ duas perguntas de gente diferente: "o que eu faço agora com este pedido?"  │
 * │ (CS, todo dia) e "quanto perdemos e por quê?" (liderança, no fechamento).  │
 * │ Quem entrava para trabalhar um pedido passava por quatro abas de número.   │
 * │                                                                            │
 * │ Agora: AQUI se opera — o quadro, o cadastro do card e os sete formulários  │
 * │ de cada pedido. Em `/saidas` se analisa — funil, coorte, meta e            │
 * │ reconciliação.                                                            │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O CADASTRO É A PRIMEIRA COISA QUANDO O QUADRO ESTÁ VAZIO, e a última       │
 * │ quando não está.                                                          │
 * │                                                                            │
 * │ Quem abre a tela com pedidos no quadro veio trabalhar o que já existe; o   │
 * │ formulário embaixo não estorva. Quem abre com o quadro vazio não tem o que │
 * │ trabalhar — e aí o `Vazio` aponta para o formulário, que é a única ação     │
 * │ possível. Foi a lição de `a6b9e91`: a ação existia e nenhuma tela a         │
 * │ chamava, então a tela subiu zerada e ninguém soube por quê.                │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
import { contasParaSaida, listarSaidas, quadroDeSaida } from '@pulse/success'
import { Aviso, Card, Vazio } from '@pulse/ui'

import { Linha } from '../andamento'
import { SubNav } from '../subnav'
import { Quadro, Registrar } from '../../saidas/visoes'
import { Corpo, Topo } from '../../casca'
import { pool } from '../../../../lib/db'
import { exigir, temEscopo } from '../../../../lib/guarda'

export const dynamic = 'force-dynamic'

/** Esta tela, para as ações devolverem aqui e não em `/saidas`. */
const AQUI = '/cancelamento/kanban'

export default async function Kanban({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; erro?: string }>
}) {
  const q = await searchParams
  const id = await exigir((p) => temEscopo(p.contas), 'fluxo de cancelamento')

  /* A MESMA regra que `anunciar` aplica lá dentro, e não a do `exigir` da tela:
     VER o fluxo pede escopo de contas, ABRIR um pedido pede acesso à fila.
     Mostrar o formulário a quem só vê contas faria a pessoa preencher oito
     campos para receber "registrar saída exige acesso à fila de trabalho". */
  const podeRegistrar = id.permissoes.fila !== 'nenhum' || id.permissoes.configurar
  const podeAprovar = id.permissoes.aprovaDistrato !== 'nao' || id.permissoes.configurar
  const hoje = new Date().toISOString().slice(0, 10)

  const [saidas, pedidos, contas] = await Promise.all([
    listarSaidas(pool(), id),
    quadroDeSaida(pool(), id),
    podeRegistrar ? contasParaSaida(pool(), id) : Promise.resolve([]),
  ])

  /* As três etapas de trabalho e o aviso correndo contam como ABERTAS: são os
     pedidos que ainda pedem alguma coisa de alguém. Os quatro desfechos são
     fechados — e `em_aviso` NÃO é desfecho: `TRANSICOES` lhe dá saída para
     `retido` e `encerrado`, então o cliente ainda pode ser salvo. */
  const abertas = saidas.filter(
    (s) =>
      s.estado === 'anunciado' ||
      s.estado === 'financeiro' ||
      s.estado === 'reversao' ||
      s.estado === 'em_aviso',
  )
  const fechadas = saidas.filter(
    (s) =>
      s.estado === 'retido' ||
      s.estado === 'desconto' ||
      s.estado === 'renegociado' ||
      s.estado === 'encerrado',
  )

  return (
    <>
      <Topo href={AQUI} />
        <SubNav atual="kanban" />
      <Corpo className="grid gap-5">
        {q.erro && (
          <Aviso tom="erro" papel="alert">
            {q.erro}
          </Aviso>
        )}
        {q.ok && (
          <Aviso tom="ok" papel="status">
            {q.ok}
          </Aviso>
        )}

        <Quadro pedidos={pedidos} volta={AQUI} />

        {pedidos.length === 0 && (
          <Vazio
            titulo="Nenhum pedido de cancelamento registrado."
            porque="O quadro se preenche a partir do primeiro card cadastrado, no formulário abaixo. Enquanto isso, a aba Reconciliação em Saídas mostra o churn que o FATURAMENTO já enxerga — de quem o dinheiro parou de entrar, sem ninguém ter dito por quê."
            acao={{ texto: 'Ver a reconciliação', href: '/saidas?aba=reconciliacao' }}
          />
        )}

        {podeRegistrar && <Registrar contas={contas} hoje={hoje} volta={AQUI} />}

        <Card title={`Em andamento (${abertas.length})`}>
          {abertas.length === 0 ? (
            <Vazio
              titulo="Nenhum pedido em andamento."
              porque="Pedidos aparecem aqui enquanto pedem alguma coisa de alguém — confirmação de aviso, de última cobrança, ou a aprovação do distrato. Lista vazia é boa notícia, não erro de carregamento."
              acao={{ texto: 'Ver a fila de trabalho', href: '/' }}
              className="border-0 p-0"
            />
          ) : (
            <ul className="grid gap-3">
              {abertas.map((s) => (
                <Linha key={s.id} s={s} podeAprovar={podeAprovar} volta={AQUI} />
              ))}
            </ul>
          )}
        </Card>

        {/* Os desfechos ficam FECHADOS num `<details>`: são o que já aconteceu, e
            acumulam para sempre. Em coluna aberta, em seis meses ninguém acha o
            que está em andamento no meio do que está encerrado. */}
        {fechadas.length > 0 && (
          <details>
            <summary className="cursor-pointer select-none text-corpo font-semibold text-ink-2 hover:text-ink">
              {fechadas.length} com desfecho
            </summary>
            <ul className="mt-3 grid gap-3 opacity-75">
              {fechadas.map((s) => (
                <Linha key={s.id} s={s} podeAprovar={false} volta={AQUI} />
              ))}
            </ul>
          </details>
        )}
      </Corpo>
    </>
  )
}
