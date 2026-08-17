import { AlloyalLogo, SeletorDeTema, cn } from '@pulse/ui'
import { BarChart3 } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { nomeDaPessoa } from '@pulse/config'

import { AlavancaDaLateral } from './lateral-alavanca'
import { GavetaDaLateral } from './lateral-gaveta'
import { itemAtivo } from './menu'
import { Nav } from './nav'
import { Perfil } from './perfil'
import { NovidadesDoRadar } from './radar/novidades'
import { PainelDoRadar } from './radar/painel'
import { pool } from '../../lib/db'
import { identidadeDaSessao } from '../../lib/guarda'

/**
 * Sidebar e topbar — a casca do Publi, portada.
 *
 * Duas diferenças deliberadas em relação ao alloyal-publi:
 *
 *  1. O §07 está inteiro: expandida (252px), minimizada (64px com flyout), o
 *     grupo que recolhe e a gaveta do telefone (268px / 82%). A gaveta
 *     SUBSTITUIU a fileira horizontal que havia sob o cabeçalho — era a segunda
 *     navegação da mesma tela, e rolava de lado escondendo os últimos itens.
 *
 *  2. A nav é o único componente de cliente (`nav.tsx`), porque precisa do
 *     pathname para destacar o item ativo e do `localStorage` para lembrar o que
 *     foi recolhido. Mesma pintura do NavLink do Publi.
 *
 * As medidas são as do Publi: 252 px de sidebar, 62 px de topbar, logo de 24 px.
 * Elas estão em `--sidebar-w` e `--topbar-h` para não divergirem por engano.
 */

export function Casca({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* `lateral` é o gancho do CSS que troca 252px por 64px; ver lateral.css.
          A largura muda por atributo no <html>, e não por estado do React — a
          lateral empurra a página inteira, e encolher depois de hidratar faria
          a tela toda pular a cada navegação. */}
      <aside className="lateral hidden w-[252px] shrink-0 flex-col border-r border-line bg-surface px-[14px] py-[18px] transition-[width] duration-200 motion-reduce:transition-none md:flex">
        <div className="px-2 pb-[18px] pt-1.5">
          <Link href="/" aria-label="Início" className="block">
            <AlloyalLogo className="lateral-marca-completa h-6" />
            {/* O ícone quadrado da marca, para os 64px. Os dois existem sempre e
                o CSS escolhe: trocar o `src` por estado exigiria que o React
                soubesse em qual estado está. */}
            <img src="/icon.svg" alt="" className="lateral-marca-icone mx-auto h-6 w-6" />
          </Link>
        </div>
        <Nav />
        <AlavancaDaLateral />
        <div className="lateral-rodape mt-auto px-2 pt-4 text-nota leading-relaxed text-ink-4">
          Alloyal Pulse · ferramentas de operação
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  )
}

/**
 * Topbar da página, com o nome e o propósito da tela.
 *
 * Cada página monta a sua: é o que permite o destaque do item ativo e o subtítulo
 * correto sem estado de cliente. O `proposito` não é enfeite — é a frase que
 * responde "o que esta tela decide", e telas de operação sem essa frase viram
 * painéis que ninguém sabe para que abre.
 *
 * O PERFIL é resolvido AQUI, e não passado por `acoes`. São 16 telas usando este
 * componente: pedir a cada uma que monte o próprio perfil garantiria que alguma
 * esquecesse, e o sintoma seria uma tela sem como sair.
 *
 * Por isso o componente é `async`: ele lê a identidade. Só renderiza em tela já
 * autenticada — a página chamou `exigir` antes —, então a leitura não pode falhar
 * por falta de sessão.
 */
export async function Topo({
  href,
  titulo,
  proposito,
  acoes,
  icone,
}: {
  href: string
  titulo?: string
  proposito?: string
  acoes?: ReactNode
  /** Para telas fora do menu, como a ficha de uma conta. */
  icone?: typeof BarChart3
}) {
  const item = itemAtivo(href)
  const Icone = icone ?? item?.icone ?? BarChart3
  const eu = await identidadeDaSessao()
  const nome = await nomeDaPessoa(pool(), eu.email)
  return (
    <>
      <header className="sticky top-0 z-30 flex h-[62px] shrink-0 items-center gap-3 border-b border-line bg-surface px-4 md:px-8">
        {/* Só no telefone: o gatilho da gaveta, e o logo ao lado. No computador
            os dois somem — lá a lateral está sempre visível. */}
        <GavetaDaLateral />
        <div className="md:hidden">
          <AlloyalLogo className="h-6" />
        </div>
        {/* ┌─────────────────────────────────────────────────────────────────┐
            │ O TÍTULO NÃO ENCOLHE; O PROPÓSITO SIM.                          │
            │                                                                  │
            │ Era `min-w-0` no bloco inteiro e um espaçador `flex-1` depois:   │
            │ as ações da direita têm largura própria e não cedem, então quem  │
            │ cedia era o título. Numa tela com badge e seletor de tema, "Omie"│
            │ apareceu como "O…" — some justamente o nome da tela, que é o     │
            │ contrário do que um cabeçalho serve para fazer.                  │
            │                                                                  │
            │ Agora o bloco toma o espaço livre, o título é `shrink-0`, e o    │
            │ propósito — que é complemento — é o único que trunca.            │
            └─────────────────────────────────────────────────────────────────┘ */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Icone className="h-[18px] w-[18px] shrink-0 text-purple-500" />
          <span className="shrink-0 text-title text-ink">{titulo ?? item?.rotulo}</span>
          {(proposito ?? item?.proposito) && (
            <span className="hidden min-w-0 truncate text-corpo text-ink-3 lg:inline">
              · {proposito ?? item?.proposito}
            </span>
          )}
        </div>
        {/* ┌───────────────────────────────────────────────────────────────────┐
            │ AS AÇÕES SOMEM NO TELEFONE, e o título fica.                       │
            │                                                                    │
            │ Medido em 390px: com elas, o cabeçalho de Configurações ia a 393px  │
            │ — a página inteira passava a rolar de lado — e o bloco do título    │
            │ era espremido a ZERO. Ou seja, o que sobrava era um contador        │
            │ ("4 de 12 cadastrados") numa tela onde o nome da tela não aparecia. │
            │                                                                    │
            │ Toda `acoes` de hoje é um resumo — contador ou selo — e o número    │
            │ que ela mostra está no corpo da página logo abaixo. O nome da tela  │
            │ não está em lugar nenhum senão aqui.                               │
            └───────────────────────────────────────────────────────────────────┘ */}
        {acoes && (
          <div className="hidden shrink-0 items-center gap-2 text-corpo sm:flex">{acoes}</div>
        )}
        {/* Radar: reportar (🐛) e novidades (✨). Ficam AQUI pelo mesmo motivo do
            Perfil — são 16 telas, e pedir que cada uma monte os próprios garantiria
            que alguma esquecesse. A tela onde a pessoa esbarra no defeito é
            justamente a que não pode ser a esquecida. */}
        {/* O seletor de tema fica AQUI pelo mesmo motivo do Perfil e do Radar: são
            16 telas, e pedir que cada uma monte o próprio garantiria que alguma
            esquecesse. Tema é preferência da pessoa, não da tela. */}
        <SeletorDeTema className="hidden md:inline-flex" />
        <NovidadesDoRadar />
        <PainelDoRadar />
        <Perfil id={eu} nome={nome} />
      </header>
    </>
  )
}

/**
 * O corpo da página, com a largura e o respiro do Publi.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ 1200 E `md:px-8`, que é o que o §07 do documento manda: "Área de conteúdo   │
 * │ máx. 1200px · px-4 py-6 → md:px-8 md:py-7".                                │
 * │                                                                            │
 * │ Estava 1180 com `md:px-7` — 20px a menos de caixa e 8px a mais de recuo,    │
 * │ o que dava 1124 de área útil contra os 1136 do Publi. Números escolhidos    │
 * │ "por aproximação" na primeira portagem; a divergência não tinha motivo.     │
 * │                                                                            │
 * │ A conta que importa: com a sidebar de 252px, ver os 1136 inteiros exige     │
 * │ 1452px de janela. Abaixo disso é a janela que limita, não este número.      │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export function Corpo({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main className={cn('mx-auto w-full max-w-[1200px] px-4 py-6 md:px-8 md:py-7', className)}>
      {children}
    </main>
  )
}
