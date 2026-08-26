import { exigir, temEscopo } from '../../../../lib/guarda'
import { CORPO, ESTILO } from './documento'

export const metadata = {
  title: 'Carteira em atraso · Proposta',
  description: 'Proposta de estrutura para medir inadimplência e recuperação',
}

/**
 * `/propostas/inadimplencia` — a proposta da carteira em atraso.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ É PÁGINA, E NÃO `route.ts` COMO O `/numeros`, por causa da autenticação.    │
 * │                                                                            │
 * │ O `/numeros` é rota porque é PÚBLICA: ela não chama `exigir`, e o par disso  │
 * │ é a `location` sem `auth_request` no nginx. Aqui é o contrário — o documento │
 * │ traz nome de cliente e valor de inadimplência, e não pode sair da empresa.   │
 * │                                                                            │
 * │ O oauth2-proxy já barraria quem não entrou pelo Google, mas isso é           │
 * │ AUTENTICAÇÃO, não permissão: qualquer pessoa com conta da casa passaria pelo │
 * │ proxy. `exigir` é o que checa o papel, e ele só funciona em página — usa     │
 * │ `redirect`, `forbidden` e `unauthorized`, que renderizam as telas do grupo.  │
 * │                                                                            │
 * │ O escopo é o mesmo da revisão de faturamento (`contas`): quem pode ver a     │
 * │ fila de clientes é quem pode ler a proposta sobre a fila.                    │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * O `dangerouslySetInnerHTML` é o mesmo caso do `/numeros`: HTML fixo, escrito à
 * mão, sem nenhum dado de fora — não há entrada para interpolar. O perigo do nome
 * do atributo é conteúdo de terceiro, e aqui não existe terceiro.
 */
export default async function PropostaDaInadimplencia() {
  await exigir((p) => temEscopo(p.contas), 'proposta de inadimplência')
  return (
    <>
      <style href="proposta-inadimplencia" precedence="documento">
        {ESTILO}
      </style>
      <div dangerouslySetInnerHTML={{ __html: CORPO }} />
    </>
  )
}
