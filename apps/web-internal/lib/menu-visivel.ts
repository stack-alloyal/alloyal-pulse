import 'server-only'

import { menuEfetivo, type ItemDeMenu } from '../app/(interno)/menu'
import { pool } from './db'

/**
 * O menu que a casca deve mostrar — declarado menos o que está oculto.
 *
 * Lê os overrides de `ops.menu_visibilidade` e delega a regra a `menuEfetivo`.
 * Fica em `lib/` porque toca o banco (server-only); a regra em si é pura e mora
 * em `menu.ts`, ao lado da declaração que ela filtra.
 *
 * Falha de leitura NÃO derruba a navegação: se o banco tropeçar, mostra o menu
 * declarado inteiro. Menu a menos deixaria a pessoa sem como navegar; menu a
 * mais (um item em construção a aparecer numa falha rara) é o mal menor.
 */
export async function menuVisivel(): Promise<readonly ItemDeMenu[]> {
  try {
    const { rows } = await pool().query<{ href: string; visivel: boolean }>(
      'SELECT href, visivel FROM ops.menu_visibilidade',
    )
    return menuEfetivo(new Map(rows.map((r) => [r.href, r.visivel])))
  } catch {
    return menuEfetivo(new Map())
  }
}
