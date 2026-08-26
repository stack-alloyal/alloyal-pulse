/**
 * Papéis e permissões da superfície interna.
 *
 * Doc 00, seção 5.2.
 *
 * Os papéis são derivados de GRUPO do Google Workspace, sincronizados para
 * `ops.user_role`. Não existe lista paralela de usuários dentro do produto: o
 * desligamento de uma pessoa revoga o acesso dela sem ninguém precisar lembrar
 * de limpar nada. Lista paralela é a que fica desatualizada.
 */

export const PAPEIS = [
  'pulse-csm',
  'pulse-cs-lead',
  'pulse-implantacao',
  'pulse-comercial',
  'pulse-financeiro',
  'pulse-diretoria',
  'pulse-admin',
  'pulse-dados',
  // ── Ferramenta 2 (Contratos) ──
  // O Jurídico é dono da ferramenta; Marketing e Produto entram porque são dois
  // dos sete times que hoje perguntam ao Jurídico se podem usar a marca do
  // cliente e falar com os colaboradores dele. Sem papel próprio, eles não
  // conseguem consultar — e o gargalo continua.
  'pulse-juridico',
  'pulse-marketing',
  'pulse-produto',
] as const

export type Papel = (typeof PAPEIS)[number]

export type Escopo = 'nenhum' | 'carteira' | 'base'

export interface Permissoes {
  /** Quais contas a pessoa enxerga. */
  readonly contas: Escopo
  /** Quais itens de trabalho ela vê. */
  readonly fila: Escopo
  /** Receita, NRR, cascata. */
  readonly receita: Escopo
  /** Editar biblioteca, playbooks, definições. */
  readonly configurar: boolean
  /** Aprovar distrato — e por qual via. */
  readonly aprovaDistrato: 'nao' | 'cs' | 'financeiro'
  /**
   * Consulta a dado individual de usuário final.
   *
   * `false` para todos os papéis de interface, sem exceção: não há base legal
   * para o gestor do cliente nem para o CSM verem consumo individual de
   * colaborador. O único caminho é consulta auditada com justificativa
   * registrada por `pulse-admin` (doc 00, 5.2 e 13).
   */
  readonly dadoIndividual: false | 'auditado'
}

export const PERMISSOES: Record<Papel, Permissoes> = {
  /**
   * ┌───────────────────────────────────────────────────────────────────────────┐
   * │ `receita: 'carteira'` DESDE 26/08/2026, e a razão é a fila de cobrança.     │
   * │                                                                            │
   * │ Era `'nenhum'`. O pen test da inadimplência mostrou que a tela dela estava  │
   * │ exigindo escopo de CONTAS em vez de RECEITA, e ao fechar essa brecha o CSM   │
   * │ ficou de fora — mas quem liga para o cliente atrasado é ele. Afrouxar a      │
   * │ tela seria o conserto errado: a decisão é de PAPEL, e é esta linha.          │
   * │                                                                            │
   * │ `'carteira'` e não `'base'` de propósito: o CSM vê receita da carteira dele, │
   * │ não o fechamento da empresa. A cascata em `/receita` continua exigindo       │
   * │ `receita === 'base'` e segue fora do alcance dele.                          │
   * │                                                                            │
   * │ EFEITO COLATERAL A SABER: `renovacoes` e `saidas` decidem mostrar valor com  │
   * │ `receita !== 'nenhum'`, então o CSM passa a ver dinheiro nas duas QUANDO      │
   * │ elas tiverem dado. Hoje as duas estão vazias — conferido, zero linhas até     │
   * │ para o admin —, então nada muda na tela agora. O mecanismo é que mudou, e     │
   * │ ele é coerente: são as telas da carteira dele. Mas não era o pedido, e vai    │
   * │ aparecer sozinho no dia em que aquelas telas ganharem conteúdo.               │
   * │                                                                            │
   * │ E O QUE ESTA LINHA NÃO CONSEGUE FAZER: `contas: 'carteira'` deveria limitar  │
   * │ o CSM à carteira dele, e HOJE NÃO LIMITA NADA. `core.account.csm_email` está │
   * │ vazio nas 1.964 contas — medido —, então o único recorte por dono que existe │
   * │ no produto (`contratos/calendario`, `cancelamento.ts`) devolve lista VAZIA   │
   * │ para quem tem escopo de carteira. Filtrar a inadimplência do mesmo jeito     │
   * │ entregaria uma tela em branco, que é o contrário do pedido. Então o CSM vê a │
   * │ carteira em atraso INTEIRA até `csm_email` ser preenchido — e aí o recorte   │
   * │ passa a valer sozinho nas telas que já o implementam.                        │
   * └───────────────────────────────────────────────────────────────────────────┘
   */
  'pulse-csm': {
    contas: 'carteira',
    fila: 'carteira',
    receita: 'carteira',
    configurar: false,
    aprovaDistrato: 'nao',
    dadoIndividual: false,
  },
  'pulse-cs-lead': {
    contas: 'base',
    fila: 'base',
    receita: 'carteira',
    configurar: true,
    aprovaDistrato: 'cs',
    dadoIndividual: false,
  },
  'pulse-implantacao': {
    contas: 'carteira',
    fila: 'carteira',
    receita: 'nenhum',
    configurar: false,
    aprovaDistrato: 'nao',
    dadoIndividual: false,
  },
  'pulse-comercial': {
    contas: 'base',
    fila: 'nenhum',
    receita: 'carteira',
    configurar: false,
    aprovaDistrato: 'nao',
    dadoIndividual: false,
  },
  'pulse-financeiro': {
    contas: 'base',
    fila: 'carteira',
    receita: 'base',
    configurar: false,
    // PDD é decisão de crédito. O gate é do Financeiro, nunca do CS: deixar
    // quem tem o relacionamento aprovar a rescisão é pedir que o relacionamento
    // decida contra si mesmo (doc 01, 7.3).
    aprovaDistrato: 'financeiro',
    dadoIndividual: false,
  },
  'pulse-diretoria': {
    contas: 'base',
    fila: 'nenhum',
    receita: 'base',
    configurar: false,
    aprovaDistrato: 'nao',
    dadoIndividual: false,
  },
  'pulse-admin': {
    contas: 'base',
    fila: 'base',
    receita: 'base',
    configurar: true,
    aprovaDistrato: 'nao',
    dadoIndividual: 'auditado',
  },
  'pulse-dados': {
    contas: 'base',
    fila: 'nenhum',
    receita: 'base',
    configurar: true,
    aprovaDistrato: 'nao',
    dadoIndividual: false,
  },
  // O Jurídico vê a base inteira de contas porque a pergunta dele é sempre sobre
  // um contrato específico, e ele não tem carteira. Não vê receita agregada nem
  // fila de CS: a alçada dele é contratual, e alçada larga demais é a que ninguém
  // consegue justificar numa auditoria.
  'pulse-juridico': {
    contas: 'base',
    fila: 'nenhum',
    receita: 'nenhum',
    configurar: false,
    aprovaDistrato: 'cs',
    dadoIndividual: false,
  },
  // Marketing e Produto são CONSULTA. Veem a base para achar o contrato, e nada
  // mais — a faixa de cláusula que cada um lê é decidida pela taxonomia, não por
  // esta matriz.
  'pulse-marketing': {
    contas: 'base',
    fila: 'nenhum',
    receita: 'nenhum',
    configurar: false,
    aprovaDistrato: 'nao',
    dadoIndividual: false,
  },
  'pulse-produto': {
    contas: 'base',
    fila: 'nenhum',
    receita: 'nenhum',
    configurar: false,
    aprovaDistrato: 'nao',
    dadoIndividual: false,
  },
}

export function ehPapel(valor: string): valor is Papel {
  return (PAPEIS as readonly string[]).includes(valor)
}

/** União das permissões quando a pessoa está em mais de um grupo. */
export function permissoesDe(papeis: readonly Papel[]): Permissoes {
  const escopoMax = (a: Escopo, b: Escopo): Escopo =>
    a === 'base' || b === 'base' ? 'base' : a === 'carteira' || b === 'carteira' ? 'carteira' : 'nenhum'

  return papeis.reduce<Permissoes>(
    (acc, p) => {
      const perm = PERMISSOES[p]
      return {
        contas: escopoMax(acc.contas, perm.contas),
        fila: escopoMax(acc.fila, perm.fila),
        receita: escopoMax(acc.receita, perm.receita),
        configurar: acc.configurar || perm.configurar,
        aprovaDistrato:
          perm.aprovaDistrato !== 'nao' && acc.aprovaDistrato === 'nao'
            ? perm.aprovaDistrato
            : acc.aprovaDistrato,
        dadoIndividual: acc.dadoIndividual === 'auditado' || perm.dadoIndividual === 'auditado'
          ? 'auditado'
          : false,
      }
    },
    {
      contas: 'nenhum',
      fila: 'nenhum',
      receita: 'nenhum',
      configurar: false,
      aprovaDistrato: 'nao',
      dadoIndividual: false,
    },
  )
}
