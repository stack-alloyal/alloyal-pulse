# Alloyal Ops — atalhos de operação.
# Alvos com efeito em produção estão marcados. Nada aqui faz deploy sem ser pedido.

SHELL := /bin/bash
COMPOSE := docker compose -f infra/docker-compose.yml

.PHONY: help
help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# ─── Desenvolvimento ────────────────────────────────────────────────────────
.PHONY: install
install: ## Instala dependências
	pnpm install

.PHONY: check
check: ## Roda os portões locais: lint, tipos, testes, build
	pnpm lint && pnpm typecheck && pnpm test && pnpm build

.PHONY: db-up
db-up: ## Sobe apenas Postgres e Redis
	$(COMPOSE) up -d postgres-pulse redis-pulse

.PHONY: db-migrate
db-migrate: ## Aplica migrations (usa DATABASE_URL_ADMIN)
	pnpm --filter @pulse/db build && pnpm --filter @pulse/db migrate

.PHONY: seed
seed: ## Popula um banco descartável com massa sintética (recusa base com dado real)
	pnpm --filter @pulse/db build && pnpm --filter @pulse/db seed

PORTA_TESTE ?= 5434
PORTA_SUITE ?= 5456

.PHONY: db-test
db-test: ## Sobe Postgres descartável e roda o portão de isolamento de tenant
# A porta é configurável porque 5434 é a do Postgres de PRODUÇÃO nesta VM: com a
# stack de pé, o `docker run` falha com "port is already allocated" e o portão
# simplesmente não roda. `make db-test PORTA_TESTE=5455` contorna.
	@docker rm -f pulse-pg-test >/dev/null 2>&1 || true
	@docker run -d --name pulse-pg-test -e POSTGRES_PASSWORD=teste -e POSTGRES_DB=pulse \
		-p 127.0.0.1:$(PORTA_TESTE):5432 postgres:16 >/dev/null
	@echo "aguardando o banco..."
	@for i in $$(seq 1 45); do docker exec pulse-pg-test pg_isready -U postgres -d pulse >/dev/null 2>&1 && sleep 2 && break || sleep 1; done
	@pnpm --filter @pulse/db build
	@DATABASE_URL_ADMIN=postgres://postgres:teste@127.0.0.1:$(PORTA_TESTE)/pulse \
		node --test packages/db/dist/rls.test.js
	@docker rm -f pulse-pg-test >/dev/null

.PHONY: suite
suite: ## Roda TODA a suíte do CI num Postgres descartável (o `pnpm test` cobre só um terço)
# `pnpm test` roda os scripts `test` dos pacotes, e vários são fachada — o de
# @pulse/config é um `echo`. Os testes que importam são nomeados um a um no
# ci.yml. Este alvo lê a lista de lá, para não existirem duas verdades.
#
# E sobe um cluster PRÓPRIO: rls.test.ts faz `ALTER ROLE ... WITH PASSWORD`, e
# role vale para o cluster inteiro. Apontar a suíte para um banco de teste ao
# lado da produção derrubou o Pulse em 10/08/2026.
	@docker rm -f pulse-pg-suite >/dev/null 2>&1 || true
	@docker run -d --name pulse-pg-suite -e POSTGRES_PASSWORD=teste -e POSTGRES_DB=pulse \
		-p 127.0.0.1:$(PORTA_SUITE):5432 postgres:16 >/dev/null
	@echo "aguardando o banco..."
	@for i in $$(seq 1 45); do docker exec pulse-pg-suite pg_isready -U postgres -d pulse >/dev/null 2>&1 && sleep 2 && break || sleep 1; done
	@pnpm build >/dev/null
	@set -e; \
	 lista=$$(grep -oP '(packages|apps)/[a-z-]+/(dist/\S*\.test\.js|\S*\.test\.mjs)' .github/workflows/ci.yml | sort -u); \
	 echo "$$(echo "$$lista" | wc -l) arquivos de teste nomeados no ci.yml"; \
	 for f in $$lista; do test -f "$$f" || { echo "não compilado: $$f"; exit 1; }; done; \
	 DATABASE_URL_ADMIN=postgres://postgres:teste@127.0.0.1:$(PORTA_SUITE)/pulse \
	 DATABASE_URL=postgres://postgres:teste@127.0.0.1:$(PORTA_SUITE)/pulse \
	 node --test --test-concurrency=1 $$lista; \
	 r=$$?; docker rm -f pulse-pg-suite >/dev/null; exit $$r

# ─── Segredos ───────────────────────────────────────────────────────────────
.PHONY: secrets-edit
secrets-edit: ## Edita os segredos cifrados
	sops infra/secrets/pulse.env.sops.yaml

.PHONY: primeiro-admin
primeiro-admin: ## Dá o primeiro acesso num banco vazio (EMAIL=nome@alloyal.com.br)
	@test -n "$(EMAIL)" || { echo "uso: make primeiro-admin EMAIL=nome@alloyal.com.br"; exit 1; }
	pnpm --filter @pulse/db build
	@node packages/db/dist/primeiro-admin-cli.js "$(EMAIL)"

.PHONY: secrets-check
secrets-check: ## Recusa segredo que é placeholder cifrado ou curto demais
	@bash infra/secrets/verificar.sh

.PHONY: secrets-decrypt
secrets-decrypt: ## Gera infra/.env (600) a partir do arquivo cifrado
	@bash infra/secrets/verificar.sh
	@sops -d --output-type dotenv infra/secrets/pulse.env.sops.yaml > infra/.env
	@chmod 600 infra/.env
	@echo "infra/.env gerado (600). NÃO versionar."

# ─── Produção (VM) ──────────────────────────────────────────────────────────
#
# `up` constrói E sobe no mesmo comando. Serve para mudança pequena, mas tem uma
# propriedade ruim: se o build falhar no meio, a stack já foi parada. `deploy`
# separa as duas coisas e guarda o caminho de volta — use ele para publicar.
.PHONY: up
up: ## [PRODUÇÃO] Sobe a stack (constrói e sobe junto)
	$(COMPOSE) up -d --build

APPS := worker web-internal web-portal

.PHONY: deploy
deploy: ## [PRODUÇÃO] Publica com ponto de retorno: marca, constrói, sobe, confere
# ┌─────────────────────────────────────────────────────────────────────────────┐
# │ A ORDEM É O PRODUTO DESTE ALVO, e cada passo existe por um motivo.            │
# │                                                                              │
# │ 1. MARCAR primeiro. O build sobrescreve `:latest`, e sem a marca não há       │
# │    volta — a imagem anterior vira camada órfã e some na próxima poda.         │
# │ 2. CONSTRUIR SEM SUBIR. Se falhar aqui, produção não foi tocada. É a          │
# │    diferença para o `up`, que já derrubou a stack quando o build quebra.      │
# │ 3. SUBIR só depois de as três imagens existirem.                             │
# │ 4. CONFERIR, e dizer como voltar se não subiu.                               │
# └─────────────────────────────────────────────────────────────────────────────┘
	@echo "── 1/4 · ponto de retorno ──"
	@for a in $(APPS); do 	  docker image inspect alloyal-pulse-$$a:latest >/dev/null 2>&1 	    && docker tag alloyal-pulse-$$a:latest alloyal-pulse-$$a:anterior 	    && echo "   alloyal-pulse-$$a:anterior" 	    || echo "   alloyal-pulse-$$a ainda não existe — primeira publicação"; 	done
	@echo "── 2/4 · construindo (produção intacta se falhar) ──"
	$(COMPOSE) build $(APPS)
	@echo "── 3/4 · subindo ──"
	$(COMPOSE) up -d $(APPS)
	@echo "── 4/4 · conferindo ──"
	@sleep 6
	@$(COMPOSE) ps $(APPS)
	@echo
	@echo "   Se algo não subiu, o caminho de volta é:"
	@echo "     make rollback && make up"

.PHONY: rollback
rollback: ## [PRODUÇÃO] Devolve as imagens marcadas por `deploy` para :latest
	@for a in $(APPS); do 	  docker image inspect alloyal-pulse-$$a:anterior >/dev/null 2>&1 	    && docker tag alloyal-pulse-$$a:anterior alloyal-pulse-$$a:latest 	    && echo "   alloyal-pulse-$$a devolvida" 	    || echo "   alloyal-pulse-$$a:anterior NÃO EXISTE — nada a devolver"; 	done
	@echo "   Agora: $(COMPOSE) up -d $(APPS)"

.PHONY: podar
podar: ## Poda cache de build e imagens órfãs (o cache é COMPARTILHADO com os outros apps da VM)
# ⚠️ O cache do BuildKit é do DAEMON, não do projeto: podar aqui deixa o próximo
# build do radar, do evolution e do publi mais lento também. Não quebra nada — só
# reconstrói —, mas é bom saber antes de rodar no meio do dia de alguém.
#
# `until=24h` preserva o cache do dia, que é o que acelera um segundo deploy hoje.
	@echo "antes:"; docker system df | head -5
	@docker builder prune --force --filter until=24h
	@docker image prune --force
	@echo "depois:"; docker system df | head -5

.PHONY: logs
logs: ## Segue os logs
	$(COMPOSE) logs -f --tail=100

.PHONY: ps
ps: ## Estado dos contêineres
	$(COMPOSE) ps

.PHONY: backup
backup: ## [PRODUÇÃO] Dump cifrado do banco do Pulse
	bash infra/backup/pulse-backup.sh

.PHONY: backup-test
backup-test: ## Restaura o backup mais recente num Postgres descartável e confere o que voltou
	bash infra/backup/pulse-restore-test.sh

.PHONY: backup-timer
backup-timer: ## [PRODUÇÃO] Instala e liga o timer diário do backup (03:30 UTC)
	sudo cp infra/backup/pulse-backup.service infra/backup/pulse-backup.timer /etc/systemd/system/
	sudo systemctl daemon-reload
	sudo systemctl enable --now pulse-backup.timer
	systemctl list-timers pulse-backup.timer --no-pager
