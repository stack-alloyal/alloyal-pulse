/**
 * A navegação das três páginas do Cancelamento.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ROTAS DE VERDADE, e não abas por query string.                            │
 * │                                                                            │
 * │ Saídas usa `?aba=`, e para lá está certo: as quatro visões partilham os     │
 * │ mesmos KPI no topo, e trocar de aba não deve recarregar o cabeçalho.        │
 * │                                                                            │
 * │ Aqui as três páginas não partilham nada — a Visão Geral tem gráfico, o      │
 * │ Kanban tem quadro e formulário, Dados tem tabela larga. Rota própria dá     │
 * │ endereço compartilhável, título de aba próprio no navegador, e faz cada     │
 * │ página carregar SÓ a consulta dela: a de Dados custa 649ms medidos, e         │
 * │ pagá-la para quem abriu o Kanban seria consulta que ninguém lê.            │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
import { Abas } from '@pulse/ui'

const PAGINAS = [
  { chave: 'geral', rotulo: 'Visão geral', href: '/cancelamento' },
  { chave: 'kanban', rotulo: 'Kanban', href: '/cancelamento/kanban' },
  { chave: 'dados', rotulo: 'Dados', href: '/cancelamento/dados' },
] as const

export type PaginaDoCancelamento = (typeof PAGINAS)[number]['chave']

export function SubNav({ atual }: { atual: PaginaDoCancelamento }) {
  return (
    <Abas
      abas={PAGINAS.map((p) => ({ chave: p.chave, rotulo: p.rotulo }))}
      atual={atual}
      href={(k) => PAGINAS.find((p) => p.chave === k)!.href}
      iguais
    />
  )
}
