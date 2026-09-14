import { Aviso, Badge, Btn, Card, Field } from '@pulse/ui'

import { definirVisibilidadeDoMenu } from '../acoes'
import { MENU, visivelNoMenu } from '../../menu'
import { Corpo, Topo } from '../../casca'
import { pool } from '../../../../lib/db'
import { exigir } from '../../../../lib/guarda'

export const dynamic = 'force-dynamic'

/**
 * Acesso do menu — o que aparece na navegação, e o que está em construção.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POR QUE ESTA TELA EXISTE (pedido de 14/09/2026).                          │
 * │                                                                            │
 * │ Telas implementadas pela metade ficavam no menu e geravam "eu deveria       │
 * │ acessar isso?" em quem não devia nem ver. Aqui o admin tira do menu o que   │
 * │ ainda não está pronto — sem deploy, e sem trancar a rota: quem tem a URL     │
 * │ continua entrando. O que se apaga é a DÚVIDA, não o acesso.                 │
 * │                                                                            │
 * │ Duas camadas: o DEV declara o status em `menu.ts` (pronto/em construção), e │
 * │ o admin dá o OVERRIDE aqui. O override vence. A coluna "estado" mostra o     │
 * │ efetivo — o que a navegação realmente faz agora.                            │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export default async function AcessoDoMenu({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; erro?: string }>
}) {
  await exigir((p) => p.configurar, 'visibilidade do menu')
  const q = await searchParams

  const { rows } = await pool().query<{ href: string; visivel: boolean; motivo: string | null }>(
    'SELECT href, visivel, motivo FROM ops.menu_visibilidade',
  )
  const override = new Map(rows.map((r) => [r.href, r]))
  const mapaVisivel = new Map(rows.map((r) => [r.href, r.visivel]))

  const ocultos = MENU.filter((m) => !visivelNoMenu(m, mapaVisivel)).length

  return (
    <>
      <Topo
        href="/configuracoes"
        titulo="Acesso do menu"
        proposito="o que aparece na navegação, e o que está em construção"
        acoes={
          <span className="text-corpo text-ink-2">
            {ocultos} oculto(s) de {MENU.length}
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

        <p className="max-w-[80ch] text-corpo leading-relaxed text-ink-2">
          Esconder um item o tira da <strong className="font-semibold">navegação</strong>, não do
          sistema: a rota continua existindo e quem tem o endereço ainda entra. Use para o que foi ao
          ar pela metade e gera dúvida de acesso. O que o dev marcou como{' '}
          <Badge tone="amber">em construção</Badge> já nasce oculto; aqui você inverte caso a caso.
        </p>

        <Card title={`Itens do menu · ${MENU.length}`}>
          <div className="grid gap-4">
            {MENU.map((m) => {
              const ov = override.get(m.href)
              const visivel = visivelNoMenu(m, mapaVisivel)
              const emConstrucao = m.status === 'em_construcao'
              return (
                <div
                  key={m.href}
                  className="grid gap-2 border-b border-line pb-4 last:border-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <strong className="text-corpo font-bold text-ink">{m.rotulo}</strong>
                    <code className="text-nota text-ink-3">{m.href}</code>
                    {emConstrucao && <Badge tone="amber">em construção (padrão: oculto)</Badge>}
                    {visivel ? (
                      <Badge tone="green">aparece no menu</Badge>
                    ) : (
                      <Badge tone="red">oculto</Badge>
                    )}
                    {ov && (
                      <span className="text-nota text-ink-3">
                        override por {ov.motivo ? '' : '—'}
                        {ov.motivo}
                      </span>
                    )}
                  </div>
                  <p className="text-meta text-ink-3">{m.proposito}</p>
                  {/* O motivo viaja com o clique: uma decisão de esconder tela sem
                      justificativa é a que ninguém sabe desfazer depois. */}
                  <form action={definirVisibilidadeDoMenu} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="href" value={m.href} />
                    <input type="hidden" name="visivel" value={visivel ? '0' : '1'} />
                    <Field
                      name="motivo"
                      defaultValue={ov?.motivo ?? ''}
                      placeholder={visivel ? 'Por que esconder? (ex.: C1 não roda)' : 'Por que reexibir?'}
                      aria-label={`Motivo para ${m.rotulo}`}
                      className="w-72 max-w-full"
                    />
                    <Btn type="submit" variant={visivel ? 'ghost' : 'primary'}>
                      {visivel ? 'Esconder do menu' : 'Mostrar no menu'}
                    </Btn>
                  </form>
                </div>
              )
            })}
          </div>
        </Card>
      </Corpo>
    </>
  )
}
