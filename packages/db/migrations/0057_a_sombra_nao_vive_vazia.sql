-- 0057 — o comentário da sombra afirmava o contrário do que ela faz.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ SÓ COMENTÁRIO, e existe porque a 0056 já está aplicada.                    │
-- │                                                                            │
-- │ O guardião de checksum recusa editar migration aplicada, e está certo:      │
-- │ arquivo que muda depois de rodar faz o banco e o repositório contarem       │
-- │ histórias diferentes. Correção entra como migration nova — é o mesmo        │
-- │ caminho da 0047, que consertou uma afirmação falsa da 0045.                 │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ O QUE ESTAVA ERRADO: "Vive vazia entre execuções".                         │
-- │                                                                            │
-- │ Medido em 04/09, depois de duas execuções automáticas: a sombra tinha       │
-- │ 90.280 linhas — exatamente o mesmo que o vivo. A limpeza                    │
-- │ (`limparSombraDeTitulos`) roda ANTES de carregar, e não depois de trocar,   │
-- │ então entre uma execução e a seguinte ela guarda o retrato da última carga. │
-- │                                                                            │
-- │ O comportamento está certo e fica como está: a limpeza antes é o que        │
-- │ garante que a troca nunca misture dois dias, e a cópia residual custa 30 MB │
-- │ e serve para diferenciar contra o vivo quando uma troca parecer duvidosa.   │
-- │ O que estava errado era só a descrição — e descrição errada em objeto de    │
-- │ banco é pior que descrição nenhuma, porque alguém a lê e acredita.          │
-- └───────────────────────────────────────────────────────────────────────────┘

BEGIN;

COMMENT ON TABLE core.omie_titulo_sombra IS
  'Área de carga do C20. Fica CHEIA entre execuções, com o retrato da última carga: '
  'a limpeza é antes de carregar, não depois de trocar. O conteúdo é descartável, e a '
  'cópia residual serve para diferenciar contra o vivo depois de uma troca duvidosa.';

COMMIT;
