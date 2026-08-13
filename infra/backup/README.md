# Backup do banco do Pulse

O backup compartilhado da casa (`stack-backup.timer`, 03:00 UTC) roda `pg_dumpall`
no Postgres **compartilhado**. O Pulse tem instância própria — `postgres-pulse` —,
logo **não é coberto por ele**. Estes arquivos existem por causa disso.

## O estado antes de 13/08/2026, para não se repetir

O renome de *Alloyal Ops* para *Alloyal Pulse* (migration 0017) trocou o nome do
banco, e o script continuou apontando para `ops`. Ninguém percebeu porque **nada
chamava o script**: sem timer, sem cron. Quando finalmente rodou, falhou com
`database "ops" does not exist` — e deixou no diretório um `.dump` de **zero byte**,
porque `> "$arquivo"` cria o arquivo antes de o `pg_dump` sequer rodar.

O resultado: a base que sustenta NRR e churn da empresa passou de 31/07 a 10/08
sem um único backup, e o diretório continha um arquivo com cara de backup.

As três correções que saíram disso estão no código, não neste texto: o nome do
banco, a gravação em temporário com verificação por `pg_restore --list` antes de
virar arquivo definitivo, e o timer.

## Uso

```bash
make backup        # dump cifrado, agora
make backup-test   # restaura o mais recente num Postgres descartável e confere
make backup-timer  # instala e liga o timer diário (03:30 UTC)
```

O timer roda às **03:30 UTC**: meia hora depois do backup da casa, para não
disputarem I/O, e antes do reboot automático das 04:00. `Persistent=true`, então
uma VM desligada no horário faz o backup ao voltar em vez de pular o dia.

## Cifragem

O dump tem CPF, e-mail e telefone de gente real. O script **recusa** gravar em
claro: sem `age` instalado ou sem destinatário, ele apaga o dump e sai com erro.
`PERMITIR_CLARO=1` contorna, e existe para ser digitado conscientemente — não para
ser o comportamento padrão de um timer noturno cujo log ninguém lê.

O destinatário sai do `.sops.yaml`, e não de uma variável dentro da unit systemd.
É a mesma chave `age` dos segredos, e a custódia dela já está descrita em
`infra/secrets/README.md`: VM (`~/.config/sops/age/keys.txt`, 600) e cofre pessoal
de quem opera.

> ⚠️ **Ao rotacionar a chave** (`make secrets-rotate`, semestral): guarde a chave
> **privada antiga** por pelo menos `RETENCAO_DIAS` (30) depois da troca. Os
> backups já gravados continuam cifrados para ela. Passados os 30 dias, o último
> deles expirou e a chave antiga pode ir embora.

## Restaurar de verdade

Descoberto ao escrever o teste de restauração, e vale para qualquer restore:

**`pg_dump` não inclui os ROLES.** Role é objeto do cluster, não do banco. Restaurar
num cluster novo sem criar os roles antes faz o `pg_restore` abortar a criação das
políticas de RLS com `role "pulse_portal" does not exist`. O banco sobe com as
tabelas de `public_v` em RLS `FORCE` e **zero política** — o que nega tudo. Falha
fechado, então nada vaza; e é justamente por não vazar que passa despercebido até
um cliente reclamar de tela vazia.

Ordem correta:

```bash
# 1. decifrar
age -d -i ~/.config/sops/age/keys.txt -o /tmp/pulse.dump BACKUP.dump.age

# 2. os roles, ANTES do restore
for r in pulse_owner pulse_api pulse_portal pulse_worker; do
  psql -U postgres -c "CREATE ROLE $r NOLOGIN"   # a senha se define depois
done

# 3. restaurar
pg_restore -U postgres -d pulse --no-owner /tmp/pulse.dump

# 4. senhas dos roles: saem do SOPS, nunca digitadas à mão
#    (ver infra/secrets/README.md — PULSE_API_PASSWORD e companhia)
```

`make backup-test` executa exatamente esses passos num contêiner descartável e
confere o que voltou: contas > 0, políticas de RLS > 0, migrations > 0 e **nenhuma**
tabela com RLS forçado sem política. Um `pg_restore` silencioso não prova nada —
um dump de banco vazio também não reclama.

## O que ainda falta

O backup é **local**. Está documentado que isso não cobre perda da VM (pendência
C-13, doc 02). O arquivo já sai cifrado justamente para que a cópia remota seja só
um `rclone`/`oci os object put` a mais, sem rediscutir segurança.
