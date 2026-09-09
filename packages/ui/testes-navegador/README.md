# Testes de navegador do documento de kickoff

Rodam Chromium de verdade contra o contêiner, com os cabeçalhos que o porteiro
injetaria. Ficam aqui e não em `infra/` por um motivo prosaico: o `playwright` é
dependência de `packages/ui`, e `infra/` está fora do workspace do pnpm — de lá o
`import 'playwright'` não resolve.

Não estão no CI: precisam da pilha de pé, e o CI não tem Postgres com o documento
servido.

```bash
cd packages/ui
set -a; . ../../infra/.env; set +a
export BASE=http://$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' pulse-web-internal | awk '{print $1}'):3000

node testes-navegador/sem-nada-local.mjs   # o kickoff é 100% banco
node testes-navegador/roadmap.mjs          # menu, cadastro, timeline, por área

../../infra/limpar-registros-de-teste.sh   # limpa SÓ as identidades de teste
```

## As telas do oauth2-proxy

`telas-do-proxy.mjs` é o único desta pasta que **não toca em produção**: sobe um
oauth2-proxy descartável na 4199 com a imagem do compose, um upstream
`static://200` e `--custom-templates-dir` apontado para `infra/oauth2-templates`.
Nem banco, nem segredo, nem sessão. Não precisa de `.env` nem de `BASE`.

```bash
cd packages/ui
node testes-navegador/telas-do-proxy.mjs     # tiros em /tmp/pulse-telas-do-proxy
TIROS=/outro/lugar node testes-navegador/telas-do-proxy.mjs
```

**Por que existe, tendo portão em `design-system.test.mjs`.** O portão lê o HTML
como texto — cor, frase do CSRF, título e tag fechada em cada ramo. O que ele não
faz é EXECUTAR o template, e `error.html` é Go `html/template`. Medido em
09/09/2026: trocar `(eq .StatusCode 403)` por `(eq .StatusCode "403")` passa por
todo portão de texto, e o proxy devolve 403 com o corpo cortado antes do título —
sem status de erro. Só renderizando de verdade se vê.

**Cobre 2 dos 5 ramos por status.** 401, 403 sem ser de tempo e 404 não são
alcançáveis por requisição nesta configuração: `/oauth2/<desconhecido>` cai na
tela de entrada e `/oauth2/auth` responde 401 sem corpo. Para esses, o portão de
texto é o que há.

## Duas regras que não são opcionais

**Nunca limpar a base entre execuções.** Estes testes rodam contra a PRODUÇÃO, que tem
o levantamento real dos times. Em 05/08/2026 um `DELETE FROM ops.kickoff_registro` sem
filtro, feito exatamente para "limpar entre execuções", apagou 17 registros que
Operações havia acabado de preencher. Só voltaram porque os bytes ainda estavam no WAL.
Hoje o gatilho da migration 0027 recusa DELETE, mas a regra vale de qualquer forma:
**medir por diferença, e limpar por escopo** com `limpar-registros-de-teste.sh`.

**Contagem é relativa à linha de base**, lida pela API antes de qualquer página abrir.
Medir com a página já aberta contamina a base com os próprios registros do teste — foi
o que fez cinco asserções falharem na primeira tentativa.

## O que a CSP obriga

A aplicação manda `upgrade-insecure-requests`, e está certa. Falando http com o
contêiner, o Chromium promove tudo para https e tudo falha com `ERR_SSL_PROTOCOL_ERROR`
— artefato do teste, não defeito. Os arquivos contornam com `ctx.route()` devolvendo a
requisição ao http, sem tocar na CSP servida.

E o documento é um DECK: slide que não está visível não recebe clique. Navegue pela
trilha (`getByRole('button', { name: /Roadmap/ })`) antes de interagir.

## Um teste que foi apagado, e por quê

`resgate.mjs` provava a mecânica de rascunho local e sombra. Essa mecânica deixou de
existir quando o kickoff passou a ser 100% banco. As asserções dele que continuavam
valendo — autoria em todo cartão, botão de remover só onde funciona, 404 para quem não é
autor, recarga automática — foram para `sem-nada-local.mjs`. Teste que afirma
comportamento removido é pior que teste nenhum: ele passa a falhar por estar certo.

## Recuperação de emergência

`infra/recuperar-do-wal.py` lê os bytes crus de um segmento de WAL e reconstrói as
linhas de `ops.kickoff_registro`. É o último recurso, não o procedimento: o procedimento
é `infra/backup-banco.sh`, agendado no `pulse-backup.timer`.
