import { DOCUMENTO } from './documento'

/**
 * `/numeros` — a única rota PÚBLICA da superfície interna.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ NÃO CHAMA `exigir` NEM LÊ IDENTIDADE, e é isso que a torna aberta: a        │
 * │ autenticação do Pulse é por página, não por middleware. O que a mantém      │
 * │ SEGURA é o que ela não faz — não toca o banco, não recebe parâmetro, não    │
 * │ tem formulário e não devolve nada além de um HTML fixo.                     │
 * │                                                                            │
 * │ O par disto está no `proxy-pulse.advanced.conf`: uma `location = /numeros`  │
 * │ sem `auth_request`, do mesmo jeito que `/api/health`. Sem os dois lados a    │
 * │ rota não abre — e é bom que seja assim: abrir por engano exige duas          │
 * │ edições em dois lugares.                                                   │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export const dynamic = 'force-static'

export function GET() {
  return new Response(DOCUMENTO, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Cinco minutos de cache na borda: é conteúdo fixo, e o número muda quando
      // alguém edita o arquivo, não a cada visita.
      'cache-control': 'public, max-age=60, s-maxage=300',
      // A página não embute nada de terceiros além da fonte, e não deve poder
      // ser embutida por ninguém.
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
    },
  })
}
