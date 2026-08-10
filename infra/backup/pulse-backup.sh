#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Backup do banco do Pulse.
#
# ⚠️ POR QUE ESTE ARQUIVO EXISTE
#
# O backup compartilhado da casa (/opt/stack/infra/backup, timer systemd 03:00
# UTC) roda `pg_dumpall` no Postgres COMPARTILHADO. O Pulse tem instância própria
# (`postgres-pulse`), logo NÃO é coberto por ele. Sem este script, o primeiro BI da
# empresa fica sem backup e ninguém percebe até precisar restaurar.
#
# ⚠️ E O QUE AINDA FALTA
#
# O backup da casa é LOCAL — está documentado que "não cobre perda da VM". Para
# uma base que passa a ser a fonte de NRR e churn da empresa, isso é insuficiente:
# falta destino remoto. Pendência C-13 (doc 02). Este script já grava cifrado
# para que a cópia remota seja só um `rclone`/`oci os object put` a mais.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/stack/backups/pulse}"
RETENCAO_DIAS="${RETENCAO_DIAS:-30}"
CONTAINER="${CONTAINER:-postgres-pulse}"
# O renome de Alloyal Ops para Alloyal Pulse (migration 0017) trocou o nome do
# BANCO, e este script ficou apontando para `ops`. Descoberto em 10/08/2026: o
# diretório de backup tinha um único arquivo, de zero byte — nunca houve um
# backup bem-sucedido desta base.
DB="${DB:-pulse}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$BACKUP_DIR"

PARCIAL="$BACKUP_DIR/.pulse-$STAMP.parcial"
trap 'rm -f "$PARCIAL"' EXIT

# Escreve em arquivo temporário e só renomeia depois de verificar. O redirecionamento
# direto cria o arquivo ANTES de o pg_dump falhar: era assim que um backup inexistente
# aparecia no diretório como `pulse-....dump` de zero byte, indistinguível de um bom.
# --format=custom permite restauração seletiva de tabela; --no-owner facilita
# restaurar em instância com papéis diferentes (staging).
docker exec "$CONTAINER" pg_dump -U postgres -d "$DB" --format=custom --no-owner > "$PARCIAL"

# Backup que ninguém abriu não é backup. `pg_restore --list` lê o índice do dump:
# é barato e prova que o arquivo é um dump íntegro, não um pedaço truncado.
if ! docker exec -i "$CONTAINER" pg_restore --list < "$PARCIAL" > /dev/null 2>&1; then
  echo "ERRO: o dump de '$DB' não passou no pg_restore --list — não vou gravá-lo como backup." >&2
  exit 1
fi

TABELAS=$(docker exec -i "$CONTAINER" pg_restore --list < "$PARCIAL" 2>/dev/null | grep -c 'TABLE DATA' || true)
if [ "$TABELAS" -lt 1 ]; then
  echo "ERRO: o dump não tem nenhuma TABLE DATA. Banco errado, ou vazio." >&2
  exit 1
fi

mv "$PARCIAL" "$BACKUP_DIR/pulse-$STAMP.dump"
echo "dump verificado: $TABELAS tabelas com dado"

if command -v age >/dev/null 2>&1 && [ -n "${AGE_RECIPIENT:-}" ]; then
  age -r "$AGE_RECIPIENT" -o "$BACKUP_DIR/pulse-$STAMP.dump.age" "$BACKUP_DIR/pulse-$STAMP.dump"
  rm -f "$BACKUP_DIR/pulse-$STAMP.dump"
  echo "backup cifrado: $BACKUP_DIR/pulse-$STAMP.dump.age"
else
  # Dump em claro contém dado pessoal. Avisar alto: não é detalhe.
  echo "AVISO: backup NÃO cifrado (defina AGE_RECIPIENT). Contém dado pessoal." >&2
  echo "backup: $BACKUP_DIR/pulse-$STAMP.dump"
fi

find "$BACKUP_DIR" -name 'pulse-*.dump*' -mtime "+$RETENCAO_DIAS" -delete

# A restauração é testada por trimestre (doc 00, 11 · doc 01, 17.4).
# Backup nunca restaurado não é backup — é esperança.
