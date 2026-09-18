# API de leitura `/api/v1` — guia de consumo e operação

> Contrato máquina: `https://pulse.alloyal.com.br/api/v1/openapi.json` (aberto).
> Significado de cada campo: `GET /api/v1/dicionario` (com token).
> Este documento é o "como usar" e o "como operar" — o que o OpenAPI não diz.

## 1. O que a API é — e o que não é

A API expõe a camada **medida** do Pulse (o faturado do Omie) e a camada
**registrada** por gente (saídas, fechamento), mais a **ponte de identidade**
`account_id ↔ CNPJ ↔ código(s) Omie ↔ hubspot_company_id`. Foi feita para o
ETL de conciliação cruzar os dois lados em três níveis: identidade, título a
título e agregados por competência × conta.

Ela **não** tem a camada de contrato: `core.contract` está vazio e `contract_id`
é nulo em todo lugar. O MRR aqui é o **faturado**, com `origem` sempre
`faturamento`. O contrato é responsabilidade do ETL — a API entrega os ids para
o cruzamento.

Só leitura, em todos os níveis: método (`GET`, o resto é 405), token (escopo
`leitura` trancado por CHECK no banco) e papel de banco (`pulse_api`, sem
`INSERT` na tabela de tokens — quem serve a API não cunha a própria chave).

## 2. Autenticação

```
Authorization: Bearer pulse_…
```

- Sem token, revogado ou expirado → **401** com `{"erro":{"codigo":"sem_token"|"token_invalido"}}`.
- Índice (`/api/v1`) e `openapi.json` são abertos: esquema, não dado.
- `/api/v1` fica **fora** do oauth2-proxy (o ETL não tem sessão Google) e **sem**
  o segredo do proxy: o token é o único portão. O allowlist do Cloudflare e o
  mTLS continuam valendo — o token só trafega por dentro do Cloudflare.

## 3. Formato

- Dinheiro em **centavos inteiros, como string** (`"180000"` = R$ 1.800,00).
- Datas ISO: `AAAA-MM-DD` para data, date-time UTC para carimbo.
- Competência `AAAA-MM`. Salvo indicação no dicionário, a competência de um
  título é o **mês do vencimento**.
- CNPJ **só dígitos** na resposta; na consulta a pontuação é ignorada.

Todo recurso de lista devolve o mesmo envelope:

```json
{
  "recurso": "contas",
  "gerado_em": "2026-09-18T12:00:00.000Z",
  "snapshot": "2026-09-18T05:00:00.111Z",
  "dicionario_versao": "2026-09-18",
  "proximo_cursor": "MDAwNThj…",
  "dados": [ … ]
}
```

- `snapshot` é o carimbo do **dado mais novo do recurso** — "até quando estes
  dados vão". Nos recursos sem carimbo por linha (mrr, faturamento, inadimplência)
  é a base do incremental: compare com o `snapshot` da última carga.
- `dicionario_versao` sobe quando um campo **muda de sentido**. Se mudou desde a
  última carga, releia `/api/v1/dicionario` antes de conciliar.

## 4. Paginação

Keyset por **cursor opaco**, nunca offset: a base muda entre páginas e offset
pula ou repete linha.

```
GET /api/v1/titulos?limite=5000
GET /api/v1/titulos?limite=5000&cursor=<proximo_cursor da resposta anterior>
```

- `limite`: default **1.000**, teto **5.000**.
- `proximo_cursor: null` = acabou. Não peça "depois do último".
- Cursor de outra lista, forjado ou corrompido → **400 `cursor_invalido`**.
- Mude os filtros, comece do zero (sem cursor).

## 5. Filtros

| Parâmetro | Forma | Recusa |
|---|---|---|
| `cnpj` | 14 dígitos (ou 11, CPF); pontuação ignorada | outro comprimento → 400 `cnpj_invalido` |
| `account_id` | uuid | 400 `account_id_invalido` |
| `competencia` | `AAAA-MM` | 400 `competencia_invalida` |
| `atualizado_desde` | ISO `AAAA-MM-DD` ou `AAAA-MM-DDTHH:MM:SSZ` | 400 `atualizado_desde_invalido` |

Regra que importa: um filtro que o recurso **não aplica** responde **400
`filtro_nao_suportado`** — nunca é aceito e ignorado. (Aceitar e ignorar
devolveria a base inteira como se fosse o recorte pedido.) O OpenAPI lista,
por recurso, exatamente os filtros que valem.

## 6. Export em massa

`GET /api/v1/<recurso>/export?formato=ndjson|csv` — o recurso inteiro (com os
filtros que ele aceita), em **streaming**: uma linha por registro, sem carregar
tudo na memória. NDJSON é o default; CSV tem cabeçalho e neutraliza injeção de
fórmula (célula começando com `=`, `+`, `@` ganha apóstrofo).

Existe para `contas`, `titulos`, `eventos`, `receita/mrr`,
`receita/faturamento`, `inadimplencia/contas`, `inadimplencia/titulos`.

## 7. Limites de uso

| Régua | Valor | Resposta |
|---|---|---|
| listas | 300 requisições/min **por token** | 429 + `Retry-After` |
| exports | **1 simultâneo por token**, 3 no total | 429 + `Retry-After: 30` |
| falhas de autenticação | 30/min **por IP** — acima disso, 429 antes do banco | 429 |

Em memória, por processo: reinício zera. Valores em `LIMITES`
(`apps/web-internal/app/api/v1/_lib/api.ts`) e expostos em `/api/v1`.

## 8. Os recursos

| Recurso | O que é | Chave | Export |
|---|---|---|---|
| `contas` | ponte de identidade: uma linha por conta com todos os ids, `vinculo` (inclui `sem_vinculo`), status, CSM, setor | `uuid` | ✓ |
| `titulos` | os títulos do Omie como o Pulse os vê (C20): valor, recebido, em aberto, dias de atraso, competência | `bigint` | ✓ |
| `eventos` | o ledger `fact.mrr_event` inteiro | `uuid` | ✓ |
| `receita/mrr` | MRR **suavizado** por competência × conta + faturado bruto + `reconstruido` | `AAAA-MM\|uuid` | ✓ |
| `receita/fechamento` | a cascata da tela: inicial, movimentos, final, `nrr`/`grr` (**razão**), estado | `AAAA-MM` | — |
| `receita/faturamento` | cobrado (por vencimento) × recebido (por pagamento), lado a lado | `AAAA-MM\|uuid` | ✓ |
| `inadimplencia/contas` | a **foto** do dia 1º por conta: em aberto, maior atraso, faixa, `ativa`, `e_cliente` | `AAAA-MM\|uuid` | ✓ |
| `inadimplencia/titulos` | a mesma foto título a título, com `movimento` | `AAAA-MM\|codigo` | ✓ |
| `saidas` | as quatro datas, MRR congelado na levantada, motivo, estado | `uuid` | — |
| `ciclos` | declaração + última execução + **último sucesso** de cada ciclo | — | — |
| `dicionario` | significado, fonte e regras de tudo acima | — | — |

Leituras que enganam (detalhe no dicionário):

- **Inadimplência é foto**: a competência `2026-09` é a foto de **1º/09** e
  descreve o fim de **agosto**. Título sem vínculo sai com `account_id: null`.
- **`nrr`/`grr` são razão** (0.8411 = 84,11%), não percentual.
- **`mrr_centavos` é suavizado** (dobra e buraco corrigidos); `faturado_centavos`
  é o bruto. Os dois vêm na mesma linha de propósito.
- **`receita/mrr` e `receita/faturamento` contam só cliente** (tags
  Cliente/Hinova, sem Azul, sem Fornecedor/Investidor) — o universo da Carteira.
  `titulos` e `inadimplencia` contam tudo do Omie (`e_cliente` marca o recorte).
- **Zero linhas pode ser resposta certa**: uma conta que parou de faturar não
  aparece na competência — não é filtro quebrado.
- O Pulse tem ~90 mil títulos (exclui previsão e cancelado). Ao bater com uma
  base maior, confira o universo antes de ler diferença como erro.

## 9. Receita de batch diário

```
# 1. identidade e fatos, inteiros (um export por vez — teto de concorrência)
GET /api/v1/contas/export
GET /api/v1/titulos/export?atualizado_desde=<snapshot da última carga>
GET /api/v1/eventos/export?atualizado_desde=<idem>

# 2. agregados, por competência (as abertas: mês corrente e anterior)
GET /api/v1/receita/mrr?competencia=2026-09&limite=5000
GET /api/v1/receita/faturamento?competencia=2026-09&limite=5000
GET /api/v1/receita/fechamento
GET /api/v1/inadimplencia/contas?competencia=2026-09&limite=5000

# 3. registrado
GET /api/v1/saidas?atualizado_desde=<idem>

# 4. contra o que comparei
GET /api/v1/ciclos        # ultimo_sucesso_em por ciclo = frescor real
GET /api/v1/dicionario    # se dicionario_versao mudou
```

## 10. Operação: tokens (admin)

Emitir e revogar é ato de admin, pelo CLI, com o papel dono — nunca pela API.

```bash
cd ~/alloyal-pulse
export DATABASE_URL_ADMIN="postgres://postgres:$(grep -E '^POSTGRES_PULSE_PASSWORD=' infra/.env | cut -d= -f2-)@127.0.0.1:5434/pulse"

pnpm --filter @pulse/config token emitir "ETL de conciliação — Fulano" 180   # [dias] opcional
pnpm --filter @pulse/config token listar
pnpm --filter @pulse/config token revogar <id>
```

- O token cru aparece **uma vez**, no terminal de quem emitiu. O banco guarda só
  o SHA-256 (`ops.api_token`). Não há como relê-lo — perdeu, emite outro e revoga o antigo.
- Dê prazo (`[dias]`). Expirar é hábito; revogar é reação.
- Vazou? `revogar <id>` corta na hora — a próxima requisição já toma 401.
- `ultimo_uso_em` é amostrado (uma gravação por minuto por token): serve para
  achar token morto, não para auditoria por requisição.

## 11. Operação: infra

- **Rota**: `location /api/v1` no proxy host do NPM (`infra/proxy-pulse.advanced.conf`),
  fora do `auth_request` e sem `X-Pulse-Proxy-Secret`. Aplicada no
  `advanced_config` (sqlite) **e** no `8.conf`; recarga com `nginx -t && nginx -s reload`.
- **Banco**: migrações `0061` (tokens), `0062` (grant do menu), `0063` (índice
  `omie_titulo.sincronizado_em`, que serve o `snapshot` de títulos).
- **Código**: rotas em `apps/web-internal/app/api/v1/`; a cozinha comum
  (token, envelope, cursor, limites, stream) em `_lib/api.ts`; o SQL em
  `packages/config/src/api-leitura.ts`; o token em `packages/config/src/api-token.ts`.
- **Revisão**: a API passou por revisão QA + pentest ao vivo (PRs #32 e #33):
  auth, revogação, cabeçalhos, injeção, cursor, filtros, CSV, limites.

## 12. Códigos de erro

| HTTP | `erro.codigo` | Quando |
|---|---|---|
| 400 | `cursor_invalido`, `cnpj_invalido`, `account_id_invalido`, `competencia_invalida`, `atualizado_desde_invalido`, `filtro_nao_suportado` | parâmetro malformado ou não aplicável |
| 401 | `sem_token`, `token_invalido` | sem Bearer; token revogado/expirado/desconhecido |
| 405 | — | método diferente de GET |
| 429 | `limite_excedido` | ver §7; respeite `Retry-After` |
| 500 | `erro_interno` | falha inesperada — em JSON, sem detalhe de banco (está no log do servidor) |
