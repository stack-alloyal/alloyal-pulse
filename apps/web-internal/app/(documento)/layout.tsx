import type { ReactNode } from 'react'

/**
 * Layout raiz dos DOCUMENTOS: sem casca, sem navegação, sem `estilo.css`.
 *
 * É a terceira raiz da aplicação, ao lado de `(interno)` e `(impressao)`, e existe
 * por um motivo estreito: um documento que se lê de cima a baixo — uma proposta, um
 * laudo — traz o próprio CSS e a própria coluna de leitura. Envolvê-lo na casca de
 * operação daria a ele sidebar, topbar e 1200px de largura, e tiraria a única coisa
 * que faz prosa longa ser lida, que é a linha curta.
 *
 * DIFERENÇA EM RELAÇÃO A `(impressao)`, que também é raiz nua: o que sai de lá vira
 * PDF e vai para a mão do cliente. O que sai daqui é interno e fica atrás do login —
 * cada página deste grupo chama `exigir` por conta própria, como toda tela do Pulse.
 * Juntar os dois grupos faria um documento interno herdar uma raiz desenhada para
 * sair da empresa, e o vazamento seria de uma linha só.
 */
export const metadata = {
  title: 'Documento · Alloyal Pulse',
  description: 'Documento interno de operação',
}

export default function LayoutDocumento({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
