import type pg from 'pg'

import type { Identidade } from '@pulse/auth'

import { DIAS_PARA_ESTAGNAR, type EstadoSaida, type OrigemSaida } from './cancelamento.js'

/**
 * As três visões do fluxo de saída: o quadro, a coorte e a meta.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ARQUIVO PRÓPRIO porque isto é LEITURA, e `cancelamento.ts` é a máquina de   │
 * │ estados. Lá cada função tem um gate humano e uma transação; aqui nenhuma    │
 * │ escreve — exceto `definirMeta`, que está aqui porque a meta é o insumo de   │
 * │ uma visão e não um estado do pedido.                                       │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

/** Só quem vê a base inteira; o resto vê a própria carteira. */
const daBase = (id: Identidade) => id.permissoes.contas === 'base'

// ═══ O QUADRO ════════════════════════════════════════════════════════════════

/**
 * As oito posições do quadro, derivadas de `estado` + `origem`.
 *
 * A coluna não é uma coluna do banco: `encerrado` + `origem` dá duas posições, e
 * gravar duas seria ter duas formas de escrever a mesma coisa. A derivação mora
 * aqui, num lugar, e a tela recebe a posição pronta.
 */
export type PosicaoDoQuadro =
  | 'pedido'
  | 'financeiro'
  | 'reversao'
  | 'revertido'
  | 'desconto'
  | 'renegociado'
  | 'cancelamento'
  | 'pdd'

export const POSICOES: ReadonlyArray<{
  id: PosicaoDoQuadro
  rotulo: string
  tipo: 'etapa' | 'salvo' | 'perda'
  explica: string
}> = [
  { id: 'pedido', rotulo: 'Pedido de cancelamento ou desconto', tipo: 'etapa',
    explica: 'a mão levantada, com cliente, data, canal e MRR congelado' },
  { id: 'financeiro', rotulo: 'Informações financeiras', tipo: 'etapa',
    explica: 'multa, dívida, aviso prévio e até quando ainda se cobra' },
  { id: 'reversao', rotulo: 'Tentativa de reversão', tipo: 'etapa',
    explica: 'a conversa; a única etapa com prazo' },
  { id: 'revertido', rotulo: 'Cancelamento revertido', tipo: 'salvo',
    explica: 'fica no mesmo valor; nada entra no ledger' },
  { id: 'desconto', rotulo: 'Desconto', tipo: 'salvo',
    explica: 'fica pagando menos; entra como contração' },
  { id: 'renegociado', rotulo: 'Renegociação financeira', tipo: 'salvo',
    explica: 'muda prazo ou parcela; só mexe no MRR se o mensal mudar' },
  { id: 'cancelamento', rotulo: 'Cancelamento', tipo: 'perda',
    explica: 'sai por decisão do cliente; churn pedido' },
  { id: 'pdd', rotulo: 'Cancelamento Alloyal (PDD)', tipo: 'perda',
    explica: 'nós cortamos, por crédito; churn por inadimplência' },
]

/**
 * O SQL que traduz estado + origem em posição. Um `CASE` só, e é ele que garante
 * que quadro, coorte e contagem concordem sobre onde cada pedido está.
 */
const POSICAO = `CASE
  WHEN c.estado = 'anunciado'   THEN 'pedido'
  WHEN c.estado = 'financeiro'  THEN 'financeiro'
  WHEN c.estado = 'reversao'    THEN 'reversao'
  WHEN c.estado = 'retido'      THEN 'revertido'
  WHEN c.estado = 'desconto'    THEN 'desconto'
  WHEN c.estado = 'renegociado' THEN 'renegociado'
  -- em_aviso é cancelamento decidido com o aviso correndo: aparece junto do
  -- cancelamento, porque para quem olha o quadro a decisão já foi tomada.
  WHEN c.origem = 'alloyal'     THEN 'pdd'
  ELSE 'cancelamento'
END`

export interface PedidoNoQuadro {
  readonly id: string
  readonly accountId: string
  readonly razaoSocial: string
  readonly posicao: PosicaoDoQuadro
  /**
   * O estado CRU, ao lado da posição derivada — e não é redundância.
   *
   * A posição é o que a tela desenha; o estado é o que a máquina de estados
   * aceita, e uma posição esconde dois estados: a coluna `cancelamento` guarda
   * `em_aviso` (o aviso correndo, que ainda pode ser retido) e `encerrado` (o
   * fim de linha). Sem o estado a tela não distingue os dois, e teria de proibir
   * o arraste da coluna inteira — proibindo junto a retenção de um pedido que a
   * `TRANSICOES` permite.
   */
  readonly estado: EstadoSaida
  /**
   * Quem iniciou a saída — e ela é o que separa as DUAS colunas de perda.
   *
   * `cancelamento` e `pdd` são o mesmo estado (`em_aviso`/`encerrado`) com
   * origens diferentes, e a origem não é transição: se define ao registrar o
   * pedido. Sem este campo o arraste não sabe em qual das duas o cartão vai
   * cair, e a pessoa solta numa coluna para ver o cartão aparecer na outra.
   */
  readonly origem: OrigemSaida
  readonly pedido: 'cancelar' | 'desconto'
  readonly dataLevantada: string | null
  readonly mrrCentavos: string | null
  readonly mrrNovoCentavos: string | null
  readonly avisoPrevioDias: number | null
  readonly fimDoAviso: string | null
  readonly competenciaEfeito: string | null
  readonly motivo: string | null
  /** O texto livre de quem registrou. Preenchido em 430 dos 445 — é onde mora o
   *  "por quê" que a taxonomia de 10 valores não consegue carregar. */
  readonly motivoDetalhe: string | null
  readonly motivoConfirmado: boolean
  /** O "Ticket ID" do HubSpot, quando a linha veio da carga. Rastreabilidade:
   *  quem quiser a conversa inteira sabe onde procurar. */
  readonly ticketExterno: string | null
  readonly diasNaEtapa: number
  /** Parado além do prazo numa ETAPA. Desfecho não estagna. */
  readonly estagnado: boolean
  readonly dividaCentavos: string | null
}

/**
 * O quadro, com recorte de tempo opcional.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O RECORTE NÃO ALCANÇA O QUE ESTÁ EM ANDAMENTO, e isto é medido.           │
 * │                                                                            │
 * │ Com os tickets do HubSpot: o recorte "este trimestre" esconderia DOIS      │
 * │ pedidos em andamento — os de 20/03 e 25/05 —, e eles são exatamente os     │
 * │ mais parados de todos, os que o quadro existe para puxar o olho.           │
 * │                                                                            │
 * │ Um kanban que esconde trabalho deixou de ser um kanban. Então o filtro     │
 * │ recorta o HISTÓRICO — as cinco colunas de desfecho — e as três etapas de   │
 * │ trabalho aparecem sempre, em qualquer período. A tela diz isso em voz alta │
 * │ no subtítulo; não é regra escondida.                                      │
 * │                                                                            │
 * │ Para voltar ao recorte literal, é só tirar o `OR c.estado IN (...)` abaixo │
 * │ — uma linha, e o teste `o recorte nunca esconde etapa de trabalho` cai     │
 * │ junto, que é como deve ser.                                               │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export async function quadroDeSaida(
  db: pg.Pool,
  id: Identidade,
  opcoes: { readonly desde?: string | null; readonly ate?: string | null } = {},
): Promise<PedidoNoQuadro[]> {
  const { rows } = await db.query(
    `SELECT c.id::text, c.account_id::text AS account_id, a.razao_social,
            ${POSICAO} AS posicao, c.estado, c.origem, c.pedido,
            to_char(c.data_levantada, 'YYYY-MM-DD')            AS data_levantada,
            c.mrr_centavos_na_levantada::text                  AS mrr,
            c.mrr_novo_centavos::text                          AS mrr_novo,
            c.aviso_previo_dias,
            to_char(c.data_fim_aviso, 'YYYY-MM-DD')            AS fim_aviso,
            to_char(c.competencia_efeito_receita, 'YYYY-MM')   AS efeito,
            c.motivo, c.motivo_detalhe, c.ticket_externo,
            (c.motivo_confirmado_por IS NOT NULL)              AS motivo_confirmado,
            greatest(0, (now()::date - c.etapa_desde::date))    AS dias_na_etapa,
            c.debito_aberto_na_levantada_centavos::text        AS divida
       FROM success.cancellation c
       JOIN core.account a ON a.id = c.account_id
      WHERE ($2::boolean OR a.csm_email = $1)
        AND (c.estado IN ('anunciado', 'financeiro', 'reversao')
             -- COALESCE porque data_levantada é NULA quando a origem é
             -- Alloyal: o CHECK só a exige do cliente, e saída por crédito não
             -- tem levantada de mão. Sem isto, todo cartão de PDD sumiria de
             -- QUALQUER recorte: "NULL >= data" não é falso, é nulo. É o mesmo
             -- COALESCE que confirmarAviso já usa, pelo mesmo motivo.
             -- (Sem crase aqui: isto vive dentro de um template literal, e a
             --  crase fechava a string — o build acusou na hora.)
             OR (($3::date IS NULL OR COALESCE(c.data_levantada, c.criado_em::date) >= $3::date)
                 AND ($4::date IS NULL OR COALESCE(c.data_levantada, c.criado_em::date) <= $4::date)))
      ORDER BY
        -- Etapas primeiro, e dentro delas o mais parado no topo: o quadro tem de
        -- puxar o olho para o que está esquecido, não para o que é recente.
        (c.estado IN ('anunciado', 'financeiro', 'reversao')) DESC,
        c.etapa_desde,
        c.mrr_centavos_na_levantada DESC NULLS LAST`,
    [id.email, daBase(id), opcoes.desde ?? null, opcoes.ate ?? null],
  )
  return rows.map((r) => {
    const posicao = String(r['posicao']) as PosicaoDoQuadro
    const dias = Number(r['dias_na_etapa'] ?? 0)
    const emEtapa = posicao === 'pedido' || posicao === 'financeiro' || posicao === 'reversao'
    return {
      id: String(r['id']),
      accountId: String(r['account_id']),
      razaoSocial: String(r['razao_social'] ?? ''),
      posicao,
      estado: String(r['estado']) as EstadoSaida,
      origem: String(r['origem']) as OrigemSaida,
      pedido: String(r['pedido']) as 'cancelar' | 'desconto',
      dataLevantada: (r['data_levantada'] as string | null) ?? null,
      mrrCentavos: r['mrr'] === null ? null : String(r['mrr']),
      mrrNovoCentavos: r['mrr_novo'] === null ? null : String(r['mrr_novo']),
      avisoPrevioDias: r['aviso_previo_dias'] === null ? null : Number(r['aviso_previo_dias']),
      fimDoAviso: (r['fim_aviso'] as string | null) ?? null,
      competenciaEfeito: (r['efeito'] as string | null) ?? null,
      motivo: (r['motivo'] as string | null) ?? null,
      motivoDetalhe: (r['motivo_detalhe'] as string | null) ?? null,
      ticketExterno: (r['ticket_externo'] as string | null) ?? null,
      motivoConfirmado: r['motivo_confirmado'] === true,
      diasNaEtapa: dias,
      estagnado: emEtapa && dias >= DIAS_PARA_ESTAGNAR,
      dividaCentavos: r['divida'] === null ? null : String(r['divida']),
    }
  })
}

/**
 * Os últimos cancelamentos, pelos mais RECENTES.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ EXISTE PORQUE A VISÃO GERAL ESTAVA CHAMANDO DE "ÚLTIMOS" OS PRIMEIROS.     │
 * │                                                                            │
 * │ Ela reusava `listarSaidas`, cuja ordem é `data_fim_aviso NULLS FIRST`       │
 * │ ASCENDENTE — e essa ordem está certa para o que aquela função serve: a      │
 * │ fila de trabalho põe na frente quem tem menos janela de reversão.           │
 * │ Para uma lista de "últimos cancelamentos realizados" ela é exatamente ao    │
 * │ contrário.                                                                 │
 * │                                                                            │
 * │ Com a tabela vazia ninguém via. Com os 444 tickets do HubSpot dentro, a     │
 * │ tela passou a anunciar AGROCUPOM de 21/11/2023 como último cancelamento,    │
 * │ enquanto os de verdade eram Avep Brasil (21/08/2026) e Gran Cursos          │
 * │ (06/08/2026). Rótulo que promete uma coisa e mostra outra.                  │
 * │                                                                            │
 * │ Reusar uma consulta pela ORDEM dela é o defeito; a correção é uma consulta  │
 * │ própria, com a ordem que o rótulo promete.                                  │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * A ordem é pela data em que a RECEITA parou, e cai para a levantada quando
 * aquela não existe: é a data que responde "quando este cliente saiu".
 */
export async function ultimosCancelamentos(
  db: pg.Pool,
  id: Identidade,
  limite = 10,
): Promise<
  Array<{
    readonly accountId: string
    readonly conta: string
    readonly dataLevantada: string | null
    readonly receitaParouEm: string | null
    readonly receitaParouDerivada: boolean
    readonly mrrCentavos: string | null
    readonly motivo: string | null
    readonly origem: OrigemSaida
  }>
> {
  if (id.permissoes.contas === 'nenhum') return []
  const { rows } = await db.query(
    `SELECT c.account_id::text AS conta_id, a.razao_social,
            to_char(c.data_levantada, 'YYYY-MM-DD')          AS levantada,
            to_char(c.competencia_efeito_receita, 'YYYY-MM') AS efeito,
            -- Importado não tem a corrente de confirmações: a competência dele
            -- foi DERIVADA do fim do aviso. A tela tem de poder dizer isso, em
            -- vez de mostrar o número como se alguém o tivesse apurado.
            (c.origem_do_registro <> 'humano')               AS derivada,
            c.mrr_centavos_na_levantada::text                AS mrr,
            c.motivo, c.origem
       FROM success.cancellation c
       JOIN core.account a ON a.id = c.account_id
      WHERE c.estado = 'encerrado'
        AND ($2::boolean OR a.csm_email = $1)
      ORDER BY COALESCE(c.competencia_efeito_receita, c.data_levantada) DESC NULLS LAST,
               c.data_levantada DESC NULLS LAST
      LIMIT $3`,
    [id.email, daBase(id), limite],
  )
  return rows.map((r) => ({
    accountId: String(r['conta_id']),
    conta: String(r['razao_social'] ?? ''),
    dataLevantada: (r['levantada'] as string | null) ?? null,
    receitaParouEm: (r['efeito'] as string | null) ?? null,
    receitaParouDerivada: r['derivada'] === true,
    mrrCentavos: r['mrr'] === null ? null : String(r['mrr']),
    motivo: (r['motivo'] as string | null) ?? null,
    origem: String(r['origem']) as OrigemSaida,
  }))
}

// ═══ QUEM PODE LEVANTAR A MÃO ════════════════════════════════════════════════

export interface ContaParaSaida {
  readonly accountId: string
  readonly razaoSocial: string
  /** O MRR que `anunciar` vai congelar sozinho. `null` = precisa ser digitado. */
  readonly mrrCentavos: string | null
}

/**
 * As contas que podem receber um pedido de saída.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POR QUE ESTA LISTA É RECORTADA, e não "todas as contas".                    │
 * │                                                                            │
 * │ São 3.274 contas no cadastro e 2.153 marcadas ativas, mas só 426 ativas      │
 * │ faturaram nos últimos doze meses — medido em 27/08/2026. Levantada de mão    │
 * │ é evento de cliente COM receita: as outras 1.727 são cadastro sem cobrança,  │
 * │ e oferecê-las num select transforma a escolha do cliente numa busca em       │
 * │ 2.153 linhas para achar uma de 426.                                         │
 * │                                                                            │
 * │ Doze meses, e não os dois da carência do MRR: quem parou de pagar há seis    │
 * │ meses e só agora formaliza o cancelamento é justamente o caso que o campo    │
 * │ de MRR digitado existe para atender. Ele aparece na lista com `mrrCentavos`  │
 * │ nulo, e a tela pede o valor.                                                │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Conta que já tem saída em andamento fica FORA: `anunciar` recusa a segunda, e
 * oferecer uma opção que só devolve erro é fazer a pessoa descobrir a regra pelo
 * tropeço.
 */
export async function contasParaSaida(
  db: pg.Pool,
  id: Identidade,
): Promise<ContaParaSaida[]> {
  const { rows } = await db.query(
    `WITH faturou AS (
       SELECT DISTINCT ON (account_id) account_id, mrr_centavos, competencia
         FROM analytics.mrr_faturado_mes
        WHERE competencia >= date_trunc('month', current_date) - interval '12 months'
        ORDER BY account_id, competencia DESC
     )
     SELECT a.id::text AS account_id, a.razao_social,
            -- O MRR só é oferecido como congelável se estiver DENTRO da carência
            -- de dois meses que anunciar() usa. Mostrar o de nove meses atrás
            -- prometeria um congelamento que a função não vai fazer.
            CASE WHEN f.competencia >= date_trunc('month', current_date) - interval '2 months'
                 THEN f.mrr_centavos::text END AS mrr
       FROM core.account a
       JOIN faturou f ON f.account_id = a.id
      WHERE a.ativo
        AND ($2::boolean OR a.csm_email = $1)
        AND NOT EXISTS (
          SELECT 1 FROM success.cancellation c
           WHERE c.account_id = a.id
             AND c.estado IN ('anunciado', 'financeiro', 'reversao', 'em_aviso'))
      ORDER BY a.razao_social`,
    [id.email, daBase(id)],
  )
  return rows.map((r) => ({
    accountId: String(r['account_id']),
    razaoSocial: String(r['razao_social'] ?? ''),
    mrrCentavos: r['mrr'] === null ? null : String(r['mrr']),
  }))
}

// ═══ O CHURN OBSERVADO, E A RECONCILIAÇÃO ════════════════════════════════════

/**
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POR QUE ESTE BLOCO EXISTE, e por que ele NÃO substitui o pipeline.        │
 * │                                                                            │
 * │ Em 28/08/2026 as cinco visões deixaram de ler `fact.mrr_event` a pedido do │
 * │ usuário, e a razão era boa: o ledger é derivado do faturamento e não sabe  │
 * │ POR QUE a receita parou. O commit registrou o preço — "a coorte começa     │
 * │ vazia e preenche conforme o time usa o pipeline".                          │
 * │                                                                            │
 * │ Em 10/09 o usuário voltou ao ponto: a tela continua zerada, e um dos KPI   │
 * │ prometia "saíram do FATURAMENTO" lendo a tabela manual. A promessa quebrada │
 * │ era real.                                                                  │
 * │                                                                            │
 * │ A saída não é escolher uma fonte: é mostrar as DUAS, nomeadas. O pipeline   │
 * │ responde "quem levantou a mão e por quê"; o Omie responde "de quem o        │
 * │ dinheiro parou de entrar". São perguntas diferentes e nenhuma substitui a   │
 * │ outra — e a diferença entre elas é a lista de reconciliação, que é o que    │
 * │ faz o pipeline ser usado.                                                  │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ AS DUAS RESSALVAS, MEDIDAS — e é por elas que o número não é o ledger cru. │
 * │                                                                            │
 * │ 1. VOLTA A FATURAR. Dos 1.035 eventos `churn_pedido` do ledger, 198 (19,1%) │
 * │    voltaram a faturar depois: não eram saída, eram ritmo de cobrança —      │
 * │    cliente que passou a pagar trimestralmente cai no ledger como churn. Ler │
 * │    o ledger cru inflaria o churn em um quinto.                             │
 * │                                                                            │
 * │ 2. MÊS RECENTE NÃO É JULGÁVEL. Medido: ~11% voltam em até 3 meses e ~8%     │
 * │    depois. Daí a carência de `MESES_DE_MATURIDADE` — afirmar saída no mês   │
 * │    corrente é afirmar o que ainda não se sabe.                              │
 * │                                                                            │
 * │ O custo da maturidade é explícito: os três últimos meses aparecem como "em  │
 * │ apuração", e não como zero. Zero é uma afirmação; "em apuração" é a verdade.│
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export const MESES_DE_MATURIDADE = 3

/**
 * O recorte de saída observada, em UM lugar.
 *
 * Repetido entre a série e a lista, divergiria — é o mesmo motivo pelo qual
 * `POSICAO` é um `CASE` só.
 */
const SAIU_DO_FATURAMENTO = `
  e.tipo = 'churn_pedido'
  AND e.competencia <= date_trunc('month', current_date) - make_interval(months => ${MESES_DE_MATURIDADE})
  AND NOT EXISTS (
    SELECT 1 FROM analytics.mrr_faturado_mes m
     WHERE m.account_id = e.account_id
       AND m.competencia > e.competencia
       AND m.mrr_centavos > 0)`

export interface MesObservado {
  readonly mes: string
  /** Contas cujo faturamento parou naquela competência, já maduras. */
  readonly contas: number
  readonly receitaPerdidaCentavos: string
  /** Quantas delas têm registro no pipeline. A diferença é o que falta apurar. */
  readonly comRegistro: number
  /** Falso nos meses dentro da carência de maturidade: ainda não se sabe. */
  readonly maduro: boolean
}

/**
 * O churn que o FATURAMENTO mostra, mês a mês.
 *
 * Não substitui `coorteDeSaida`: aquela conta pedidos do pipeline pela data do
 * anúncio, esta conta contas pela competência em que o dinheiro parou. Ver o
 * bloco no topo deste arquivo para por que as duas coexistem.
 */
export async function churnObservado(db: pg.Pool, meses = 12): Promise<MesObservado[]> {
  const { rows } = await db.query(
    `WITH grade AS (
       SELECT generate_series(
                date_trunc('month', current_date) - make_interval(months => $1::int - 1),
                date_trunc('month', current_date),
                '1 month')::date AS mes
     ), obs AS (
       SELECT e.competencia, e.account_id, e.valor_centavos
         FROM fact.mrr_event e
        WHERE ${SAIU_DO_FATURAMENTO}
     )
     SELECT to_char(g.mes, 'YYYY-MM-DD') AS mes,
            count(o.account_id)::int AS contas,
            COALESCE(abs(sum(o.valor_centavos)), 0)::text AS receita,
            count(o.account_id) FILTER (
              WHERE EXISTS (SELECT 1 FROM success.cancellation c
                             WHERE c.account_id = o.account_id)
            )::int AS com_registro,
            -- A carência: o mês só é maduro se já passou dela.
            (g.mes <= date_trunc('month', current_date)
                      - make_interval(months => ${MESES_DE_MATURIDADE}))::boolean AS maduro
       FROM grade g
       LEFT JOIN obs o ON o.competencia = g.mes
      GROUP BY g.mes ORDER BY g.mes`,
    [meses],
  )
  return rows.map((r) => ({
    mes: String(r['mes']),
    contas: Number(r['contas']),
    receitaPerdidaCentavos: String(r['receita']),
    comRegistro: Number(r['com_registro']),
    maduro: Boolean(r['maduro']),
  }))
}

export interface SaidaSemRegistro {
  readonly accountId: string
  readonly razaoSocial: string
  readonly competencia: string
  readonly receitaPerdidaCentavos: string
  /** `true` se a conta ainda está marcada como ativa no cadastro. */
  readonly aindaAtiva: boolean
  /**
   * O total ANTES do limite, repetido em cada linha pela janela.
   *
   * Existe porque a primeira versão desta lista mostrava "Sem registro (200)" —
   * a contagem do que caiu na página, com cara de total. São 794. Título que
   * conta o próprio truncamento é o mesmo defeito que o rótulo "saíram do
   * faturamento" tinha: afirma menos do que existe, sem avisar.
   */
  readonly total: number
}

/**
 * A LISTA DE RECONCILIAÇÃO: parou de faturar e ninguém disse por quê.
 *
 * É a peça que faltava para o pipeline ser usado. Medido em 10/09/2026: 302
 * contas pararam de faturar em 13 meses, somando ~R$ 1,16 milhão, e ZERO tinham
 * registro. O formulário existia, funcionava e estava vazio — porque ninguém
 * sabia QUEM registrar.
 *
 * Respeita o escopo de carteira como as outras visões: `daBase` ou `csm_email`.
 */
export async function saidasSemRegistro(
  db: pg.Pool,
  id: Identidade,
  limite = 200,
): Promise<SaidaSemRegistro[]> {
  const { rows } = await db.query(
    `SELECT e.account_id::text AS account_id,
            a.razao_social,
            to_char(e.competencia, 'YYYY-MM-DD') AS competencia,
            abs(e.valor_centavos)::text AS receita,
            a.ativo AS ainda_ativa,
            count(*) OVER ()::int AS total
       FROM fact.mrr_event e
       JOIN core.account a ON a.id = e.account_id
      WHERE ${SAIU_DO_FATURAMENTO}
        AND ($1::boolean OR a.csm_email = $2)
        AND NOT EXISTS (SELECT 1 FROM success.cancellation c
                         WHERE c.account_id = e.account_id)
      ORDER BY e.competencia DESC, abs(e.valor_centavos) DESC
      LIMIT $3`,
    [daBase(id), id.email, limite],
  )
  return rows.map((r) => ({
    accountId: String(r['account_id']),
    razaoSocial: String(r['razao_social'] ?? ''),
    competencia: String(r['competencia']),
    receitaPerdidaCentavos: String(r['receita']),
    aindaAtiva: Boolean(r['ainda_ativa']),
    total: Number(r['total']),
  }))
}

// ═══ O FUNIL: o kanban que se preenche sozinho ═══════════════════════════════

/**
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POR QUE AS COLUNAS SÃO DE FATURAMENTO, E NÃO DO PIPELINE.                 │
 * │                                                                            │
 * │ O usuário pediu o fluxo em kanban e disse: "não quero que renderize vazio  │
 * │ e sim mostre as evoluções". O quadro do pipeline não pode atender isso, e   │
 * │ a razão é de definição, não de implementação: LEVANTAR A MÃO é alguém       │
 * │ avisando que vai sair, e acontece ANTES de o dinheiro parar. O Omie só vê   │
 * │ dinheiro. Nenhuma coluna de "levantou a mão" se preenche sozinha porque o   │
 * │ sinal não existe nos dados.                                                │
 * │                                                                            │
 * │ E não é só o pipeline que está vazio. Medido em 10/09/2026:                 │
 * │   metrics.signal · metrics.daily_snapshot · metrics.rfm_score → ZERO linha  │
 * │ A faixa de risco da Carteira sai de `metrics.signal`, então ela também está │
 * │ vazia — os cinco ciclos de sinais nunca foram implementados.                │
 * │                                                                            │
 * │ Sobra uma classificação que se preenche hoje: a derivada do FATURAMENTO e   │
 * │ da INADIMPLÊNCIA, que são as duas cargas que de fato rodam todo dia.        │
 * │ Medido: 398 contas, R$ 1.432.203,00, nenhuma coluna vazia.                  │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ DUAS CAMADAS, e a de baixo nunca inventa decisão humana.                   │
 * │                                                                            │
 * │ A coluna afirma o que o DINHEIRO fez — atrasou, caiu, parou. O selo do      │
 * │ cartão afirma o que alguém REGISTROU, e só aparece quando existe registro.  │
 * │ Assim o quadro nasce cheio sem afirmar um aviso que ninguém deu: no dia um  │
 * │ é risco medido e nenhum selo; conforme o time usa o formulário, os selos    │
 * │ aparecem e o quadro passa a ser as duas coisas.                            │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ COLUNAS EXCLUSIVAS, e a ordem é a severidade.                              │
 * │                                                                            │
 * │ Cada conta cai em UMA coluna. A primeira versão desta medição tinha         │
 * │ colunas sobrepostas — "em atraso" e "contraiu" eram subconjuntos de         │
 * │ "faturando" — e as somas não fechavam com a base. Kanban cuja soma não       │
 * │ fecha é kanban em que ninguém confia na contagem.                          │
 * │                                                                            │
 * │ `atraso_e_contracao` vem antes de `atraso` e de `contracao` por isso: é a    │
 * │ conta que atrasa E encolhe ao mesmo tempo, e é a menor coluna (6 contas,     │
 * │ R$ 41.173,33) e a mais informativa do quadro.                              │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export const COLUNAS_DO_FUNIL = [
  {
    id: 'parou',
    rotulo: 'Parou de faturar',
    proposito: 'o dinheiro não entrou, e ainda está dentro da janela de apuração',
    tom: 'red',
  },
  {
    id: 'atraso_e_contracao',
    rotulo: 'Atraso e contração',
    proposito: 'atrasa E encolhe ao mesmo tempo — a menor coluna, e a mais grave',
    tom: 'red',
  },
  {
    id: 'atraso',
    rotulo: 'Em atraso',
    proposito: 'título vencido além da carência de dois dias úteis',
    tom: 'amber',
  },
  {
    id: 'contracao',
    rotulo: 'Contraindo',
    proposito: 'continua pagando, e pagando menos do que pagava',
    tom: 'amber',
  },
  {
    id: 'saudavel',
    rotulo: 'Sem sinal',
    proposito: 'faturou, em dia, sem queda — nada a fazer aqui hoje',
    tom: 'green',
  },
] as const

export type ColunaDoFunil = (typeof COLUNAS_DO_FUNIL)[number]['id']

/**
 * Quantos meses de faturamento definem a base ATIVA do funil.
 *
 * Quatro e não doze: o funil é trabalho corrente, e conta que não fatura há um
 * ano não é risco — já é saída, e vive na aba Reconciliação. Doze meses trariam
 * as 794 saídas confirmadas para dentro do quadro e o entupiriam.
 */
export const MESES_DA_BASE_ATIVA = 4

export interface ContaNoFunil {
  readonly accountId: string
  readonly razaoSocial: string
  readonly coluna: ColunaDoFunil
  readonly mrrCentavos: string
  /** Quanto está vencido além da carência. Zero fora das colunas de atraso. */
  readonly abertoCentavos: string
  /** Dias do vencimento mais antigo em aberto. `null` sem atraso. */
  readonly diasEmAtraso: number | null
  /** Quanto o MRR caiu nos últimos meses. Zero sem contração. */
  readonly quedaCentavos: string
  /**
   * A CAMADA DE CIMA: o estado do pedido, se alguém registrou um.
   *
   * `null` é o caso comum hoje — 398 de 398. E é `null` honesto: significa
   * "ninguém disse nada", não "está tudo bem".
   */
  readonly estadoNoPipeline: string | null
}

/**
 * O funil de saída, uma linha por conta ativa.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A ORDEM É O SINAL DA PRÓPRIA COLUNA, e não o MRR. MEDIDO NA TELA.         │
 * │                                                                            │
 * │ A primeira versão ordenava tudo por MRR — o critério da Carteira, e certo   │
 * │ lá. Aqui produziu isto, visto na renderização: a coluna "Em atraso" trazia  │
 * │ entre os oito primeiros a "Vou De Meia · R$ 0,02 vencidos · 293 dias", ao   │
 * │ lado da "OXXO · R$ 31.200,00 vencidos · 15 dias". Duas coisas de ordens de  │
 * │ grandeza diferentes com o mesmo peso é o que ensina a desconfiar da coluna. │
 * │                                                                            │
 * │ A saída NÃO é piso de materialidade: seria outro número arbitrário para     │
 * │ manter, e medido é 1 conta em 55 abaixo de R$ 100. Ordenar pelo sinal       │
 * │ resolve sem escolher número nenhum — nas colunas de atraso pesa o VENCIDO,  │
 * │ na de contração pesa a QUEDA, no resto pesa o MRR. O resíduo de dois        │
 * │ centavos afunda para o fim da coluna, onde ele pertence, e continua lá para │
 * │ quem procurar.                                                             │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Respeita o escopo de carteira como as outras visões.
 */
export async function funilDeSaida(db: pg.Pool, id: Identidade): Promise<ContaNoFunil[]> {
  const { rows } = await db.query(
    `WITH base AS (
       -- A última competência faturada de cada conta ativa, e o MRR dela.
       SELECT DISTINCT ON (account_id) account_id, mrr_centavos, competencia
         FROM analytics.mrr_faturado_mes
        WHERE competencia >= date_trunc('month', current_date)
                             - make_interval(months => ${MESES_DA_BASE_ATIVA})
          AND mrr_centavos > 0
        ORDER BY account_id, competencia DESC
     ), atraso AS (
       -- O MESMO recorte da inadimplência: carência de dois dias úteis, agora
       -- com feriado (0058). Duplicar a regra aqui a faria divergir da tela de
       -- inadimplência, e duas verdades sobre "estar em atraso" é pior que uma.
       SELECT v.account_id,
              sum(t.aberto_centavos) AS aberto,
              max(current_date - t.vencimento) AS dias
         FROM core.omie_titulo t
         JOIN core.vinculo_cliente v ON v.chave = t.documento AND v.fonte = 'omie'
        WHERE t.situacao NOT IN ('previsao', 'cancelado')
          AND t.vencimento <= core.dia_util_antes(current_date, 2)
          AND (t.pagamento IS NULL OR t.aberto_centavos > 0)
        GROUP BY v.account_id
     ), contracao AS (
       SELECT account_id, abs(sum(valor_centavos)) AS queda
         FROM fact.mrr_event
        WHERE tipo = 'contracao'
          AND competencia >= date_trunc('month', current_date) - interval '3 months'
        GROUP BY account_id
     ), parou AS (
       -- Dentro da janela de maturidade: parou, e ainda pode voltar. Passada a
       -- janela deixa de ser funil e vira saída confirmada, na Reconciliação.
       SELECT DISTINCT account_id FROM fact.mrr_event
        WHERE tipo = 'churn_pedido'
          AND competencia > date_trunc('month', current_date)
                            - make_interval(months => ${MESES_DE_MATURIDADE})
     )
     SELECT b.account_id::text AS account_id,
            a2.razao_social,
            b.mrr_centavos::text AS mrr,
            COALESCE(at.aberto, 0)::text AS aberto,
            at.dias::int AS dias,
            COALESCE(ct.queda, 0)::text AS queda,
            -- A severidade decide, e a ordem dos WHEN é a ordem das colunas.
            CASE
              WHEN p.account_id IS NOT NULL              THEN 'parou'
              WHEN at.account_id IS NOT NULL
               AND ct.account_id IS NOT NULL             THEN 'atraso_e_contracao'
              WHEN at.account_id IS NOT NULL             THEN 'atraso'
              WHEN ct.account_id IS NOT NULL             THEN 'contracao'
              ELSE 'saudavel'
            END AS coluna,
            -- A camada de cima: só os estados ABERTOS. Pedido já encerrado não é
            -- selo de trabalho, é história — e a conta dele já saiu da base ativa.
            (SELECT c.estado FROM success.cancellation c
              WHERE c.account_id = b.account_id
                AND c.estado IN ('anunciado','financeiro','reversao','em_aviso')
              ORDER BY c.criado_em DESC LIMIT 1) AS estado_pipeline
       FROM base b
       JOIN core.account a2 ON a2.id = b.account_id
       LEFT JOIN atraso at ON at.account_id = b.account_id
       LEFT JOIN contracao ct ON ct.account_id = b.account_id
       LEFT JOIN parou p ON p.account_id = b.account_id
      WHERE ($1::boolean OR a2.csm_email = $2)
      ORDER BY CASE
                 WHEN at.account_id IS NOT NULL THEN at.aberto
                 WHEN ct.account_id IS NOT NULL THEN ct.queda
                 ELSE b.mrr_centavos
               END DESC,
               b.mrr_centavos DESC`,
    [daBase(id), id.email],
  )
  return rows.map((r) => ({
    accountId: String(r['account_id']),
    razaoSocial: String(r['razao_social'] ?? ''),
    coluna: String(r['coluna']) as ColunaDoFunil,
    mrrCentavos: String(r['mrr']),
    abertoCentavos: String(r['aberto']),
    diasEmAtraso: r['dias'] === null ? null : Number(r['dias']),
    quedaCentavos: String(r['queda']),
    estadoNoPipeline: r['estado_pipeline'] === null ? null : String(r['estado_pipeline']),
  }))
}

// ═══ AS TRÊS PÁGINAS DO CANCELAMENTO ═════════════════════════════════════════

/**
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O GRÁFICO TEM DUAS CAMADAS, E POR MEDIÇÃO — NÃO POR ESTILO.               │
 * │                                                                            │
 * │ O pedido foi "gráfico do Cancelamento mostrando o Total e as barras         │
 * │ empilhadas como Desconto, Renegociação Financeira, Cancelamento Cliente e   │
 * │ Cancelamento PDD". As QUATRO séries saem de `success.cancellation`, que em   │
 * │ 10/09/2026 tem zero linha — o gráfico nasceria vazio inteiro.               │
 * │                                                                            │
 * │ Então o TOTAL vem do faturamento (o mesmo recorte de `churnObservado`: 3     │
 * │ meses de maturidade e nunca voltou a faturar), e as quatro séries vêm do     │
 * │ pipeline. A barra mostra o que se sabe HOJE e a decomposição enche conforme  │
 * │ o time registra — e a diferença entre o total e a soma das partes é,         │
 * │ literalmente, o que falta apurar.                                          │
 * │                                                                            │
 * │ É o mesmo princípio do selo do funil: a camada de baixo é medida, a de cima  │
 * │ é humana, e nenhuma finge ser a outra.                                     │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
/**
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ AS QUATRO SÉRIES NÃO CABEM NUMA PILHA SÓ, e um portão provou isso.       │
 * │                                                                            │
 * │ O pedido foi "barras empilhadas como Desconto, Renegociação Financeira,    │
 * │ Cancelamento Cliente e Cancelamento PDD". Empilhei as quatro dentro do     │
 * │ total medido no faturamento, e o portão da invariante falhou com um caso   │
 * │ real: desconto de R$ 4.000 num mês cujo total era ZERO.                    │
 * │                                                                            │
 * │ A causa é de conceito. O total conta quem PAROU de pagar. Desconto e       │
 * │ renegociação são clientes que CONTINUAM pagando, menos — `concederDesconto`│
 * │ grava `contracao`, não `churn_pedido`. Empilhá-los ali afirmaria como       │
 * │ perdido um cliente que está na base, que é literalmente o erro que o       │
 * │ commit de 28/08 tinha apontado na meta.                                    │
 * │                                                                            │
 * │ Então são DOIS grupos, e o gráfico desenha duas barras por mês:            │
 * │   SAIU     = altura medida; dentro, Cliente + PDD + não apurado            │
 * │   REDUZIU  = desconto + renegociação, ao lado e na mesma escala            │
 * │                                                                            │
 * │ Ver juntos é o ponto — as duas decisões competem pela mesma conversa com o │
 * │ cliente —, mas somá-las seria dizer que perdemos quem ficou.               │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export interface MesDoGrafico {
  readonly mes: string
  /** SAIU: contas que pararam de faturar, maduras. É a altura da 1ª barra. */
  readonly totalCentavos: string
  readonly totalContas: number
  /** Dentro de SAIU, e zero até alguém registrar o motivo. */
  readonly clienteCentavos: string
  readonly pddCentavos: string
  /** REDUZIU: cliente que ficou pagando menos. Barra PRÓPRIA, fora do total. */
  readonly descontoCentavos: string
  readonly renegociadoCentavos: string
  /** `false` nos meses dentro da carência: o total ainda não é afirmável. */
  readonly maduro: boolean
}

/**
 * O gráfico da Visão Geral: total medido e decomposição registrada.
 *
 * `meses` é 6 ou 12 — é o filtro que a tela oferece.
 */
export async function graficoDeCancelamento(
  db: pg.Pool,
  meses = 12,
): Promise<MesDoGrafico[]> {
  const { rows } = await db.query(
    `WITH grade AS (
       SELECT generate_series(
                date_trunc('month', current_date) - make_interval(months => $1::int - 1),
                date_trunc('month', current_date),
                '1 month')::date AS mes
     ), obs AS (
       -- O total, do faturamento. Mesmo recorte de churnObservado.
       SELECT e.competencia, e.account_id, abs(e.valor_centavos) AS valor
         FROM fact.mrr_event e
        WHERE ${SAIU_DO_FATURAMENTO}
     ), pipe AS (
       -- A decomposição, do pipeline. Pela competência de EFEITO, que é quando a
       -- receita para — a mesma data que o total usa, senão as barras ficariam
       -- em meses diferentes do total que as contém.
       SELECT competencia_efeito_receita AS mes, estado, origem,
              coalesce(mrr_centavos_na_levantada, 0) AS valor
         FROM success.cancellation
        WHERE competencia_efeito_receita IS NOT NULL
     )
     SELECT to_char(g.mes, 'YYYY-MM-DD') AS mes,
            COALESCE((SELECT sum(o.valor) FROM obs o WHERE o.competencia = g.mes), 0)::text AS total,
            COALESCE((SELECT count(*) FROM obs o WHERE o.competencia = g.mes), 0)::int AS total_contas,
            COALESCE((SELECT sum(valor) FROM pipe WHERE mes = g.mes AND estado = 'desconto'), 0)::text AS desconto,
            COALESCE((SELECT sum(valor) FROM pipe WHERE mes = g.mes AND estado = 'renegociado'), 0)::text AS renegociado,
            COALESCE((SELECT sum(valor) FROM pipe WHERE mes = g.mes AND estado = 'encerrado' AND origem = 'cliente'), 0)::text AS cliente,
            COALESCE((SELECT sum(valor) FROM pipe WHERE mes = g.mes AND estado = 'encerrado' AND origem = 'alloyal'), 0)::text AS pdd,
            (g.mes <= date_trunc('month', current_date)
                      - make_interval(months => ${MESES_DE_MATURIDADE}))::boolean AS maduro
       FROM grade g ORDER BY g.mes`,
    [meses],
  )
  return rows.map((r) => ({
    mes: String(r['mes']),
    totalCentavos: String(r['total']),
    totalContas: Number(r['total_contas']),
    descontoCentavos: String(r['desconto']),
    renegociadoCentavos: String(r['renegociado']),
    clienteCentavos: String(r['cliente']),
    pddCentavos: String(r['pdd']),
    maduro: Boolean(r['maduro']),
  }))
}

export interface LinhaDeDados {
  readonly accountId: string
  readonly razaoSocial: string
  /**
   * PRIMEIRO FATURAMENTO, e não início de contrato.
   *
   * `core.contract` e `contracts.document` têm ZERO linha (medido em
   * 10/09/2026), então não existe fonte para data de início de contrato. O que
   * existe é a primeira competência faturada — 1.172 contas, a mais antiga em
   * 2021-01.
   *
   * O nome do campo diz o que ele é. Chamá-lo de "início do contrato" seria o
   * mesmo defeito do rótulo "saíram do faturamento": prometer uma fonte que não
   * se tem.
   */
  readonly primeiroFaturamento: string | null
  /** Do pipeline: quando o cliente avisou. `null` quando ninguém registrou. */
  readonly dataLevantada: string | null
  readonly mrrCentavos: string
  /** Quanto de desconto foi concedido, se o desfecho foi desconto. */
  readonly descontoCentavos: string | null
  /** O estado do pedido, ou `null` — que significa "ninguém registrou". */
  readonly estado: string | null
  /** Competência em que o faturamento parou, pelo Omie. `null` se não parou. */
  readonly competenciaQueParou: string | null
}

/**
 * A tabela da página Dados: uma linha por conta que saiu ou está saindo.
 *
 * Junta as duas fontes numa linha só — o que o faturamento viu e o que alguém
 * registrou — porque a pergunta da página é sobre a CONTA, e não sobre a fonte.
 * As colunas que vêm de fonte vazia chegam `null`, e a tela mostra travessão em
 * vez de zero: zero afirma "não houve", travessão diz "não sei".
 */
export async function dadosDeCancelamento(
  db: pg.Pool,
  id: Identidade,
  limite = 300,
): Promise<LinhaDeDados[]> {
  const { rows } = await db.query(
    `WITH saiu AS (
       SELECT e.account_id, min(e.competencia) AS competencia
         FROM fact.mrr_event e
        WHERE ${SAIU_DO_FATURAMENTO}
        GROUP BY e.account_id
     ), inicio AS (
       SELECT account_id, min(competencia) AS primeira
         FROM analytics.mrr_faturado_mes WHERE mrr_centavos > 0
        GROUP BY account_id
     ), ult_mrr AS (
       SELECT DISTINCT ON (account_id) account_id, mrr_centavos
         FROM analytics.mrr_faturado_mes WHERE mrr_centavos > 0
        ORDER BY account_id, competencia DESC
     )
     SELECT a.id::text AS account_id, a.razao_social,
            to_char(i.primeira, 'YYYY-MM-DD') AS primeiro_faturamento,
            to_char(c.data_levantada, 'YYYY-MM-DD') AS data_levantada,
            COALESCE(c.mrr_centavos_na_levantada, m.mrr_centavos, 0)::text AS mrr,
            CASE WHEN c.estado = 'desconto'
                 THEN (c.mrr_centavos_na_levantada - COALESCE(c.mrr_novo_centavos, 0))::text
            END AS desconto,
            c.estado,
            to_char(s.competencia, 'YYYY-MM-DD') AS parou
       FROM core.account a
       LEFT JOIN success.cancellation c ON c.account_id = a.id
       LEFT JOIN saiu s ON s.account_id = a.id
       LEFT JOIN inicio i ON i.account_id = a.id
       LEFT JOIN ult_mrr m ON m.account_id = a.id
      -- Só quem saiu ou está saindo: a tabela é de cancelamento, e a base inteira
      -- (2.155 contas) responderia outra pergunta.
      WHERE (c.id IS NOT NULL OR s.account_id IS NOT NULL)
        AND ($1::boolean OR a.csm_email = $2)
      ORDER BY COALESCE(c.data_levantada, s.competencia) DESC NULLS LAST,
               COALESCE(c.mrr_centavos_na_levantada, m.mrr_centavos, 0) DESC
      LIMIT $3`,
    [daBase(id), id.email, limite],
  )
  return rows.map((r) => ({
    accountId: String(r['account_id']),
    razaoSocial: String(r['razao_social'] ?? ''),
    primeiroFaturamento: r['primeiro_faturamento'] === null ? null : String(r['primeiro_faturamento']),
    dataLevantada: r['data_levantada'] === null ? null : String(r['data_levantada']),
    mrrCentavos: String(r['mrr']),
    descontoCentavos: r['desconto'] === null ? null : String(r['desconto']),
    estado: r['estado'] === null ? null : String(r['estado']),
    competenciaQueParou: r['parou'] === null ? null : String(r['parou']),
  }))
}

// ═══ A COORTE ════════════════════════════════════════════════════════════════

export interface MesDaCoorte {
  readonly mes: string
  /** Do pipeline: pedidos ANUNCIADOS neste mês. Zero até alguém registrar. */
  readonly anunciados: number
  readonly mrrAnunciadoCentavos: string
  readonly avisoPrevioMedioDias: number | null
  readonly revertidos: number
  readonly comDesconto: number
  readonly renegociados: number
  readonly cancelados: number
  /**
   * Do MESMO pipeline: pedidos cuja receita PARA neste mês.
   *
   * ┌───────────────────────────────────────────────────────────────────────┐
   * │ VEM DE `competencia_efeito_receita`, e não do ledger de MRR.            │
   * │                                                                        │
   * │ A primeira versão lia `fact.mrr_event`, e isso misturava duas           │
   * │ definições de churn na mesma tabela. O ledger é DERIVADO do             │
   * │ faturamento do Omie: ele sabe que a receita parou, não por quê — um     │
   * │ cliente que renegociou para pagar trimestralmente entra lá como churn   │
   * │ e reativação, e o próprio módulo que o gera diz isso no cabeçalho.      │
   * │                                                                        │
   * │ Numa coorte de SAÍDA as duas colunas têm de falar do mesmo caso: o mês  │
   * │ em que o cliente avisou, e o mês em que a receita dele parou. A         │
   * │ distância entre as duas é o aviso prévio, e só faz sentido se for o     │
   * │ mesmo pedido nos dois lados. `competencia_efeito_receita` é apurada     │
   * │ pelo fluxo com as duas confirmações humanas — última cobrança mais um.  │
   * │                                                                        │
   * │ Reativação saiu junto: não é evento do pipeline de saída. Cliente que   │
   * │ volta é assunto de Receita, e estava aqui só porque o ledger a tinha.   │
   * └───────────────────────────────────────────────────────────────────────┘
   */
  readonly churnEfeitoContas: number
  readonly churnEfeitoCentavos: string
}

/**
 * A coorte, com as DUAS datas lado a lado.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ SÃO DUAS COORTES E NÃO UMA, e juntá-las numa coluna seria o erro.           │
 * │                                                                            │
 * │ A coorte de ANÚNCIO conta quando a mão subiu — é a que antecipa, e é a que  │
 * │ o pedido pede. Ela começa vazia: o ledger derivado do faturamento sabe o    │
 * │ mês em que a receita PAROU, não o mês em que o cliente avisou.              │
 * │                                                                            │
 * │ A coorte de EFEITO conta quando a receita saiu, e tem história — R$ 843 mil │
 * │ em 2026 quando foi medido.                                                 │
 * │                                                                            │
 * │ A distância entre as duas É o aviso prévio. Somá-las numa coluna faria      │
 * │ junho aparecer com saídas que foram anunciadas em abril, e a leitura de      │
 * │ tendência ficaria deslocada pelo tamanho do aviso — que varia por contrato. │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export async function coorteDeSaida(db: pg.Pool, meses = 12): Promise<MesDaCoorte[]> {
  const { rows } = await db.query(
    `WITH grade AS (
       SELECT generate_series(
                date_trunc('month', current_date) - ($1::int || ' months')::interval,
                date_trunc('month', current_date),
                interval '1 month')::date AS mes
     ),
     anuncio AS (
       SELECT date_trunc('month', c.data_levantada)::date AS mes,
              count(*)                                        AS n,
              coalesce(sum(c.mrr_centavos_na_levantada), 0)   AS mrr,
              round(avg(c.aviso_previo_dias))                 AS aviso,
              count(*) FILTER (WHERE c.estado = 'retido')      AS revertidos,
              count(*) FILTER (WHERE c.estado = 'desconto')    AS descontos,
              count(*) FILTER (WHERE c.estado = 'renegociado') AS renegociados,
              count(*) FILTER (WHERE c.estado IN ('em_aviso', 'encerrado')) AS cancelados
         FROM success.cancellation c
        WHERE c.data_levantada IS NOT NULL
        GROUP BY 1
     ),
     efeito AS (
       /* O mês em que a receita PARA, do mesmo pedido do lado do anúncio.
          Só estado de perda entra: retido, desconto e renegociado continuam
          faturando, e contá-los aqui afirmaria uma saída de receita que não
          houve. */
       SELECT c.competencia_efeito_receita AS mes,
              count(*)                                      AS n,
              coalesce(sum(c.mrr_centavos_na_levantada), 0)  AS mrr
         FROM success.cancellation c
        WHERE c.competencia_efeito_receita IS NOT NULL
          AND c.estado IN ('em_aviso', 'encerrado')
        GROUP BY 1
     )
     SELECT to_char(g.mes, 'YYYY-MM-DD') AS mes,
            coalesce(an.n, 0)::int            AS anunciados,
            coalesce(an.mrr, 0)::text         AS mrr_anunciado,
            an.aviso                          AS aviso,
            coalesce(an.revertidos, 0)::int   AS revertidos,
            coalesce(an.descontos, 0)::int    AS descontos,
            coalesce(an.renegociados, 0)::int AS renegociados,
            coalesce(an.cancelados, 0)::int   AS cancelados,
            coalesce(ef.n, 0)::int            AS churn_contas,
            coalesce(ef.mrr, 0)::text         AS churn_mrr
       FROM grade g
       LEFT JOIN anuncio an ON an.mes = g.mes
       LEFT JOIN efeito  ef ON ef.mes = g.mes
      ORDER BY g.mes`,
    [meses],
  )
  return rows.map((r) => ({
    mes: String(r['mes']),
    anunciados: Number(r['anunciados']),
    mrrAnunciadoCentavos: String(r['mrr_anunciado']),
    avisoPrevioMedioDias: r['aviso'] === null ? null : Number(r['aviso']),
    revertidos: Number(r['revertidos']),
    comDesconto: Number(r['descontos']),
    renegociados: Number(r['renegociados']),
    cancelados: Number(r['cancelados']),
    churnEfeitoContas: Number(r['churn_contas']),
    churnEfeitoCentavos: String(r['churn_mrr']),
  }))
}

// ═══ META CONTRA REALIZADO ═══════════════════════════════════════════════════

export interface LinhaDaMeta {
  readonly competencia: string
  /** Nulo é "sem meta definida", que a tela mostra diferente de meta zero. */
  readonly metaCentavos: string | null
  readonly metaAcumuladaCentavos: string | null
  readonly churnCentavos: string
  readonly churnAcumuladoCentavos: string
  /** Meta acumulada menos churn acumulado. Negativo é churn acima da meta. */
  readonly diferencaCentavos: string | null
  readonly definidoPor: string | null
}

/**
 * Meta contra realizado, com as duas curvas ACUMULADAS.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A COLUNA QUE DECIDE É A ACUMULADA, e é a que o pedido nomeia por último.    │
 * │                                                                            │
 * │ Junho de 2026, medido: R$ 57.421 de churn contra uma meta de R$ 100 mil —   │
 * │ o melhor mês do ano. Olhando só o mês, é uma vitória; olhando o acumulado,  │
 * │ ele MELHOROU a diferença de R$ 173 mil para R$ 130 mil, e o ano continua    │
 * │ atrasado. É a única coluna que responde "estamos recuperando ou só tivemos  │
 * │ um mês bom".                                                               │
 * │                                                                            │
 * │ O SINAL: negativo é churn ACIMA da meta, isto é, ruim. Em receita, o sinal  │
 * │ de um número de perda é a primeira coisa que alguém lê errado — a tela diz  │
 * │ isso em texto ao lado da tabela, não só pela cor.                           │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * O realizado conta SÓ `churn_pedido` e `churn_inadimplencia`. Desconto e
 * renegociação são contração: somá-los aqui faria a tabela deixar de ser de churn
 * e passar a ser de receita perdida — que é uma tabela útil, e é outra tabela.
 */
export async function metaVersusRealizado(
  db: pg.Pool,
  de: string,
  ate: string,
): Promise<LinhaDaMeta[]> {
  const { rows } = await db.query(
    `WITH grade AS (
       SELECT generate_series($1::date, $2::date, interval '1 month')::date AS mes
     ),
     churn AS (
       /* ┌───────────────────────────────────────────────────────────────────┐
          │ O REALIZADO SAI DO PIPELINE, e não do ledger de MRR.               │
          │                                                                    │
          │ A primeira versão somava fact.mrr_event, e era erro de conceito:    │
          │ esta tabela fica ao lado do quadro de saídas e responde "batemos a  │
          │ meta de churn?". O ledger é derivado do faturamento do Omie e não   │
          │ sabe POR QUE a receita parou — cliente que mudou para cobrança      │
          │ trimestral entra lá como churn. A meta seria cobrada contra um      │
          │ número que inclui quem não saiu.                                    │
          │                                                                    │
          │ Aqui o realizado é o que o time REGISTROU e levou até a perda, no   │
          │ mês em que a receita para. Mesma fonte dos KPI e do quadro: a tela  │
          │ inteira conta uma história só.                                      │
          └───────────────────────────────────────────────────────────────────┘ */
       SELECT c.competencia_efeito_receita AS mes,
              coalesce(sum(c.mrr_centavos_na_levantada), 0) AS v
         FROM success.cancellation c
        WHERE c.competencia_efeito_receita IS NOT NULL
          AND c.estado IN ('em_aviso', 'encerrado')
        GROUP BY 1
     )
     SELECT to_char(g.mes, 'YYYY-MM-DD') AS mes,
            m.meta_centavos::text        AS meta,
            -- Acumulado da META: nulo enquanto NENHUM mês do período tem meta. Um
            -- acumulado que soma zero por falta de meta afirmaria meta zero.
            CASE WHEN count(m.meta_centavos) OVER (ORDER BY g.mes) > 0
                 THEN sum(coalesce(m.meta_centavos, 0)) OVER (ORDER BY g.mes)
            END::text                    AS meta_acumulada,
            coalesce(c.v, 0)::text       AS churn,
            sum(coalesce(c.v, 0)) OVER (ORDER BY g.mes)::text AS churn_acumulado,
            m.definido_por
       FROM grade g
       LEFT JOIN success.meta_churn m ON m.competencia = g.mes
       LEFT JOIN churn c ON c.mes = g.mes
      ORDER BY g.mes`,
    [de.slice(0, 7) + '-01', ate.slice(0, 7) + '-01'],
  )
  return rows.map((r) => {
    const metaAcum = r['meta_acumulada'] === null ? null : String(r['meta_acumulada'])
    const churnAcum = String(r['churn_acumulado'])
    return {
      competencia: String(r['mes']),
      metaCentavos: r['meta'] === null ? null : String(r['meta']),
      metaAcumuladaCentavos: metaAcum,
      churnCentavos: String(r['churn']),
      churnAcumuladoCentavos: churnAcum,
      diferencaCentavos: metaAcum === null ? null : String(Number(metaAcum) - Number(churnAcum)),
      definidoPor: (r['definido_por'] as string | null) ?? null,
    }
  })
}

/**
 * Define ou corrige a meta de um mês.
 *
 * Exige `configurar`: meta é combinado da casa, não decisão de quem trabalha a
 * fila. E é UPDATE em vez de apagar-e-criar, para `definido_por` e `definido_em`
 * dizerem quem mudou por último — meta que muda sem autor é meta que ninguém
 * combinou.
 */
export async function definirMeta(
  db: pg.Pool,
  id: Identidade,
  competencia: string,
  metaCentavos: string,
  nota?: string,
): Promise<void> {
  if (!id.permissoes.configurar) {
    throw new Error('definir meta de churn exige permissão de configurar')
  }
  const v = Number(metaCentavos)
  if (!Number.isFinite(v) || v < 0) throw new Error('meta tem de ser um valor em centavos, não negativo')
  await db.query(
    `INSERT INTO success.meta_churn (competencia, meta_centavos, definido_por, nota)
     VALUES (($1::text || '-01')::date, $2, $3, $4)
     ON CONFLICT (competencia) DO UPDATE
        SET meta_centavos = excluded.meta_centavos,
            definido_por  = excluded.definido_por,
            definido_em   = now(),
            nota          = excluded.nota`,
    [competencia.slice(0, 7), Math.round(v), id.email, nota ?? null],
  )
}
