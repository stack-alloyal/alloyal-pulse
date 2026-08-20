import type { Identidade } from '@pulse/auth'
import type pg from 'pg'

/**
 * Match e merge de identidades do cliente.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O PROBLEMA, medido em 13/08/2026 na Swile: um cliente tem MAIS DE UMA       │
 * │ identidade em cada sistema, e nenhuma regra automática liga todas.          │
 * │                                                                            │
 * │ · No Omie são duas fichas com CNPJs de raízes diferentes (37374538 e         │
 * │   26401688) — a empresa mudou de LTDA para S.A. e o cadastro antigo ficou.   │
 * │ · No HubSpot são duas empresas, porque ganho, upsell e downsell criam        │
 * │   negócio novo. Isso é HISTÓRIA COMERCIAL, não sujeira.                     │
 * │                                                                            │
 * │ Daí as três regras deste módulo:                                            │
 * │                                                                            │
 * │ 1. Uma conta tem N identidades por fonte, não uma.                          │
 * │ 2. Uma identidade pertence a UMA conta — a trava `vinculo_chave_unica`. Sem  │
 * │    ela o mesmo faturamento entra em duas contas e a receita da empresa passa │
 * │    a depender de quantas vezes alguém clicou em vincular.                    │
 * │ 3. Todo vínculo e desvínculo vira evento imutável, com autor e motivo. A     │
 * │    pergunta que aparece três meses depois é "por que o faturamento deste     │
 * │    cliente mudou de valor?", e só a trilha responde.                        │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

export type FonteDeVinculo = 'omie' | 'hubspot'
export type OrigemDeVinculo = 'exato' | 'raiz' | 'manual' | 'ciclo'

export class VinculoInvalidoError extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'VinculoInvalidoError'
  }
}

export class VinculoOcupadoError extends Error {
  readonly contaAtual: string
  readonly nomeContaAtual: string
  constructor(chave: string, contaAtual: string, nomeContaAtual: string) {
    super(
      `a identidade ${chave} já pertence a ${nomeContaAtual}. Desvincule lá primeiro — ` +
        `a mesma ficha em duas contas contaria o faturamento duas vezes.`,
    )
    this.name = 'VinculoOcupadoError'
    this.contaAtual = contaAtual
    this.nomeContaAtual = nomeContaAtual
  }
}

export interface VinculoDeCliente {
  readonly id: string
  readonly fonte: FonteDeVinculo
  readonly chave: string
  readonly origem: OrigemDeVinculo
  readonly motivo: string | null
  readonly criadoPor: string
  readonly criadoEm: Date
  /** O que a chave descreve, para a tela não mostrar só um número. */
  readonly rotulo: string | null
  readonly inativo: boolean | null
  /** Peso financeiro desta identidade — o que se perde ou se ganha ao desvincular. */
  readonly titulos: number
  readonly valorCentavos: number
}

export interface EventoDeVinculo {
  readonly id: string
  readonly fonte: FonteDeVinculo
  readonly chave: string
  readonly acao: 'vinculou' | 'desvinculou'
  readonly origem: string | null
  readonly motivo: string | null
  readonly quem: string
  readonly quando: Date
  readonly rotulo: string | null
}

/** As identidades vigentes da conta, com o que cada uma carrega de faturamento. */
export async function vinculosDaConta(db: pg.Pool, accountId: string): Promise<VinculoDeCliente[]> {
  const { rows } = await db.query<VinculoDeCliente>(
    `SELECT v.id::text, v.fonte, v.chave, v.origem, v.motivo,
            v.criado_por AS "criadoPor", v.criado_em AS "criadoEm",
            CASE v.fonte WHEN 'omie' THEN o.razao_social ELSE NULL END AS rotulo,
            CASE v.fonte WHEN 'omie' THEN o.inativo ELSE NULL END AS inativo,
            coalesce(t.n, 0)::int AS titulos,
            coalesce(t.v, 0)::bigint AS "valorCentavos"
       FROM core.vinculo_cliente v
       LEFT JOIN core.omie_cliente o
              ON v.fonte = 'omie' AND o.documento = v.chave
       LEFT JOIN LATERAL (
              SELECT count(*) n, sum(valor_centavos) v
                FROM core.omie_titulo
               WHERE v.fonte = 'omie' AND documento = v.chave
                 AND (vencimento IS NULL OR vencimento <= current_date)
            ) t ON true
      WHERE v.account_id = $1
      ORDER BY v.fonte, coalesce(t.v, 0) DESC, v.chave`,
    [accountId],
  )
  return rows
}

export async function historicoDeVinculos(
  db: pg.Pool,
  accountId: string,
): Promise<EventoDeVinculo[]> {
  const { rows } = await db.query<EventoDeVinculo>(
    `SELECT e.id::text, e.fonte, e.chave, e.acao, e.origem, e.motivo, e.quem, e.quando,
            CASE e.fonte WHEN 'omie' THEN o.razao_social ELSE NULL END AS rotulo
       FROM core.vinculo_evento e
       LEFT JOIN core.omie_cliente o ON e.fonte = 'omie' AND o.documento = e.chave
      WHERE e.account_id = $1
      ORDER BY e.quando DESC, e.id DESC`,
    [accountId],
  )
  return rows
}

/**
 * Um candidato: identidade não vinculada que provavelmente é do mesmo cliente.
 *
 * `evidencia` é o que sustenta a suspeita, e vem junto de propósito. Sugestão sem
 * evidência transforma a área de match em roleta: a pessoa aceita porque o sistema
 * sugeriu, e o sistema sugeriu porque dois nomes começam igual.
 */
export interface Candidato {
  readonly fonte: FonteDeVinculo
  readonly chave: string
  readonly rotulo: string
  readonly inativo: boolean
  readonly evidencia: 'hubspot' | 'raiz' | 'nome'
  readonly detalhe: string
  readonly titulos: number
  readonly valorCentavos: number
  /** Quando já pertence a outra conta, dizer de quem — antes de alguém tentar. */
  readonly jaVinculadaA: string | null
}

const FORCA: Record<Candidato['evidencia'], number> = { hubspot: 3, raiz: 2, nome: 1 }

/**
 * Quantas fichas um termo pode compartilhar e ainda identificar alguém.
 *
 * 6 é escolha, e a medição sustenta: os termos que passavam a peneira antiga
 * apareciam em 40 a 167 fichas. Acima disso o termo é categoria, não nome.
 */
export const LIMITE_TERMO_RARO = 6

/**
 * Procura identidades do Omie que parecem ser desta conta e ainda não estão ligadas.
 *
 * Três evidências, da mais forte para a mais fraca:
 *
 * · `hubspot` — a ficha do Omie declara um `idHubspot` que ESTA conta já reivindica.
 *   É a mais forte porque atravessa o CNPJ: pega exatamente o caso do cadastro
 *   antigo que virou empresa nova.
 * · `raiz` — mesma raiz de CNPJ. Boa, e insuficiente sozinha: matriz e filial
 *   compartilham raiz e podem ser contas diferentes de propósito.
 * · `nome` — mesmo primeiro termo da razão social, e só quando esse termo é RARO.
 *   É a mais fraca e está aqui porque foi a única que encontraria a Swile.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A RARIDADE NÃO É REFINAMENTO, é a diferença entre a tela servir e enganar.  │
 * │ Vi na primeira versão pronta: "Banco Afro" aparecia com R$ 949 mil          │
 * │ pendentes porque `BANCO` casa com todo banco do Omie. Medido, os termos      │
 * │ iniciais mais comuns são CASHBACK (167 fichas), LUCAS (126), MARIA (100),   │
 * │ ASSOCIACAO (85), POSTO (56) — nomes próprios de pessoa física e palavras    │
 * │ genéricas de empresa.                                                      │
 * │                                                                            │
 * │ Lista de palavras proibidas seria interminável e teria que ser mantida à    │
 * │ mão. A raridade se mede: termo em mais de LIMITE_TERMO_RARO fichas não      │
 * │ identifica ninguém, e a evidência simplesmente não nasce.                   │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export async function candidatosDaConta(db: pg.Pool, accountId: string): Promise<Candidato[]> {
  const { rows } = await db.query<Candidato & { forca: number }>(
    `WITH conta AS (
       SELECT a.id, a.razao_social, a.cnpj,
              regexp_replace(coalesce(a.cnpj,''), '[^0-9]', '', 'g') doc,
              core.termo(a.razao_social) primeira
         FROM core.account a WHERE a.id = $1
     ),
     raros AS (
       SELECT core.termo(o.razao_social) t
         FROM core.omie_cliente o, conta c
        WHERE core.termo(o.razao_social) = c.primeira
        GROUP BY 1 HAVING count(*) <= $2
     ),
     hubs AS (
       SELECT chave FROM core.vinculo_cliente WHERE account_id = $1 AND fonte = 'hubspot'
     ),
     achados AS (
       SELECT o.documento chave, o.razao_social rotulo, o.inativo,
              'hubspot'::text evidencia,
              'a ficha declara idHubspot ' || o.hubspot_id || ', que esta conta reivindica' detalhe
         FROM core.omie_cliente o, conta c
        WHERE o.hubspot_id IS NOT NULL
          AND o.hubspot_id IN (SELECT chave FROM hubs)
       UNION ALL
       SELECT o.documento, o.razao_social, o.inativo, 'raiz',
              'mesma raiz de CNPJ (' || left(c.doc, 8) || ')'
         FROM core.omie_cliente o, conta c
        WHERE length(c.doc) = 14 AND length(o.documento) = 14
          AND left(o.documento, 8) = left(c.doc, 8)
       UNION ALL
       SELECT o.documento, o.razao_social, o.inativo, 'nome',
              'mesmo primeiro termo "' || c.primeira || '", raro no Omie'
         FROM core.omie_cliente o, conta c
        WHERE length(c.primeira) >= 5
          AND core.termo(o.razao_social) = c.primeira
          -- Só termo RARO. Ver o comentário da função: BANCO casa com todo banco.
          -- A frequência sai de uma agregação, não de subconsulta por linha: a
          -- primeira versão levou a tela a "timed out" na carga real.
          AND c.primeira IN (SELECT t FROM raros)
     ),
     -- A mesma ficha pode chegar por duas evidências; fica a mais forte.
     melhor AS (
       SELECT DISTINCT ON (chave) chave, rotulo, inativo, evidencia, detalhe,
              CASE evidencia WHEN 'hubspot' THEN 3 WHEN 'raiz' THEN 2 ELSE 1 END forca
         FROM achados
        ORDER BY chave, CASE evidencia WHEN 'hubspot' THEN 3 WHEN 'raiz' THEN 2 ELSE 1 END DESC
     )
     SELECT 'omie'::text fonte, m.chave, m.rotulo, m.inativo, m.evidencia, m.detalhe, m.forca,
            coalesce(t.n,0)::int titulos, coalesce(t.v,0)::bigint AS "valorCentavos",
            dono.razao_social AS "jaVinculadaA"
       FROM melhor m
       LEFT JOIN LATERAL (
              SELECT count(*) n, sum(valor_centavos) v FROM core.omie_titulo
               WHERE documento = m.chave AND (vencimento IS NULL OR vencimento <= current_date)
            ) t ON true
       LEFT JOIN core.vinculo_cliente vc ON vc.fonte='omie' AND vc.chave = m.chave
       LEFT JOIN core.account dono ON dono.id = vc.account_id
      -- Fora as que ESTA conta já tem: candidato é o que falta, não o que existe.
      WHERE NOT EXISTS (
              SELECT 1 FROM core.vinculo_cliente v
               WHERE v.account_id = $1 AND v.fonte='omie' AND v.chave = m.chave)
      ORDER BY m.forca DESC, coalesce(t.v,0) DESC
      LIMIT 25`,
    [accountId, LIMITE_TERMO_RARO],
  )
  return rows.map(({ forca: _forca, ...c }) => c)
}

/**
 * O diagnóstico da conta: o que está ligado, o que falta, e quanto isso vale.
 *
 * Existe porque o sintoma que chega é "o faturamento da Swile está errado", e nunca
 * "falta um vínculo". A tela precisa transformar o primeiro no segundo sozinha.
 */
export interface DiagnosticoDeVinculo {
  readonly vinculos: number
  readonly vinculosOmie: number
  readonly vinculosHubspot: number
  readonly candidatos: number
  /** Faturamento que os candidatos carregam — o tamanho do que pode estar faltando. */
  readonly candidatoValorCentavos: number
  readonly candidatoForte: boolean
  /** Vínculo apontando para ficha inativa no Omie, tendo candidato ativo à mão. */
  readonly apontaParaInativa: boolean
}

export async function diagnosticoDaConta(db: pg.Pool, accountId: string): Promise<DiagnosticoDeVinculo> {
  const [vinculos, candidatos] = await Promise.all([
    vinculosDaConta(db, accountId),
    candidatosDaConta(db, accountId),
  ])
  const livres = candidatos.filter((c) => !c.jaVinculadaA)
  const omie = vinculos.filter((v) => v.fonte === 'omie')
  return {
    vinculos: vinculos.length,
    vinculosOmie: omie.length,
    vinculosHubspot: vinculos.filter((v) => v.fonte === 'hubspot').length,
    candidatos: livres.length,
    candidatoValorCentavos: livres.reduce((s, c) => s + Number(c.valorCentavos), 0),
    candidatoForte: livres.some((c) => FORCA[c.evidencia] >= 2),
    // O caso Swile em uma linha: liga na ficha morta e existe uma viva sobrando.
    apontaParaInativa:
      omie.length > 0 && omie.every((v) => v.inativo === true) && livres.some((c) => !c.inativo),
  }
}

/** Liga uma identidade à conta. Manual exige motivo; o evento é sempre gravado. */
export async function vincular(
  db: pg.Pool,
  id: Identidade,
  d: { accountId: string; fonte: FonteDeVinculo; chave: string; motivo?: string; origem?: OrigemDeVinculo },
): Promise<void> {
  const origem = d.origem ?? 'manual'
  const motivo = d.motivo?.trim() ?? ''
  if (origem === 'manual' && motivo.length < 10) {
    throw new VinculoInvalidoError(
      'vincular à mão exige motivo escrito — este vínculo muda o faturamento que o cliente mostra, e quem olhar em três meses precisa saber por quê',
    )
  }
  const chave = d.chave.trim()
  if (!chave) throw new VinculoInvalidoError('identidade vazia')

  const cliente = await db.connect()
  try {
    await cliente.query('BEGIN')
    // Quem já é dono, ANTES de tentar inserir: a mensagem de unique violation não
    // diz de quem é, e "já existe" manda a pessoa procurar no escuro.
    const { rows: dono } = await cliente.query<{ account_id: string; razao_social: string }>(
      `SELECT v.account_id::text, a.razao_social
         FROM core.vinculo_cliente v JOIN core.account a ON a.id = v.account_id
        WHERE v.fonte = $1 AND v.chave = $2`,
      [d.fonte, chave],
    )
    const atual = dono[0]
    if (atual && atual.account_id !== d.accountId) {
      throw new VinculoOcupadoError(chave, atual.account_id, atual.razao_social)
    }
    if (atual) {
      await cliente.query('ROLLBACK')
      return
    }

    await cliente.query(
      `INSERT INTO core.vinculo_cliente (account_id, fonte, chave, origem, motivo, criado_por)
       VALUES ($1, $2, $3, $4, NULLIF($5,''), $6)`,
      [d.accountId, d.fonte, chave, origem, motivo, id.email],
    )
    await cliente.query(
      `INSERT INTO core.vinculo_evento (account_id, fonte, chave, acao, origem, motivo, quem)
       VALUES ($1, $2, $3, 'vinculou', $4, NULLIF($5,''), $6)`,
      [d.accountId, d.fonte, chave, origem, motivo, id.email],
    )
    await cliente.query('COMMIT')
  } catch (e) {
    await cliente.query('ROLLBACK')
    throw e
  } finally {
    cliente.release()
  }
}

/**
 * Desliga uma identidade. Exige motivo SEMPRE — inclusive para vínculo automático.
 *
 * Desvincular reduz o faturamento que o cliente mostra. É a operação com maior
 * chance de assustar alguém depois, e a que mais precisa de explicação escrita.
 */
export async function desvincular(
  db: pg.Pool,
  id: Identidade,
  d: { accountId: string; fonte: FonteDeVinculo; chave: string; motivo: string },
): Promise<void> {
  const motivo = d.motivo?.trim() ?? ''
  if (motivo.length < 10) {
    throw new VinculoInvalidoError(
      'desvincular exige motivo escrito — o faturamento do cliente vai mudar de valor, e a trilha é o que explica isso depois',
    )
  }
  const cliente = await db.connect()
  try {
    await cliente.query('BEGIN')
    const { rowCount } = await cliente.query(
      `DELETE FROM core.vinculo_cliente WHERE account_id = $1 AND fonte = $2 AND chave = $3`,
      [d.accountId, d.fonte, d.chave],
    )
    if (rowCount === 0) {
      throw new VinculoInvalidoError('esta identidade não está vinculada a esta conta')
    }
    await cliente.query(
      `INSERT INTO core.vinculo_evento (account_id, fonte, chave, acao, motivo, quem)
       VALUES ($1, $2, $3, 'desvinculou', $4, $5)`,
      [d.accountId, d.fonte, d.chave, motivo, id.email],
    )
    await cliente.query('COMMIT')
  } catch (e) {
    await cliente.query('ROLLBACK')
    throw e
  } finally {
    cliente.release()
  }
}

/**
 * A fila de match: contas onde o vínculo provavelmente está incompleto ou errado.
 *
 * ORDENADA POR DINHEIRO EM JOGO, e não por nome ou por data. Uma lista de 779
 * contas sem vínculo ordenada alfabeticamente é uma lista que ninguém termina; a
 * primeira página tem que ser onde o erro custa mais. A Swile — R$ 1,5 milhão
 * pendurados numa ficha não vinculada — aparece em cima.
 */
export interface LinhaDeMatch {
  readonly accountId: string
  readonly conta: string
  readonly cnpj: string | null
  readonly ativo: boolean
  readonly vinculosOmie: number
  readonly candidatos: number
  readonly candidatoValorCentavos: number
  readonly melhorEvidencia: 'hubspot' | 'raiz' | 'nome' | null
  readonly vinculadoValorCentavos: number
  readonly apontaParaInativa: boolean
}

export async function filaDeMatch(
  db: pg.Pool,
  { limite = 100 }: { limite?: number } = {},
): Promise<LinhaDeMatch[]> {
  const { rows } = await db.query<LinhaDeMatch>(
    `WITH conta AS (
       SELECT a.id, a.razao_social, a.cnpj, a.ativo,
              regexp_replace(coalesce(a.cnpj,''), '[^0-9]', '', 'g') doc,
              core.termo(a.razao_social) primeira
         FROM core.account a
     ),
     -- Frequência de cada termo UMA vez. Com subconsulta por linha esta tela
     -- devolvia "timed out" na base real.
     raros AS (
       SELECT core.termo(razao_social) t FROM core.omie_cliente
        GROUP BY 1 HAVING count(*) <= $2
     ),
     -- TRÊS RAMOS EM UNION ALL, e não um OR. Com OR o planejador não usa índice
     -- nenhum e cai em laço aninhado sobre 3.242 contas × 9.498 fichas.
     pares AS (
       SELECT c.id account_id, o.documento, 3 forca
         FROM conta c
         JOIN core.vinculo_cliente h ON h.account_id = c.id AND h.fonte = 'hubspot'
         JOIN core.omie_cliente o ON o.hubspot_id = h.chave
       UNION ALL
       SELECT c.id, o.documento, 2
         FROM conta c
         JOIN core.omie_cliente o
           ON length(c.doc) = 14 AND length(o.documento) = 14
          AND left(o.documento, 8) = left(c.doc, 8)
       UNION ALL
       SELECT c.id, o.documento, 1
         FROM conta c
         JOIN core.omie_cliente o ON core.termo(o.razao_social) = c.primeira
        WHERE length(c.primeira) >= 5 AND c.primeira IN (SELECT t FROM raros)
     ),
     -- Só ficha SEM DONO. A que já pertence a alguém não é candidata de ninguém —
     -- a mesma ficha em duas contas contaria o faturamento duas vezes.
     livres AS (
       SELECT p.account_id, p.documento, max(p.forca) forca
         FROM pares p
        WHERE NOT EXISTS (SELECT 1 FROM core.vinculo_cliente v
                           WHERE v.fonte = 'omie' AND v.chave = p.documento)
        GROUP BY 1, 2
     ),
     peso AS (
       SELECT documento, count(*) n, sum(valor_centavos) v
         FROM core.omie_titulo
        WHERE vencimento IS NULL OR vencimento <= current_date
        GROUP BY 1
     ),
     cand AS (
       SELECT l.account_id, count(*)::int n,
              coalesce(sum(p.v), 0) valor, max(l.forca) forca,
              bool_or(NOT o.inativo) tem_ativa
         FROM livres l
         JOIN core.omie_cliente o ON o.documento = l.documento
         LEFT JOIN peso p ON p.documento = l.documento
        GROUP BY l.account_id
     ),
     vinc AS (
       SELECT v.account_id, count(*) FILTER (WHERE v.fonte='omie')::int n_omie,
              coalesce(sum(p.v) FILTER (WHERE v.fonte='omie'), 0) valor,
              bool_and(o.inativo) FILTER (WHERE v.fonte='omie') todas_inativas
         FROM core.vinculo_cliente v
         LEFT JOIN core.omie_cliente o ON v.fonte='omie' AND o.documento = v.chave
         LEFT JOIN peso p ON v.fonte='omie' AND p.documento = v.chave
        GROUP BY v.account_id
     )
     SELECT c.id::text AS "accountId", c.razao_social AS conta, c.cnpj, c.ativo,
            coalesce(v.n_omie,0)::int AS "vinculosOmie",
            coalesce(k.n,0)::int AS candidatos,
            coalesce(k.valor,0)::bigint AS "candidatoValorCentavos",
            CASE k.forca WHEN 3 THEN 'hubspot' WHEN 2 THEN 'raiz' WHEN 1 THEN 'nome' END AS "melhorEvidencia",
            coalesce(v.valor,0)::bigint AS "vinculadoValorCentavos",
            coalesce(v.todas_inativas AND k.tem_ativa, false) AS "apontaParaInativa"
       FROM conta c
       JOIN cand k ON k.account_id = c.id
       LEFT JOIN vinc v ON v.account_id = c.id
      ORDER BY k.valor DESC, c.razao_social
      LIMIT $1`,
    [limite, LIMITE_TERMO_RARO],
  )
  return rows
}

export interface ResumoDoMatch {
  readonly contasComCandidato: number
  /** Fichas do Omie sem dono que alguma conta reivindica. Contadas UMA vez. */
  readonly fichasLivres: number
  readonly valorPendenteCentavos: number
  readonly contasSemVinculo: number
  readonly apontandoParaInativa: number
}

/**
 * O resumo conta FICHA DISTINTA, e não a soma das linhas da fila.
 *
 * Somar por conta inflava o total: quatro contas "Hinova" reivindicam as MESMAS
 * fichas, e o valor entrava quatro vezes. A primeira versão exibia R$ 46 milhões
 * de "faturamento não atribuído" numa base cujo faturamento vencido inteiro é
 * R$ 140 milhões — um total que se soma mais de uma vez não é total.
 */
export async function resumoDoMatch(db: pg.Pool): Promise<ResumoDoMatch> {
  const linhas = await filaDeMatch(db, { limite: 5000 })
  const { rows } = await db.query<{ fichas: string; valor: string }>(
    `WITH conta AS (
       SELECT a.id, regexp_replace(coalesce(a.cnpj,''), '[^0-9]', '', 'g') doc,
              core.termo(a.razao_social) primeira
         FROM core.account a
     ),
     raros AS (
       SELECT core.termo(razao_social) t FROM core.omie_cliente
        GROUP BY 1 HAVING count(*) <= $1
     ),
     -- TRÊS RAMOS EM UNION, e não um OR. Com OR o planejador não usa índice
     -- nenhum e cai em laço aninhado: a primeira versão levava 30 s. Cada ramo
     -- sozinho usa o índice da sua condição.
     livres AS (
       SELECT DISTINCT x.documento FROM (
         SELECT o.documento
           FROM core.omie_cliente o
           JOIN core.vinculo_cliente h ON h.fonte='hubspot' AND h.chave = o.hubspot_id
          WHERE o.hubspot_id IS NOT NULL
         UNION
         SELECT o.documento
           FROM core.omie_cliente o JOIN conta c
             ON length(c.doc) = 14 AND length(o.documento) = 14
            AND left(o.documento, 8) = left(c.doc, 8)
         UNION
         SELECT o.documento
           FROM core.omie_cliente o JOIN conta c
             ON core.termo(o.razao_social) = c.primeira
          WHERE length(c.primeira) >= 5 AND c.primeira IN (SELECT t FROM raros)
       ) x
       WHERE NOT EXISTS (SELECT 1 FROM core.vinculo_cliente v
                          WHERE v.fonte='omie' AND v.chave = x.documento)
     )
     SELECT count(*)::text fichas,
            coalesce((SELECT sum(valor_centavos) FROM core.omie_titulo
                       WHERE documento IN (SELECT documento FROM livres)
                         AND (vencimento IS NULL OR vencimento <= current_date)), 0)::text valor
       FROM livres`,
    [LIMITE_TERMO_RARO],
  )
  return {
    contasComCandidato: linhas.length,
    fichasLivres: Number(rows[0]?.fichas ?? 0),
    valorPendenteCentavos: Number(rows[0]?.valor ?? 0),
    contasSemVinculo: linhas.filter((l) => l.vinculosOmie === 0).length,
    apontandoParaInativa: linhas.filter((l) => l.apontaParaInativa).length,
  }
}

/**
 * Vincula sozinho o que o HubSpot já declara. Roda no C20.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ AQUI A EVIDÊNCIA NÃO É HEURÍSTICA, é chave declarada: a ficha do Omie diz    │
 * │ em `idHubspot` a qual empresa do HubSpot ela pertence, e a conta reivindica  │
 * │ essa mesma empresa. Não é "os nomes se parecem" — os dois lados apontam para │
 * │ o mesmo terceiro.                                                          │
 * │                                                                            │
 * │ Medido em 13/08/2026: 83 contas com 100 fichas soltas e R$ 6.000.377,81 de  │
 * │ faturamento não atribuído. Casos como "Tangerino Tecnologia" ↔ "SOLIDES     │
 * │ TECNOLOGIA S/A" (aquisição), "Pix do milhão" ↔ "PIX DO MILHÃO CLUBE DE      │
 * │ BENEFÍCIOS", "Tera+" ↔ "BRAINY HOTEL CONSULTING". Deixar 83 clientes com o  │
 * │ número errado esperando alguém clicar 100 vezes seria escolher o erro.      │
 * │                                                                            │
 * │ DUAS TRAVAS, e a segunda é a que importa:                                   │
 * │                                                                            │
 * │ 1. Só quando a ficha não pertence a ninguém. A trava de unicidade já impede  │
 * │    roubo, mas errar aqui geraria exceção em vez de decisão.                 │
 * │ 2. Só quando EXATAMENTE UMA conta reivindica aquele HubSpot ID. Com duas, a  │
 * │    escolha seria arbitrária e o faturamento iria para a conta errada — e     │
 * │    esse caso vai para a fila de conferência, que é onde gente decide.        │
 * │                                                                            │
 * │ `origem: 'ciclo'` distingue do manual na tela, e o evento fica na trilha com │
 * │ autor `ciclo C20`. Desvincular continua disponível, com motivo.             │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export interface AutoVinculo {
  readonly criados: number
  readonly ambiguos: number
  readonly valorAtribuidoCentavos: number
}

export async function vincularPeloHubspot(db: pg.Pool): Promise<AutoVinculo> {
  const { rows } = await db.query<{
    account_id: string
    documento: string
    valor: string
  }>(
    `WITH candidatas AS (
       SELECT o.documento, o.hubspot_id,
              (SELECT count(*) FROM core.vinculo_cliente h
                WHERE h.fonte='hubspot' AND h.chave = o.hubspot_id) donos,
              -- min(uuid) não existe no Postgres. E aqui não faria falta: o
              -- filtro abaixo exige EXATAMENTE UM dono, então qualquer agregação
              -- devolveria o mesmo. (array_agg(...))[1] é o que expressa isso.
              (SELECT (array_agg(h.account_id))[1] FROM core.vinculo_cliente h
                WHERE h.fonte='hubspot' AND h.chave = o.hubspot_id) account_id
         FROM core.omie_cliente o
        WHERE o.hubspot_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM core.vinculo_cliente v
                           WHERE v.fonte='omie' AND v.chave = o.documento)
     )
     SELECT c.account_id::text, c.documento,
            coalesce((SELECT sum(valor_centavos) FROM core.omie_titulo
                       WHERE documento = c.documento AND situacao <> 'previsao'), 0)::text valor
       FROM candidatas c
      WHERE c.donos = 1 AND c.account_id IS NOT NULL`,
  )

  const ambiguos = await db.query<{ n: string }>(
    `SELECT count(*)::text n FROM core.omie_cliente o
      WHERE o.hubspot_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM core.vinculo_cliente v
                         WHERE v.fonte='omie' AND v.chave = o.documento)
        AND (SELECT count(*) FROM core.vinculo_cliente h
              WHERE h.fonte='hubspot' AND h.chave = o.hubspot_id) > 1`,
  )

  let criados = 0
  let valor = 0
  for (const r of rows) {
    const cliente = await db.connect()
    try {
      await cliente.query('BEGIN')
      const ins = await cliente.query(
        `INSERT INTO core.vinculo_cliente (account_id, fonte, chave, origem, motivo, criado_por)
         VALUES ($1, 'omie', $2, 'ciclo', $3, 'ciclo C20')
         ON CONFLICT (fonte, chave) DO NOTHING`,
        [
          r.account_id,
          r.documento,
          'a ficha do Omie declara o mesmo idHubspot que esta conta reivindica, e nenhuma outra conta o reivindica',
        ],
      )
      if ((ins.rowCount ?? 0) > 0) {
        await cliente.query(
          `INSERT INTO core.vinculo_evento (account_id, fonte, chave, acao, origem, motivo, quem)
           VALUES ($1, 'omie', $2, 'vinculou', 'ciclo', $3, 'ciclo C20')`,
          [r.account_id, r.documento, 'mesmo idHubspot declarado pela ficha, sem ambiguidade'],
        )
        criados++
        valor += Number(r.valor)
      }
      await cliente.query('COMMIT')
    } catch {
      await cliente.query('ROLLBACK')
    } finally {
      cliente.release()
    }
  }

  return { criados, ambiguos: Number(ambiguos.rows[0]?.n ?? 0), valorAtribuidoCentavos: valor }
}

/**
 * Busca livre no cadastro do Omie, por nome ou por documento.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ EXISTE PORQUE `candidatosDaConta` NÃO ACHA TUDO, e por bom motivo: ele só   │
 * │ sugere com evidência forte — HubSpot igual, raiz de CNPJ igual, ou primeiro │
 * │ termo do nome raro. É o que impede a tela de propor "Banco Afro" para       │
 * │ qualquer conta que comece com "Banco".                                     │
 * │                                                                            │
 * │ O preço é que o caso legítimo sem evidência não aparece: a conta chamada    │
 * │ "Playhub" e a ficha do Omie chamada "LCI TELECOM" são o mesmo cliente, e    │
 * │ nenhuma regra automática vai adivinhar. Aí quem sabe é a pessoa, e ela      │
 * │ precisa de um campo de busca — não de uma lista de sugestões.               │
 * │                                                                            │
 * │ Duas defesas que a busca automática já tinha e esta mantém:                 │
 * │  · CNPJ comparado SEM pontuação dos dois lados, com mínimo de 6 dígitos —   │
 * │    "912" senão casaria com todo documento que contém 912 em qualquer        │
 * │    posição;                                                                │
 * │  · diz de quem a ficha já é (`jaVinculadaA`), ANTES de alguém tentar e      │
 * │    tomar o erro de vínculo ocupado.                                        │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export async function buscarNoOmie(
  db: pg.Pool,
  termo: string,
  { limite = 25 }: { limite?: number } = {},
): Promise<Candidato[]> {
  const t = termo.trim()
  if (t.length < 3) return []
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT oc.documento AS chave,
            oc.razao_social,
            oc.nome_fantasia,
            oc.codigo_omie::text AS codigo,
            oc.inativo,
            oc.tags,
            coalesce(f.n, 0)::text     AS titulos,
            coalesce(f.valor, 0)::text AS valor,
            (SELECT a.razao_social FROM core.vinculo_cliente v
               JOIN core.account a ON a.id = v.account_id
              WHERE v.fonte = 'omie' AND v.chave = oc.documento
              LIMIT 1) AS ja_de
       FROM core.omie_cliente oc
       LEFT JOIN LATERAL (
         SELECT count(*) n, sum(t.valor_centavos) valor
           FROM core.omie_titulo t
          WHERE t.documento = oc.documento AND t.situacao <> 'previsao'
       ) f ON true
      WHERE oc.razao_social ILIKE '%' || $1 || '%'
         OR coalesce(oc.nome_fantasia, '') ILIKE '%' || $1 || '%'
         -- Mínimo de 6 dígitos: sem ele, buscar "912" traz todo CNPJ que
         -- contenha 912 em qualquer posição, e a busca deixa de filtrar.
         OR (length(regexp_replace($1, '\\D', '', 'g')) >= 6
             AND regexp_replace(oc.documento, '\\D', '', 'g')
                 LIKE '%' || regexp_replace($1, '\\D', '', 'g') || '%')
      -- Quem tem título vem primeiro: entre duas fichas do mesmo nome, a que
      -- fatura é a que a pessoa está procurando.
      ORDER BY coalesce(f.valor, 0) DESC, oc.inativo, oc.razao_social
      LIMIT $2`,
    [t, limite],
  )
  return rows.map((r) => {
    const fantasia = (r['nome_fantasia'] as string | null) ?? null
    const tags = (r['tags'] as string[] | null) ?? []
    return {
      fonte: 'omie' as const,
      chave: String(r['chave']),
      rotulo: String(r['razao_social'] ?? r['chave']),
      inativo: r['inativo'] === true,
      // A busca é MANUAL, então a evidência é a pessoa: `nome` é o rótulo mais
      // honesto — não houve regra automática nenhuma aqui.
      evidencia: 'nome' as const,
      detalhe: [
        fantasia && fantasia !== r['razao_social'] ? fantasia : null,
        `código ${String(r['codigo'])}`,
        Array.isArray(tags) && tags.length ? tags.join(', ') : null,
      ]
        .filter(Boolean)
        .join(' · '),
      titulos: Number(r['titulos'] ?? 0),
      valorCentavos: Number(r['valor'] ?? 0),
      jaVinculadaA: (r['ja_de'] as string | null) ?? null,
    }
  })
}
