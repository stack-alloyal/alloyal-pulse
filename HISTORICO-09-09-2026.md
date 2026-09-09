# Sessão de 26/08 a 09/09/2026 — o que foi feito e o que ficou aberto

Continuação de `HISTORICO-26-08-2026.md`, que registra o incidente do TRUNCATE. Este
cobre o que veio depois. **Uma decisão está aberta e é a última seção.**

---

## 1. A recuperação do TRUNCATE fechou

Verificada em 26/08, 21h50 UTC. Contagens exatas: `core.account` 3.274 ·
`core.account_hubspot` 1.144 · `core.vinculo_cliente` 2.319 · `core.vinculo_evento` 101 ·
`success.cancellation` 0.

Integridade de FK conferida **à mão**, porque o COPY entrou com
`session_replication_role = replica` e o Postgres não checou nada na carga: **zero
órfãos** nos quatro caminhos. `criado_em` máximo em 22/08 — quatro dias antes do backup,
então a janela de perda é vazia.

E o estrago era menor do que eu havia dito: `analytics.monthly_close` estava **intacto**
(calculado antes do truncate), e `/receita` lê as cascatas guardadas, não o ledger. A
tela de receita nunca esteve errada.

---

## 2. O fluxo de churn: a porta de entrada faltava

`registrarPedido` — a única porta de entrada do fluxo — **não tinha formulário nenhum**
apontando para ela. Sem porta, `success.cancellation` ficou em zero linha, e daí saíram
todos os zeros da tela. Havia ainda uma segunda ação órfã desde `e131b8f`.

O portão que escrevi para isso (`packages/config/src/acoes-ligadas.test.ts`) achou
**outras três**: `acaoDesconto`, `acaoRenegociar`, `acaoConfirmarMotivo` — as posições 5
e 6 do pipeline eram inalcançáveis pela tela.

**Teste de unidade não pega esta classe por construção:** ele CHAMA a função, e era o
chamar que faltava.

Também: o select do cadastro traz as **426** contas ativas que faturaram em 12 meses, e
não as 2.153 ativas — levantada de mão é evento de cliente COM receita.

**Aberto:** o botão de etapa do quadro não entrega o valor de `para` para a ação (dois
`<button name="para">` no mesmo formulário, e `dados.get('para')` volta vazio). O banco
recusa corretamente. `packages/ui/testes-navegador/saida-ponta-a-ponta.mjs` está
commitado **vermelho de propósito** no passo 5, com o diagnóstico no cabeçalho.

---

## 3. Saídas deixou de ler o ledger de MRR

Depois de o usuário perguntar por que estávamos "refazendo todo o fluxo de banco" para
ver churn. Ele estava certo: das cinco visões, **três nunca tocaram** `fact.mrr_event`.
Eu havia ligado a coorte e a meta nele por escolha minha, para a coluna de efeito nascer
com história — e daí saiu a bola de neve do C22.

Na meta era **erro de conceito**: o ledger é derivado do faturamento e não sabe POR QUE a
receita parou; cliente que passou a pagar trimestralmente entrava como saída, e a meta
era cobrada contra um número que inclui quem não saiu.

Hoje as cinco leem `success.cancellation`. O efeito vem de `competencia_efeito_receita`,
filtrado por ESTADO — `retido`, `desconto` e `renegociado` continuam faturando.

---

## 4. O PRD em `pulse.alloyal.com.br/docs`

`docs.alloyal.com.br` tem compose, nginx e oauth2-proxy prontos e **nunca esteve no ar**:
não resolve em DNS, não tem proxy host no NPM, e os logs do contêiner só mostraram
healthcheck de `127.0.0.1` em toda a vida dele.

O caminho `/docs` sob o host que já funciona não pede DNS, certificado nem proxy novo. O
arquivo é a FONTE (`docs/PRD-Alloyal-Pulse-v1.0.html`), não uma cópia — sha256 conferido
entre o que a rota devolve e o que está no disco.

Artefacto publicado: https://claude.ai/code/artifact/b9f94a4d-efa8-43da-98be-10d863783279

---

## 5. Docker: 4,8 GB de contexto e um worker com Next.js dentro

O `.dockerignore` de 29/08 resolveu 88% e **parecia pronto**. Faltava o `**/`: padrão de
`.dockerignore` é ancorado na raiz, então `.next/` não casa com `apps/web-internal/.next/`.
Contexto final: **3,9 MB em 399 arquivos**, de 4.797 MB.

E o worker levava o `node_modules` do estágio de build: **512 MB**, com `next` (156 MB) e
`@next/swc` (130 MB) num processo que é BullMQ. `pnpm deploy --prod` dá 21 MB. Imagem:
**1,01 GB → 371 MB**.

A política de GC do BuildKit estava CERTA (20/30 GB, confirmada no `buildx inspect`) — o
errado era a entrada.

**Alvos novos:** `make deploy` (marca as imagens como `:anterior`, constrói SEM subir,
sobe, confere), `make rollback`, `make podar`.

---

## 6. O design system passou a ser o do Publi

O DS do Pulse foi copiado do Publi e ficou para trás: o Publi consertou o contraste em
14/08 (`895f2fb`) e o Pulse manteve os valores de antes. Eram **iguais em 9 de 11**
tokens, e os que divergiam eram justamente os três consertados.

Hoje vem inteira do Publi: 41 claros e 42 escuros, contra 24 e 22.

**Tripla RGB não é formato:** é o que faz `bg-ink/40` existir. Medido com build antes e
depois — antes, ZERO classes de opacidade da paleta na CSS gerada. O véu da gaveta do
Radar e o do modal de novidades **não pintavam nada**.

**E eu quebrei o tema escuro no meio:** trocar o valor dos tokens sem trocar os
consumidores diretos fez `background: var(--bg)` resolver para `background: 246 246 248`,
CSS inválido que o navegador descarta. Preto sobre `#17161d`, 1,17:1, cascata de receita
ilegível. Nenhum erro em build, console ou teste. Virou o portão mais útil daqui.

Três portões novos: contraste mínimo de 4,5:1, a exceção declarada (`ink-4` a 3,05:1,
herdada do Publi) e o `rgb()`.

---

## 7. Omie: o cron sempre funcionou; a carga nunca removia

**C20 roda todo dia às 04:10, `parcial: false` em 20 execuções.** O defeito era o
`ON CONFLICT DO UPDATE`: acrescenta e atualiza, nunca remove. Eram **1.079 fantasmas**;
1.073 `previsao` (inofensivos) e **6 em atraso somando R$ 31.020,64** na carteira.

**Migração 0056** — tabela sombra: carrega fora do caminho, valida contra o vivo, troca
em UMA transação. Piso de **90%**, medido: variação real de 0,3% em 20 execuções.

Convergência observada nos removidos: **1.172 → 279 → 2 → 4 → 0 → 0 → 0 → 7.**

**Migração 0055** destravou o C22, que falhava com `permission denied` desde 27/08 — seis
dias verde no painel para um ciclo que não conseguia gravar. Ledger regenerado: 6.370
eventos em 68 competências.

**Setembro reapurado** (decisão do usuário, 04/09): saldo final R$ 2.057.951,72 →
**R$ 1.999.358,88**. Os fantasmas viraram `movimento = 'cancelado'` com
`motivo_saida = 'ausente'`. Conferido na tela: `/receita` bate número por número, e a
tabela de fechamento na aba evolução mostra a equação inteira.

---

## 8. ABERTO — o C18 tem o mesmo defeito, e o usuário pediu tempo

Ver a memória `vazamento-de-contas-no-c18` para o detalhe. Em resumo:

- A leitura é **íntegra**: `parcial: false`, 110 páginas, 3.187 lidos, sem filtro na API.
- A escrita nunca remove: **3.277 guardadas − 3.187 lidas = 90 fantasmas**.
- Das 90, **53 com `status_core = 'active'`** — o painel AFIRMA ativas. Das 53, **13
  faturam, somando R$ 82.022,11**. A maior é a **Playhub, R$ 35 mil/mês**.
- É **vazamento contínuo**: 17 em 08/09, 9, 11, 8, 3, 5, 4… desde 23/08.
- **Zero das 13 aparecem** nas quatro listas da Revisão de faturamento (medido chamando
  as funções). Cada exclusão está certa; falta a lista.
- Custo concreto: `contasParaSaida` filtra por `a.ativo`, então as 13 não podem receber
  pedido de cancelamento pela tela.

**Recomendação:** sombra no C18 (o mecanismo já existe e está testado; o piso pode ser
mais apertado que o do Omie, porque a variação é de 0,06%), e a lista na Revisão como
complemento — a sombra remove o registro, não responde por que a Playhub saiu.

---

## 9. Cinco ciclos não estão ativos, e é por desenho

**C1, C2, C3** (réplica), **C5** (HubSpot) e **C8** (adimplência do Omie) são cascas
declaradas sem implementação; o filtro `ehCasca` as tira da agenda.

Consequência: `metrics.daily_snapshot` está **vazio**, então o **C12** roda `ok` gravando
zero — ele CONSOLIDA o snapshot, não o cria. Toda a camada de sinais, score de saúde e
fila de trabalho está sem dado. Estado conhecido, não regressão.

Dos 16 declarados, **11 agendados, 8 execuções cada em 8 dias, zero falhas.**

---

## 10. O que continua pendente, fora do C18

- **O alarme só escreve em stderr.** Severidade alta, e ficou no log do contêiner — foi
  assim que o C22 passou seis dias falhando sem ninguém saber. Precisa de decisão sobre
  destino (e-mail, WhatsApp, push).
- **Deploy automático:** não existe. `make deploy` é manual. A VM já usa timer do systemd
  como padrão (radar, hub, evolution). Publicar em produção sem gente é decisão de
  política, não técnica.
- **`origin/worktree-ds-2026-contraste`**: 1 commit fora da main, a paleta DS 2026. NÃO
  mergear — é anterior ao tema escuro e o preset hex desligaria o mecanismo. A peça que
  valia (o portão de contraste) já foi portada.
- **Dois servidores de dev de sessões antigas** nas portas 3318 e 3344, segurando conexão
  com o Postgres de produção.
- **As três definições da inadimplência** e as decisões do `situacao` do Omie continuam
  tomadas por mim e nunca aprovadas explicitamente.
- **`csm_email` vazio** em todas as contas, então o escopo `carteira` não filtra nada.
- **Destino remoto de backup** (C-26), critério de lançamento do PRD.

---

## Estado do repositório em 09/09

`main` sincronizado com `origin`, topo em `addb2f4`. **797 testes verdes**, lint com 0
erros. Migrações aplicadas até a **0057**. Contêineres no ar com as imagens de 04/09.
