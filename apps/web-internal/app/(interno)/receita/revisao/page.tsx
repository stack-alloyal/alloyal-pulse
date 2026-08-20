import {
  contasAtivasFaturando,
  contasQuePararamDeFaturar,
  contasSemVinculoComOmie,
  revisaoDoReajuste,
  vinculosSemTagDeCliente,
  JANELA_DO_REAJUSTE,
  MESES_DE_CARENCIA,
  type ContaAtiva,
  type ContaComReajuste,
  type ContaQueParou,
  type ContaSemReajuste,
  type ContaSemVinculo,
  type VinculoSemTag,
} from '@pulse/config'
import { Abas, Aviso, Badge, Card, Chip, Chips, Kpi, KpiGrade } from '@pulse/ui'
import { ExternalLink } from 'lucide-react'
import Link from 'next/link'

import { TabelaOrdenavel, type Coluna } from './tabela'
import { Corpo, Topo } from '../../casca'
import { pool } from '../../../../lib/db'
import { exigir, temEscopo } from '../../../../lib/guarda'

export const dynamic = 'force-dynamic'

/**
 * Revisão de faturamento: onde o faturamento e o cadastro discordam.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ CINCO VISÕES EM ABAS, e não cinco cards numa rolagem só. Duas razões, e a    │
 * │ segunda é a que decidiu:                                                    │
 * │                                                                            │
 * │  1. eram 1.130 linhas na mesma página — 337 + 183 + 74 + 515 + 21 —, e a     │
 * │     quinta lista ficava a seis telas de rolagem da primeira;                 │
 * │  2. cada visão é uma FILA de trabalho diferente, com uma ação diferente do   │
 * │     outro lado. Empilhadas, liam-se como um relatório para ler; em abas,     │
 * │     como cinco filas para trabalhar — que é o que são.                       │
 * │                                                                            │
 * │ Os KPIs ficam ACIMA das abas de propósito: são o mesmo em todas, e repetir   │
 * │ por aba faria parecer que mudam com a escolha. O contador de cada aba é que  │
 * │ dá o tamanho da fila dela.                                                  │
 * │                                                                            │
 * │ NÃO é `/relatorios`: aquela tela é o que o CLIENTE recebe, congelado no      │
 * │ envio. Esta é auditoria nossa e muda a cada sincronização.                   │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

const N = (v: number) => v.toLocaleString('pt-BR')
/** Dinheiro COM centavos, inclusive nos KPIs — o número desta tela vai a reunião. */
const BRL = (c: number) =>
  (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MES = (r: string | null) => {
  if (!r) return '—'
  const [a, m] = r.split('-')
  return `${MESES[Number(m) - 1] ?? m}/${(a ?? '').slice(2)}`
}
const DOC = (d: string | null) => {
  const s = (d ?? '').replace(/\D/g, '')
  if (s.length === 14) return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`
  if (s.length === 11) return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`
  return d ?? '—'
}
const DIA = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—')

/** A configuração da conta no painel. A chave é o CNPJ sem pontuação. */
const PAINEL = (cnpj: string | null) => {
  const d = (cnpj ?? '').replace(/\D/g, '')
  return d ? `https://dashboard.alloyal.com.br/business/${d}/configuracao` : null
}

function NoPainel({ cnpj }: { cnpj: string | null }) {
  const url = PAINEL(cnpj)
  if (!url) return <span className="text-ink-4">—</span>
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title="Abre a configuração desta conta no painel"
      aria-label="Abrir no painel"
      className="inline-flex items-center text-purple-700 hover:text-purple-500"
    >
      <ExternalLink className="h-[14px] w-[14px]" />
    </a>
  )
}

function Nome({ id, nome, doc }: { id: string | null; nome: string; doc?: string | null }) {
  const texto = (
    <>
      <span className="block truncate font-medium text-ink">{nome}</span>
      {doc !== undefined && <span className="block text-nota text-ink-3">{DOC(doc)}</span>}
    </>
  )
  return (
    <span className="block min-w-0 max-w-[24ch] lg:max-w-[32ch]">
      {id ? (
        <Link href={`/carteira/base/${id}`} className="block hover:underline hover:[&>span]:text-purple-700">
          {texto}
        </Link>
      ) : (
        texto
      )}
    </span>
  )
}

const Num = ({ children }: { children: React.ReactNode }) => (
  <span className="whitespace-nowrap tabular-nums text-ink">{children}</span>
)
const Meta = ({ children }: { children: React.ReactNode }) => (
  <span className="whitespace-nowrap tabular-nums text-ink-2">{children}</span>
)

/* ─── As cinco abas ────────────────────────────────────────────────────────── */

const ABAS = ['ativos', 'pararam', 'reajuste', 'comreajuste', 'semvinculo', 'semtag'] as const
type Chave = (typeof ABAS)[number]

export default async function RevisaoDeFaturamento({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; ord?: string; dir?: string; af?: string }>
}) {
  await exigir((p) => temEscopo(p.contas), 'revisão de faturamento')
  const q = await searchParams
  const aba: Chave = ABAS.find((a) => a === q.aba) ?? 'ativos'
  const dir: 'asc' | 'desc' = q.dir === 'asc' ? 'asc' : 'desc'

  const db = pool()
  const [ativos, pararam, reajuste, semVinculo, semTag] = await Promise.all([
    contasAtivasFaturando(db),
    contasQuePararamDeFaturar(db),
    revisaoDoReajuste(db),
    contasSemVinculoComOmie(db),
    vinculosSemTagDeCliente(db),
  ])

  /* ┌──────────────────────────────────────────────────────────────────────┐
     │ O RECORTE POR AFILIADO na aba sem vínculo. Das 515 contas, 410 têm um   │
     │ afiliado no nome — e essas NÃO deveriam ter faturamento nosso: quem      │
     │ cobra é o parceiro. Sem separar, a fila mistura 410 contas que estão     │
     │ certas assim com 105 que são a pergunta de verdade.                     │
     │                                                                         │
     │ `af` aceita `com`, `sem`, ou o nome do afiliado em maiúscula. Nome           │
     │ desconhecido cai em "todos" em vez de devolver lista vazia: parâmetro de │
     │ URL é colado por gente, e lista vazia sem explicação parece defeito.    │
     └──────────────────────────────────────────────────────────────────────┘ */
  const afiliados = new Map<string, { exibido: string; n: number }>()
  for (const c of semVinculo) {
    if (!c.afiliado) continue
    const atual = afiliados.get(c.afiliado)
    afiliados.set(c.afiliado, {
      exibido: atual?.exibido ?? c.afiliadoExibido ?? c.afiliado,
      n: (atual?.n ?? 0) + 1,
    })
  }
  const porAfiliado = [...afiliados.entries()].sort((a, b) => b[1].n - a[1].n)
  const comAfiliado = semVinculo.filter((c) => c.afiliado).length
  const af = q.af ?? 'todos'
  const afValido =
    af === 'com' || af === 'sem' || afiliados.has(af) ? af : 'todos'
  const semVinculoVisiveis = semVinculo.filter((c) =>
    afValido === 'com' ? Boolean(c.afiliado)
    : afValido === 'sem' ? !c.afiliado
    : afValido === 'todos' ? true
    : c.afiliado === afValido,
  )

  const mrrAtivo = ativos.reduce((s, c) => s + c.mrrMes, 0)
  const mrrQueSumiu = pararam.reduce((s, c) => s + c.mrrAnterior, 0)
  const comCandidato = semVinculo.filter((c) => c.temCandidatoNoOmie).length

  /* A URL carrega a aba E a ordenação: trocar de aba não deve levar a ordem da
     aba anterior, porque as colunas são outras — um `?ord=` que não existe na
     aba nova cairia no padrão dela, e é isso que acontece. */
  const link = (a: Chave, ord?: string, d?: 'asc' | 'desc', afiliado?: string) => {
    const p = new URLSearchParams({ aba: a })
    // O recorte de afiliado sobrevive à ordenação, e a ordenação ao recorte:
    // trocar um e perder o outro obriga a refazer duas escolhas quando mudou uma.
    const alvo = afiliado ?? (a === 'semvinculo' ? afValido : 'todos')
    if (alvo !== 'todos') p.set('af', alvo)
    if (ord) { p.set('ord', ord); p.set('dir', d ?? 'desc') }
    return `/receita/revisao?${p.toString()}`
  }
  const hrefDaColuna = (a: Chave) => (id: string, d: 'asc' | 'desc') => link(a, id, d)

  return (
    <>
      <Topo
        href="/receita/revisao"
        titulo="Revisão de faturamento"
        proposito="onde o faturamento e o cadastro discordam"
      />
      <Corpo className="grid gap-5">
        <KpiGrade colunas={4}>
          <Kpi
            rotulo="Ativos e faturando"
            valor={N(ativos.length)}
            nota={`${BRL(mrrAtivo)} no último mês de cada um`}
            tom="green"
          />
          <Kpi
            rotulo="Pararam e seguem ativos"
            valor={N(pararam.length)}
            nota={`${BRL(mrrQueSumiu)}/mês que deixaram de entrar`}
            tom="red"
          />
          <Kpi
            rotulo="Perda com reajuste desde março"
            valor={BRL(reajuste.perdaAcumulada)}
            nota={`${N(reajuste.semReajusteVencidos.length)} contas · ${BRL(reajuste.perdaMensal)}/mês`}
            tom="amber"
          />
          <Kpi
            rotulo="Sem vínculo com o Omie"
            valor={N(semVinculo.length)}
            nota={`${N(comCandidato)} com CNPJ igual esperando ligação`}
          />
        </KpiGrade>

        <Abas
          abas={[
            { chave: 'ativos', rotulo: 'Clientes ativos', conta: ativos.length },
            { chave: 'pararam', rotulo: 'Pararam de faturar', conta: pararam.length },
            { chave: 'reajuste', rotulo: 'Sem reajuste', conta: reajuste.semReajusteVencidos.length },
            { chave: 'comreajuste', rotulo: 'Com reajuste', conta: reajuste.comReajuste.length },
            { chave: 'semvinculo', rotulo: 'Sem vínculo no Omie', conta: semVinculo.length },
            { chave: 'semtag', rotulo: 'Sem tag de cliente', conta: semTag.length },
          ]}
          atual={aba}
          href={(k) => link(k as Chave)}
          iguais
        />

        {aba === 'ativos' && (
          <Card title={`Clientes ativos e faturando · ${N(ativos.length)}`}>
            <TabelaOrdenavel<ContaAtiva>
              dados={ativos}
              ord={q.ord ?? 'mrr'}
              dir={dir}
              href={hrefDaColuna('ativos')}
              chaveDaLinha={(c) => c.accountId}
              vazio="Nenhum cliente ativo está faturando."
              colunas={COLUNAS_ATIVOS}
            />
            <p className="mt-3 text-meta leading-relaxed text-ink-3">
              É o complemento exato da aba <strong className="font-semibold text-ink">Pararam
              de faturar</strong>: mesmo recorte, mesma carência de {MESES_DE_CARENCIA}{' '}
              meses, sinal invertido. Nenhuma conta aparece nas duas — conferido. Existe
              para as outras abas terem denominador: {N(pararam.length)} paradas contra{' '}
              {N(ativos.length)} faturando é uma frase; {N(pararam.length)} sozinho não é.
            </p>
          </Card>
        )}

        {aba === 'pararam' && (
          <Card title={`Pararam de faturar e seguem ativos no painel · ${N(pararam.length)}`}>
            <TabelaOrdenavel<ContaQueParou>
              dados={pararam}
              ord={q.ord ?? 'mrr'}
              dir={dir}
              href={hrefDaColuna('pararam')}
              chaveDaLinha={(c) => c.accountId}
              vazio="Nenhuma conta ativa parou de faturar."
              colunas={COLUNAS_PARARAM}
            />
            <p className="mt-3 text-meta leading-relaxed text-ink-3">
              O corte é de <strong className="font-semibold text-ink">{MESES_DE_CARENCIA} meses
              cheios</strong> sem título faturado: menos que isso marcaria como parado todo
              cliente que vence dia 20, todo dia 1º — e fila falsa é ignorada em duas
              semanas. <strong className="font-semibold text-ink">MRR que sumiu</strong> é a
              média dos três últimos meses faturados, não do último, que costuma ser o mês
              parcial em que a cobrança já estava caindo. O status é o do painel
              (<code className="font-mono text-meta">status_core = active</code>) e não o
              booleano <code className="font-mono text-meta">ativo</code> — este também fica
              falso quando a conta não vem na carga do core, que é ausência de dado e não
              decisão de ninguém.
            </p>
          </Card>
        )}

        {aba === 'reajuste' && (
          <Card
            title={`Sem o reajuste, com aniversário vencido · ${N(reajuste.semReajusteVencidos.length)}`}
            actions={
              <span className="text-corpo text-ink-2">
                taxa de referência{' '}
                <strong className="font-semibold text-ink">{reajuste.taxaPct}%</strong>
              </span>
            }
          >
            <Aviso tom="info">
              <strong className="font-semibold">A taxa foi lida do dado, não digitada.</strong>{' '}
              É a moda dos aumentos observados entre {MES(JANELA_DO_REAJUSTE.antesDe.slice(0, 7))} e{' '}
              {MES(JANELA_DO_REAJUSTE.depoisDe.slice(0, 7))}:{' '}
              <strong className="font-semibold">{N(reajuste.clientesNaTaxa)}</strong> dos{' '}
              {N(reajuste.clientesQueSubiram)} clientes que subiram estão exatamente em{' '}
              {reajuste.taxaPct}%. Março fica fora das duas janelas porque o mês do reajuste
              carrega cobrança extra e retroativo — medido, o MRR de março foi R$ 1,85 milhão
              contra ~R$ 1,2 milhão nos vizinhos, e comparar contra ele inventaria aumento em
              quem não teve nenhum.
            </Aviso>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-line bg-surface-2 p-3">
                <p className="text-nota uppercase tracking-wide text-ink-3">
                  Direito contratual · {N(reajuste.semReajusteVencidos.length)} com aniversário vencido
                </p>
                <p className="mt-1 text-title text-ink">{BRL(reajuste.perdaAcumulada)}</p>
                <p className="mt-0.5 text-meta text-ink-2">
                  {BRL(reajuste.perdaMensal)}/mês × {reajuste.mesesDesdeOReajuste} meses fechados
                </p>
              </div>
              <div className="rounded-md border border-line bg-surface-2 p-3">
                <p className="text-nota uppercase tracking-wide text-ink-3">
                  Se TODOS os {N(reajuste.hipotese.clientes)} parados tivessem sido reajustados
                </p>
                <p className="mt-1 text-title text-ink">{BRL(reajuste.hipotese.ganhoAcumulado)}</p>
                <p className="mt-0.5 text-meta text-ink-2">
                  {BRL(reajuste.hipotese.ganhoMensal)}/mês a {reajuste.taxaPct}% sobre{' '}
                  {BRL(reajuste.hipotese.mrrMensal)}/mês de MRR parado
                  <br />
                  a 4,00% cravados: {BRL(reajuste.hipotese.ganhoMensalA4)}/mês ·{' '}
                  {BRL(reajuste.hipotese.ganhoAcumuladoA4)} no período
                </p>
              </div>
            </div>

            <div className="mt-4">
              <TabelaOrdenavel<ContaSemReajuste>
                dados={reajuste.semReajusteVencidos}
                ord={q.ord ?? 'perda'}
                dir={dir}
                href={hrefDaColuna('reajuste')}
                chaveDaLinha={(c) => c.documento}
                vazio="Todo contrato com aniversário vencido já foi reajustado."
                colunas={COLUNAS_REAJUSTE}
              />
            </div>
            <p className="mt-3 text-meta leading-relaxed text-ink-3">
              <strong className="font-semibold text-ink">{N(reajuste.clientesSemMudanca)}</strong>{' '}
              clientes não tiveram mudança de MRR entre as duas janelas:{' '}
              {N(reajuste.semReajusteVencidos.length)} com contrato iniciado há 12 meses ou mais
              — aniversário vencido, reajuste não aplicado — e {N(reajuste.semReajusteNaoDevidos)}{' '}
              com contrato novo demais, corretamente sem reajuste. A soma fecha com o total, e é
              assim que se confere esta aba. A perda acumulada usa meses{' '}
              <strong className="font-semibold text-ink">fechados</strong>: o mês corrente ainda
              está sendo faturado, e contá-lo inflaria o número com um mês que não terminou.
            </p>
          </Card>
        )}

        {aba === 'comreajuste' && (
          <Card
            title={`Clientes com reajuste aplicado · ${N(reajuste.comReajuste.length)}`}
            actions={
              <span className="text-corpo text-ink-2">
                taxa de referência{' '}
                <strong className="font-semibold text-ink">{reajuste.taxaPct}%</strong>
              </span>
            }
          >
            {/* ┌───────────────────────────────────────────────────────────────┐
                │ DOIS TOTAIS, e separá-los é a única forma de o número servir.   │
                │                                                                │
                │ Dos que subiram, 110 estão exatamente na taxa e somam           │
                │ R$ 8.116/mês de incremento; os outros 31 somam R$ 91.341. Esses │
                │ 31 não são reajuste — são upsell, troca de plano, cobrança      │
                │ nova. Somados numa linha só, atribuiriam ao IPCA um aumento que │
                │ veio de venda, e o efeito real do reajuste apareceria onze vezes │
                │ maior do que é.                                                 │
                └───────────────────────────────────────────────────────────────┘ */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-line bg-surface-2 p-3">
                <p className="text-nota uppercase tracking-wide text-ink-3">
                  Na taxa de {reajuste.taxaPct}% · {N(reajuste.totalNaTaxa.clientes)} clientes
                </p>
                <p className="mt-1 text-title text-ink">
                  + {BRL(reajuste.totalNaTaxa.incremento)}<span className="text-corpo font-normal text-ink-2">/mês</span>
                </p>
                <p className="mt-0.5 text-meta text-ink-2">
                  MRR antes de março: {BRL(reajuste.totalNaTaxa.mrrAntes)}/mês · acumulado em{' '}
                  {reajuste.mesesDesdeOReajuste} meses fechados:{' '}
                  {BRL(reajuste.totalNaTaxa.incremento * reajuste.mesesDesdeOReajuste)}
                </p>
              </div>
              <div className="rounded-md border border-line bg-surface-2 p-3">
                <p className="text-nota uppercase tracking-wide text-ink-3">
                  Fora da taxa · {N(reajuste.totalFora.clientes)} clientes
                </p>
                <p className="mt-1 text-title text-ink">
                  + {BRL(reajuste.totalFora.incremento)}<span className="text-corpo font-normal text-ink-2">/mês</span>
                </p>
                <p className="mt-0.5 text-meta text-ink-2">
                  Não é reajuste: é upsell, troca de plano ou cobrança nova. Fica aqui para
                  não inflar o efeito do IPCA.
                </p>
              </div>
            </div>

            <div className="mt-4">
              <TabelaOrdenavel<ContaComReajuste>
                dados={reajuste.comReajuste}
                ord={q.ord ?? 'inc'}
                dir={dir}
                href={hrefDaColuna('comreajuste')}
                chaveDaLinha={(c) => c.documento}
                vazio="Nenhum cliente teve aumento de MRR entre as duas janelas."
                colunas={COLUNAS_COM_REAJUSTE}
              />
            </div>
            <p className="mt-3 text-meta leading-relaxed text-ink-3">
              <strong className="font-semibold text-ink">MRR antes</strong> e{' '}
              <strong className="font-semibold text-ink">MRR depois</strong> são a MODA
              mensal de cada lado de março — o valor que mais se repete, não a média. É o
              que torna a comparação confiável: um mês dobrado por cobrança extra ou um
              mês parcial não move a moda, e move a média. A SWILE é o caso que provou
              isso — março dela veio dobrado e junho parcial, e pela média ela aparecia
              como queda de 4,7% quando o valor recorrente nunca mudou.
            </p>
          </Card>
        )}

        {aba === 'semvinculo' && (
          <Card
            title={`Contas ativas sem vínculo com o Omie · ${N(semVinculoVisiveis.length)}${
              afValido === 'todos' ? '' : ` de ${N(semVinculo.length)}`
            }`}
            actions={
              <div className="flex flex-wrap items-center justify-end gap-3">
                <Chips>
                  <Chip rotulo="todos" href={link('semvinculo', undefined, undefined, 'todos')} ativo={afValido === 'todos'} conta={semVinculo.length} fixo />
                  <Chip rotulo="com afiliado" href={link('semvinculo', undefined, undefined, 'com')} ativo={afValido === 'com'} conta={comAfiliado} fixo />
                  <Chip rotulo="sem afiliado" href={link('semvinculo', undefined, undefined, 'sem')} ativo={afValido === 'sem'} conta={semVinculo.length - comAfiliado} fixo />
                </Chips>
                {/* Um chip por afiliado, do maior para o menor. São dez nomes, e
                    ver o tamanho de cada um É a informação: 350 contas são de um
                    afiliado só, e isso muda como se lê a fila de 515. */}
                <Chips rotulo="afiliado:">
                  {porAfiliado.map(([chave, { exibido, n }]) => (
                    <Chip
                      key={chave}
                      rotulo={exibido}
                      href={link('semvinculo', undefined, undefined, chave)}
                      ativo={afValido === chave}
                      conta={n}
                      fixo
                    />
                  ))}
                </Chips>
              </div>
            }
          >
            <TabelaOrdenavel<ContaSemVinculo>
              dados={semVinculoVisiveis}
              ord={q.ord ?? 'cad'}
              dir={dir}
              href={hrefDaColuna('semvinculo')}
              chaveDaLinha={(c) => c.accountId}
              vazio="Toda conta ativa tem vínculo com o Omie."
              colunas={COLUNAS_SEM_VINCULO}
            />
            <p className="mt-3 text-meta leading-relaxed text-ink-3">
              Estas contas estão <strong className="font-semibold text-ink">fora das outras
              abas</strong>: sobre elas não se pode afirmar nem que pararam nem que faltou
              reajuste, porque não há faturamento nosso ligado a elas. Encolher esta fila é o
              que torna as outras confiáveis.{' '}
              <strong className="font-semibold text-ink">Candidato no Omie</strong> separa duas
              filas com ações opostas: <em>mesmo CNPJ no Omie</em> é ligação que falta fazer — e
              são apenas {N(comCandidato)} —, enquanto <em>não existe lá</em> é conta que o
              financeiro nunca cadastrou, e aí a pergunta é se ela deveria estar ativa no painel.
              <br />
              <strong className="font-semibold text-ink">O afiliado sai do nome</strong>, do
              que vem entre parênteses — não existe campo de afiliado no core. Conta de
              afiliado não tem faturamento nosso porque quem cobra é o parceiro, e por isso
              estar aqui é o esperado para ela: são{' '}
              <strong className="font-semibold text-ink">{N(comAfiliado)}</strong> das{' '}
              {N(semVinculo.length)}, e {N(semVinculo.length - comAfiliado)} contas{' '}
              <em>próprias</em> — essas sim são a pergunta. Como é convenção de nome lida
              como dado, um &quot;(matriz)&quot; ou &quot;(teste)&quot; no cadastro aparece
              aqui como afiliado; melhor aparecer do que ser agrupado em silêncio.
            </p>
          </Card>
        )}

        {aba === 'semtag' && (
          <Card title={`Vinculados sem tag de cliente no Omie · ${N(semTag.length)}`}>
            <Aviso tom="info">
              <strong className="font-semibold">
                Esta é a fila que falta para o recorte deixar de ser inferência.
              </strong>{' '}
              Nenhum cadastro destes documentos tem <em>Cliente</em> nem{' '}
              <em>Cliente Hinova</em>, e o Pulse os trata como cliente por não serem
              fornecedor nem investidor — leitura correta hoje, mas significa que um
              fornecedor NOVO, ainda sem tag, entraria nas contas como cliente.{' '}
              <strong className="font-semibold">
                {N(semTag.filter((c) => c.faturamento12m > 0).length)} destes {N(semTag.length)}{' '}
                faturam
              </strong>{' '}
              — são esses que importam primeiro.
            </Aviso>
            <div className="mt-4">
              <TabelaOrdenavel<VinculoSemTag>
                dados={semTag}
                ord={q.ord ?? 'fat'}
                dir={dir}
                href={hrefDaColuna('semtag')}
                chaveDaLinha={(c) => c.accountId + c.documento}
                vazio="Todo vínculo tem tag de cliente no Omie."
                colunas={COLUNAS_SEM_TAG}
              />
            </div>
            <p className="mt-3 text-meta leading-relaxed text-ink-3">
              Tag <strong className="font-semibold text-ink">âmbar</strong> é a que contradiz o
              vínculo: <em>Fornecedor</em> e <em>Investidor</em>. Onde ela aparece, a pergunta
              não é só de tag — pode ser vínculo errado. A{' '}
              <strong className="font-semibold text-ink">BIZ Invest</strong> é o caso: os dois
              cadastros dela são fornecedor e investidor, ela não fatura nada, e ainda assim
              está ligada a uma conta nossa.{' '}
              <strong className="font-semibold text-ink">Cadastros no Omie</strong> conta
              quantos registros existem para o mesmo documento — a OAB-MT tem seis, e um deles
              é Fornecedor, o que fez uma versão anterior desta tela tirar um cliente que
              fatura R$ 4.200 por mês sem falhar.
            </p>
          </Card>
        )}
      </Corpo>
    </>
  )
}

/* ─── As colunas de cada aba. Todas ordenáveis, menos o link do painel. ─────── */

const COLUNAS_ATIVOS: readonly Coluna<ContaAtiva>[] = [
  { id: 'nome', rotulo: 'Cliente', celula: (c) => <Nome id={c.accountId} nome={c.razaoSocial} doc={c.cnpj} />, chave: (c) => c.razaoSocial, inicial: 'asc' },
  { id: 'id', rotulo: 'ID', celula: (c) => <span className="font-mono text-meta text-ink-2">{c.brandId ?? '—'}</span>, chave: (c) => Number(c.brandId ?? 0), inicial: 'asc' },
  { id: 'mes', rotulo: 'Último mês', celula: (c) => <Meta>{MES(c.ultimoMes)}</Meta>, chave: (c) => c.ultimoMes },
  { id: 'mrr', rotulo: 'MRR do mês', celula: (c) => <Num>{BRL(c.mrrMes)}</Num>, chave: (c) => c.mrrMes, inicial: 'desc', alinhar: 'direita' },
  { id: 'doze', rotulo: 'Faturado 12m', celula: (c) => <Num>{BRL(c.faturamento12m)}</Num>, chave: (c) => c.faturamento12m, inicial: 'desc', alinhar: 'direita' },
  { id: 'meses', rotulo: 'Meses', celula: (c) => <Meta>{c.meses}</Meta>, chave: (c) => c.meses, inicial: 'desc', alinhar: 'direita' },
  { id: 'cad', rotulo: 'Cadastrados', celula: (c) => <Meta>{N(c.usuariosCadastrados)}</Meta>, chave: (c) => c.usuariosCadastrados, inicial: 'desc', alinhar: 'direita' },
  { id: 'painel', rotulo: '', celula: (c) => <NoPainel cnpj={c.cnpj} /> },
]

const COLUNAS_PARARAM: readonly Coluna<ContaQueParou>[] = [
  { id: 'nome', rotulo: 'Cliente', celula: (c) => <Nome id={c.accountId} nome={c.razaoSocial} doc={c.cnpj} />, chave: (c) => c.razaoSocial, inicial: 'asc' },
  { id: 'id', rotulo: 'ID', celula: (c) => <span className="font-mono text-meta text-ink-2">{c.brandId ?? '—'}</span>, chave: (c) => Number(c.brandId ?? 0), inicial: 'asc' },
  { id: 'mes', rotulo: 'Último mês', celula: (c) => <Meta>{MES(c.ultimoMes)}</Meta>, chave: (c) => c.ultimoMes },
  {
    id: 'parado',
    rotulo: 'Parado há',
    celula: (c) => (
      <Badge tone={c.mesesParado >= 12 ? 'red' : 'amber'}>
        {c.mesesParado} {c.mesesParado === 1 ? 'mês' : 'meses'}
      </Badge>
    ),
    chave: (c) => c.mesesParado,
    inicial: 'desc',
  },
  { id: 'mrr', rotulo: 'MRR que sumiu', celula: (c) => <Num>{c.mrrAnterior > 0 ? BRL(c.mrrAnterior) : '—'}</Num>, chave: (c) => c.mrrAnterior, inicial: 'desc', alinhar: 'direita' },
  { id: 'cad', rotulo: 'Cadastrados', celula: (c) => <Meta>{N(c.usuariosCadastrados)}</Meta>, chave: (c) => c.usuariosCadastrados, inicial: 'desc', alinhar: 'direita' },
  { id: 'painel', rotulo: '', celula: (c) => <NoPainel cnpj={c.cnpj} /> },
]

const COLUNAS_REAJUSTE: readonly Coluna<ContaSemReajuste>[] = [
  { id: 'nome', rotulo: 'Cliente', celula: (c) => <Nome id={c.accountId} nome={c.razaoSocial} />, chave: (c) => c.razaoSocial, inicial: 'asc' },
  { id: 'doc', rotulo: 'Documento', celula: (c) => <Meta>{DOC(c.documento)}</Meta>, chave: (c) => c.documento, inicial: 'asc' },
  { id: 'desde', rotulo: 'Contrato desde', celula: (c) => <Meta>{DIA(c.contratoDesde)}</Meta>, chave: (c) => c.contratoDesde ?? '' },
  { id: 'aniv', rotulo: 'Aniversários', celula: (c) => <Meta>{c.aniversarios}</Meta>, chave: (c) => c.aniversarios, inicial: 'desc', alinhar: 'direita' },
  { id: 'mrr', rotulo: 'MRR hoje', celula: (c) => <Num>{BRL(c.mrrMensal)}</Num>, chave: (c) => c.mrrMensal, inicial: 'desc', alinhar: 'direita' },
  {
    id: 'perda',
    rotulo: 'Deixa de entrar',
    celula: (c) => <span className="whitespace-nowrap tabular-nums font-semibold text-red">{BRL(c.perdaMensal)}</span>,
    chave: (c) => c.perdaMensal,
    inicial: 'desc',
    alinhar: 'direita',
  },
  { id: 'painel', rotulo: '', celula: (c) => <NoPainel cnpj={c.documento} /> },
]

const COLUNAS_COM_REAJUSTE: readonly Coluna<ContaComReajuste>[] = [
  { id: 'nome', rotulo: 'Cliente', celula: (c) => <Nome id={c.accountId} nome={c.razaoSocial} />, chave: (c) => c.razaoSocial, inicial: 'asc' },
  { id: 'doc', rotulo: 'Documento', celula: (c) => <Meta>{DOC(c.documento)}</Meta>, chave: (c) => c.documento, inicial: 'asc' },
  { id: 'antes', rotulo: 'MRR antes', celula: (c) => <Meta>{BRL(c.mrrAntes)}</Meta>, chave: (c) => c.mrrAntes, inicial: 'desc', alinhar: 'direita' },
  { id: 'depois', rotulo: 'MRR depois', celula: (c) => <Num>{BRL(c.mrrDepois)}</Num>, chave: (c) => c.mrrDepois, inicial: 'desc', alinhar: 'direita' },
  {
    id: 'inc',
    rotulo: 'Incremento',
    celula: (c) => <span className="whitespace-nowrap tabular-nums font-semibold text-green">+ {BRL(c.incremento)}</span>,
    chave: (c) => c.incremento,
    inicial: 'desc',
    alinhar: 'direita',
  },
  {
    id: 'pct',
    rotulo: 'Variação',
    celula: (c) => (
      <Badge tone={c.naTaxa ? 'green' : 'amber'}>
        {c.pct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
      </Badge>
    ),
    chave: (c) => c.pct,
    inicial: 'desc',
  },
  { id: 'painel', rotulo: '', celula: (c) => <NoPainel cnpj={c.documento} /> },
]

const COLUNAS_SEM_VINCULO: readonly Coluna<ContaSemVinculo>[] = [
  { id: 'nome', rotulo: 'Cliente', celula: (c) => <Nome id={c.accountId} nome={c.razaoSocial} doc={c.cnpj} />, chave: (c) => c.razaoSocial, inicial: 'asc' },
  { id: 'id', rotulo: 'ID', celula: (c) => <span className="font-mono text-meta text-ink-2">{c.brandId ?? '—'}</span>, chave: (c) => Number(c.brandId ?? 0), inicial: 'asc' },
  { id: 'hs', rotulo: 'HubSpot ID', celula: (c) => <span className="font-mono text-meta text-ink-2">{c.hubspotCompanyId ?? '—'}</span>, chave: (c) => c.hubspotCompanyId ?? '', inicial: 'asc' },
  { id: 'cad', rotulo: 'Cadastrados', celula: (c) => <Meta>{N(c.usuariosCadastrados)}</Meta>, chave: (c) => c.usuariosCadastrados, inicial: 'desc', alinhar: 'direita' },
  {
    id: 'afiliado',
    rotulo: 'Afiliado',
    celula: (c) =>
      c.afiliadoExibido ? (
        <Badge tone="indigo">{c.afiliadoExibido}</Badge>
      ) : (
        <span className="text-meta text-ink-4">próprio</span>
      ),
    // Agrupa por nome, e quem não tem afiliado vai para o fim: "próprio" é a
    // fila que precisa de ação, e ela merece ficar junta.
    chave: (c) => c.afiliado ?? 'zzzz',
    inicial: 'asc',
  },
  {
    id: 'cand',
    rotulo: 'Candidato no Omie',
    celula: (c) =>
      c.temCandidatoNoOmie ? (
        <Badge tone="green">mesmo CNPJ no Omie</Badge>
      ) : (
        <span className="text-meta text-ink-4">não existe lá</span>
      ),
    // Ordena o que FALTA LIGAR para cima: é a fila com ação clara.
    chave: (c) => (c.temCandidatoNoOmie ? 1 : 0),
    inicial: 'desc',
  },
  { id: 'painel', rotulo: '', celula: (c) => <NoPainel cnpj={c.cnpj} /> },
]

const COLUNAS_SEM_TAG: readonly Coluna<VinculoSemTag>[] = [
  { id: 'nome', rotulo: 'Cliente', celula: (c) => <Nome id={c.accountId} nome={c.razaoSocial} />, chave: (c) => c.razaoSocial, inicial: 'asc' },
  { id: 'doc', rotulo: 'Documento', celula: (c) => <Meta>{DOC(c.documento)}</Meta>, chave: (c) => c.documento, inicial: 'asc' },
  { id: 'cads', rotulo: 'Cadastros no Omie', celula: (c) => <Meta>{c.cadastros}</Meta>, chave: (c) => c.cadastros, inicial: 'desc', alinhar: 'direita' },
  {
    id: 'tags',
    rotulo: 'Tags que existem',
    celula: (c) => (
      <span className="flex flex-wrap gap-1">
        {c.tags.length === 0 ? (
          <span className="text-meta text-ink-4">nenhuma</span>
        ) : (
          c.tags.map((t) => (
            <Badge key={t} tone={t === 'Fornecedor' || t === 'Investidor' ? 'amber' : 'slate'}>
              {t}
            </Badge>
          ))
        )}
      </span>
    ),
    // Ordena pela tag que CONTRADIZ o vínculo, não em ordem alfabética: é ela
    // que muda a pergunta de "falta taguear" para "vínculo errado".
    chave: (c) => (c.tags.some((t) => t === 'Fornecedor' || t === 'Investidor') ? 1 : 0),
    inicial: 'desc',
  },
  { id: 'fat', rotulo: 'Faturado 12m', celula: (c) => <Num>{c.faturamento12m > 0 ? BRL(c.faturamento12m) : '—'}</Num>, chave: (c) => c.faturamento12m, inicial: 'desc', alinhar: 'direita' },
  { id: 'painel', rotulo: '', celula: (c) => <NoPainel cnpj={c.documento} /> },
]
