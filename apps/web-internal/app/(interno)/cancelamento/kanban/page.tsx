/**
 * `/cancelamento/kanban` — o quadro, na estrutura do Kanban do Allvoice.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ALTURA DE VIEWPORT COM UMA CONSTANTE SÓ, e ela é MEDIDA.                  │
 * │                                                                            │
 * │ O Allvoice usa `flex h-screen overflow-hidden` na casca inteira. A do Pulse │
 * │ é `min-h-screen items-start`, e trocá-la mudaria a rolagem de TODA página   │
 * │ da app — risco desproporcional para uma tela.                              │
 * │                                                                            │
 * │ Então o único número aqui é `62px`, que é o `h-[62px]` declarado no `Topo`  │
 * │ de `casca.tsx`. Do container para baixo é tudo flex: o cabeçalho é          │
 * │ `shrink-0` e o quadro é `min-h-0 flex-1`, que é o que faz a coluna ter      │
 * │ altura e rolar por dentro. Uma constante que se pode conferir lendo o       │
 * │ `Topo`, e nenhuma cadeia de `calc` para manter.                            │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O FORMULÁRIO SAIU DE BAIXO DO QUADRO, e virou o CTA que o usuário pediu.   │
 * │                                                                            │
 * │ Com o quadro ocupando a viewport não existe "abaixo dele". O CTA leva a     │
 * │ `?novo=1`, que troca o quadro pelo cadastro — sem JavaScript, com endereço  │
 * │ compartilhável, e com um caminho de volta explícito.                       │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O CARTÃO SE MOVE ARRASTANDO, e a tela não navega mais para isso.          │
 * │                                                                            │
 * │ A faixa de `?ok=`/`?erro=` daqui continua servindo o CADASTRO, que ainda    │
 * │ redireciona — registrar uma levantada de mão é um formulário e tem de       │
 * │ funcionar sem JavaScript. O ARRASTE responde dentro do próprio quadro, e é  │
 * │ o `Arraste` que desenha a resposta dele. Ver `arrastar.tsx`.                │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ DOIS FILTROS PEDIDOS FICAM DESABILITADOS, e é honestidade e não preguiça.  │
 * │                                                                            │
 * │ Medido em 10/09/2026: `csm_email` é NULO em 2.155 contas de 2.155, então o  │
 * │ filtro de CS não teria uma opção. Tierização não existe como conceito — o   │
 * │ usuário mesmo escreveu "(ainda a ser criada)", e `core.account.porte`       │
 * │ também está nulo em todas.                                                 │
 * │                                                                            │
 * │ Desabilitado com o motivo no `title` é o padrão do `Chip` do design system: │
 * │ "apagado e sem clique diz as duas coisas ao mesmo tempo — o filtro existe   │
 * │ e não tem nada agora". Esconder faria a pessoa procurar; inventar valor     │
 * │ faria ela filtrar por nada.                                                │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
import {
  contasParaSaida,
  dataConhecida,
  faixaDoPeriodo,
  PERIODOS,
  periodoConhecido,
  quadroDeSaida,
  rotuloDaFaixa,
} from '@pulse/success'
import { Aviso, Btn, Field, Select } from '@pulse/ui'
import Link from 'next/link'

import { QuadroKanban } from './quadro'
import { Registrar } from '../../saidas/visoes'
import { SubNav } from '../subnav'
import { Topo } from '../../casca'
import { pool } from '../../../../lib/db'
import { exigir, temEscopo } from '../../../../lib/guarda'

export const dynamic = 'force-dynamic'

const AQUI = '/cancelamento/kanban'

/** `h-[62px]` do `Topo` em `casca.tsx`. O resto da altura vem do flex. */
const ALTURA = 'h-[calc(100vh-62px)]'

const BRL = (c: string) =>
  (Number(c) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  })

export default async function Kanban({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string
    erro?: string
    novo?: string
    q?: string
    periodo?: string
    de?: string
    ate?: string
  }>
}) {
  const q = await searchParams
  const id = await exigir((p) => temEscopo(p.contas), 'quadro de cancelamento')
  const podeRegistrar = id.permissoes.fila !== 'nenhum' || id.permissoes.configurar
  const cadastrando = q.novo === '1' && podeRegistrar
  const busca = (q.q ?? '').trim()
  const hoje = new Date().toISOString().slice(0, 10)

  /* O recorte de tempo. Tudo passa por lista de permissão antes de virar
     consulta: `periodo` cai no padrão se não for um dos cinco, e as duas datas
     só passam no formato `AAAA-MM-DD` — é `searchParams`, ou seja, entrada do
     usuário, e uma data crua indo para `::date` é erro 500 em dia de sorte. */
  const periodo = periodoConhecido(q.periodo)
  const faixa = faixaDoPeriodo(periodo, hoje, {
    desde: dataConhecida(q.de),
    ate: dataConhecida(q.ate),
  })

  const [pedidos, contas] = await Promise.all([
    quadroDeSaida(pool(), id, faixa),
    cadastrando ? contasParaSaida(pool(), id) : Promise.resolve([]),
  ])

  /* A busca filtra no servidor, sobre o que já veio: são dezenas de cartões, e
     uma consulta nova por tecla digitada seria custo sem ganho. */
  const visiveis = busca
    ? pedidos.filter((p) => p.razaoSocial.toLowerCase().includes(busca.toLowerCase()))
    : pedidos
  const total = visiveis.reduce((s, p) => s + Number(p.mrrCentavos ?? 0), 0)

  return (
    <>
      <Topo href={AQUI} />
      <div className={`flex ${ALTURA} min-h-0 flex-col`}>
        {(q.erro || q.ok) && (
          <div className="shrink-0 px-4 pt-4 md:px-8">
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
          </div>
        )}

        <div className="shrink-0 px-4 pt-4 md:px-8">
          <SubNav atual="kanban" />
        </div>

        {/* O cabeçalho de lá: título e subtítulo à esquerda, filtros à direita,
            tudo numa faixa fina com borda embaixo. */}
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3 md:px-8">
          <div>
            <h1 className="text-titulo font-semibold text-ink">Quadro</h1>
            <p className="mt-1 text-meta text-ink-3">
              {visiveis.length} pedido(s){total > 0 && <> · {BRL(String(total))}</>} ·{' '}
              {rotuloDaFaixa(periodo, faixa).toLowerCase()}
              {/* O recorte NUNCA esconde etapa de trabalho, e dizer isso aqui é o
                  que impede a regra de ser surpresa. Medido: "este trimestre"
                  esconderia os dois pedidos mais parados do quadro. */}
              {periodo !== 'tudo' && <> · em andamento aparece sempre</>}
            </p>
          </div>

          {/* ┌───────────────────────────────────────────────────────────────┐
              │ UM FORMULÁRIO SÓ para busca e período, e não dois.             │
              │                                                                │
              │ Dois `<form method="GET">` lado a lado se apagam: submeter a   │
              │ busca manda só `?q=`, e o período volta ao padrão sem ninguém  │
              │ pedir. Junto, cada submissão carrega os dois — e continua       │
              │ funcionando sem JavaScript, que é a regra desta tela.          │
              └───────────────────────────────────────────────────────────────┘ */}
          <form method="GET" className="ml-auto flex flex-wrap items-end gap-2">
            <Field
              type="search"
              name="q"
              defaultValue={busca}
              placeholder="Buscar cliente…"
              aria-label="Buscar cliente"
              /* Era `w-40` (140px na raiz de 14px) e caberia "Transp…". Pedido do usuário
                 depois de ver a tela: `w-72` são 252px, a mesma largura de uma coluna
                 do quadro — cabe o nome inteiro de quase toda conta da base. */
              className="w-72"
            />

            <Select name="periodo" defaultValue={periodo} aria-label="Período">
              {PERIODOS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.rotulo}
                </option>
              ))}
            </Select>

            {/* ┌─────────────────────────────────────────────────────────────┐
                │ AS DUAS DATAS FICAM SEMPRE NA TELA, e DESABILITADAS enquanto │
                │ o período for um preset.                                      │
                │                                                               │
                │ Aparecer sempre é o que mostra qual faixa o preset está       │
                │ usando — "este trimestre" vira 01/07 a hoje na cara da pessoa │
                │ em vez de virar um recorte que ela adivinha.                  │
                │                                                               │
                │ Desabilitadas porque senão existe uma armadilha silenciosa:   │
                │ dava para digitar duas datas com "Últimos 12 meses" no select │
                │ e as datas seriam IGNORADAS — o servidor só olha as duas      │
                │ quando o período é `personalizado`. A pessoa filtraria e veria │
                │ o mesmo quadro, sem nenhuma pista do porquê.                   │
                │                                                               │
                │ Resolver isso "adivinhando" a intenção (se as datas mudaram,  │
                │ virar personalizado) quebra no caso oposto: trocar o select    │
                │ manda junto as datas VELHAS do preset anterior. Desabilitar é  │
                │ determinístico, funciona sem JavaScript, e é o mesmo padrão    │
                │ dos filtros de CS e tier logo abaixo — apagado com o motivo    │
                │ no `title` diz as duas coisas ao mesmo tempo.                  │
                └─────────────────────────────────────────────────────────────┘ */}
            <Field
              type="date"
              name="de"
              defaultValue={faixa.desde ?? ''}
              aria-label="De"
              disabled={periodo !== 'personalizado'}
              title={
                periodo === 'personalizado'
                  ? 'Início da faixa'
                  : 'Escolha "Período personalizado" para digitar as datas'
              }
              className={`w-[9.5rem] ${periodo !== 'personalizado' ? 'cursor-not-allowed text-ink-4' : ''}`}
            />
            <Field
              type="date"
              name="ate"
              defaultValue={faixa.ate ?? ''}
              aria-label="Até"
              disabled={periodo !== 'personalizado'}
              title={
                periodo === 'personalizado'
                  ? 'Fim da faixa'
                  : 'Escolha "Período personalizado" para digitar as datas'
              }
              className={`w-[9.5rem] ${periodo !== 'personalizado' ? 'cursor-not-allowed text-ink-4' : ''}`}
            />

            <Btn type="submit" variant="ghost">
              Filtrar
            </Btn>
          </form>

          <div className="flex flex-wrap items-center gap-2">

            {/* Os dois que o usuário pediu e que não têm de onde sair. */}
            <Select
              disabled
              aria-label="Filtrar por CS"
              title="Sem opções: csm_email está nulo em todas as 2.155 contas ativas"
              className="cursor-not-allowed text-ink-4"
            >
              <option>Todos os CS</option>
            </Select>
            <Select
              disabled
              aria-label="Filtrar por tierização"
              title="A tierização de clientes ainda não existe no modelo"
              className="cursor-not-allowed text-ink-4"
            >
              <option>Todas as tiers</option>
            </Select>

            {/* `Link` e não `Btn`: o Btn da casa é botão e não aceita href, e um
                CTA de navegação tem de ser ÂNCORA — abre em nova aba, aparece no
                histórico, e funciona sem JavaScript. As classes são as do botão
                primário, e o portão de foco exige o anel. */}
            {podeRegistrar &&
              (cadastrando ? (
                <Link
                  href={AQUI}
                  className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-meta font-semibold text-ink-2 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-purple-500"
                >
                  Voltar ao quadro
                </Link>
              ) : (
                <Link
                  href={`${AQUI}?novo=1`}
                  className="rounded-md bg-purple-500 px-3 py-1.5 text-meta font-semibold text-white hover:bg-purple-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-purple-500"
                >
                  Nova levantada de mão
                </Link>
              ))}
          </div>
        </header>

        {cadastrando ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
            <div className="mx-auto max-w-[900px]">
              <Registrar contas={contas} hoje={hoje} volta={AQUI} />
            </div>
          </div>
        ) : (
          <QuadroKanban
            pedidos={visiveis}
            /* Os dois eixos que as funções de `@pulse/success` cobram. O
               `configurar` entra no primeiro e NÃO no segundo, porque
               `renegociar` não abre essa exceção. */
            poderes={{
              fila: id.permissoes.fila !== 'nenhum' || id.permissoes.configurar,
              distrato: id.permissoes.aprovaDistrato !== 'nao',
            }}
          />
        )}
      </div>
    </>
  )
}
