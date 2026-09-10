/**
 * Para onde uma ação do fluxo devolve, e as telas que podem pedir isso.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ARQUIVO PRÓPRIO PORQUE `acoes.ts` É `'use server'`.                       │
 * │                                                                            │
 * │ Um módulo de Server Action só pode EXPORTAR função assíncrona — o build     │
 * │ recusa `export const` com "Only async functions are allowed to be exported  │
 * │ in a 'use server' file". Então a constante e a lista moram aqui, e as duas  │
 * │ pontas (a ação e o formulário) importam do mesmo lugar.                    │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ LISTA DE PERMISSÃO, e não saneamento. É a diferença entre uma escolha e   │
 * │ um OPEN REDIRECT.                                                         │
 * │                                                                            │
 * │ O destino passou a vir de campo de formulário porque o fluxo tem duas      │
 * │ casas: `/cancelamento` opera e `/saidas` analisa, e quem submete numa não  │
 * │ pode aterrissar na outra. Campo de formulário é entrada do usuário, e uma  │
 * │ Server Action é endpoint público — `redirect(dados.get('voltarPara'))`      │
 * │ mandaria a pessoa autenticada para onde o atacante escrevesse.             │
 * │                                                                            │
 * │ Então não se valida a FORMA do valor: compara-se com esta lista. O que não  │
 * │ está aqui vira `/cancelamento`, e nenhum valor de fora chega ao `redirect`. │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export const TELAS_DO_FLUXO = ['/cancelamento', '/saidas'] as const

/** O nome do campo, num lugar só — o formulário e a ação têm de concordar. */
export const CAMPO_DE_VOLTA = 'voltarPara'

export function destinoDeVolta(dados: FormData): string {
  const pedido = String(dados.get(CAMPO_DE_VOLTA) ?? '')
  return (TELAS_DO_FLUXO as readonly string[]).includes(pedido) ? pedido : TELAS_DO_FLUXO[0]
}
