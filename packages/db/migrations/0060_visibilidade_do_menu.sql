-- 0060 — a visibilidade de cada item do menu, editável pelo admin.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ POR QUE ESTA TABELA EXISTE.                                                │
-- │                                                                            │
-- │ O menu é DECLARADO em `menu.ts` e aparecia inteiro para todo mundo. Só que  │
-- │ algumas telas foram implementadas pela metade — o ciclo por trás não roda,  │
-- │ o dado não existe — e mesmo assim ficavam no menu, gerando "eu deveria ter  │
-- │ acesso a isso?" em quem não devia nem ver. Esconder da navegação resolve a  │
-- │ dúvida sem bloquear a rota: quem tem a URL ainda entra.                     │
-- │                                                                            │
-- │ A decisão é do ADMIN e muda sem deploy, então mora em tabela e não no        │
-- │ código. `menu.ts` continua declarando o status PADRÃO de cada item (pronto  │
-- │ ou em construção); esta tabela é o OVERRIDE por cima dele.                  │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ CHAVE É O `href`, e não um id novo.                                        │
-- │                                                                            │
-- │ O href já identifica o item de menu de forma única e estável, e é o que a    │
-- │ tela usa para casar override com item. Um id sintético seria uma segunda    │
-- │ identidade para manter em dia. Item que sai do menu.ts deixa uma linha       │
-- │ órfã aqui — inofensiva, porque a tela só lê override de href que existe.    │
-- └───────────────────────────────────────────────────────────────────────────┘

BEGIN;

CREATE TABLE ops.menu_visibilidade (
  href           text PRIMARY KEY,
  visivel        boolean NOT NULL,
  -- Por que foi escondido/mostrado. Não é enfeite: "em construção, C1 não roda"
  -- é o que impede alguém de reexibir sem saber por que estava oculto.
  motivo         text,
  atualizado_por text NOT NULL,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ops.menu_visibilidade IS
  'Override de visibilidade do menu por item (href). Ausência = usa o padrão '
  'declarado em menu.ts. Editável pelo admin em /configuracoes/acesso-do-menu.';

COMMIT;
