-- ============================================================================
-- 0038 · Um cliente, várias identidades — match, merge e a história de por quê
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ O CASO QUE FORÇOU ISTO, medido em 13/08/2026.                              │
-- │                                                                            │
-- │ A Swile aparecia no Pulse com R$ 215 mil de faturamento. O real é ordem de  │
-- │ grandeza acima. Ela tem DUAS fichas no Omie:                               │
-- │                                                                            │
-- │   37.374.538/0001-76  SWILE DO BRASIL SOLUÇÕES DE PAGAMENTO LTDA  INATIVA   │
-- │                       6 títulos · R$ 215.375,00   ← o CNPJ que está na conta│
-- │   26.401.688/0001-05  SWILE DO BRASIL S.A.        ativa                    │
-- │                       210 títulos · R$ 1,51 mi vencidos                    │
-- │                                                                            │
-- │ As raízes são 37374538 e 26401688: não têm nada em comum. O casamento por   │
-- │ CNPJ exato acertou a ficha ERRADA, e o casamento por raiz não alcança a     │
-- │ certa. Nenhuma regra automática liga as duas — e os idHubspot também são    │
-- │ diferentes (15926297635 e 13591238254).                                     │
-- │                                                                            │
-- │ E ISSO NÃO É SUJEIRA DE CADASTRO. HubSpot ID diferente é HISTÓRIA COMERCIAL:│
-- │ ganho, upsell e downsell criam empresa/negócio novo. Tratar como erro e     │
-- │ "escolher o certo" jogaria fora metade da história de receita do cliente.   │
-- │                                                                            │
-- │ Por isso o modelo deixa de ser "uma conta, um documento" e passa a ser      │
-- │ "uma conta, N identidades, cada uma com origem, autor e motivo".            │
-- │                                                                            │
-- │ ALCANCE, medido na base: 1.178 contas casam por CNPJ exato, 1.285 só pela   │
-- │ raiz, 779 não casam de jeito nenhum — e 140 dessas têm ficha no Omie com o  │
-- │ mesmo primeiro nome. A Swile é pior que as 779: ela casa, para a ficha      │
-- │ errada. Um vínculo automático não é confiável só porque existe.             │
-- └───────────────────────────────────────────────────────────────────────────┘
-- ============================================================================

BEGIN;

-- ═══ O vínculo vigente ══════════════════════════════════════════════════════
CREATE TABLE core.vinculo_cliente (
  id           bigserial PRIMARY KEY,
  account_id   uuid NOT NULL REFERENCES core.account(id) ON DELETE CASCADE,
  fonte        text NOT NULL,
  -- Documento (Omie) ou id de empresa (HubSpot). Texto porque o HubSpot usa
  -- número grande e o Omie usa CNPJ com zero à esquerda.
  chave        text NOT NULL,
  origem       text NOT NULL,
  -- Obrigatório quando alguém decidiu à mão: vínculo manual sem motivo é o mesmo
  -- que número sem procedência, e é exatamente o que este modelo existe para
  -- evitar.
  motivo       text,
  criado_por   text NOT NULL,
  criado_em    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT vinculo_fonte_valida CHECK (fonte IN ('omie', 'hubspot')),
  CONSTRAINT vinculo_origem_valida CHECK (origem IN ('exato', 'raiz', 'manual', 'ciclo')),
  CONSTRAINT vinculo_manual_tem_motivo CHECK (
    origem <> 'manual' OR (motivo IS NOT NULL AND length(trim(motivo)) >= 10)
  )
);

-- A MESMA identidade não pode pertencer a duas contas.
--
-- É a trava que impede o erro mais caro deste modelo: com a ficha do Omie
-- vinculada a duas contas, o mesmo faturamento é contado duas vezes, e a soma da
-- receita da empresa passa a depender de quantas vezes alguém clicou em vincular.
CREATE UNIQUE INDEX vinculo_chave_unica ON core.vinculo_cliente (fonte, chave);
CREATE INDEX vinculo_conta_idx ON core.vinculo_cliente (account_id, fonte);

COMMENT ON TABLE core.vinculo_cliente IS
  'Identidades externas de uma conta: fichas do Omie e empresas do HubSpot. Uma conta tem VÁRIAS — upsell cria empresa nova (ver 0038).';

-- ═══ A história ═════════════════════════════════════════════════════════════
-- Tabela separada e imutável, e não `ativo boolean` na tabela acima.
--
-- Vínculo desfeito precisa continuar respondendo "quem ligou, quando, por quê, e
-- quem desligou" — porque a pergunta que aparece três meses depois é "por que o
-- faturamento deste cliente mudou de valor?". Um booleano sobrescrito não
-- responde isso; o registro de um vínculo removido responde.
CREATE TABLE core.vinculo_evento (
  id           bigserial PRIMARY KEY,
  account_id   uuid NOT NULL REFERENCES core.account(id) ON DELETE CASCADE,
  fonte        text NOT NULL,
  chave        text NOT NULL,
  acao         text NOT NULL,
  origem       text,
  motivo       text,
  quem         text NOT NULL,
  quando       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT vinculo_evento_acao_valida CHECK (acao IN ('vinculou', 'desvinculou'))
);

CREATE INDEX vinculo_evento_conta_idx ON core.vinculo_evento (account_id, quando DESC);
CREATE INDEX vinculo_evento_chave_idx ON core.vinculo_evento (fonte, chave, quando DESC);

COMMENT ON TABLE core.vinculo_evento IS
  'Trilha imutável de vínculo e desvínculo. Responde "por que o faturamento deste cliente mudou de valor" três meses depois.';

CREATE OR REPLACE FUNCTION core.vinculo_evento_nao_se_altera() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'core.vinculo_evento é trilha e não aceita % — registre um evento novo', TG_OP;
END;
$$;

CREATE TRIGGER vinculo_evento_imutavel
  BEFORE UPDATE OR DELETE ON core.vinculo_evento
  FOR EACH ROW EXECUTE FUNCTION core.vinculo_evento_nao_se_altera();

-- ═══ "Vale os dois" na fila de conferência ══════════════════════════════════
-- A fila só oferecia escolher UM lado. Com upsell criando empresa nova no
-- HubSpot, "os dois estão certos" passou a ser a resposta mais comum — e ela não
-- existia, então quem conferisse era obrigado a descartar metade da história.
ALTER TABLE core.conferencia_fonte DROP CONSTRAINT IF EXISTS conferencia_decisao;
ALTER TABLE core.conferencia_fonte ADD CONSTRAINT conferencia_decisao
  CHECK (decisao IS NULL OR decisao IN ('lecupon', 'omie', 'ambos', 'nenhum'));

-- ═══ Semear com o que as regras automáticas já acertam ══════════════════════
-- Sem isto, a tabela nasce vazia e a leitura teria que decidir entre "não há
-- vínculo" e "ainda não semeamos" — e ela não tem como distinguir.
--
-- Só o casamento EXATO entra. A raiz fica de fora de propósito: é heurística boa
-- para exibir e ruim para gravar como fato, porque a matriz cobre várias filiais
-- e gravar isso como identidade da filial daria a ela o faturamento do grupo.
INSERT INTO core.vinculo_cliente (account_id, fonte, chave, origem, criado_por)
SELECT DISTINCT ON (o.documento) a.id, 'omie', o.documento, 'exato', 'migration/0038'
  FROM core.account a
  JOIN core.omie_cliente o
    ON o.documento = regexp_replace(coalesce(a.cnpj, ''), '[^0-9]', '', 'g')
 WHERE length(regexp_replace(coalesce(a.cnpj, ''), '[^0-9]', '', 'g')) IN (11, 14)
 ORDER BY o.documento, a.ativo DESC, a.criado_em
ON CONFLICT (fonte, chave) DO NOTHING;

-- O HubSpot que a conta já declara. `ON CONFLICT DO NOTHING` porque duas contas
-- podem apontar para a mesma empresa do HubSpot, e a primeira vence — quem
-- desempata é gente, na área de match.
INSERT INTO core.vinculo_cliente (account_id, fonte, chave, origem, criado_por)
SELECT DISTINCT ON (a.hubspot_company_id) a.id, 'hubspot', a.hubspot_company_id, 'exato', 'migration/0038'
  FROM core.account a
 WHERE a.hubspot_company_id IS NOT NULL AND a.hubspot_company_id <> ''
 ORDER BY a.hubspot_company_id, a.ativo DESC, a.criado_em
ON CONFLICT (fonte, chave) DO NOTHING;

GRANT SELECT, INSERT, DELETE ON core.vinculo_cliente TO pulse_api;
GRANT SELECT, INSERT ON core.vinculo_evento TO pulse_api;
GRANT USAGE, SELECT ON SEQUENCE core.vinculo_cliente_id_seq, core.vinculo_evento_id_seq TO pulse_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON core.vinculo_cliente TO pulse_worker;
GRANT SELECT, INSERT ON core.vinculo_evento TO pulse_worker;
GRANT USAGE, SELECT ON SEQUENCE core.vinculo_cliente_id_seq, core.vinculo_evento_id_seq TO pulse_worker;

COMMIT;
