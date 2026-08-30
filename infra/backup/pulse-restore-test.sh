#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Prova que o backup mais recente do Pulse restaura.
#
# ⚠️ POR QUE ESTE ARQUIVO EXISTE
#
# Os documentos pedem teste de restauração trimestral (doc 00, 11 · doc 01, 17.4)
# com a frase certa: "backup nunca restaurado não é backup — é esperança". Até
# 13/08/2026 isso era só a frase: não havia como executá-la, e o próprio backup
# estava quebrado desde o renome sem ninguém notar.
#
# Roda num Postgres DESCARTÁVEL, criado e destruído aqui. Não toca em produção,
# não depende de estar na VM certa, e pode rodar a qualquer momento.
#
# ⚠️ O QUE ESTE TESTE DESCOBRIU, E QUE VALE PARA UMA RESTAURAÇÃO DE VERDADE
#
# `pg_dump` não inclui ROLES — eles são objetos do cluster, não do banco. Restaurar
# num cluster novo sem criar os roles antes faz o pg_restore ABORTAR a criação das
# políticas de RLS, com "role pulse_portal does not exist". O banco sobe com as
# tabelas de `public_v` em RLS FORCE e ZERO política, o que nega tudo: o portal do
# cliente restaurado não enxerga uma linha. Falha fechado, então nada vaza — e por
# isso mesmo passa despercebido até um cliente reclamar que a tela está vazia.
#
# Por isso a ordem abaixo é: criar roles, DEPOIS restaurar.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/stack/backups/pulse}"
CONTAINER="${CONTAINER:-pulse-pg-restore-test}"
PORTA="${PORTA:-5458}"
CHAVE_AGE="${CHAVE_AGE:-$HOME/.config/sops/age/keys.txt}"

ARQUIVO="${1:-$(ls -t "$BACKUP_DIR"/pulse-*.dump.age "$BACKUP_DIR"/pulse-*.dump 2>/dev/null | head -1 || true)}"
if [ -z "$ARQUIVO" ] || [ ! -f "$ARQUIVO" ]; then
  echo "ERRO: nenhum backup encontrado em $BACKUP_DIR" >&2
  exit 1
fi
echo "testando: $ARQUIVO"

TMP="$(mktemp -d)"
limpar() {
  rm -rf "$TMP"
  # ⚠️ O `-v` NÃO É OPCIONAL. A imagem do Postgres declara `VOLUME /var/lib/postgresql/data`, então cada
  # execução cria um volume ANÔNIMO de ~85 MB — e `docker rm` sem `-v` o deixa para trás. Medido na VM em
  # 29/08: 328 volumes órfãos ocupando 20,7 GB (somando o mesmo bug na suíte do Hub).
  # Aqui é mais sério que espaço: o volume que sobra é a RESTAURAÇÃO DE UM BACKUP DE PRODUÇÃO. Naquela
  # varredura os órfãos estavam vazios, mas o dia em que um teste rodar com dump cheio deixa uma cópia
  # da base de clientes num volume que ninguém audita.
  docker rm -f -v "$CONTAINER" >/dev/null 2>&1 || true
}
trap limpar EXIT

# ── 1. Decifrar, se for o caso ──────────────────────────────────────────────
DUMP="$TMP/pulse.dump"
if [[ "$ARQUIVO" == *.age ]]; then
  [ -f "$CHAVE_AGE" ] || { echo "ERRO: chave privada não encontrada em $CHAVE_AGE" >&2; exit 1; }
  age -d -i "$CHAVE_AGE" -o "$DUMP" "$ARQUIVO"
  echo "decifrado"
else
  cp "$ARQUIVO" "$DUMP"
fi

# ── 2. Postgres descartável ─────────────────────────────────────────────────
docker rm -f -v "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=teste -e POSTGRES_DB=restaurado \
  -p "127.0.0.1:$PORTA:5432" postgres:16 >/dev/null
for _ in $(seq 1 45); do
  docker exec "$CONTAINER" pg_isready -U postgres -d restaurado >/dev/null 2>&1 && sleep 2 && break || sleep 1
done

# ── 3. Os roles ANTES do restore — ver o cabeçalho ──────────────────────────
for r in pulse_owner pulse_api pulse_portal pulse_worker; do
  docker exec "$CONTAINER" psql -U postgres -qtAc \
    "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='$r') THEN EXECUTE 'CREATE ROLE $r NOLOGIN'; END IF; END \$\$" >/dev/null
done

# ── 4. Restaurar ────────────────────────────────────────────────────────────
docker cp "$DUMP" "$CONTAINER:/tmp/r.dump" >/dev/null
ERROS="$(docker exec "$CONTAINER" pg_restore -U postgres -d restaurado --no-owner /tmp/r.dump 2>&1 | grep -ci 'error' || true)"
if [ "$ERROS" -gt 0 ]; then
  echo "ERRO: pg_restore relatou $ERROS erro(s)" >&2
  docker exec "$CONTAINER" pg_restore -U postgres -d restaurado --no-owner /tmp/r.dump 2>&1 | grep -i error | head -5 >&2
  exit 1
fi

# ── 5. Provar que o que voltou serve ────────────────────────────────────────
# Não basta "o pg_restore não reclamou": um dump de um banco vazio também não
# reclama. As três perguntas abaixo são o que distingue backup de arquivo.
LEITURA="$(docker exec "$CONTAINER" psql -U postgres -d restaurado -tAc "
SELECT (SELECT count(*) FROM core.account) || '|' ||
       (SELECT count(*) FROM pg_policy) || '|' ||
       (SELECT count(*) FROM pg_class c WHERE c.relrowsecurity AND c.relforcerowsecurity
          AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)) || '|' ||
       (SELECT count(*) FROM public.schema_migration)")"
CONTAS="${LEITURA%%|*}"; RESTO="${LEITURA#*|}"
POLITICAS="${RESTO%%|*}"; RESTO="${RESTO#*|}"
ORFAS="${RESTO%%|*}"; MIGRACOES="${RESTO#*|}"

echo "contas=$CONTAS políticas=$POLITICAS migrations=$MIGRACOES rls-órfão=$ORFAS"

FALHOU=0
[ "$CONTAS"    -gt 0 ] || { echo "ERRO: nenhuma conta no banco restaurado" >&2; FALHOU=1; }
[ "$POLITICAS" -gt 0 ] || { echo "ERRO: nenhuma política de RLS restaurada" >&2; FALHOU=1; }
[ "$MIGRACOES" -gt 0 ] || { echo "ERRO: nenhuma migration registrada" >&2; FALHOU=1; }
[ "$ORFAS" -eq 0 ] || { echo "ERRO: $ORFAS tabela(s) com RLS forçado e nenhuma política — o recurso morre calado" >&2; FALHOU=1; }
[ "$FALHOU" -eq 0 ] || exit 1

echo "✓ o backup restaura, e o que voltou está íntegro"
