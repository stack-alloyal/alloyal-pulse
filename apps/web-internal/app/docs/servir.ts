import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { NaoAutenticadoError, SemPapelError } from '@pulse/auth'
import { forbidden, unauthorized } from 'next/navigation'

import { identidade } from '../../lib/identidade'

/**
 * O mecanismo comum de `/docs` — a política de acesso e a leitura do arquivo.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ EXISTE PARA NÃO HAVER DUAS CÓPIAS DA POLÍTICA DE ACESSO.                   │
 * │                                                                            │
 * │ São duas rotas agora — `/docs` e `/docs/<arquivo>` — e a política é sutil o  │
 * │ bastante para divergir sem ninguém notar: papel NÃO é exigido, mas sessão e  │
 * │ suspensão são. Duas implementações dessa regra é uma delas ficando           │
 * │ desatualizada, e a que fica desatualizada é a que vaza.                     │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

/**
 * A política, escrita uma vez.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ PAPEL NÃO É EXIGIDO, e isto é o pedido original: "aberto a todos que        │
 * │ entrarem pelo SSO do Google". `identidadeDaSessao` transformaria falta de    │
 * │ papel em 403 — medido: usuário novo levava 403 num documento que devia ler.  │
 * │                                                                            │
 * │ O que continua barrando: falta de sessão (401) e suspensão (403). Suspensão  │
 * │ existe para caso como desligamento em análise, e cortar o app mas não o      │
 * │ material interno é meia suspensão.                                          │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export async function exigirSessaoParaDocumento(): Promise<void> {
  try {
    await identidade()
  } catch (err) {
    if (err instanceof SemPapelError) {
      // Autenticada pelo Google, ainda sem papel: exatamente o público daqui.
    } else if (err instanceof NaoAutenticadoError) {
      unauthorized()
    } else {
      forbidden()
    }
  }
}

/**
 * As duas pastas de onde um documento pode vir, e por que são duas.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ `conteudo/` é material feito PARA a app (o kickoff). `docs/` é a pasta de    │
 * │ produto na raiz do repositório — os PRDs —, e ela é a FONTE: é o que o       │
 * │ `infra/docs/` serve, e é o que o próprio rodapé dos documentos cita. Copiar  │
 * │ 224 KB de PRD para dentro da app criaria a segunda cópia que envelhece, e o  │
 * │ sintoma seria `/docs` servindo um PRD que ninguém reconhece.                 │
 * │                                                                            │
 * │ Os caminhos relativos resolvem nos DOIS ambientes, e isso não é coincidência:│
 * │ o `server.js` do standalone faz `process.chdir(__dirname)`, então em produção │
 * │ o cwd é `/app/apps/web-internal`; em `next dev` é a raiz do app. Nos dois,    │
 * │ `../../docs` cai na pasta de produto — desde que o Dockerfile a copie para    │
 * │ `/app/docs`, o que ele faz com a mesma justificativa do `public/`.           │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
const PASTAS = ['conteudo', join('..', '..', 'docs')] as const

/**
 * Lê o documento, tentando as pastas na ordem.
 *
 * Devolve `null` só quando o arquivo não está em NENHUMA delas — e quem chama
 * traduz isso em 500, não em 404: arquivo listado e ausente é defeito de
 * EMPACOTAMENTO, e foi exatamente o que aconteceu com o `public/` não entrando no
 * standalone. Um 404 ali esconderia a causa.
 */
export async function lerDocumento(nome: string): Promise<string | null> {
  for (const pasta of PASTAS) {
    try {
      return await readFile(join(process.cwd(), pasta, nome), 'utf8')
    } catch {
      continue
    }
  }
  return null
}

/** A resposta, com o cabeçalho que impede proxy de guardar documento interno. */
export function respostaDeDocumento(html: string): Response {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Sem cache compartilhado: a resposta depende de QUEM pediu, e um proxy
      // guardando-a serviria o documento a quem foi suspenso depois.
      'Cache-Control': 'private, no-store',
    },
  })
}

export function faltandoNoPacote(nome: string): Response {
  return new Response(`documento ${nome} não está no pacote`, { status: 500 })
}
