#!/usr/bin/env python3
"""
Transforma o export de tickets do pipeline `INT | Cancelamento` do HubSpot em
SQL para `success.cancellation`. Lê CSV na entrada, escreve SQL na saída.

┌───────────────────────────────────────────────────────────────────────────────┐
│ EMITE SQL em vez de conectar, e são três razões.                              │
│                                                                                │
│ 1. Nenhuma dependência nova: não há psycopg2 nesta máquina e instalar driver   │
│    de banco no Python do sistema para uma carga é preço alto pelo que se ganha.│
│ 2. O SQL é AUDITÁVEL antes de rodar — dá para ler o que vai ser gravado, o     │
│    que num INSERT de 485 linhas em tabela que o time olha não é luxo.          │
│ 3. Os JOIN ficam no Postgres, onde eles são exatos: casar CNPJ com conta e     │
│    buscar o MRR medido são consultas, não laços em Python.                     │
│                                                                                │
│ PYTHON e não TypeScript porque o arquivo tem 863 colunas, campos com quebra    │
│ de linha dentro de aspas e um campo com a fatura inteira do cliente. O `csv`   │
│ da biblioteca padrão lê isso certo. Precedente: `infra/recuperar-do-wal.py`.   │
└───────────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────────┐
│ O SQL EMITIDO É DRY-RUN POR PADRÃO — ele termina em ROLLBACK.                 │
│                                                                                │
│ Rodar sem querer imprime o relatório e não grava nada. Para gravar de verdade  │
│ é preciso dizer, e a intenção vira uma flag explícita na linha de comando:     │
│                                                                                │
│   python3 infra/carga-tickets-hubspot.py tickets.csv > /tmp/carga.sql          │
│   docker exec -i postgres-pulse psql -U postgres -d pulse -f - < /tmp/carga.sql│
│   #                                                    ↑ imprime e desfaz     │
│   docker exec -i postgres-pulse psql -U postgres -d pulse -v gravar=1 -f - ... │
│   #                                                       ↑ grava              │
│                                                                                │
│ Trava melhor que conferir hostname: não depende de eu lembrar de conferir.     │
└───────────────────────────────────────────────────────────────────────────────┘

As decisões abaixo são as da página de conferência, respondidas em 10/09/2026.
"""
import csv
import re
import sys
from datetime import date, timedelta

csv.field_size_limit(10**7)

# O estado vem do STATUS ATUAL, não das etapas por que o ticket passou. É o que
# resolve a Renegociação Financeira: 277 passaram por ela e 1 está nela — os
# outros 276 estão em `Cancelado`, e é `Cancelado` que carrega.
ESTADO = {
    'Pedido de Cancelamento ou Desconto': 'anunciado',
    'Informações Financeiras': 'financeiro',
    'Tentativa de Reversão': 'reversao',
    'Cancelamento Revertido': 'retido',
    'Desconto': 'desconto',
    'Renegociação Financeira': 'renegociado',
    'Cancelado': 'encerrado',
    'Cancelado Alloyal (PDD)': 'encerrado',
}

# As datas automáticas do HubSpot, e não as digitadas pelo CS: medido, as
# manuais são menos completas (408 contra 448, 37 contra 49).
ETAPA = {k: f'Date entered "{k} (INT | Cancelamento)"' for k in ESTADO}

CANAL = {'reunião': 'reuniao', 'reuniao': 'reuniao', 'whatsapp': 'whatsapp',
         'telefônico': 'telefone', 'telefonico': 'telefone',
         'e-mail': 'email', 'email': 'email', 'outro': 'outro'}

# 12 valores do HubSpot para 10 daqui. `desuso` é NOVO: o motivo mais comum do
# export (198 de 485) não cabia em nenhum dos nove que eu havia escrito.
MOTIVO = {
    'Não está/ Não pretende mais utilizar o produto da Lecupon': 'desuso',
    'Cliente alegou problemas financeiros': 'custo',
    'Cliente Inadimplente': 'churn_inadimplencia',
    '[NÃO USAR] A Lecupon não é uma prioridade para a empresa no momento': 'baixa_adesao',
    'Não conseguiu monetizar o clube até o momento': 'baixa_adesao',
    'Está Insatisfeito com o produto - Soluções': 'insatisfacao_produto',
    'Está indo para o Concorrente': 'concorrente',
    '[NÃO USAR] Está insatisfeito(a) com o Produto da Alloyal': 'insatisfacao_produto',
    'Está Insatisfeito com o produto - Problemas Técnicos': 'insatisfacao_produto',
    'Orçamento não comporta o valor da Lecupon': 'custo',
    'Está insatisfeito(a) com o Atendimento da Alloyal': 'insatisfacao_atendimento',
    'Venda não concretizada': None,   # não é motivo de cancelamento: fica nulo
}

digitos = lambda s: re.sub(r'\D', '', s or '')


def dia(s):
    try:
        return date.fromisoformat((s or '').strip()[:10])
    except ValueError:
        return None


def centavos(s):
    s = (s or '').strip().replace(',', '.')
    try:
        return round(float(s) * 100)
    except ValueError:
        return None


def aviso(s):
    """`000` é zero; `750` não é praticado e vira nulo em vez de virar chute."""
    s = (s or '').strip()
    return int(s) if s.isdigit() and 0 <= int(s) <= 365 else None


def canal(s):
    """O campo é multivalor (25 combinações); guarda-se o PRIMEIRO reconhecido."""
    for p in (s or '').split(';'):
        c = CANAL.get(p.strip().lower())
        if c:
            return c
    return None


def lit(v):
    if v is None:
        return 'NULL'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, int):
        return str(v)
    if isinstance(v, date):
        return f"'{v.isoformat()}'"
    return "'" + str(v).replace("'", "''") + "'"


COLUNAS = ['ticket_externo', 'cnpj', 'origem', 'estado', 'pedido', 'data_levantada',
           'canal', 'quem_comunicou', 'mrr_centavos', 'mrr_novo_centavos',
           'aviso_previo_dias', 'data_fim_aviso', 'motivo', 'motivo_detalhe',
           'retido_em', 'etapa_desde', 'criado_em', 'derivou_fim_do_aviso']


def main():
    if len(sys.argv) < 2:
        sys.exit('uso: carga-tickets-hubspot.py <arquivo.csv> > carga.sql')
    with open(sys.argv[1], newline='', encoding='utf-8-sig') as f:
        linhas = list(csv.DictReader(f))

    fora, dentro = [], []
    for x in linhas:
        t = (x.get('Ticket ID') or '').strip()
        status = (x.get('Status do ticket') or '').strip()
        est = ESTADO.get(status)
        if not est:
            fora.append((t, f'status desconhecido: {status}')); continue
        cnpj = digitos(x.get('CNPJ da empresa')) or digitos(x.get('CNPJ'))
        if len(cnpj) != 14:
            fora.append((t, f'documento com {len(cnpj)} dígitos, não 14')); continue
        lev = dia(x.get('[CS] Data que levantou a mão para cancelar'))
        if lev is None:
            fora.append((t, 'sem data de levantada')); continue

        tipo = (x.get('[CS] Cancelamento/Desconto - Tipo') or '').strip()
        av = aviso(x.get('[CS] Dias de aviso prévio'))
        fim, derivou = dia(x.get('[CS] Data do cancelamento')), False
        # Os 3 invertidos: desvio de exatamente −90, do tamanho do próprio aviso.
        if fim is not None and fim < lev:
            fim, derivou = (lev + timedelta(days=av) if av is not None else None), True
        elif fim is None and av is not None:
            fim, derivou = lev + timedelta(days=av), True

        mrr_novo = centavos(x.get('[CSM] Valor do Desconto')) if est == 'desconto' else None
        dentro.append([
            t, cnpj,
            'alloyal' if status.startswith('Cancelado Alloyal') or tipo == 'Cancelado pela Alloyal' else 'cliente',
            est,
            'desconto' if tipo in ('Desconto', 'Downgrade') else 'cancelar',
            lev, canal(x.get('[CS] Canal Utilizado')),
            (x.get('[CS] Email de quem pediu o cancelamento') or '').strip() or None,
            centavos(x.get('[CS] MRR Atual')), mrr_novo, av, fim,
            MOTIVO.get((x.get('[CS] Motivo do Cancelamento') or '').strip()),
            (x.get('[CS] Descreva um pouco mais o que motivou o cancelamento') or '').strip()[:2000] or None,
            dia(x.get(ETAPA['Cancelamento Revertido'])) if est == 'retido' else None,
            dia(x.get(ETAPA[status])) or lev,
            dia(x.get('Data de criação')) or lev,
            derivou,
        ])

    w = sys.stdout.write
    w('-- Gerado por infra/carga-tickets-hubspot.py. DRY-RUN: termina em ROLLBACK.\n')
    w('-- Para gravar de verdade, rode o psql com  -v gravar=1\n')
    w(f'-- {len(dentro)} tickets transformados, {len(fora)} descartados na leitura.\n\n')
    w('\\set ON_ERROR_STOP on\nBEGIN;\n\n')
    w(f'CREATE TEMP TABLE t ({", ".join(c + " text" for c in COLUNAS)}) ON COMMIT DROP;\n')
    for bloco in range(0, len(dentro), 100):
        w('INSERT INTO t VALUES\n')
        w(',\n'.join('  (' + ', '.join(lit(v) for v in r) + ')' for r in dentro[bloco:bloco + 100]))
        w(';\n')

    # Daqui para baixo é o Postgres que decide: o casamento com a conta e o MRR
    # medido são consultas, e consulta é exata onde laço em Python é chute.
    w('''
-- ── O que NÃO vai entrar, e por quê ─────────────────────────────────────────
CREATE TEMP TABLE recusado ON COMMIT DROP AS
SELECT t.ticket_externo, t.cnpj,
       CASE
         WHEN a.id IS NULL THEN 'CNPJ válido sem conta em core.account'
         -- `[CSM] Valor do Desconto` é ambíguo: em 5 dos 11 ele é IGUAL ao MRR,
         -- então não se sabe se é o valor novo ou o abatimento. O CHECK
         -- `desconto_tem_mrr_novo` fica forte de propósito e estes ficam fora:
         -- gravar contração errada mexe no ledger que fecha o mês.
         WHEN t.estado = 'desconto'
              AND (t.mrr_novo_centavos IS NULL
                   OR t.mrr_novo_centavos::bigint >= COALESCE(t.mrr_centavos::bigint, 0))
           THEN 'desconto com valor ambíguo'
         WHEN COALESCE(NULLIF(t.mrr_centavos::bigint, 0), m.mrr_centavos) IS NULL
           THEN 'MRR zero e sem faturamento medido'
       END AS porque
  FROM t
  LEFT JOIN core.account a ON regexp_replace(a.cnpj, '[^0-9]', '', 'g') = t.cnpj
  LEFT JOIN (SELECT DISTINCT ON (account_id) account_id, mrr_centavos
               FROM analytics.mrr_faturado_mes ORDER BY account_id, competencia DESC) m
         ON m.account_id = a.id;
DELETE FROM recusado WHERE porque IS NULL;

-- ── A carga ─────────────────────────────────────────────────────────────────
INSERT INTO success.cancellation
  (ticket_externo, account_id, origem, estado, pedido, data_levantada, canal,
   quem_comunicou, mrr_centavos_na_levantada, mrr_novo_centavos, aviso_previo_dias,
   data_fim_aviso, motivo, motivo_detalhe, retido_em, etapa_desde, criado_em,
   origem_do_registro)
SELECT t.ticket_externo, a.id, t.origem, t.estado, t.pedido, t.data_levantada::date,
       t.canal, t.quem_comunicou,
       -- O MRR do ticket, e o MEDIDO quando o ticket registrou zero. Dois casos,
       -- e marcados: zero esconderia exatamente o churn que a tela mostra.
       COALESCE(NULLIF(t.mrr_centavos::bigint, 0), m.mrr_centavos),
       t.mrr_novo_centavos::bigint, t.aviso_previo_dias::int, t.data_fim_aviso::date,
       t.motivo, t.motivo_detalhe, t.retido_em::date, t.etapa_desde::timestamptz,
       t.criado_em::timestamptz, 'carga_hubspot'
  FROM t
  JOIN core.account a ON regexp_replace(a.cnpj, '[^0-9]', '', 'g') = t.cnpj
  LEFT JOIN (SELECT DISTINCT ON (account_id) account_id, mrr_centavos
               FROM analytics.mrr_faturado_mes ORDER BY account_id, competencia DESC) m
         ON m.account_id = a.id
 WHERE NOT EXISTS (SELECT 1 FROM recusado r WHERE r.ticket_externo = t.ticket_externo)
ON CONFLICT (ticket_externo) WHERE ticket_externo IS NOT NULL DO UPDATE SET
  account_id = EXCLUDED.account_id, origem = EXCLUDED.origem, estado = EXCLUDED.estado,
  pedido = EXCLUDED.pedido, data_levantada = EXCLUDED.data_levantada,
  canal = EXCLUDED.canal, quem_comunicou = EXCLUDED.quem_comunicou,
  mrr_centavos_na_levantada = EXCLUDED.mrr_centavos_na_levantada,
  mrr_novo_centavos = EXCLUDED.mrr_novo_centavos,
  aviso_previo_dias = EXCLUDED.aviso_previo_dias, data_fim_aviso = EXCLUDED.data_fim_aviso,
  motivo = EXCLUDED.motivo, motivo_detalhe = EXCLUDED.motivo_detalhe,
  retido_em = EXCLUDED.retido_em, etapa_desde = EXCLUDED.etapa_desde;

-- ── O relatório ─────────────────────────────────────────────────────────────
\\echo ''
\\echo '── recusados, por motivo:'
SELECT porque, count(*) FROM recusado GROUP BY 1 ORDER BY 2 DESC;
\\echo '── carregados, por posição do quadro:'
SELECT estado, origem, count(*) AS cartoes,
       to_char(sum(mrr_centavos_na_levantada)/100.0, 'FM999G999G999D00') AS mrr,
       count(*) FILTER (WHERE aviso_previo_dias IS NULL) AS sem_aviso,
       count(*) FILTER (WHERE motivo IS NULL) AS sem_motivo
  FROM success.cancellation WHERE origem_do_registro = 'carga_hubspot'
 GROUP BY 1,2 ORDER BY 3 DESC;
\\echo '── faixa de datas e total:'
SELECT count(*) AS total, min(data_levantada) AS primeira, max(data_levantada) AS ultima,
       to_char(sum(mrr_centavos_na_levantada)/100.0, 'FM999G999G999D00') AS mrr_somado
  FROM success.cancellation WHERE origem_do_registro = 'carga_hubspot';

\\if :{?gravar}
  \\echo '>>> GRAVANDO'
  COMMIT;
\\else
  \\echo '>>> DRY-RUN: desfazendo. Rode com -v gravar=1 para gravar.'
  ROLLBACK;
\\endif
''')


if __name__ == '__main__':
    main()
