import { exigirConta, recorteDaConta, veBaseDeContas, type Identidade } from '@pulse/auth'

import type pg from 'pg'

import { perderPorSaida } from './renovacao.js'

/**
 * Churn real — a saída modelada como PROCESSO, com quatro datas.
 *
 * Doc 01 (v1.0), seção 10.1. Quando um cliente levanta a mão ele está perdido
 * comercialmente naquele dia, mas a receita dele continua entrando durante todo
 * o aviso prévio. São dois fatos em momentos diferentes, e tratá-los como um só
 * produz duas distorções opostas:
 *
 *   reconhecer a receita como perdida no dia do anúncio  → subestima o trimestre;
 *   contar o cliente como ativo até o último pagamento   → esconde uma perda que
 *                                                          já aconteceu e que
 *                                                          ainda dava para reverter.
 *
 * Por isso cada métrica lê a data que lhe corresponde:
 *
 *   data_levantada               → CHURN DE CONTAS
 *   data_fim_aviso               → o prazo duro da retenção
 *   competencia_ultima_cobranca  → confirmada pelo Financeiro
 *   competencia_efeito_receita   → CHURN DE RECEITA (última cobrança + 1)
 *
 * As transições daqui não repetem as invariantes: quem as impõe é o banco
 * (`efeito_receita_exige_duas_confirmacoes`, `encerrado_tem_efeito_e_aprovacao`).
 * Este módulo existe para que a transição ilegal falhe com uma frase que uma
 * pessoa entende, em vez de com uma violação de CHECK.
 */

/**
 * As oito posições do quadro, e `em_aviso` que não está na lista de oito.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ TRÊS ETAPAS DE TRABALHO e QUATRO DESFECHOS, mais o aviso correndo.          │
 * │                                                                            │
 * │ A diferença entre etapa e desfecho não é vocabulário: num quadro em que      │
 * │ desfecho é coluna de trabalho, a coluna nunca esvazia — ela acumula tudo     │
 * │ que já aconteceu, e em seis meses ninguém acha o que está aberto no meio     │
 * │ do que está encerrado.                                                     │
 * │                                                                            │
 * │ `encerrado` cobre as posições 7 e 8 do quadro (Cancelamento e Cancelamento   │
 * │ Alloyal), separadas por `origem`. Dois estados para a mesma posição          │
 * │ contábil dariam duas formas de escrever a mesma coisa, e uma delas seria     │
 * │ esquecida na próxima consulta.                                             │
 * │                                                                            │
 * │ `em_aviso` não está nas oito posições que o pedido descreve, e existe: é o   │
 * │ cancelamento já decidido enquanto o aviso prévio corre e o cliente AINDA     │
 * │ PAGA. O quadro mostra junto de cancelamento; a competência de efeito é que   │
 * │ diz quando a receita para.                                                 │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export type EstadoSaida =
  // ── etapas: o pedido ESTÁ nelas ──
  | 'anunciado'
  | 'financeiro'
  | 'reversao'
  // ── decidido, aviso prévio correndo ──
  | 'em_aviso'
  // ── desfechos: o pedido PAROU neles ──
  | 'retido'
  | 'desconto'
  | 'renegociado'
  | 'encerrado'

/** O que o cliente pediu. Decide quais desfechos fazem sentido. */
export type PedidoDeSaida = 'cancelar' | 'desconto'

/** As etapas de trabalho, na ordem do quadro. */
export const ETAPAS_DE_TRABALHO = ['anunciado', 'financeiro', 'reversao'] as const

/** Os desfechos, e o que cada um faz com a receita. */
export const DESFECHOS_DE_SAIDA = [
  { estado: 'retido', rotulo: 'Cancelamento revertido', efeito: 'nada' },
  { estado: 'desconto', rotulo: 'Desconto', efeito: 'contracao' },
  { estado: 'renegociado', rotulo: 'Renegociação financeira', efeito: 'contracao_se_mudou' },
  { estado: 'encerrado', rotulo: 'Cancelamento', efeito: 'churn' },
] as const

/**
 * Dias parado numa etapa antes de o pedido aparecer como estagnado.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ 14 DIAS, e o número tem motivo: é menor que o menor aviso prévio praticado  │
 * │ (30 dias), então o pedido aparece como estagnado ENQUANTO ainda há tempo de │
 * │ agir. Prazo maior que o aviso avisaria depois de a decisão já estar tomada. │
 * │                                                                            │
 * │ Um pedido parado na tentativa de reversão é um cancelamento que ninguém     │
 * │ quis anunciar. Sem a regra de idade, o quadro conta uma história melhor que │
 * │ a real — pedido esquecido parece pedido em andamento.                       │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export const DIAS_PARA_ESTAGNAR = 14
export type OrigemSaida = 'cliente' | 'alloyal'
export type CanalAnuncio = 'email' | 'reuniao' | 'whatsapp' | 'formulario' | 'telefone'

/**
 * A taxonomia fechada de motivos de saída.
 *
 * Texto livre não sustenta análise de padrão: com campo aberto, "preço",
 * "custo", "caro" e "orçamento" viram quatro motivos distintos, e a pergunta
 * "por que perdemos clientes" deixa de ter resposta. A lista é curta de
 * propósito — taxonomia grande é preenchida no chute.
 *
 * `outro` existe e exige detalhe: sem ele, quem não acha a categoria escolhe a
 * primeira que parece caber, e contamina a categoria certa.
 */
export const MOTIVOS_SAIDA = [
  { valor: 'custo', rotulo: 'Custo', explica: 'preço, orçamento ou corte de despesa' },
  { valor: 'baixa_adesao', rotulo: 'Baixa adesão', explica: 'o clube não pegou na base' },
  { valor: 'insatisfacao_produto', rotulo: 'Insatisfação com o produto', explica: 'falha, lacuna ou experiência' },
  { valor: 'insatisfacao_atendimento', rotulo: 'Insatisfação com o atendimento', explica: 'suporte ou relacionamento' },
  { valor: 'concorrente', rotulo: 'Foi para o concorrente', explica: 'trocou por outro fornecedor' },
  { valor: 'mudanca_interna', rotulo: 'Mudança interna do cliente', explica: 'troca de gestão, fusão, reestruturação' },
  { valor: 'encerramento_atividade', rotulo: 'Encerrou atividade', explica: 'a empresa fechou ou foi adquirida' },
  { valor: 'churn_inadimplencia', rotulo: 'Inadimplência', explica: 'encerramento pela Alloyal, decisão de crédito' },
  { valor: 'outro', rotulo: 'Outro', explica: 'exige detalhe escrito' },
] as const

export type MotivoSaida = (typeof MOTIVOS_SAIDA)[number]['valor']

/** O rótulo legível de um motivo, ou o próprio código se vier de fora da lista. */
export function rotuloDoMotivo(motivo: string | null): string | null {
  if (!motivo) return null
  return MOTIVOS_SAIDA.find((m) => m.valor === motivo)?.rotulo ?? motivo.replace(/_/g, ' ')
}

export class TransicaoInvalidaError extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'TransicaoInvalidaError'
  }
}

export class SemPermissaoError extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'SemPermissaoError'
  }
}

/**
 * Quais transições saem de cada estado.
 *
 * `retido` e `encerrado` são terminais de propósito. Reabrir uma saída encerrada
 * moveria receita entre competências já congeladas; se o cliente voltar, o
 * evento certo é uma reativação nova, não a edição da saída antiga.
 */
export const TRANSICOES: Readonly<Record<EstadoSaida, readonly EstadoSaida[]>> = {
  // Do pedido dá para ir direto ao desfecho: cliente que liga pedindo desconto e
  // aceita na mesma conversa não passa por etapa nenhuma, e obrigá-lo a passar
  // faria o registro ser feito depois — ou não ser feito.
  anunciado: ['financeiro', 'reversao', 'retido', 'desconto', 'renegociado', 'em_aviso'],
  financeiro: ['reversao', 'retido', 'desconto', 'renegociado', 'em_aviso'],
  reversao: ['retido', 'desconto', 'renegociado', 'em_aviso'],
  em_aviso: ['retido', 'encerrado'],
  // Os quatro desfechos são terminais. Reabrir moveria receita entre competências
  // já congeladas; se o cliente voltar, o evento certo é uma reativação nova.
  retido: [],
  desconto: [],
  renegociado: [],
  encerrado: [],
}

export function podeIr(de: EstadoSaida, para: EstadoSaida): boolean {
  return TRANSICOES[de].includes(para)
}

/**
 * A competência em que a receita sai: último mês cobrado + 1.
 *
 * É derivada, nunca digitada. Deixar alguém digitar significa que um dia o
 * churn de receita e a última cobrança vão discordar, e a diferença aparecerá
 * como um ajuste sem explicação no fechamento.
 */
export function competenciaDeEfeito(ultimaCobranca: string): string {
  const [ano, mes] = ultimaCobranca.split('-').map(Number) as [number, number]
  const proximo = mes === 12 ? 1 : mes + 1
  const anoDoProximo = mes === 12 ? ano + 1 : ano
  return `${anoDoProximo}-${String(proximo).padStart(2, '0')}-01`
}

/** A data em que a janela de retenção fecha. */
export function fimDoAviso(dataLevantada: string, avisoPrevioDias: number): string {
  const d = new Date(`${dataLevantada}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + avisoPrevioDias)
  return d.toISOString().slice(0, 10)
}

export interface Saida {
  id: string
  accountId: string
  conta: string
  origem: OrigemSaida
  estado: EstadoSaida
  dataLevantada: string | null
  canal: CanalAnuncio | null
  quemComunicou: string | null
  mrrCentavosNaLevantada: string | null
  multaAplicavelCentavos: string | null
  debitoAbertoNaLevantadaCentavos: string | null
  avisoPrevioDias: number | null
  avisoConfirmadoPor: string | null
  avisoConfirmadoEm: string | null
  dataFimAviso: string | null
  competenciaUltimaCobranca: string | null
  cobrancaConfirmadaPor: string | null
  cobrancaConfirmadaEm: string | null
  competenciaEfeitoReceita: string | null
  motivo: string | null
  /**
   * Quem confirmou o motivo — e é por ser OUTRA pessoa que o CHECK do banco
   * aceita. `null` é motivo não confirmado, que não é o mesmo que sem motivo:
   * o campo `motivo` pode estar preenchido por quem abriu o pedido.
   */
  motivoConfirmadoPor: string | null
  retidoEm: string | null
  retidoPor: string | null
  aprovadoPor: string | null
  /** Dias que faltam para a janela de retenção fechar; negativo se já fechou. */
  diasParaFimDoAviso: number | null
  criadoEm: string
}

/**
 * O que falta para esta saída poder ser encerrada.
 *
 * Lista, não booleano: "não pode encerrar" sem dizer o que falta é como um
 * distrato fica parado três semanas esperando alguém descobrir qual campo
 * estava em branco.
 */
export function faltaParaEncerrar(s: Saida): string[] {
  const falta: string[] = []
  if (s.avisoConfirmadoPor === null) falta.push('confirmação do aviso prévio (CS ou Jurídico)')
  if (s.competenciaUltimaCobranca === null || s.cobrancaConfirmadaPor === null) {
    falta.push('confirmação do último mês de cobrança (Financeiro)')
  }
  if (s.aprovadoPor === null) falta.push('aprovação do distrato')
  return falta
}

const COLUNAS = `
  c.id, c.account_id AS "accountId", a.razao_social AS conta,
  c.origem, c.estado,
  to_char(c.data_levantada,'YYYY-MM-DD')              AS "dataLevantada",
  c.canal, c.quem_comunicou                            AS "quemComunicou",
  c.mrr_centavos_na_levantada::text                    AS "mrrCentavosNaLevantada",
  c.multa_aplicavel_centavos::text                     AS "multaAplicavelCentavos",
  c.debito_aberto_na_levantada_centavos::text          AS "debitoAbertoNaLevantadaCentavos",
  c.aviso_previo_dias                                  AS "avisoPrevioDias",
  c.aviso_confirmado_por                               AS "avisoConfirmadoPor",
  c.aviso_confirmado_em                                AS "avisoConfirmadoEm",
  to_char(c.data_fim_aviso,'YYYY-MM-DD')               AS "dataFimAviso",
  to_char(c.competencia_ultima_cobranca,'YYYY-MM')     AS "competenciaUltimaCobranca",
  c.cobranca_confirmada_por                            AS "cobrancaConfirmadaPor",
  c.cobranca_confirmada_em                             AS "cobrancaConfirmadaEm",
  to_char(c.competencia_efeito_receita,'YYYY-MM')      AS "competenciaEfeitoReceita",
  c.motivo, c.motivo_confirmado_por                    AS "motivoConfirmadoPor",
  to_char(c.retido_em,'YYYY-MM-DD') AS "retidoEm", c.retido_por AS "retidoPor",
  c.aprovado_por AS "aprovadoPor",
  (c.data_fim_aviso - current_date)                    AS "diasParaFimDoAviso",
  c.criado_em                                          AS "criadoEm"`

/** Registra a levantada de mão. É o instante do churn de CONTAS. */
export async function anunciar(
  db: pg.Pool,
  id: Identidade,
  dados: {
    accountId: string
    origem: OrigemSaida
    dataLevantada?: string
    canal?: CanalAnuncio
    quemComunicou?: string
    motivo?: string
    motivoDetalhe?: string
    /** Cancelar ou desconto. É a porta de entrada dos dois, e decide o desfecho. */
    pedido?: PedidoDeSaida
    /** Vence a derivação. Para o cliente que parou de pagar e só agora formaliza. */
    mrrCentavos?: string
    /** Do contrato quando há; digitado quando não — nem o Omie guarda prazo de aviso. */
    avisoPrevioDias?: number
  },
): Promise<string> {
  if (id.permissoes.fila === 'nenhum' && !id.permissoes.configurar) {
    throw new SemPermissaoError('registrar saída exige acesso à fila de trabalho')
  }
  if (dados.origem === 'cliente' && !dados.dataLevantada) {
    throw new TransicaoInvalidaError(
      'levantada de mão exige a data em que o cliente comunicou — é a data do churn de contas',
    )
  }
  // A conta vem de fora (FormData), e o INSERT lê `core.contract` para congelar o MRR
  // da levantada. Sem este recorte, um CSM abre saída em conta de outra carteira — e o
  // valor do contrato alheio volta na resposta.
  await exigirConta(db, id, dados.accountId, 'conta')

  const cliente = await db.connect()
  try {
    await cliente.query('BEGIN')

    // Uma conta não pode ter duas saídas abertas: a segunda duplicaria o MRR na
    // conta de saída comprometida, e o número que o board olha dobraria.
    const { rows: abertas } = await cliente.query<{ id: string }>(
      `SELECT id FROM success.cancellation
        WHERE account_id = $1 AND estado IN ('anunciado','financeiro','reversao','em_aviso')
          FOR UPDATE`,
      [dados.accountId],
    )
    if (abertas.length > 0) {
      throw new TransicaoInvalidaError(
        'já existe uma saída em andamento para esta conta — atualize aquela em vez de abrir outra',
      )
    }

    /* ┌─────────────────────────────────────────────────────────────────────┐
       │ O MRR É RESOLVIDO ANTES DO INSERT, e não dentro dele.                  │
       │                                                                      │
       │ A primeira versão guardava depois: o INSERT rodava, o CHECK do banco   │
       │ `origem_cliente_tem_levantada` recusava, e quem chamava recebia        │
       │ "violates check constraint origem_cliente_tem_levantada" — exatamente  │
       │ o tipo de resposta que o cabeçalho deste arquivo diz que não se dá a    │
       │ uma pessoa. O guarda em TypeScript nunca era alcançado.                │
       └─────────────────────────────────────────────────────────────────────┘ */
    const { rows: fonte } = await cliente.query<{ mrr: string | null; aviso: number | null }>(
      `SELECT coalesce($2::bigint, ct.mrr_centavos, fm.mrr_centavos)::text AS mrr,
              coalesce($3::int, ct.aviso_previo_dias)                      AS aviso
         FROM (SELECT 1) AS existe
         LEFT JOIN LATERAL (
           SELECT mrr_centavos, aviso_previo_dias FROM core.contract
            WHERE account_id = $1 AND status_vigencia = 'vigente'
            ORDER BY inicio DESC LIMIT 1
         ) ct ON true
         LEFT JOIN LATERAL (
           SELECT mrr_centavos FROM analytics.mrr_faturado_mes
            WHERE account_id = $1
              AND competencia >= date_trunc('month', current_date) - interval '2 months'
            ORDER BY competencia DESC LIMIT 1
         ) fm ON true`,
      [dados.accountId, dados.mrrCentavos ?? null, dados.avisoPrevioDias ?? null],
    )
    const mrrCongelado = fonte[0]?.mrr ?? null
    const avisoResolvido = fonte[0]?.aviso ?? null

    /* ┌─────────────────────────────────────────────────────────────────────┐
       │ A INVARIANTE É "HÁ MRR PARA CONGELAR", e não "há contrato vigente".    │
       │                                                                      │
       │ O guarda antigo era sobre a FONTE — sem linha em `core.contract`, o     │
       │ INSERT não inseria nada. Isso deixou o fluxo inteiro morto em produção, │
       │ onde aquela tabela tem zero linhas, e é por isso que a tabela de saídas │
       │ ficou meses existindo sem uma única linha.                             │
       │                                                                      │
       │ O que a checagem protegia continua valendo: sem o valor de antes não há │
       │ como medir a perda depois, nem contração num desconto. Só que o valor   │
       │ vem de três lugares — contrato, faturado ou digitado — e exigir a fonte │
       │ em vez do valor era o que travava.                                     │
       │                                                                      │
       │ Origem `alloyal` (PDD) passa sem MRR: cortar por crédito um cliente que │
       │ já não paga é justamente o caso em que não há valor, e a restrição de   │
       │ banco só exige o valor quando o pedido vem do cliente.                 │
       └─────────────────────────────────────────────────────────────────────┘ */
    if (dados.origem === 'cliente' && !mrrCongelado) {
      throw new TransicaoInvalidaError(
        'não há MRR para congelar nesta conta: sem contrato vigente, sem faturamento nos últimos meses e sem valor informado. Sem o valor de antes não há como medir a perda depois.',
      )
    }

    /* ┌─────────────────────────────────────────────────────────────────────┐
       │ ESTE INSERT NUNCA INSERIU NADA, e é por isso que a tabela tem zero      │
       │ linhas depois de existir por meses.                                     │
       │                                                                        │
       │ Ele era `INSERT ... SELECT FROM core.contract WHERE ...`, e             │
       │ `core.contract` está VAZIA — o ciclo C5, que a alimentaria do HubSpot,   │
       │ não está ligado. `SELECT` sem linha insere zero linhas, o `RETURNING`    │
       │ volta vazio, e quem chamasse recebia um erro de índice indefinido em vez │
       │ de "não há contrato". O fluxo de saídas estava morto na porta de entrada.│
       │                                                                        │
       │ Agora o contrato é OPCIONAL e os três números vêm de onde existem:      │
       │  · MRR   → `analytics.mrr_faturado_mes`, a mesma fonte da cascata e da   │
       │            carteira. Se as três discordassem do MRR do mesmo cliente na  │
       │            hora do cancelamento, seria o pior momento possível.          │
       │  · dívida → `fact.inadimplencia_titulo`, a foto apurada.                 │
       │  · aviso  → do contrato quando há; senão digitado, porque nem            │
       │            `core.omie_contrato` guarda prazo de aviso prévio.            │
       │                                                                        │
       │ `mrrCentavos` pode vir de fora e vence os dois: é o caso do cliente que  │
       │ parou de pagar meses atrás e só agora formaliza a saída — aí não há MRR  │
       │ recente para derivar, e quem registra sabe o valor.                     │
       └─────────────────────────────────────────────────────────────────────┘

       MRR, multa e débito são CONGELADOS aqui. Durante o aviso o contrato pode
       ser reajustado ou contraído, e a perda tem que ser medida contra o valor
       que existia quando o cliente decidiu sair. */
    const { rows } = await cliente.query<{ id: string; mrr: string | null }>(
      `INSERT INTO success.cancellation
         (account_id, contract_id, origem, estado, pedido, criado_por,
          data_levantada, canal, quem_comunicou, motivo, motivo_detalhe,
          mrr_centavos_na_levantada, multa_aplicavel_centavos,
          debito_aberto_na_levantada_centavos, aviso_previo_dias)
       SELECT $1, ct.id, $2, 'anunciado', $8, $9, $3::date, $4, $5, $6, $7,
              $10::bigint,
              NULL,
              ina.aberto_centavos,
              $11::int
         FROM (SELECT 1) AS existe
         LEFT JOIN LATERAL (
           SELECT id FROM core.contract
            WHERE account_id = $1 AND status_vigencia = 'vigente'
            ORDER BY inicio DESC LIMIT 1
         ) ct ON true
         LEFT JOIN LATERAL (
           SELECT sum(valor_centavos) AS aberto_centavos
             FROM fact.inadimplencia_titulo
            WHERE account_id = $1 AND movimento IN ('permaneceu', 'entrou')
              AND competencia = (SELECT max(competencia) FROM fact.inadimplencia_titulo)
         ) ina ON true
       RETURNING id, mrr_centavos_na_levantada::text AS mrr`, 
      [
        dados.accountId,
        dados.origem,
        dados.dataLevantada ?? null,
        dados.canal ?? null,
        dados.quemComunicou ?? null,
        dados.motivo ?? null,
        dados.motivoDetalhe ?? null,
        dados.pedido ?? 'cancelar',
        id.email,
        mrrCongelado,
        avisoResolvido,
      ],
    )
    /* ┌─────────────────────────────────────────────────────────────────────┐
       │ A INVARIANTE É "HÁ MRR PARA CONGELAR", e não "há contrato vigente".    │
       │                                                                      │
       │ Antes o guarda era `rows.length === 0`, porque o INSERT lia            │
       │ `core.contract` e sem contrato não inseria nada. Isso deixava o fluxo  │
       │ inteiro morto em produção, onde aquela tabela tem zero linhas.         │
       │                                                                      │
       │ O que a checagem protegia continua valendo, e é isto: sem o valor de   │
       │ antes não há como medir a perda depois, nem contração num desconto. Só │
       │ que o valor pode vir de três lugares — contrato, faturado, ou digitado │
       │ — e exigir a FONTE em vez do VALOR era o que travava.                 │
       │                                                                      │
       │ Origem `alloyal` (PDD) passa sem MRR: a restrição de banco             │
       │ `origem_cliente_tem_levantada` só exige o valor quando o pedido vem do │
       │ cliente, e cortar por crédito um cliente que já não paga é o caso em   │
       │ que não há MRR mesmo.                                                 │
       └─────────────────────────────────────────────────────────────────────┘ */
    await cliente.query('COMMIT')
    return String(rows[0]!.id)
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    cliente.release()
  }
}

/**
 * CONFIRMAÇÃO 1 — o aviso prévio, por CS ou Jurídico.
 *
 * O contrato diz N dias, mas há acordo, renúncia e prorrogação: é o campo que
 * mais desloca receita entre meses, e por isso é confirmado por uma pessoa em
 * vez de copiado em silêncio.
 */
export async function confirmarAviso(
  db: pg.Pool,
  id: Identidade,
  saidaId: string,
  avisoPrevioDias: number,
): Promise<void> {
  if (id.permissoes.fila === 'nenhum' && !id.permissoes.configurar) {
    throw new SemPermissaoError('confirmar aviso prévio exige acesso à fila de trabalho')
  }
  if (!Number.isInteger(avisoPrevioDias) || avisoPrevioDias < 0) {
    throw new TransicaoInvalidaError('aviso prévio em dias tem que ser um inteiro não negativo')
  }

  const { rowCount } = await db.query(
    `UPDATE success.cancellation
        SET aviso_previo_dias = $3,
            -- Saída pedida pelo cliente conta a partir da levantada; saída da
            -- Alloyal por inadimplência não tem levantada — o equivalente é a
            -- data da provisão, que é quando o registro nasceu.
            data_fim_aviso = COALESCE(data_levantada, criado_em::date) + $3::int,
            aviso_confirmado_por = $2,
            aviso_confirmado_em = now(),
            -- De qualquer ETAPA de trabalho o aviso confirmado leva a em_aviso: o
            -- cancelamento passou a ser um fato, e a tentativa de reversão acabou.
            estado = CASE WHEN estado IN ('anunciado','financeiro','reversao')
                          THEN 'em_aviso' ELSE estado END,
            etapa_desde = CASE WHEN estado IN ('anunciado','financeiro','reversao')
                               THEN now() ELSE etapa_desde END
      WHERE id = $1 AND estado IN ('anunciado','financeiro','reversao','em_aviso')
        AND ${recorteDaConta('success.cancellation.account_id', 4, 2)}`,
    [saidaId, id.email, avisoPrevioDias, veBaseDeContas(id)],
  )
  if (rowCount === 0) {
    throw new TransicaoInvalidaError('saída não está aberta, ou não é de conta da sua carteira')
  }
}

/**
 * CONFIRMAÇÃO 2 — o último mês de cobrança, pelo Financeiro.
 *
 * Só o Financeiro sabe se a última fatura saiu, foi rateada ou antecipada. É
 * aqui que `competencia_efeito_receita` nasce, derivada — e o banco recusa
 * gravá-la sem as duas confirmações.
 */
export async function confirmarUltimaCobranca(
  db: pg.Pool,
  id: Identidade,
  saidaId: string,
  competenciaUltimaCobranca: string,
): Promise<{ competenciaEfeitoReceita: string }> {
  if (id.permissoes.aprovaDistrato !== 'financeiro' && !id.permissoes.configurar) {
    throw new SemPermissaoError(
      'só o Financeiro confirma o último mês de cobrança — é quem sabe se a fatura saiu',
    )
  }
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(competenciaUltimaCobranca)) {
    throw new TransicaoInvalidaError('competência tem que estar em AAAA-MM')
  }
  const comp = competenciaUltimaCobranca.slice(0, 7) + '-01'
  const efeito = competenciaDeEfeito(comp)

  const { rowCount } = await db.query(
    `UPDATE success.cancellation
        SET competencia_ultima_cobranca = $3::date,
            cobranca_confirmada_por = $2,
            cobranca_confirmada_em = now(),
            -- Só é gravada quando a OUTRA confirmação já existe. O banco também
            -- recusa, mas recusar aqui dá uma mensagem que uma pessoa entende.
            competencia_efeito_receita =
              CASE WHEN aviso_confirmado_por IS NOT NULL THEN $4::date END
      WHERE id = $1 AND estado IN ('anunciado','financeiro','reversao','em_aviso')
        AND ${recorteDaConta('success.cancellation.account_id', 5, 2)}`,
    [saidaId, id.email, comp, efeito, veBaseDeContas(id)],
  )
  if (rowCount === 0)
    throw new TransicaoInvalidaError('saída não está aberta, ou não é de conta da sua carteira')
  return { competenciaEfeitoReceita: efeito }
}

/**
 * Retenção — a saída revertida dentro da janela.
 *
 * É a métrica de vitória do time de CS que a maioria das empresas nunca
 * calcula, e por isso ela é um ESTADO e não um `delete`: apagar a saída
 * apagaria junto a prova de que houve reversão.
 */
export async function reter(
  db: pg.Pool,
  id: Identidade,
  saidaId: string,
  nota?: string,
  /**
   * A data da retenção. Padrão: a do banco.
   *
   * Existe para o teste poder fixá-la, e o motivo é concreto: a retenção é contada
   * na competência de `retido_em`, e com `current_date` o mesmo teste caía em julho
   * num dia e em agosto no seguinte — passava quando foi escrito e falhava sozinho
   * depois, sem ninguém mexer em nada.
   */
  hoje?: string,
): Promise<void> {
  if (id.permissoes.fila === 'nenhum' && !id.permissoes.configurar) {
    throw new SemPermissaoError('registrar retenção exige acesso à fila de trabalho')
  }
  const { rowCount } = await db.query(
    `UPDATE success.cancellation
        SET estado = 'retido', retido_em = COALESCE($5::date, current_date), retido_por = $2,
            motivo_detalhe = COALESCE($3, motivo_detalhe), etapa_desde = now()
      WHERE id = $1 AND estado IN ('anunciado','financeiro','reversao','em_aviso')
        AND ${recorteDaConta('success.cancellation.account_id', 4, 2)}`,
    [saidaId, id.email, nota ?? null, veBaseDeContas(id), hoje ?? null],
  )
  if (rowCount === 0) {
    throw new TransicaoInvalidaError('só um pedido em andamento, de conta da sua carteira, pode ser revertido')
  }
}

/**
 * Encerramento — a receita sai da base e o evento entra no ledger.
 *
 * O gate humano é aqui, e o evento em `fact.mrr_event` é gravado na MESMA
 * transação: ledger e processo não podem discordar nem por um instante, porque
 * o fechamento mensal lê o ledger e ninguém reconcilia o que não sabe que
 * divergiu.
 */
export async function encerrar(
  db: pg.Pool,
  id: Identidade,
  saidaId: string,
): Promise<{ competenciaEfeitoReceita: string; valorCentavos: string }> {
  if (id.permissoes.aprovaDistrato === 'nao' && !id.permissoes.configurar) {
    throw new SemPermissaoError('encerrar exige alçada de aprovação de distrato')
  }

  const cliente = await db.connect()
  try {
    await cliente.query('BEGIN')
    const { rows } = await cliente.query<Saida>(
      // O recorte aqui é defesa em profundidade: hoje nenhum papel combina alçada
      // de distrato com escopo de carteira, então a cláusula não barra ninguém. Ela
      // existe para o dia em que um papel novo combinar as duas coisas — e nesse dia
      // ninguém vai revisar esta consulta.
      `SELECT ${COLUNAS} FROM success.cancellation c
         JOIN core.account a ON a.id = c.account_id
        WHERE c.id = $1
          AND ($2::boolean OR a.csm_email = $3)
        FOR UPDATE OF c`,
      [saidaId, id.permissoes.contas === 'base', id.email],
    )
    const s = rows[0]
    if (!s) throw new TransicaoInvalidaError('saída não encontrada')
    if (s.estado === 'retido' || s.estado === 'encerrado') {
      throw new TransicaoInvalidaError(
        s.estado === 'retido'
          ? 'esta saída foi revertida; se o cliente sair de novo, o caminho é uma saída nova'
          : 'esta saída já foi encerrada',
      )
    }
    // A lista vem ANTES da checagem de estado para o caso aberto: dizer "uma
    // saída em anunciado não pode ser encerrada" é verdade e não ajuda ninguém —
    // o que a pessoa precisa saber é qual confirmação está faltando.
    const falta = faltaParaEncerrar({ ...s, aprovadoPor: 'ok' })
    if (falta.length > 0) {
      throw new TransicaoInvalidaError(`falta antes de encerrar: ${falta.join('; ')}`)
    }

    const efeito = competenciaDeEfeito(s.competenciaUltimaCobranca! + '-01')
    const valor = -Math.abs(Number(s.mrrCentavosNaLevantada ?? 0))

    await cliente.query(
      `UPDATE success.cancellation
          SET estado = 'encerrado', aprovado_por = $2, aprovado_em = now(),
              competencia_efeito_receita = $3::date,
              /* ┌───────────────────────────────────────────────────────────────┐
                 │ QUEM APROVA CONFIRMA O MOTIVO, e é aqui que a decisão 4 se     │
                 │ paga sem custar um passo a mais.                                │
                 │                                                               │
                 │ O motivo confirmado por outra pessoa é a prática de win/loss    │
                 │ de vendas: quem conduziu tem viés, e "custo" é o motivo mais    │
                 │ confortável de escrever. Mas exigir uma AÇÃO separada criaria   │
                 │ um travamento real — num time pequeno, o pedido ficaria aberto  │
                 │ esperando a segunda pessoa passar.                             │
                 │                                                               │
                 │ E não precisa: encerrar já exige aprovaDistrato, isto e, JA e │
                 │ outra pessoa. O CHECK motivo_confirmado_por_outra_pessoa        │
                 │ recusa se for a mesma — então a garantia vem do banco e o passo │
                 │ a mais não existe. Confirmação explícita continua disponível    │
                 │ em confirmarMotivo, para quem quiser confirmar antes.         │
                 └───────────────────────────────────────────────────────────────┘ */
              motivo_confirmado_por = COALESCE(motivo_confirmado_por, $2),
              motivo_confirmado_em = COALESCE(motivo_confirmado_em, now())
        WHERE id = $1`,
      [saidaId, id.email, efeito],
    )

    // O contrato para de produzir receita no ÚLTIMO DIA da última competência
    // cobrada. Sem isto, o ledger diz que a receita saiu e a base de contratos
    // diz que não — e a cascata publica a diferença como resíduo não atribuído
    // todo mês, para sempre. Foi assim que este bug apareceu: o resíduo o achou.
    //
    // `vigencia_fim` NÃO é alterado. Ele é o fim contratado, e a diferença entre
    // os dois é o prazo restante — o fato que caracteriza multa por rescisão
    // antecipada, e que o Jurídico vai precisar.
    await cliente.query(
      `UPDATE core.contract
          SET encerrado_em = ($2::date + INTERVAL '1 month - 1 day')::date,
              status_vigencia = 'encerrado',
              atualizado_em = now()
        WHERE id = (SELECT contract_id FROM success.cancellation WHERE id = $1)`,
      [saidaId, s.competenciaUltimaCobranca + '-01'],
    )

    // A renovação aberta desta conta morre aqui, na mesma transação. Sem isto a
    // conta sai pela porta da saída e continua na previsão de renovação como
    // receita esperada — dois módulos contando a mesma conta de formas opostas, e
    // a previsão somando receita de quem já foi embora.
    await perderPorSaida(cliente, s.accountId, id.email)

    // `chave_natural` faz a gravação ser idempotente: dois cliques no botão de
    // aprovar não podem virar duas baixas de receita.
    await cliente.query(
      `INSERT INTO fact.mrr_event
         (account_id, contract_id, competencia, valor_centavos, tipo, motivo,
          origem, criado_por, chave_natural)
       SELECT c.account_id, c.contract_id, $2::date, $3, $4, c.motivo,
              'ops', $5, 'cancelamento:' || c.id
         FROM success.cancellation c WHERE c.id = $1
       ON CONFLICT (chave_natural) DO NOTHING`,
      [
        saidaId,
        efeito,
        valor,
        s.origem === 'alloyal' ? 'churn_inadimplencia' : 'churn_pedido',
        id.email,
      ],
    )

    await cliente.query('COMMIT')
    return { competenciaEfeitoReceita: efeito.slice(0, 7), valorCentavos: String(valor) }
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    cliente.release()
  }
}

export async function listarSaidas(
  db: pg.Pool,
  id: Identidade,
  opts: { estados?: readonly EstadoSaida[] } = {},
): Promise<Saida[]> {
  if (id.permissoes.contas === 'nenhum') return []
  const daBase = id.permissoes.contas === 'base'
  const estados = opts.estados ?? ['anunciado', 'em_aviso', 'retido', 'encerrado']

  const { rows } = await db.query<Saida>(
    `SELECT ${COLUNAS}
       FROM success.cancellation c
       JOIN core.account a ON a.id = c.account_id
      WHERE c.estado = ANY($1)
        AND ($2::boolean OR a.csm_email = $3)
      -- Aberto primeiro, e dentro dele o que tem menos janela de retenção: é o
      -- que ainda dá para reverter, e é a única parte desta tela que é ação.
      ORDER BY (c.estado IN ('anunciado','financeiro','reversao','em_aviso')) DESC,
               c.data_fim_aviso NULLS FIRST, c.data_levantada DESC`,
    [estados, daBase, id.email],
  )
  return rows.map((r) => ({
    ...r,
    diasParaFimDoAviso: r.diasParaFimDoAviso === null ? null : Number(r.diasParaFimDoAviso),
  }))
}

export interface ResumoChurn {
  competencia: string
  /** Contas que levantaram a mão NESTA competência — churn de contas. */
  contasQueLevantaram: number
  mrrQueLevantouCentavos: string
  /**
   * Quantas daquelas levantadas foram revertidas DEPOIS.
   *
   * Vem separado em vez de subtraído do total porque `contasQueLevantaram`
   * precisa ser estável: um número de mês fechado que muda sozinho quando o
   * processo avança é a definição de relatório em que ninguém confia. Quem
   * quiser o líquido subtrai; quem quiser o bruto tem o bruto.
   */
  retidasDepois: number
  /** Contas cujo efeito na receita cai NESTA competência — churn de receita. */
  contasComEfeito: number
  mrrRealizadoCentavos: string
  /** MRR anunciado que ainda está faturando: nem ativo saudável, nem perdido. */
  mrrComprometidoCentavos: string
  contasComprometidas: number
  retidasNaCompetencia: number
  mrrRetidoCentavos: string
}

/**
 * Os dois churns, lado a lado, cada um lendo a data que lhe corresponde.
 *
 * Ver juntos é o ponto: o mês em que as contas saem quase nunca é o mês em que
 * a receita sai, e a diferença entre os dois — a SAÍDA COMPROMETIDA — é o
 * número que responde "quanto do faturamento de hoje já está perdido".
 */
export async function resumoChurn(db: pg.Pool, competencia: string): Promise<ResumoChurn> {
  const { rows } = await db.query<Record<string, string>>(
    `WITH mes AS (SELECT date_trunc('month', $1::date)::date AS ini)
     SELECT
       -- Churn de CONTAS: lê data_levantada, e conta TODAS — inclusive as que
       -- foram revertidas depois. O bruto é estável; o líquido sai da coluna
       -- ao lado.
       count(*) FILTER (
         WHERE date_trunc('month', data_levantada) = (SELECT ini FROM mes)
       )::text AS contas_levantaram,
       COALESCE(sum(mrr_centavos_na_levantada) FILTER (
         WHERE date_trunc('month', data_levantada) = (SELECT ini FROM mes)
       ), 0)::text AS mrr_levantou,
       count(*) FILTER (
         WHERE date_trunc('month', data_levantada) = (SELECT ini FROM mes)
           AND estado = 'retido'
       )::text AS retidas_depois,

       -- Churn de RECEITA: lê competencia_efeito_receita.
       count(*) FILTER (
         WHERE competencia_efeito_receita = (SELECT ini FROM mes)
       )::text AS contas_efeito,
       COALESCE(sum(mrr_centavos_na_levantada) FILTER (
         WHERE competencia_efeito_receita = (SELECT ini FROM mes)
       ), 0)::text AS mrr_realizado,

       -- COMPROMETIDO: já anunciado e ainda faturando NAQUELE mês.
       --
       -- A condição é sobre DATAS, nunca sobre o estado atual. Filtrar por
       -- estado (qualquer um dos abertos) daria a resposta certa só enquanto
       -- a saída estivesse aberta: no instante em que alguém clicasse em
       -- encerrar, o comprometido de julho cairia de R$ 40 mil para zero, e um
       -- mês já fechado passaria a contar outra história.
       count(*) FILTER (
         WHERE data_levantada <= ((SELECT ini FROM mes) + INTERVAL '1 month - 1 day')
           AND (retido_em IS NULL
                OR retido_em > ((SELECT ini FROM mes) + INTERVAL '1 month - 1 day'))
           AND (competencia_efeito_receita IS NULL
                OR competencia_efeito_receita > (SELECT ini FROM mes))
       )::text AS contas_comprometidas,
       COALESCE(sum(mrr_centavos_na_levantada) FILTER (
         WHERE data_levantada <= ((SELECT ini FROM mes) + INTERVAL '1 month - 1 day')
           AND (retido_em IS NULL
                OR retido_em > ((SELECT ini FROM mes) + INTERVAL '1 month - 1 day'))
           AND (competencia_efeito_receita IS NULL
                OR competencia_efeito_receita > (SELECT ini FROM mes))
       ), 0)::text AS mrr_comprometido,

       count(*) FILTER (
         WHERE estado = 'retido' AND date_trunc('month', retido_em) = (SELECT ini FROM mes)
       )::text AS retidas,
       COALESCE(sum(mrr_centavos_na_levantada) FILTER (
         WHERE estado = 'retido' AND date_trunc('month', retido_em) = (SELECT ini FROM mes)
       ), 0)::text AS mrr_retido
     FROM success.cancellation`,
    [competencia],
  )
  const r = rows[0]!
  return {
    competencia: competencia.slice(0, 7),
    contasQueLevantaram: Number(r['contas_levantaram']),
    mrrQueLevantouCentavos: r['mrr_levantou']!,
    retidasDepois: Number(r['retidas_depois']),
    contasComEfeito: Number(r['contas_efeito']),
    mrrRealizadoCentavos: r['mrr_realizado']!,
    mrrComprometidoCentavos: r['mrr_comprometido']!,
    contasComprometidas: Number(r['contas_comprometidas']),
    retidasNaCompetencia: Number(r['retidas']),
    mrrRetidoCentavos: r['mrr_retido']!,
  }
}

// ═══ AS ETAPAS DE TRABALHO, e os desfechos que SALVAM o cliente ══════════════

/**
 * Move o pedido de uma etapa de trabalho para outra.
 *
 * Só entre as três etapas: os desfechos têm função própria, porque cada um faz
 * algo diferente com a receita e um `UPDATE estado` genérico deixaria o ledger de
 * fora. `etapa_desde` é reiniciado, e é ele que alimenta a lista de estagnados.
 */
export async function avancarEtapa(
  db: pg.Pool,
  id: Identidade,
  saidaId: string,
  para: 'anunciado' | 'financeiro' | 'reversao',
): Promise<void> {
  if (id.permissoes.fila === 'nenhum' && !id.permissoes.configurar) {
    throw new SemPermissaoError('mover pedido exige acesso à fila de trabalho')
  }
  const { rowCount } = await db.query(
    `UPDATE success.cancellation
        SET estado = $3, etapa_desde = now()
      WHERE id = $1
        AND estado IN ('anunciado', 'financeiro', 'reversao')
        AND estado <> $3
        AND ${recorteDaConta('success.cancellation.account_id', 4, 2)}`,
    [saidaId, id.email, para, veBaseDeContas(id)],
  )
  if (rowCount === 0) {
    throw new TransicaoInvalidaError(
      'só um pedido em etapa de trabalho, de conta da sua carteira, muda de etapa — e não para a mesma',
    )
  }
}

/**
 * Desconto concedido: o cliente FICA, pagando menos.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ISTO NÃO É CHURN, E O LEDGER TEM DE DIZER ISSO.                            │
 * │                                                                            │
 * │ O evento é `contracao`, com o valor da diferença contra o MRR congelado na  │
 * │ levantada. Lançar churn aqui contaria como perda um cliente que ficou, e a  │
 * │ cascata em /receita passaria a mostrar uma conta perdida que está na base.  │
 * │                                                                            │
 * │ E o contrário também importa: NÃO lançar nada esconderia a receita que      │
 * │ deixou de entrar. Contração é exatamente o nome dessa coisa.                │
 * │                                                                            │
 * │ O desfecho é terminal. Se o cliente pedir de novo daqui a seis meses, é um  │
 * │ pedido NOVO — e é isso que permite contar quantas vezes um cliente pediu.   │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Exige aprovação de distrato, como o encerramento: desconto é decisão sobre
 * receita recorrente, e o Pulse já tem quem pode tomá-la.
 */
export async function concederDesconto(
  db: pg.Pool,
  id: Identidade,
  saidaId: string,
  dados: { mrrNovoCentavos: string; competenciaEfeito: string; nota?: string },
): Promise<{ contracaoCentavos: string; competencia: string }> {
  if (id.permissoes.aprovaDistrato === 'nao') {
    throw new SemPermissaoError('conceder desconto exige permissão de aprovar distrato')
  }
  const comp = dados.competenciaEfeito.slice(0, 7) + '-01'
  const cliente = await db.connect()
  try {
    await cliente.query('BEGIN')

    const { rows } = await cliente.query<{ mrr: string | null; conta: string }>(
      `SELECT mrr_centavos_na_levantada::text AS mrr, account_id::text AS conta
         FROM success.cancellation
        WHERE id = $1 AND estado IN ('anunciado', 'financeiro', 'reversao')
          AND ${recorteDaConta('success.cancellation.account_id', 3, 2)}
          FOR UPDATE`,
      [saidaId, id.email, veBaseDeContas(id)],
    )
    const atual = rows[0]
    if (!atual) {
      throw new TransicaoInvalidaError(
        'só um pedido em andamento, de conta da sua carteira, recebe desconto',
      )
    }
    const antes = Number(atual.mrr ?? 0)
    const depois = Number(dados.mrrNovoCentavos)
    if (!(antes > 0)) {
      throw new TransicaoInvalidaError(
        'o pedido não tem MRR na levantada — sem o valor de antes não há contração a lançar',
      )
    }
    if (!(depois >= 0) || depois >= antes) {
      throw new TransicaoInvalidaError(
        'o MRR com desconto tem de ser menor que o da levantada; igual ou maior não é desconto',
      )
    }

    await cliente.query(
      `UPDATE success.cancellation
          SET estado = 'desconto', etapa_desde = now(),
              mrr_novo_centavos = $2, competencia_efeito_receita = $3::date,
              aprovado_por = $4, aprovado_em = now(),
              motivo_detalhe = COALESCE($5, motivo_detalhe)
        WHERE id = $1`,
      [saidaId, depois, comp, id.email, dados.nota ?? null],
    )

    // Contração é NEGATIVA no ledger, como churn e ao contrário de expansão. A
    // cascata faz `abs()` no agregado, e o sinal aqui é o que a torna somável.
    await cliente.query(
      `INSERT INTO fact.mrr_event
         (account_id, competencia, valor_centavos, tipo, motivo, origem, criado_por,
          chave_natural)
       VALUES ($1, $2::date, $3, 'contracao', 'desconto concedido em pedido de saída',
               'ops', $4, 'desconto:' || $5)
       ON CONFLICT (chave_natural) DO NOTHING`,
      [atual.conta, comp, -(antes - depois), id.email, saidaId],
    )

    await cliente.query('COMMIT')
    return { contracaoCentavos: String(antes - depois), competencia: comp }
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => undefined)
    throw erro
  } finally {
    cliente.release()
  }
}

/**
 * Renegociação financeira: parcela a dívida, muda vencimento ou prazo.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ MEXE NO RECEBÍVEL, E SÓ MEXE NO MRR SE O MENSAL MUDAR.                     │
 * │                                                                            │
 * │ É a diferença que a lista de desfechos esconde: parcelar R$ 30 mil de       │
 * │ dívida em seis vezes não altera o MRR — altera quando o dinheiro entra, que │
 * │ é a inadimplência e não a receita. Lançar contração aí seria contar como    │
 * │ perda de receita recorrente uma mudança de prazo.                          │
 * │                                                                            │
 * │ Por isso `mrrNovoCentavos` é OPCIONAL aqui, e obrigatório no desconto: são  │
 * │ dois desfechos que se parecem e fazem coisas diferentes com o ledger.       │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export async function renegociar(
  db: pg.Pool,
  id: Identidade,
  saidaId: string,
  dados: { mrrNovoCentavos?: string; competenciaEfeito?: string; nota?: string },
): Promise<{ contracaoCentavos: string | null }> {
  if (id.permissoes.aprovaDistrato === 'nao') {
    throw new SemPermissaoError('renegociar exige permissão de aprovar distrato')
  }
  const cliente = await db.connect()
  try {
    await cliente.query('BEGIN')

    const { rows } = await cliente.query<{ mrr: string | null; conta: string }>(
      `SELECT mrr_centavos_na_levantada::text AS mrr, account_id::text AS conta
         FROM success.cancellation
        WHERE id = $1 AND estado IN ('anunciado', 'financeiro', 'reversao')
          AND ${recorteDaConta('success.cancellation.account_id', 3, 2)}
          FOR UPDATE`,
      [saidaId, id.email, veBaseDeContas(id)],
    )
    const atual = rows[0]
    if (!atual) {
      throw new TransicaoInvalidaError(
        'só um pedido em andamento, de conta da sua carteira, é renegociado',
      )
    }

    const antes = Number(atual.mrr ?? 0)
    const depois = dados.mrrNovoCentavos === undefined ? null : Number(dados.mrrNovoCentavos)
    const mudouOMensal = depois !== null && antes > 0 && depois !== antes
    const comp = (dados.competenciaEfeito ?? '').slice(0, 7)
    if (mudouOMensal && !comp) {
      throw new TransicaoInvalidaError(
        'renegociação que muda o mensal precisa da competência de efeito — é ela que decide em que mês a contração entra',
      )
    }

    await cliente.query(
      `UPDATE success.cancellation
          SET estado = 'renegociado', etapa_desde = now(),
              mrr_novo_centavos = $2,
              competencia_efeito_receita = CASE WHEN $3::text <> '' THEN ($3 || '-01')::date END,
              aprovado_por = $4, aprovado_em = now(),
              motivo_detalhe = COALESCE($5, motivo_detalhe)
        WHERE id = $1`,
      [saidaId, depois, comp, id.email, dados.nota ?? null],
    )

    if (mudouOMensal) {
      // Pode ser contração OU expansão: renegociar para cima acontece, e chamar
      // isso de contração pelo nome do desfecho seria o ledger mentindo.
      const delta = depois - antes
      await cliente.query(
        `INSERT INTO fact.mrr_event
           (account_id, competencia, valor_centavos, tipo, motivo, origem, criado_por,
            chave_natural)
         VALUES ($1, ($2 || '-01')::date, $3, $4,
                 'renegociação em pedido de saída', 'ops', $5, 'renegociacao:' || $6)
         ON CONFLICT (chave_natural) DO NOTHING`,
        [atual.conta, comp, delta, delta < 0 ? 'contracao' : 'expansao', id.email, saidaId],
      )
    }

    await cliente.query('COMMIT')
    return { contracaoCentavos: mudouOMensal ? String(antes - (depois ?? 0)) : null }
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => undefined)
    throw erro
  } finally {
    cliente.release()
  }
}

/**
 * Confirma o motivo — e quem confirma NÃO pode ser quem registrou.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ VEM DA PRÁTICA DE WIN/LOSS DE VENDAS: quem conduziu o caso tem viés, e      │
 * │ "custo" é o motivo mais confortável de escrever. Toda a análise de churn     │
 * │ depende deste campo, e um campo preenchido por quem tem interesse na         │
 * │ resposta não sustenta análise nenhuma.                                     │
 * │                                                                            │
 * │ O banco também recusa (`motivo_confirmado_por_outra_pessoa`). A checagem     │
 * │ aqui existe para a recusa chegar como frase legível em vez de violação de    │
 * │ CHECK no meio de um clique.                                                │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export async function confirmarMotivo(
  db: pg.Pool,
  id: Identidade,
  saidaId: string,
  dados: { motivo: MotivoSaida; detalhe?: string },
): Promise<void> {
  if (id.permissoes.fila === 'nenhum' && !id.permissoes.configurar) {
    throw new SemPermissaoError('confirmar motivo exige acesso à fila de trabalho')
  }
  if (dados.motivo === 'outro' && !dados.detalhe?.trim()) {
    throw new TransicaoInvalidaError('o motivo "outro" exige detalhe escrito — é o que impede a categoria de virar depósito')
  }
  const { rows } = await db.query<{ criado_por: string | null }>(
    `SELECT criado_por FROM success.cancellation
      WHERE id = $1 AND ${recorteDaConta('success.cancellation.account_id', 3, 2)}`,
    [saidaId, id.email, veBaseDeContas(id)],
  )
  const dono = rows[0]
  if (!dono) throw new TransicaoInvalidaError('pedido não encontrado na sua carteira')
  if (dono.criado_por === id.email) {
    throw new SemPermissaoError(
      'o motivo é confirmado por outra pessoa: quem registrou o pedido não confirma o próprio motivo',
    )
  }
  await db.query(
    `UPDATE success.cancellation
        SET motivo = $2, motivo_detalhe = COALESCE($3, motivo_detalhe),
            motivo_confirmado_por = $4, motivo_confirmado_em = now()
      WHERE id = $1`,
    [saidaId, dados.motivo, dados.detalhe ?? null, id.email],
  )
}
