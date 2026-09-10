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
export const TELAS_DO_FLUXO = [
  '/cancelamento',
  '/cancelamento/kanban',
  '/cancelamento/dados',
  '/saidas',
] as const

/**
 * O tipo que torna o defeito INCOMPILÁVEL, em vez de guardado por portão.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O DEFEITO REAL, relatado pelo usuário em 10/09/2026.                      │
 * │                                                                            │
 * │ Quando o kanban virou `/cancelamento/kanban`, ele passou a mandar esse      │
 * │ caminho como destino de volta — e o caminho NÃO ESTAVA nesta lista. O       │
 * │ `destinoDeVolta` fez o que devia: caiu no primeiro membro. Resultado, na    │
 * │ palavra de quem usou: "quando clico para movimentar o card ele volta para a │
 * │ Visão Geral e tenho que ficar voltando para a aba Kanban".                  │
 * │                                                                            │
 * │ E o portão que eu havia escrito para isto era CEGO: ele conferia que cada   │
 * │ formulário CARREGA o campo de volta, e não que o VALOR do campo está na     │
 * │ lista. Passou verde enquanto o comportamento estava errado.                 │
 * │                                                                            │
 * │ Portão melhor não é a resposta certa aqui — TIPO é. Com `TelaDoFluxo`, um   │
 * │ caminho fora da lista não compila, e nenhum portão precisa lembrar de       │
 * │ existir. A lista de permissão continua valendo em tempo de execução, porque │
 * │ o campo do formulário é entrada do usuário e o tipo não protege disso.       │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export type TelaDoFluxo = (typeof TELAS_DO_FLUXO)[number]

/** O nome do campo, num lugar só — o formulário e a ação têm de concordar. */
export const CAMPO_DE_VOLTA = 'voltarPara'

export function destinoDeVolta(dados: FormData): string {
  const pedido = String(dados.get(CAMPO_DE_VOLTA) ?? '')
  return (TELAS_DO_FLUXO as readonly string[]).includes(pedido) ? pedido : TELAS_DO_FLUXO[0]
}
