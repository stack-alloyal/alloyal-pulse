import {
  DIAS_CORRENTE,
  DIAS_MORTA,
  DIAS_UTEIS_PARA_APARECER,
  FAIXAS,
  ESTADOS_DO_PAINEL,
  type ClienteEmAtraso,
  type CobrancaEmContaCortada,
  type FaixaId,
  type FiltrosDaCarteira,
  type MesDaCarteira,
  type TituloEmAtraso,
  carteiraDeHoje,
  clientesEmAtraso,
  coorteDoAtraso,
  faturandoContaCortada,
  recuperacaoDeDozeMeses,
  resumoDaCarteira,
  rotuloDaFaixa,
  rotuloDoEstado,
  serieDaCarteira,
} from '@pulse/config'
import { Abas, Aviso, Badge, Busca, Card, Chip, Chips, Kpi, KpiGrade, type Tom } from '@pulse/ui'
import Link from 'next/link'

import { GraficoDaCoorte, GraficoDoAtraso, GraficoDoFluxo } from '../grafico-atraso'
import { TabelaOrdenavel, type Coluna } from '../revisao/tabela'
import { Corpo, Topo } from '../../casca'
import { pool } from '../../../../lib/db'
import { exigir, temEscopo } from '../../../../lib/guarda'

/**
 * Inadimplência: a carteira em atraso, o que volta, e o que já é perda.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A TELA ABRE NA FILA DE 62 NOMES, E NÃO NO NÚMERO DE DOIS MILHÕES.          │
 * │                                                                            │
 * │ Medido: dos R$ 2,1 milhões vencidos, R$ 1,5 milhão está em conta que o      │
 * │ painel já suspendeu ou desativou, e metade da carteira está vencida há mais │
 * │ de um ano. Um indicador que não responde a esforço deixa de ser lido — e o  │
 * │ total é exatamente esse indicador, porque o que o define é o passivo antigo.│
 * │                                                                            │
 * │ Então a aba que abre é a CORRENTE: até {DIAS_CORRENTE} dias e conta ativa.  │
 * │ A carteira inteira fica na aba ao lado, com o corte por estado de painel e  │
 * │ a faixa acima de um ano nomeada como cobrança morta. Uma tela com um número │
 * │ de dois milhões produz paralisia; uma com sessenta nomes produz ligação.    │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ NADA AQUI ESCREVE. Sem baixa de título, sem suspender conta, sem aviso ao  │
 * │ cliente. A régua de cobrança JÁ EXISTE — é o `suspended_by_overdue` do      │
 * │ painel Lecupon, com 520 contas — e esta tela LÊ o estado dela. Inventar uma │
 * │ segunda definição de inadimplência grave criaria a divergência que o        │
 * │ módulo `inadimplencia.ts` existe para evitar.                               │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

/**
 * Dinheiro com CENTAVOS, sempre. O documento manda, e há portão.
 *
 * Tentei um segundo formatador arredondado para os KPI, onde "R$ 2.273.802,16"
 * é largo. O portão recusou, e tem razão: a tela é de conciliação — quem lê está
 * conferindo contra o Omie, e um valor arredondado obriga a abrir outra tela para
 * descobrir se a diferença é do arredondamento ou dos dados.
 */
const BRL = (c: number | string) =>
  (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const N = (n: number) => n.toLocaleString('pt-BR')
const PCT = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const MES = (iso: string) => {
  const [a, m] = iso.split('-')
  return `${['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m)]}/${a?.slice(2)}`
}
const DIA = (iso: string) => iso.split('-').reverse().join('/')

/** O CNPJ com pontuação. Catorze dígitos vira 00.000.000/0000-00. */
const DOC = (d: string) =>
  d.length === 14
    ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
    : d.length === 11
      ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
      : d

/**
 * O selo do estado do painel.
 *
 * `suspended_by_overdue` é vermelho e `inactive` é âmbar de propósito: a primeira
 * é a régua de cobrança tendo cortado o cliente por este mesmo atraso — é a
 * consequência do que a tela está mostrando —, e a segunda é uma conta que saiu
 * por qualquer motivo. Pintar as duas igual apagaria a informação mais útil da
 * linha. Nenhum estado é verde: conta ativa com título vencido não é saúde.
 */
const TOM_DO_ESTADO: Record<string, Tom> = {
  active: 'indigo',
  suspended_by_overdue: 'red',
  suspended: 'amber',
  inactive: 'amber',
  sem_vinculo: 'slate',
}

const SeloDoPainel = ({ estado }: { estado: string | null }) => (
  <Badge tone={TOM_DO_ESTADO[estado ?? 'sem_vinculo'] ?? 'slate'}>
    {rotuloDoEstado(estado)}
  </Badge>
)

/**
 * A idade do atraso, com a faixa dita por extenso quando ela muda a leitura.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ AQUI HAVIA UM RÓTULO "em trânsito?" nos títulos de um e dois dias, e ele    │
 * │ era um remendo: eu estava usando a interface para avisar que a lista        │
 * │ continha quem tinha pagado em dia, em vez de tirar essas linhas da lista.   │
 * │                                                                            │
 * │ O conserto de verdade é a carência em dias úteis (`DIAS_UTEIS_PARA_APARECER`│
 * │ em `inadimplencia.ts`): o pagamento leva um dia útil para aparecer no Omie, │
 * │ então nada com menos de dois dias úteis entra na carteira. Com a causa      │
 * │ resolvida, o aviso deixa de ter o que avisar — e um aviso que sobra depois  │
 * │ do conserto ensina a desconfiar da lista inteira.                          │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * O que ficou é o rótulo da faixa morta: um título de 800 dias é outra conversa,
 * e o número sozinho obriga quem lê a fazer essa conta de cabeça em cada linha.
 */
const Idade = ({ dias }: { dias: number }) => (
  <span className="whitespace-nowrap tabular-nums">
    <span className={dias > DIAS_MORTA ? 'text-ink-3' : 'text-ink'}>{N(dias)} d</span>
    {dias > DIAS_MORTA && <span className="ml-1.5 text-nota text-ink-3">morta</span>}
  </span>
)

const Nome = ({
  nome,
  doc,
  id,
}: {
  nome: string | null
  doc: string
  id: string | null
}) => {
  const texto = (
    <>
      <span className="block truncate font-medium text-ink">{nome ?? DOC(doc)}</span>
      <span className="block text-nota tabular-nums text-ink-3">{DOC(doc)}</span>
    </>
  )
  return (
    <span className="block min-w-0 max-w-[24ch] lg:max-w-[34ch]">
      {id ? (
        <Link
          href={`/carteira/base/${id}`}
          className="block hover:underline hover:[&>span]:text-purple-700"
        >
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

/* ─── As quatro abas ───────────────────────────────────────────────────────── */

const ABAS = ['corrente', 'carteira', 'clientes', 'evolucao'] as const
type Chave = (typeof ABAS)[number]

const COLUNAS_TITULOS: readonly Coluna<TituloEmAtraso>[] = [
  {
    id: 'cliente',
    rotulo: 'Cliente',
    celula: (t) => <Nome nome={t.razaoSocial} doc={t.documento} id={t.accountId} />,
    chave: (t) => t.razaoSocial ?? t.documento,
    inicial: 'asc',
  },
  {
    id: 'valor',
    rotulo: 'Em aberto',
    /* ┌───────────────────────────────────────────────────────────────────────┐
       │ O VALOR CHEIO APARECE quando houve baixa parcial, e não é enfeite: sem │
       │ ele, um título de R$ 45.000 com R$ 33.750 pagos mostra "R$ 11.250" e   │
       │ quem confere contra o Omie acha que a tela errou. O INTERPROMO é       │
       │ exatamente esse caso, e é o segundo nome da fila.                      │
       └───────────────────────────────────────────────────────────────────────┘ */
    celula: (t) => (
      <span className="block whitespace-nowrap">
        <Num>{BRL(t.valorCentavos)}</Num>
        {Number(t.pagoCentavos) > 0 && (
          <span className="block text-nota tabular-nums text-ink-3">
            de {BRL(t.valorDoTituloCentavos)} · pagou {BRL(t.pagoCentavos)}
          </span>
        )}
      </span>
    ),
    chave: (t) => Number(t.valorCentavos),
    inicial: 'desc',
    alinhar: 'direita',
  },
  {
    id: 'venc',
    rotulo: 'Venceu',
    celula: (t) => <Num>{DIA(t.vencimento)}</Num>,
    chave: (t) => t.vencimento,
    inicial: 'asc',
    alinhar: 'direita',
  },
  {
    id: 'dias',
    rotulo: 'Atraso',
    celula: (t) => <Idade dias={t.diasAtraso} />,
    chave: (t) => t.diasAtraso,
    inicial: 'desc',
    alinhar: 'direita',
  },
  {
    id: 'faixa',
    rotulo: 'Faixa',
    celula: (t) => <span className="whitespace-nowrap text-ink-2">{rotuloDaFaixa(t.faixa)}</span>,
    chave: (t) => t.diasAtraso,
  },
  {
    id: 'painel',
    rotulo: 'No painel',
    celula: (t) => <SeloDoPainel estado={t.statusPainel} />,
    chave: (t) => rotuloDoEstado(t.statusPainel),
    inicial: 'asc',
  },
]

const COLUNAS_CLIENTES: readonly Coluna<ClienteEmAtraso>[] = [
  {
    id: 'cliente',
    rotulo: 'Cliente',
    celula: (c) => <Nome nome={c.razaoSocial} doc={c.documento} id={c.accountId} />,
    chave: (c) => c.razaoSocial ?? c.documento,
    inicial: 'asc',
  },
  {
    id: 'valor',
    rotulo: 'Total em atraso',
    celula: (c) => (
      <span className="block whitespace-nowrap">
        <Num>{BRL(c.valorCentavos)}</Num>
        {Number(c.pagoCentavos) > 0 && (
          <span className="block text-nota tabular-nums text-ink-3">
            já pagou {BRL(c.pagoCentavos)} em parte
          </span>
        )}
      </span>
    ),
    chave: (c) => Number(c.valorCentavos),
    inicial: 'desc',
    alinhar: 'direita',
  },
  {
    id: 'corrente',
    rotulo: `Até ${DIAS_CORRENTE} d`,
    celula: (c) =>
      Number(c.correnteCentavos) > 0 ? (
        <Num>{BRL(c.correnteCentavos)}</Num>
      ) : (
        <span className="text-ink-4">—</span>
      ),
    chave: (c) => Number(c.correnteCentavos),
    inicial: 'desc',
    alinhar: 'direita',
  },
  {
    id: 'titulos',
    rotulo: 'Títulos',
    celula: (c) => <Num>{N(c.titulos)}</Num>,
    chave: (c) => c.titulos,
    inicial: 'desc',
    alinhar: 'direita',
  },
  {
    id: 'dias',
    rotulo: 'Atraso maior',
    celula: (c) => <Idade dias={c.diasMax} />,
    chave: (c) => c.diasMax,
    inicial: 'desc',
    alinhar: 'direita',
  },
  {
    id: 'painel',
    rotulo: 'No painel',
    celula: (c) => <SeloDoPainel estado={c.statusPainel} />,
    chave: (c) => rotuloDoEstado(c.statusPainel),
    inicial: 'asc',
  },
]

/** Quantos títulos a lista mostra antes de pedir um filtro. */
const TETO = 400

export default async function Inadimplencia({
  searchParams,
}: {
  searchParams: Promise<{
    aba?: string
    ord?: string
    dir?: string
    faixa?: string
    estado?: string
    cli?: string
    q?: string
  }>
}) {
  /* ┌──────────────────────────────────────────────────────────────────────┐
     │ A PERMISSÃO É DE RECEITA, não de contas — e a primeira versão errou isso. │
     │                                                                          │
     │ Eu copiei `temEscopo(p.contas)` da revisão de faturamento. O efeito, medido│
     │ no pen test: CINCO papéis com `receita: 'nenhum'` abriam a carteira em     │
     │ atraso inteira — `pulse-csm`, `pulse-implantacao`, `pulse-juridico`,       │
     │ `pulse-marketing` e `pulse-produto`. Marketing e Produto existem no        │
     │ sistema para conferir uso de marca em contrato; não têm por que ver quanto │
     │ cada cliente deve.                                                        │
     │                                                                          │
     │ O padrão da casa já estava em `renovacoes` e `saidas`, que escondem valor  │
     │ com exatamente esta expressão, e a cascata em `/receita` é ainda mais      │
     │ estrita (`receita === 'base'`). A tela solta era esta.                     │
     │                                                                          │
     │ CONSEQUÊNCIA A CONFERIR: o CSM deixa de entrar. Se quem liga para o        │
     │ cliente é ele, o conserto NÃO é afrouxar aqui — é dar `receita: 'carteira'`│
     │ ao `pulse-csm` em `papeis.ts`, que é decisão de papel e não de tela.        │
     └──────────────────────────────────────────────────────────────────────┘ */
  await exigir((p) => temEscopo(p.receita) || p.configurar, 'inadimplência')
  const q = await searchParams
  const aba: Chave = ABAS.find((a) => a === q.aba) ?? 'corrente'
  const dir: 'asc' | 'desc' = q.dir === 'asc' ? 'asc' : 'desc'

  // `cli` liga o recorte de cliente do Omie. Fora por padrão: inadimplência é
  // número financeiro, e a carteira precisa amarrar com o Omie — o delta medido
  // é de R$ 1.258 em R$ 2,2 milhões, e quem quiser o recorte tem o chip.
  const apenasClientes = q.cli === '1'
  const faixa: FaixaId | '' = FAIXAS.some((f) => f.id === q.faixa) ? (q.faixa as FaixaId) : ''
  const estado: string = ESTADOS_DO_PAINEL.some((e) => e.id === q.estado) ? (q.estado ?? '') : ''
  const busca = q.q?.trim() ?? ''

  const db = pool()

  // A aba CORRENTE tem filtro próprio e fixo — é a definição dela, não uma
  // escolha da pessoa: até 90 dias E conta ativa. Deixar os chips agirem aqui
  // faria a aba deixar de ser o que o nome promete.
  /* ┌──────────────────────────────────────────────────────────────────────┐
     │ NA FILA, O RECORTE É DA CONTA E NÃO DO TÍTULO — e a diferença apareceu  │
     │ só na tela: filtrando por faixa ANTES de agrupar, as colunas "total em  │
     │ atraso" e "até 90 dias" davam o mesmo valor em todas as 97 linhas, e a  │
     │ segunda coluna não dizia nada.                                          │
     │                                                                         │
     │ O que interessa saber ao ligar é a dívida INTEIRA do cliente e quanto    │
     │ dela é recente: SWILE deve R$ 59 mil, tudo de 1 dia; a SAÚDE TOTAL deve  │
     │ o dobro, com metade vencida há mais de um ano. São conversas diferentes. │
     │                                                                         │
     │ Então filtra-se por conta ATIVA no banco, e a linha sem nada recente sai │
     │ aqui — é o que mantém a fila sendo a fila.                               │
     └──────────────────────────────────────────────────────────────────────┘ */
  const recorte: FiltrosDaCarteira =
    aba === 'corrente'
      ? { estado: 'active', apenasClientes, busca }
      : { faixa, ...(estado ? { estado } : {}), apenasClientes, busca }

  const [resumo, titulos, clientes, serie, recuperacao, coorte, cortadas] = await Promise.all([
    resumoDaCarteira(db, apenasClientes),
    aba === 'carteira'
      ? carteiraDeHoje(db, recorte, TETO)
      : Promise.resolve([] as TituloEmAtraso[]),
    aba === 'corrente' || aba === 'clientes'
      ? clientesEmAtraso(db, recorte)
      : Promise.resolve([] as ClienteEmAtraso[]),
    aba === 'evolucao' ? serieDaCarteira(db, 24) : Promise.resolve([] as MesDaCarteira[]),
    recuperacaoDeDozeMeses(db),
    // 24 e não 18: a cascata em /receita mostra a MESMA coorte com janela de 24, e
    // a média das maduras aparece nas duas telas. Com janelas diferentes ela dava
    // 84,8% aqui e 85,3% lá — o mesmo indicador com dois valores, que é o defeito
    // que dá mais trabalho para explicar depois.
    aba === 'evolucao' ? coorteDoAtraso(db, 24) : Promise.resolve([]),
    aba === 'corrente' ? faturandoContaCortada(db) : Promise.resolve([] as CobrancaEmContaCortada[]),
  ])

  /* A URL carrega aba, ordenação e os três filtros. Um construtor só, pelo mesmo
     motivo da base de clientes: uma segunda montagem esquece um filtro, e o
     sintoma é a pessoa clicar num cabeçalho e o recorte dela desaparecer. */
  const link = (
    a: Chave,
    m: { ord?: string; dir?: 'asc' | 'desc'; faixa?: string; estado?: string; cli?: string; q?: string } = {},
  ) => {
    const p = new URLSearchParams({ aba: a })
    const f = m.faixa ?? faixa
    const e = m.estado ?? estado
    const c = m.cli ?? (apenasClientes ? '1' : '')
    const b = m.q ?? busca
    if (f) p.set('faixa', f)
    if (e) p.set('estado', e)
    if (c === '1') p.set('cli', '1')
    if (b) p.set('q', b)
    if (m.ord) {
      p.set('ord', m.ord)
      p.set('dir', m.dir ?? 'desc')
    }
    return `/receita/inadimplencia?${p.toString()}`
  }
  const hrefDaColuna = (a: Chave) => (ord: string, d: 'asc' | 'desc') => link(a, { ord, dir: d })

  // A fila só tem quem tem dívida RECENTE. Um cliente ativo devendo só de 2024
  // não é ligação desta semana — é o passivo antigo, que tem a aba dele.
  const fila = aba === 'corrente' ? clientes.filter((c) => Number(c.correnteCentavos) > 0) : clientes
  const naFila = fila.length
  const perdaEstrutural = coorte.filter((c) => c.madura)
  const mediaMadura =
    perdaEstrutural.length > 0
      ? perdaEstrutural.reduce((s, c) => s + c.pagoPct, 0) / perdaEstrutural.length
      : null

  return (
    <>
      <Topo
        href="/receita/inadimplencia"
        titulo="Inadimplência"
        proposito="quem está em atraso, e quanto volta"
        acoes={
          <span className="text-ink-3">
            DSO{' '}
            <strong className="font-semibold text-ink">
              {resumo.dsoDias === null
                ? '—'
                : resumo.dsoDias.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
            </strong>{' '}
            dias
          </span>
        }
      />
      <Corpo className="grid gap-5">
        <KpiGrade colunas={4}>
          <Kpi
            rotulo={`Corrente · até ${DIAS_CORRENTE} dias, conta ativa`}
            valor={BRL(resumo.correnteCentavos)}
            nota={`${N(resumo.correnteClientes)} clientes — a fila que responde a trabalho`}
            tom="red"
          />
          <Kpi
            rotulo="Carteira em atraso"
            valor={BRL(resumo.totalCentavos)}
            nota={`${N(resumo.titulos)} títulos de ${N(resumo.clientes)} clientes`}
          />
          <Kpi
            rotulo={`Cobrança morta · mais de ${DIAS_MORTA} dias`}
            valor={BRL(resumo.mortaCentavos)}
            nota={`${N(resumo.mortaTitulos)} títulos que não se movem`}
            tom="amber"
          />
          <Kpi
            rotulo="Do que entra em atraso, quanto volta"
            valor={recuperacao.taxaRecuperacaoPct === null ? '—' : PCT(recuperacao.taxaRecuperacaoPct)}
            nota={
              recuperacao.mesesFechados > 0
                ? `${BRL(recuperacao.recuperado12mCentavos)} de ${BRL(recuperacao.entrou12mCentavos)} em ${recuperacao.mesesFechados} meses`
                : 'sem mês fechado ainda'
            }
            tom={
              recuperacao.taxaRecuperacaoPct !== null && recuperacao.taxaRecuperacaoPct < 100
                ? 'red'
                : 'green'
            }
          />
        </KpiGrade>

        <Abas
          abas={[
            /* A contagem vem do RESUMO e não da lista: a lista só é buscada na
               aba aberta, então usá-la aqui fazia a aba Corrente exibir 0
               enquanto a pessoa estava na Evolução — um número errado no lugar
               mais visível da tela, e errado justamente para baixo. */
            { chave: 'corrente', rotulo: 'Corrente', conta: resumo.correnteClientes },
            { chave: 'carteira', rotulo: 'Carteira total', conta: resumo.titulos },
            { chave: 'clientes', rotulo: 'Por cliente', conta: resumo.clientes },
            { chave: 'evolucao', rotulo: 'Evolução', conta: serie.length || undefined },
          ]}
          atual={aba}
          href={(k) => link(k as Chave)}
          iguais
        />

        {/* O recorte de cliente vale em todas as abas: é o mesmo universo sendo
            olhado, e perdê-lo ao trocar de aba obrigaria a refazer a escolha. */}
        <div className="flex flex-wrap items-center gap-3">
          <Chips rotulo="universo:">
            <Chip rotulo="tudo do Omie" href={link(aba, { cli: '' })} ativo={!apenasClientes} fixo />
            <Chip rotulo="só cliente" href={link(aba, { cli: '1' })} ativo={apenasClientes} fixo />
          </Chips>
          {(aba === 'carteira' || aba === 'clientes') && (
            <>
              <Chips rotulo="faixa:">
                <Chip rotulo="todas" href={link(aba, { faixa: '' })} ativo={!faixa} fixo />
                {resumo.porFaixa.map((f) => (
                  <Chip
                    key={f.faixa}
                    rotulo={rotuloDaFaixa(f.faixa)}
                    href={link(aba, { faixa: f.faixa })}
                    ativo={faixa === f.faixa}
                    conta={f.titulos}
                  />
                ))}
              </Chips>
              <Chips rotulo="no painel:">
                <Chip rotulo="qualquer" href={link(aba, { estado: '' })} ativo={!estado} fixo />
                {resumo.porEstado.map((e) => (
                  <Chip
                    key={e.estado}
                    rotulo={rotuloDoEstado(e.estado)}
                    href={link(aba, { estado: e.estado })}
                    ativo={estado === e.estado}
                    conta={e.cnpjs}
                  />
                ))}
              </Chips>
            </>
          )}
          {aba !== 'evolucao' && (
            <Busca
              nome="q"
              valor={busca}
              placeholder="razão social ou CNPJ"
              action="/receita/inadimplencia"
              ocultos={{
                aba,
                ...(faixa ? { faixa } : {}),
                ...(estado ? { estado } : {}),
                ...(apenasClientes ? { cli: '1' } : {}),
              }}
              {...(busca ? { hrefLimpar: link(aba, { q: '' }) } : {})}
            />
          )}
        </div>

        {aba === 'corrente' && (
          <>
            <Card title={`A fila da semana · ${N(naFila)} clientes`}>
              <TabelaOrdenavel<ClienteEmAtraso>
                dados={fila}
                ord={q.ord ?? 'corrente'}
                dir={dir}
                href={hrefDaColuna('corrente')}
                chaveDaLinha={(c) => c.documento}
                vazio="Nenhum cliente ativo com atraso de até 90 dias."
                colunas={COLUNAS_CLIENTES}
              />
              <p className="mt-3 text-meta leading-relaxed text-ink-3">
                Até <strong className="font-semibold text-ink">{DIAS_CORRENTE} dias</strong> de
                atraso E conta <strong className="font-semibold text-ink">ativa</strong> no painel —
                as duas condições. O atraso só começa a contar depois de{' '}
                <strong className="font-semibold text-ink">
                  {DIAS_UTEIS_PARA_APARECER + 1} dias úteis
                </strong>{' '}
                do vencimento: o pagamento leva um dia útil para aparecer no Omie, e o segundo dia é
                o que permite concluir que ele não apareceu. Sem essa carência, quem pagava em dia
                entrava na fila — e entrava no topo. Só a idade também não serve:{' '}
                {BRL(
                  resumo.porEstado
                    .filter((e) => e.estado !== 'active')
                    .reduce((s, e) => s + Number(e.recenteCentavos), 0),
                )}{' '}
                dos títulos recentes estão em conta já suspensa ou inativa, e mandar isso para a
                fila de ligação é gastar a semana de alguém com quem já foi embora.
              </p>
            </Card>

            {cortadas.length > 0 && (
              <Card title={`Suspensas por atraso e ainda recebendo título · ${N(cortadas.length)}`}>
                <Aviso tom="erro">
                  O painel cortou estas contas por atraso e o faturamento continuou. É vazamento dos
                  dois lados: ninguém vai pagar, e o valor está inflando o faturamento emitido.
                </Aviso>
                <ul className="mt-3 grid gap-2">
                  {cortadas.map((c) => (
                    <li
                      key={c.accountId}
                      className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2 last:border-0"
                    >
                      <Nome nome={c.razaoSocial} doc={c.documento} id={c.accountId} />
                      <span className="text-cartao tabular-nums text-ink-2">
                        {N(c.titulos)} título{c.titulos > 1 ? 's' : ''} ·{' '}
                        <strong className="font-semibold text-ink">{BRL(c.valorCentavos)}</strong> ·
                        último em {DIA(c.ultimoVencimento)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}

        {aba === 'carteira' && (
          <Card
            title={`Carteira em atraso · ${N(resumo.titulos)} títulos`}
            actions={<Badge>{BRL(resumo.totalCentavos)}</Badge>}
          >
            <TabelaOrdenavel<TituloEmAtraso>
              dados={titulos}
              ord={q.ord ?? 'valor'}
              dir={dir}
              href={hrefDaColuna('carteira')}
              chaveDaLinha={(t) => t.codigoTitulo}
              vazio="Nenhum título vencido neste recorte."
              colunas={COLUNAS_TITULOS}
            />
            {titulos.length >= TETO && (
              <Aviso tom="alerta">
                A lista mostra os {N(TETO)} maiores deste recorte. Os KPI acima e os chips contam a
                carteira inteira — use a faixa, o estado ou a busca para chegar ao caso.
              </Aviso>
            )}
          </Card>
        )}

        {aba === 'clientes' && (
          <Card title={`Por cliente · ${N(clientes.length)}`}>
            <TabelaOrdenavel<ClienteEmAtraso>
              dados={clientes}
              ord={q.ord ?? 'valor'}
              dir={dir}
              href={hrefDaColuna('clientes')}
              chaveDaLinha={(c) => c.documento}
              vazio="Nenhum cliente com título vencido neste recorte."
              colunas={COLUNAS_CLIENTES}
            />
          </Card>
        )}

        {aba === 'evolucao' && (
          <Evolucao serie={serie} coorte={coorte} mediaMadura={mediaMadura} />
        )}
      </Corpo>
    </>
  )
}

/* ─── Evolução: o gráfico, o fechamento e a coorte ─────────────────────────── */

/**
 * A aba que responde "está melhorando?".
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ TRÊS BLOCOS, e cada um responde uma pergunta que os outros dois não.        │
 * │                                                                            │
 * │ 1. O SALDO mês a mês — a carteira está crescendo ou encolhendo.             │
 * │ 2. O MOVIMENTO — entrou contra recuperado. É onde se vê que a carteira      │
 * │    cresce porque entra mais do que volta, e não porque ninguém paga.        │
 * │ 3. A COORTE — do que venceu num mês, quanto voltou algum dia. É a única     │
 * │    que separa ATRASO de PERDA, e vem das datas e não das fotos: o destino   │
 * │    de um vencimento continua mudando depois de a foto ser tirada.           │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * A FRONTEIRA `reconstruido` / `apurado` aparece no gráfico de propósito. Antes
 * dela o número é o melhor que as datas permitem — sem estado de painel, e sem
 * saber em que mês um título foi cancelado. Esconder isso seria mentir com
 * precisão de centavo.
 */
function Evolucao({
  serie,
  coorte,
  mediaMadura,
}: {
  serie: readonly MesDaCarteira[]
  coorte: readonly { mes: string; titulos: number; valorCentavos: string; pagoPct: number; madura: boolean }[]
  mediaMadura: number | null
}) {
  if (serie.length === 0) {
    return (
      <Card title="Evolução">
        <Aviso tom="alerta">
          Nenhuma competência apurada ainda. O ciclo C21 roda às 05h00 e preenche todas as
          competências fechadas que não têm foto — inclusive as de trás, na primeira execução.
        </Aviso>
      </Card>
    )
  }

  const primeiroApurado = serie.findIndex((m) => m.origem === 'apurado')
  const ultimo = serie[serie.length - 1]
  const primeiro = serie[0]
  const cresceu = ultimo && primeiro ? Number(ultimo.saldoFinalCentavos) - Number(primeiro.saldoFinalCentavos) : 0

  return (
    <>
      <Card
        title={`Saldo em atraso no dia 1º · ${serie.length} meses`}
        actions={
          <span className="text-nota text-ink-3">
            {cresceu >= 0 ? 'cresceu' : 'caiu'} {BRL(Math.abs(cresceu))} no período
          </span>
        }
      >
        {/* O gráfico mora em `../grafico-atraso`, e a cascata usa o mesmo. Aqui a
            barra é nomeada pela competência da FOTO — que é o eixo desta tela. */}
        <GraficoDoAtraso
          serie={serie}
          rotulo={(m) => MES(m.competencia)}
          diasCorrente={DIAS_CORRENTE}
        />
        <p className="mt-3 text-meta leading-relaxed text-ink-3">
          A barra inteira é a carteira; a parte escura é o que tem até{' '}
          <strong className="font-semibold text-ink">{DIAS_CORRENTE} dias</strong>.{' '}
          {primeiroApurado === -1 ? (
            <>
              Todas estas fotos são <strong className="font-semibold text-ink">reconstruídas</strong>{' '}
              das datas de vencimento e pagamento: elas dão o saldo certo, mas não o estado do painel
              de então nem o mês em que um título foi cancelado. A partir da primeira execução do
              ciclo C21 as fotos passam a ser apuradas.
            </>
          ) : (
            <>
              As fotos até <strong className="font-semibold text-ink">
                {MES(serie[Math.max(primeiroApurado - 1, 0)]?.competencia ?? '')}
              </strong>{' '}
              são reconstruídas das datas; de{' '}
              <strong className="font-semibold text-ink">
                {MES(serie[primeiroApurado]?.competencia ?? '')}
              </strong>{' '}
              em diante são apuradas no dia — e só essas guardam o estado do painel de cada conta
              naquele momento.
            </>
          )}
        </p>
      </Card>

      <Card title="Entrou em atraso contra recuperado">
        {/* Mesmo componente compartilhado com a cascata. Aqui a barra é nomeada
            pela competência da FOTO, que é o eixo desta tela. */}
        <GraficoDoFluxo serie={serie} rotulo={(m) => MES(m.competencia)} />
        <p className="mt-3 text-meta leading-relaxed text-ink-3">
          Vermelho é o que <strong className="font-semibold text-ink">entrou</strong> em atraso no
          mês; roxo é o que foi <strong className="font-semibold text-ink">recuperado</strong>. Enquanto
          o vermelho for maior, a carteira cresce — e é isso, e não a falta de pagamento, que explica
          o saldo do gráfico de cima.
        </p>
      </Card>

      <Card title="O fechamento, mês a mês">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-cartao">
            <thead>
              <tr className="border-b border-line text-left text-tabela uppercase tracking-[0.08em] text-ink-3">
                <th className="px-3 py-2 font-semibold">Competência</th>
                <th className="px-3 py-2 text-right font-semibold">Saldo inicial</th>
                <th className="px-3 py-2 text-right font-semibold">+ entrou</th>
                <th className="px-3 py-2 text-right font-semibold">− recuperado</th>
                <th className="px-3 py-2 text-right font-semibold">− baixado</th>
                <th className="px-3 py-2 text-right font-semibold">± ajuste</th>
                <th className="px-3 py-2 text-right font-semibold">= saldo final</th>
                <th className="px-3 py-2 text-right font-semibold">Títulos</th>
                <th className="px-3 py-2 font-semibold">Foto</th>
              </tr>
            </thead>
            <tbody>
              {[...serie].reverse().map((m) => (
                <tr key={m.competencia} className="border-b border-line last:border-0 hover:bg-surface-2">
                  <td className="px-3 py-2.5 font-medium text-ink">{MES(m.competencia)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{BRL(m.saldoInicialCentavos)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">{BRL(m.entrouCentavos)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">{BRL(m.recuperadoCentavos)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">
                    {Number(m.canceladoCentavos) === 0 ? (
                      <span className="text-ink-4">—</span>
                    ) : (
                      BRL(m.canceladoCentavos)
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">
                    {Number(m.ajusteCentavos) === 0 ? (
                      <span className="text-ink-4">—</span>
                    ) : (
                      BRL(m.ajusteCentavos)
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-ink">{BRL(m.saldoFinalCentavos)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{N(m.titulosFinal)}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={m.origem === 'apurado' ? 'indigo' : 'slate'}>
                      {m.origem === 'apurado' ? 'apurada' : 'reconstruída'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-meta leading-relaxed text-ink-3">
          Saldo inicial + entrou − recuperado − baixado + ajuste ={' '}
          <strong className="font-semibold text-ink">saldo final</strong>, em toda linha. A
          identidade é <strong className="font-semibold text-ink">restrição do banco</strong> e não
          cuidado de quem escreve a consulta: um mês que não feche não chega a ser gravado.{' '}
          <strong className="font-semibold text-ink">Baixado</strong> é o que saiu sem pagamento —
          cancelado, prorrogado ou ausente da base —, e fica em branco nas competências
          reconstruídas porque o Omie não guarda data de cancelamento.{' '}
          <strong className="font-semibold text-ink">Ajuste</strong> é mudança de valor de título
          que <em>continuou</em> na carteira: quase todo ele é baixa parcial, o cliente pagando um
          pedaço e o resto seguindo devido. Não entra em recuperado, que é só o título quitado.
        </p>
      </Card>

      {coorte.length > 0 && (
        <Card
          title="Do que venceu em cada mês, quanto voltou"
          actions={
            mediaMadura === null ? undefined : (
              <Badge tone="indigo">coortes maduras: {PCT(mediaMadura)}</Badge>
            )
          }
        >
          {/* Mesmo componente da cascata. Aqui não há mês escolhido, então sem anel. */}
          <GraficoDaCoorte coorte={coorte} rotulo={(c) => MES(c.mes)} />
          <p className="mt-3 text-meta leading-relaxed text-ink-3">
            É a curva de <strong className="font-semibold text-ink">vintage</strong> do crédito ao
            consumo, aplicada aqui: de tudo que venceu naquele mês e não foi pago no prazo, qual
            percentual do valor já voltou. As barras claras são coortes novas — a taxa baixa ali só
            diz que ainda não deu tempo.{' '}
            {mediaMadura !== null && (
              <>
                Nas maduras a média é <strong className="font-semibold text-ink">{PCT(mediaMadura)}</strong>,
                o que põe a perda estrutural em torno de{' '}
                <strong className="font-semibold text-ink">{PCT(100 - mediaMadura)}</strong> do que
                entra em atraso — e é essa a diferença entre atraso e perda.
              </>
            )}
          </p>
        </Card>
      )}
    </>
  )
}
