import {
  MESES_DE_MATURIDADE,
  churnObservado,
  funilDeSaida,
  coorteDeSaida,
  metaVersusRealizado,
  resumoChurn,
  saidasSemRegistro,
} from '@pulse/success'
import { Abas, Aviso, Kpi, KpiGrade } from '@pulse/ui'

import { Coorte, Funil, Meta, Reconciliacao } from './visoes'
import Link from 'next/link'
import { Corpo, Topo } from '../casca'
import { pool } from '../../../lib/db'
import { exigir, temEscopo } from '../../../lib/guarda'

export const dynamic = 'force-dynamic'

/** Centavos em reais, ou travessão. Os KPIs desta tela são os únicos que o usam
 *  aqui — o resto do formato mora em `cancelamento/andamento.tsx`. */
const REAIS = (c: string | null) =>
  c === null
    ? '—'
    : (Number(c) / 100).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
      })

/**
 * Saídas — o churn real, com as quatro datas visíveis.
 *
 * A tela existe porque churn de contas e churn de receita não fecham no mesmo
 * mês, e a diferença entre os dois é dinheiro que ainda está entrando de um
 * cliente que já foi perdido. Um número só esconde isso nas duas direções.
 *
 * O que é AÇÃO aqui é a janela de retenção: enquanto ela está aberta a saída
 * ainda pode ser revertida, e é a única parte da tela em que o tempo corre
 * contra. O resto é registro.
 */

/**
 * Só ANÁLISE. Quadro, cadastro e a lista de andamento foram para
 * `/cancelamento` em 10/09/2026 — ver o cabeçalho de lá para por que a divisão
 * tem conteúdo e não é só organização.
 *
 * `funil` é a primeira porque é a única que tem dado hoje: o pipeline depende de
 * alguém registrar, e `success.cancellation` está em zero linha.
 */
const ABAS = ['funil', 'coorte', 'meta', 'reconciliacao'] as const
type Aba = (typeof ABAS)[number]

export default async function Saidas({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; erro?: string; competencia?: string; aba?: string }>
}) {
  const id = await exigir((p) => temEscopo(p.contas), 'saídas e churn')
  const q = await searchParams
  const aba: Aba = ABAS.find((a) => a === q.aba) ?? 'funil'

  const hoje = new Date().toISOString().slice(0, 10)
  const comp = q.competencia ? `${q.competencia}-01` : `${hoje.slice(0, 7)}-01`
  const veReceita = id.permissoes.receita !== 'nenhum' || id.permissoes.configurar
  const [resumo, coorte, metas, observado, semRegistro, funil] = await Promise.all([
    // O resumo lê a base inteira: é número de receita, e receita não tem
    // carteira. Quem não pode ver receita não chega a esta linha.
    veReceita ? resumoChurn(pool(), comp) : null,
    // Coorte e meta são número de RECEITA, como o resumo: quem não vê receita
    // não carrega nem a consulta. A aba também não aparece.
    veReceita ? coorteDeSaida(pool(), 12) : Promise.resolve([]),
    veReceita
      ? metaVersusRealizado(pool(), `${hoje.slice(0, 4)}-01`, hoje.slice(0, 7))
      : Promise.resolve([]),
    /* Só na aba da reconciliação, pelo mesmo motivo do select de contas: a lista
       de sem-registro tem 794 linhas em produção, e varrer o ledger inteiro para
       quem abriu o funil é consulta que ninguém lê. */
    veReceita && aba === 'reconciliacao'
      ? churnObservado(pool(), 15)
      : Promise.resolve([]),
    veReceita && aba === 'reconciliacao'
      ? saidasSemRegistro(pool(), id)
      : Promise.resolve([]),
    /* O funil varre faturamento, inadimplência e contração das 398 contas ativas:
       260ms medido, e não vale pagar isso em aba que não o mostra. */
    aba === 'funil' ? funilDeSaida(pool(), id) : Promise.resolve([]),
  ])

  const link = (a: Aba) =>
    `/saidas?aba=${a}${q.competencia ? `&competencia=${q.competencia}` : ''}`

  return (
    <>
      <Topo href="/saidas" />
      <Corpo className="grid gap-5">
        {q.erro && <Aviso tom="erro" papel="alert">{q.erro}</Aviso>}
        {q.ok && <Aviso tom="ok" papel="status">{q.ok}</Aviso>}

        {resumo && (
          <>
            {/* Os dois churns lado a lado. Ver juntos é o ponto: o mês em que as
                contas saem quase nunca é o mês em que a receita sai. */}
            <KpiGrade>
              <Kpi
                rotulo={`Churn de contas · ${resumo.competencia}`}
                valor={resumo.contasQueLevantaram}
                nota={
                  <>
                    {REAIS(resumo.mrrQueLevantouCentavos)} levantaram a mão
                    {resumo.retidasDepois > 0 && ` · ${resumo.retidasDepois} revertida(s) depois`}
                  </>
                }
              />
              <Kpi
                rotulo={`Churn de receita · ${resumo.competencia}`}
                valor={REAIS(resumo.mrrRealizadoCentavos)}
                /* DIZIA "saíram do faturamento", e lia `success.cancellation` —
                   a tabela do fluxo, alimentada à mão. A promessa era falsa desde
                   28/08, quando as visões deixaram de ler o ledger, e foi ela que
                   fez a tela parecer defeituosa em vez de vazia. O número do
                   FATURAMENTO tem aba própria agora, com nome próprio. */
                nota={`${resumo.contasComEfeito} conta(s) saíram pelo fluxo`}
              />
              <Kpi
                rotulo="Saída comprometida"
                valor={REAIS(resumo.mrrComprometidoCentavos)}
                /* O número que responde "quanto do faturamento de hoje já está
                   perdido" — receita que ainda entra de cliente já perdido. */
                nota={`${resumo.contasComprometidas} conta(s) já perdidas ainda faturando`}
                {...(Number(resumo.mrrComprometidoCentavos) > 0 ? { tom: 'amber' as const } : {})}
              />
              <Kpi
                rotulo="Retido no mês"
                valor={REAIS(resumo.mrrRetidoCentavos)}
                nota={`${resumo.retidasNaCompetencia} saída(s) revertida(s)`}
                {...(resumo.retidasNaCompetencia > 0 ? { tom: 'green' as const } : {})}
              />
            </KpiGrade>
            <p className="max-w-[80ch] text-corpo leading-relaxed text-ink-2">
              Contas e receita não fecham no mesmo mês, e a diferença é de propósito: um cliente
              que levanta a mão hoje entra no churn de contas hoje, mas continua faturando durante
              todo o aviso prévio. Reconhecer a perda no dia do anúncio subestima o trimestre;
              contar o cliente como ativo até a última fatura esconde uma perda que já aconteceu —
              e que ainda dava para reverter.
            </p>
          </>
        )}

        {/* ┌───────────────────────────────────────────────────────────────────┐
            │ AS ABAS VÊM DEPOIS DOS KPI, e os KPI ficam em todas.                 │
            │                                                                     │
            │ Churn de contas, churn de receita, comprometido e retido são o        │
            │ cabeçalho da ferramenta inteira — trocar de aba não deve fazer o      │
            │ número do mês desaparecer. É a mesma decisão da base de clientes: o   │
            │ painel some justamente quando a pessoa está olhando um pedaço.        │
            │                                                                     │
            │ Coorte e meta só aparecem para quem vê receita: são número de         │
            │ receita, e a consulta delas nem é carregada para os outros.           │
            └───────────────────────────────────────────────────────────────────┘ */}
        <Abas
          abas={[
            /* FORA do `veReceita`: as colunas do funil são risco de CONTA, e
               quem cuida de conta precisa vê-las. Coorte, meta e reconciliação
               são número de receita e ficam atrás do gate. */
            { chave: 'funil', rotulo: 'Funil' },
            ...(veReceita
              ? [
                  { chave: 'coorte', rotulo: 'Coorte' },
                  { chave: 'meta', rotulo: 'Meta' },
                  /* Junto de coorte e meta, e não ao lado do quadro: é número de
                     RECEITA, e quem não vê receita não vê nenhum dos três. */
                  { chave: 'reconciliacao', rotulo: 'Reconciliação' },
                ]
              : []),
          ]}
          atual={aba}
          href={(k) => link(k as Aba)}
          iguais
        />

        {/* Quem entra em Saídas procurando o fluxo precisa achar a porta. Sem
            isto, a mudança de 10/09 esconderia o cadastro de quem sabia onde
            ele estava — que é o pior jeito de reorganizar uma tela. */}
        <p className="text-meta leading-relaxed text-ink-3">
          Esta tela <strong className="font-semibold text-ink">analisa</strong>. Para trabalhar um
          pedido — abrir um card, mover etapa, confirmar aviso ou encerrar — a tela é{' '}
          <Link href="/cancelamento" className="font-medium text-purple-700 hover:underline">
            Cancelamento
          </Link>
          .
        </p>

        {aba === 'funil' && <Funil contas={funil} />}
        {aba === 'coorte' && veReceita && <Coorte meses={coorte} />}
        {aba === 'reconciliacao' && veReceita && (
          <Reconciliacao meses={observado} contas={semRegistro} maturidade={MESES_DE_MATURIDADE} />
        )}
        {aba === 'meta' && veReceita && (
          <Meta linhas={metas} podeDefinir={id.permissoes.configurar} volta="/saidas" />
        )}

      </Corpo>
    </>
  )
}
