import {
  Building2,
  BookOpen,
  CalendarCheck,
  CalendarDays,
  Database,
  DoorOpen,
  FileBarChart,
  FileText,
  Inbox,
  Settings,
  SlidersHorizontal,
  Users,
  Wallet,
} from "lucide-react";

/**
 * O menu do Pulse.
 *
 * Fica em módulo próprio porque é lido pela casca (servidor) e pela nav
 * (cliente). Cada item declara o que a tela RESPONDE, e não só como se chama:
 * tela de operação sem essa frase vira painel que ninguém sabe para que abre.
 */
export interface ItemDeMenu {
  href: string;
  rotulo: string;
  icone: typeof Inbox;
  proposito: string;
  /**
   * As telas que pendem desta, como no Publi e no design system.
   *
   * Configurações tinha seis telas alcançáveis só por links no cabeçalho da
   * própria página: quem estava em Segredos não via que existia Papéis sem
   * voltar. Submenu resolve isso e é o padrão do §07 — a navegação é DECLARADA,
   * e a hierarquia da declaração é a hierarquia da tela.
   */
  filhos?: readonly { href: string; rotulo: string; proposito: string }[];
}

export const MENU: readonly ItemDeMenu[] = [
  {
    href: "/",
    rotulo: "Minha fila",
    icone: Inbox,
    proposito: "O que fazer agora",
  },
  {
    href: "/carteira",
    rotulo: "Carteira",
    icone: Users,
    proposito: "Onde eu olho — risco × receita",
  },
  {
    // Item PRÓPRIO e não sub-item da Carteira: as duas respondem perguntas diferentes.
    // A Carteira ordena por risco × receita ("onde eu olho hoje"); esta é o cadastro
    // que veio do core ("quem é a base"). Escondida dentro da outra, ninguém acha.
    href: "/carteira/base",
    rotulo: "Base de clientes",
    icone: Building2,
    proposito: "Main e sub business, como vêm do core",
  },
  {
    href: "/renovacoes",
    rotulo: "Renovações",
    icone: CalendarCheck,
    proposito: "Janela de 90 dias, com a previsão medida",
  },
  {
    href: "/saidas",
    rotulo: "Saídas",
    icone: DoorOpen,
    proposito: "O pipeline do churn, da levantada de mão ao desfecho",
  },
  {
    href: "/receita",
    rotulo: "Receita",
    icone: Wallet,
    proposito: "Cascata e fechamento mensal",
    filhos: [
      { href: "/receita", rotulo: "Cascata", proposito: "O fechamento do mês, linha por linha" },
      {
        href: "/receita/revisao",
        rotulo: "Revisão",
        proposito: "Onde o faturamento e o cadastro discordam",
      },
      {
        href: "/receita/inadimplencia",
        rotulo: "Inadimplência",
        proposito: "Quem está em atraso, e quanto volta",
      },
    ],
  },
  {
    href: "/relatorios",
    rotulo: "Relatórios",
    icone: FileBarChart,
    proposito: "O que o cliente recebe — congelado no envio",
  },
  {
    href: "/contratos",
    rotulo: "Contratos",
    icone: FileText,
    proposito: "O que vale hoje, com procedência",
  },
  {
    href: "/contratos/calendario",
    rotulo: "Calendário",
    icone: CalendarDays,
    proposito: "Nenhuma data crítica descoberta pela data",
  },
  {
    href: "/biblioteca",
    rotulo: "Biblioteca",
    icone: BookOpen,
    proposito: "Playbooks versionados, publicados sem deploy",
  },
  {
    href: "/gatilhos",
    rotulo: "Gatilhos",
    icone: SlidersHorizontal,
    proposito: "Calibração e modo sombra",
  },
  {
    href: "/dados",
    rotulo: "Dados",
    icone: Database,
    proposito: "Pipeline de captação",
  },
  {
    href: "/configuracoes",
    rotulo: "Configurações",
    icone: Settings,
    proposito: "Ajustes, acessos e segredos",
    filhos: [
      { href: "/configuracoes", rotulo: "Catálogo", proposito: "Os ajustes e o que cada um muda" },
      { href: "/configuracoes/usuarios", rotulo: "Acessos", proposito: "Quem entra e com qual papel" },
      { href: "/configuracoes/papeis", rotulo: "Papéis", proposito: "A matriz de permissão por papel" },
      { href: "/configuracoes/segredos", rotulo: "Segredos", proposito: "Credenciais das integrações" },
      { href: "/configuracoes/omie", rotulo: "Omie", proposito: "A integração financeira" },
      { href: "/configuracoes/sincronizacao", rotulo: "Sincronização", proposito: "Os ciclos e o que entrou" },
      { href: "/configuracoes/historico", rotulo: "Histórico", proposito: "A trilha do que foi mudado" },
    ],
  },
];

/**
 * O item de menu que corresponde a uma rota.
 *
 * Ordena por especificidade antes de casar: `/` casaria com tudo se viesse
 * primeiro, e a fila ficaria destacada em todas as telas.
 */
export function itemAtivo(pathname: string): ItemDeMenu | undefined {
  const ordenado = [...MENU].sort((a, b) => b.href.length - a.href.length);
  return ordenado.find((m) =>
    m.href === "/" ? pathname === "/" : pathname.startsWith(m.href),
  );
}
