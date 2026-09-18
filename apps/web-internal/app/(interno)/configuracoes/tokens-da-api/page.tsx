import { listarTokens } from '@pulse/config'
import { Aviso, Badge, Btn, Card, Field, Table } from '@pulse/ui'

import { FormularioDeEmissao } from './formulario-de-emissao'
import { revogarTokenDaApi } from '../acoes'
import { NavDeSecao, Secao } from '../nav-de-secao'
import { Corpo, Topo } from '../../casca'
import { pool } from '../../../../lib/db'
import { exigir } from '../../../../lib/guarda'

/**
 * Tokens da API de leitura (/api/v1): quem consome, com que chave, até quando.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ TOKEN NÃO É PESSOA — é credencial de serviço de um propósito (o ETL). O que  │
 * │ o amarra a gente é o rastro: quem emitiu, quem responde por ele, quem        │
 * │ revogou e por quê. Por isso responsável e motivo são obrigatórios, e cada    │
 * │ ação vai para `ops.mudanca` como as concessões de papel.                     │
 * │                                                                            │
 * │ Só pulse-admin (`configurar`) vê esta tela — o mesmo portão de Acessos. O    │
 * │ segredo aparece UMA vez, no formulário, e nunca nesta lista.                 │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

const QUANDO = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'
const DIA = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'sem prazo'

const TOM = { ativo: 'green', expirado: 'amber', revogado: 'slate' } as const

export default async function TokensDaApi({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; erro?: string }>
}) {
  const id = await exigir((p) => p.configurar, 'tokens da API')
  const q = await searchParams
  const tokens = await listarTokens(pool())
  const ativos = tokens.filter((t) => t.estado === 'ativo')

  return (
    <>
      <Topo
        href="/configuracoes/tokens-da-api"
        titulo="Tokens da API"
        proposito="quem consome a /api/v1, com que chave, até quando"
        acoes={
          <span className="text-ink-3">
            <strong className="font-semibold text-ink">{ativos.length}</strong> ativo(s) ·{' '}
            <a className="text-purple-700 hover:underline" href="/api/v1/openapi.json">
              OpenAPI
            </a>
          </span>
        }
      />
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

        <NavDeSecao
          secoes={[
            { id: 'emitir', rotulo: 'Emitir' },
            { id: 'tokens', rotulo: `Tokens (${tokens.length})` },
          ]}
        />

        <Secao id="emitir">
          <Card title="Emitir um token">
            <FormularioDeEmissao quem={id.email} />
          </Card>
        </Secao>

        <Secao id="tokens">
          <Card title="Tokens emitidos">
            {tokens.length === 0 ? (
              <p className="text-corpo text-ink-3">Nenhum token ainda.</p>
            ) : (
              <Table
                cols={['Para quem / para quê', 'Responsável', 'Emitido', 'Validade', 'Último uso', 'Estado', '']}
                rows={tokens.map((t) => [
                  <span className="block">
                    <span className="block font-medium text-ink">{t.descricao}</span>
                    <span className="block font-mono text-nota text-ink-3">{t.id}</span>
                  </span>,
                  // Nulo só nos emitidos pelo CLI, antes de a tela existir.
                  t.responsavel ?? <span className="text-ink-4">— (CLI)</span>,
                  <span className="block whitespace-nowrap">
                    <span className="block">{QUANDO(t.criadoEm)}</span>
                    <span className="block text-nota text-ink-3">por {t.criadoPor}</span>
                  </span>,
                  <span className="whitespace-nowrap tabular-nums">{DIA(t.expiraEm)}</span>,
                  <span className="whitespace-nowrap tabular-nums">{QUANDO(t.ultimoUsoEm)}</span>,
                  <span className="block">
                    <Badge tone={TOM[t.estado]}>{t.estado}</Badge>
                    {t.revogadoEm && (
                      <span className="mt-0.5 block text-nota text-ink-3">
                        {DIA(t.revogadoEm)} por {t.revogadoPor ?? '—'}
                      </span>
                    )}
                  </span>,
                  t.estado === 'ativo' ? (
                    // Revogar corta na hora: a próxima requisição toma 401. O
                    // motivo é a regra da casa — e é o que a trilha guarda.
                    <form action={revogarTokenDaApi} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="id" value={t.id} />
                      <Field name="motivo" required minLength={10} placeholder="Motivo (mín. 10)" className="w-56" />
                      <Btn type="submit" variant="danger">
                        Revogar
                      </Btn>
                    </form>
                  ) : (
                    <span className="text-ink-4">—</span>
                  ),
                ])}
              />
            )}
            <p className="mt-3 text-meta leading-relaxed text-ink-3">
              O segredo nunca aparece aqui — o banco guarda só o hash. Perdeu o token? Revogue este e
              emita outro. <strong className="font-semibold text-ink">Último uso</strong> é amostrado
              (uma gravação por minuto por token): serve para achar token morto, não para auditar
              requisição a requisição. Cada emissão e revogação está na trilha de mudanças
              (tipo <code>api_token</code>) com quem fez e o motivo.
            </p>
          </Card>
        </Secao>
      </Corpo>
    </>
  )
}
