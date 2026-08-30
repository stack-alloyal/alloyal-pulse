import {
  exigirSessaoParaDocumento,
  faltandoNoPacote,
  lerDocumento,
  respostaDeDocumento,
} from '../servir'

/**
 * Serve os documentos internos em HTML — atrás da identidade, não do `public/`.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POR QUE NÃO É ARQUIVO ESTÁTICO EM `public/`, COMO ERA:                     │
 * │                                                                            │
 * │ Porque arquivo em `public/` NÃO passa pela resolução de identidade. Medido  │
 * │ na stack de pé: uma pessoa SUSPENSA levava 403 em `/carteira` e ainda lia   │
 * │ o documento com 200. A suspensão existe para casos como desligamento em    │
 * │ análise — e cortar o app mas não o material interno é meia suspensão.      │
 * │                                                                            │
 * │ Passando por aqui, a identidade é resolvida: sem sessão dá 401, suspenso    │
 * │ dá 403. E papel continua NÃO sendo exigido — era o pedido original, "aberto │
 * │ a todos que entrarem pelo SSO do Google".                                  │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * A POLÍTICA DE ACESSO mora em `servir.ts` agora, porque `/docs` também a usa —
 * papel não é exigido, sessão e suspensão são. Duas cópias de uma regra sutil é
 * uma delas ficando desatualizada, e a desatualizada é a que vaza.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ AS FONTES CONTINUAM EM `public/`, e é decisão: são arquivo de fonte, sem   │
 * │ conteúdo de negócio. Trazê-las para cá custaria uma checagem de identidade │
 * │ por fonte, em toda visita, para proteger dois arquivos que não dizem nada. │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

/**
 * Lista fechada, e não caminho livre.
 *
 * Um handler que aceita `params.arquivo` e concatena com a pasta é travessia de
 * caminho esperando acontecer — `..%2f..%2fetc%2fpasswd` chega aqui como texto. Com
 * mapa explícito, o que não está na lista simplesmente não existe.
 */
const DOCUMENTOS: Record<string, string> = {
  'kickoff.html': 'kickoff.html',
  // Os dois PRDs vêm da pasta de produto na raiz do repositório, e não de
  // `conteudo/`: lá é a FONTE, e uma cópia dentro da app envelheceria.
  'prd-pulse.html': 'PRD-Alloyal-Pulse-v1.0.html',
  'prd-contratos.html': 'PRD-Alloyal-Contratos-v1.0.html',
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ arquivo: string }> },
): Promise<Response> {
  // Antes de qualquer leitura de disco.
  await exigirSessaoParaDocumento()

  const { arquivo } = await params
  const nome = DOCUMENTOS[arquivo]
  if (!nome) return new Response('não encontrado', { status: 404 })

  const html = await lerDocumento(nome)
  return html === null ? faltandoNoPacote(nome) : respostaDeDocumento(html)
}
