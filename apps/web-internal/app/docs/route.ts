import {
  exigirSessaoParaDocumento,
  faltandoNoPacote,
  lerDocumento,
  respostaDeDocumento,
} from './servir'

/**
 * `/docs` — o PRD do Alloyal Pulse, atrás do SSO da casa.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POR QUE AQUI, E NÃO EM `docs.alloyal.com.br`.                              │
 * │                                                                            │
 * │ O domínio próprio existe em `infra/docs/` — compose, nginx e oauth2-proxy    │
 * │ prontos —, e nunca esteve no ar: medido em 28/08/2026, `docs.alloyal.com.br` │
 * │ não resolve em DNS e não tem proxy host no NPM. Em toda a vida do contêiner  │
 * │ os logs só mostraram healthcheck de `127.0.0.1`; nenhum acesso humano.       │
 * │                                                                            │
 * │ `pulse.alloyal.com.br` já tem registro na Cloudflare, proxy host com         │
 * │ certificado e `oauth2-proxy-pulse` de pé. Um CAMINHO sob esse host não pede  │
 * │ DNS novo, proxy host novo, certificado novo nem instância nova de proxy — e  │
 * │ herda a mesma sessão do Google que a pessoa já tem aberta no Pulse.          │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ É `route.ts` E NÃO `page.tsx`, e a razão é estrutural: não existe layout     │
 * │ raiz no nível do `app/`. As três raízes são `(interno)`, `(impressao)` e     │
 * │ `(documento)`, cada uma com o próprio `<html>`. Um `page.tsx` solto aqui     │
 * │ não teria raiz nenhuma.                                                     │
 * │                                                                            │
 * │ E não precisa: o PRD é documento HTML COMPLETO, com o próprio `<head>`, o    │
 * │ próprio CSS e os quatro diagramas em SVG inline. Convertê-lo em JSX seriam   │
 * │ 2.134 linhas reescritas para chegar ao mesmo pixel.                         │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * O ARQUIVO É A FONTE, não uma cópia: `docs/PRD-Alloyal-Pulse-v1.0.html` é o mesmo
 * que o `infra/docs/` serve e o mesmo que o rodapé do documento cita. Ver `servir.ts`
 * para por que a leitura tenta duas pastas.
 */

const PRD = 'PRD-Alloyal-Pulse-v1.0.html'

export async function GET(): Promise<Response> {
  await exigirSessaoParaDocumento()
  const html = await lerDocumento(PRD)
  return html === null ? faltandoNoPacote(PRD) : respostaDeDocumento(html)
}
