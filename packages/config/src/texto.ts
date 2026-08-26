/**
 * Texto que vem da URL e vai para uma consulta.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ACHADO NO PEN TEST: `?q=%00` devolvia HTTP 500.                             │
 * │                                                                            │
 * │ O byte nulo chega ao Postgres como parâmetro e ele recusa: "invalid byte     │
 * │ sequence for encoding UTF8: 0x00". NÃO é vazamento — o parâmetro está        │
 * │ vinculado e nada ali é interpretado como SQL —, mas é erro de servidor que   │
 * │ qualquer pessoa com acesso à tela produz montando a URL à mão. E um 500 é    │
 * │ pista: ele conta ao curioso que a entrada dele chegou até o banco.          │
 * │                                                                            │
 * │ Duas telas caíam: a inadimplência e a base de clientes. As outras cinco      │
 * │ buscas do produto filtram em memória e por isso passavam. Como o conserto    │
 * │ é o mesmo nas duas, ele mora AQUI — a próxima busca herda em vez de repetir. │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Tira TODO caractere de controle e não só o nulo. O nulo é o que quebra hoje,
 * mas nenhum dos outros tem o que fazer numa razão social — e uma lista de
 * exceções que cobre exatamente o caso conhecido é a que não cobre o próximo.
 *
 * NÃO escapa nem remove aspas nem `%`: aspa é parâmetro vinculado (o driver
 * cuida) e `%` é curinga legítimo de quem busca. Sanitizar além do necessário
 * quebraria a busca por "50%" e daria falsa sensação de defesa exatamente onde a
 * defesa de verdade é o parâmetro vinculado.
 */
export function textoDeBusca(bruto: string | undefined | null): string {
  if (!bruto) return "";
  // \p{C} é a categoria Unicode "other": controle, formato, não atribuído e
  // metade solta de par surrogate. Cobre o nulo e o resto da família.
  return bruto.replace(/\p{C}/gu, "").trim();
}
