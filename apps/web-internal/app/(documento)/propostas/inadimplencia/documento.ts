/**
 * O documento da proposta de inadimplência — autossuficiente, do jeito do
 * `/numeros`: um HTML fixo com o próprio CSS, sem Tailwind e sem `estilo.css`.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POR QUE NÃO É UMA TELA NORMAL DO PULSE.                                    │
 * │                                                                            │
 * │ É documento, não ferramenta: lê-se de cima a baixo uma vez, e o que ele     │
 * │ pede é uma decisão. Dentro da casca ele ganharia sidebar, topbar e a        │
 * │ largura de 1200 de uma tela de operação — e perderia a coluna de leitura    │
 * │ de 68 caracteres, que é o que faz prosa longa ser lida.                    │
 * │                                                                            │
 * │ Os NÚMEROS SÃO FIXOS, e isso é deliberado. Foram medidos contra o banco em  │
 * │ 25/08/2026 e a proposta discute ESSA medição. Uma consulta ao vivo aqui     │
 * │ faria o texto e a tabela discordarem no dia seguinte, e a decisão que o     │
 * │ documento pede seria tomada sobre um número que já mudou. A página que      │
 * │ consulta o banco é a que está sendo PROPOSTA — não esta.                    │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * DUAS DIVERGÊNCIAS em relação ao artefacto publicado no claude.ai, e o motivo:
 *
 *  1. Sem `fonts.googleapis.com`. O Pulse não carrega webfont nenhum — declara
 *     `Inter` e cai na pilha do sistema. Uma tela interna atrás do login que
 *     depende de host externo para renderizar é dependência que não paga o que
 *     custa, e a família passa a divergir do resto do produto no dia em que o
 *     Google mudar de rota.
 *
 *  2. Sem `<title>` e sem `<link>` aqui dentro: o título vira `metadata` do
 *     layout, que é onde o Next quer que ele more.
 *
 * As CORES são token de `estilo.css`, byte a byte — há portão no
 * `design-system.test.mjs` comparando as duas listas. Documento autossuficiente
 * é justamente onde a paleta desliza sem ninguém ver.
 */

export const ESTILO = `/* ─────────────────────────────────────────────────────────────────────────────
   Tokens COPIADOS de packages/ui/src/estilo.css, não aproximados: dois roxos
   parecidos são piores que dois roxos diferentes — ninguém sabe qual é o certo.
   Nada aqui é verde: no design system da Alloyal verde significa "saudável", e
   estado de dado não é saúde de negócio.
   ───────────────────────────────────────────────────────────────────────────── */
:root{
  --bg:#f6f6f8; --surface:#ffffff; --surface-2:#fbfbfc;
  --line:#ececef; --line-strong:#e0e0e6;
  --ink:#16161a; --ink-2:#5b5b66; --ink-3:#75757e; --ink-4:#93939a;
  --purple-50:#f3ecfe; --purple-100:#e3d2fb; --purple-500:#6a18e5; --purple-700:#5512b8;
  --orange-50:#fff3e8; --orange-500:#ff7a00; --orange-700:#b45309;
  --amber:#f59e0b; --amber-50:#fef4e2; --red:#d32424; --red-50:#fcebeb;
  --sombra:0 1px 2px rgba(22,22,26,.05), 0 1px 3px rgba(22,22,26,.04);
}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){
  --bg:#0f0e13; --surface:#17161d; --surface-2:#1d1c25;
  --line:#2a2833; --line-strong:#383544;
  --ink:#edecf2; --ink-2:#a9a6b6; --ink-3:#827e90; --ink-4:#656174;
  --purple-50:#241a3a; --purple-100:#2e2350; --purple-500:#8a3fea; --purple-700:#b98bff;
  --orange-50:#2a1b0c; --orange-500:#ff8c28; --orange-700:#ffb870;
  --amber:#fbbf24; --amber-50:#2e2410; --red:#f87171; --red-50:#2e1618;
  --sombra:0 1px 2px rgba(0,0,0,.45);
}}
:root[data-theme="dark"]{
  --bg:#0f0e13; --surface:#17161d; --surface-2:#1d1c25;
  --line:#2a2833; --line-strong:#383544;
  --ink:#edecf2; --ink-2:#a9a6b6; --ink-3:#827e90; --ink-4:#656174;
  --purple-50:#241a3a; --purple-100:#2e2350; --purple-500:#8a3fea; --purple-700:#b98bff;
  --orange-50:#2a1b0c; --orange-500:#ff8c28; --orange-700:#ffb870;
  --amber:#fbbf24; --amber-50:#2e2410; --red:#f87171; --red-50:#2e1618;
  --sombra:0 1px 2px rgba(0,0,0,.45);
}

*{box-sizing:border-box}
body{
  background:var(--bg); color:var(--ink);
  font-family:'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size:15px; line-height:1.62; -webkit-font-smoothing:antialiased;
  margin:0; padding:0 20px 88px;
}
.folha{max-width:1080px; margin:0 auto}
.prosa{max-width:68ch}
p{margin:0 0 14px} p:last-child{margin-bottom:0}
strong{font-weight:600; color:var(--ink)}
a{color:var(--purple-500); text-decoration:none; border-bottom:1px solid var(--purple-100)}
a:hover{border-bottom-color:var(--purple-500)}
:where(a,button,summary):focus-visible{outline:2px solid var(--purple-500); outline-offset:2px; border-radius:3px}
.num{font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-variant-numeric:tabular-nums}

/* ── Cabeçalho ─────────────────────────────────────────────────────────────── */
header.capa{padding:52px 0 34px; border-bottom:1px solid var(--line)}
.marca{height:26px; width:auto; display:block; color:var(--orange-500)}
.sobre{
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:11px; font-weight:500;
  letter-spacing:.13em; text-transform:uppercase; color:var(--purple-500);
  margin:28px 0 10px;
}
h1{
  font-size:clamp(34px,5.4vw,52px); line-height:1.04; letter-spacing:-.028em;
  font-weight:700; margin:0 0 16px; text-wrap:balance;
}
.deck{font-size:18px; line-height:1.55; color:var(--ink-2); max-width:64ch; margin:0}
.carimbo{
  margin-top:22px; display:flex; flex-wrap:wrap; gap:8px 18px;
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:11.5px; color:var(--ink-3);
}

/* ── Faixa de KPI ──────────────────────────────────────────────────────────── */
.kpis{display:grid; grid-template-columns:repeat(auto-fit,minmax(215px,1fr)); gap:12px; margin:30px 0 0}
.kpi{
  background:var(--surface); border:1px solid var(--line); border-radius:10px;
  padding:16px 18px 15px 20px; position:relative; overflow:hidden; box-shadow:var(--sombra);
}
/* A barra lateral de 4px do §04 do design system. */
.kpi::before{content:""; position:absolute; inset:0 auto 0 0; width:4px; background:var(--purple-500)}
.kpi.alerta::before{background:var(--red)} .kpi.marca-b::before{background:var(--orange-500)}
.kpi dt{
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:10.5px; font-weight:500;
  letter-spacing:.1em; text-transform:uppercase; color:var(--ink-3); margin:0 0 7px;
}
.kpi dd{
  margin:0; font-size:25px; font-weight:600; letter-spacing:-.02em; line-height:1.12;
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-variant-numeric:tabular-nums;
}
.kpi dd small{display:block; font-family:'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size:12.5px; font-weight:400;
  letter-spacing:0; color:var(--ink-3); margin-top:5px; font-variant-numeric:normal}

/* ── Seções ────────────────────────────────────────────────────────────────── */
section{padding-top:52px}
.rubrica{display:flex; align-items:baseline; gap:13px; margin:0 0 8px}
.rubrica .marcador{
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:12px; font-weight:600;
  color:var(--purple-500); padding-top:5px;
}
h2{font-size:26px; font-weight:650; letter-spacing:-.022em; line-height:1.2; margin:0; text-wrap:balance}
h3{font-size:16.5px; font-weight:600; letter-spacing:-.008em; margin:30px 0 8px}
.regua{height:3px; width:52px; background:var(--purple-500); border-radius:2px; margin:16px 0 20px}

/* ── Tabelas ───────────────────────────────────────────────────────────────── */
table.bench{min-width:820px}
table.bench :is(th,td):nth-child(1){width:13%}
table.bench :is(th,td):nth-child(2){width:15%}
table.bench :is(th,td):nth-child(3){width:24%}
.pastilha.tracejada{width:17px; height:0; border-radius:0; background:none;
  border-top:2px dashed var(--purple-500)}
.rolo{overflow-x:auto; margin:20px 0; border:1px solid var(--line); border-radius:10px; background:var(--surface)}
table{width:100%; border-collapse:collapse; font-size:13.5px; min-width:560px}
caption{
  caption-side:top; text-align:left; padding:13px 18px 11px; font-size:12.5px; color:var(--ink-2);
  border-bottom:1px solid var(--line); background:var(--surface-2);
}
caption b{color:var(--ink); font-weight:600}
th{
  text-align:left; font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:10.5px; font-weight:500;
  letter-spacing:.085em; text-transform:uppercase; color:var(--ink-3);
  padding:11px 16px 9px; border-bottom:1px solid var(--line-strong); white-space:nowrap;
}
td{padding:10px 16px; border-bottom:1px solid var(--line); vertical-align:top; color:var(--ink-2)}
tbody tr:last-child td{border-bottom:0}
td:first-child{color:var(--ink); font-weight:500}
.n{text-align:right; font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-variant-numeric:tabular-nums; white-space:nowrap}
tr.somatorio td{background:var(--surface-2); font-weight:600; color:var(--ink); border-top:1px solid var(--line-strong)}
tr.morta td{color:var(--ink-3)} tr.morta td:first-child{color:var(--ink-2)}
tr.viva td:first-child{color:var(--ink)} tr.viva td{background:var(--purple-50)}

.selo{
  display:inline-block; font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:10px; font-weight:500;
  letter-spacing:.06em; text-transform:uppercase; padding:2.5px 7px; border-radius:5px;
  background:var(--surface-2); border:1px solid var(--line-strong); color:var(--ink-2); white-space:nowrap;
}
.selo.q{background:var(--red-50); border-color:transparent; color:var(--red)}
.selo.a{background:var(--amber-50); border-color:transparent; color:var(--orange-700)}
.selo.r{background:var(--purple-50); border-color:transparent; color:var(--purple-700)}

/* ── Gráficos ──────────────────────────────────────────────────────────────── */
.quadro{
  border:1px solid var(--line); border-radius:10px; background:var(--surface);
  padding:18px 18px 12px; margin:22px 0; box-shadow:var(--sombra);
}
.quadro-topo{display:flex; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:10px; margin-bottom:6px}
.quadro-topo h4{font-size:14px; font-weight:600; margin:0}
.legenda{display:flex; flex-wrap:wrap; gap:14px; font-size:11.5px; color:var(--ink-2)}
.legenda span{display:inline-flex; align-items:center; gap:6px}
.pastilha{width:11px; height:11px; border-radius:3px; flex:none}
.g{display:block; width:100%; height:auto; overflow:visible}
.grade line{stroke:var(--line); stroke-width:1}
.ey,.ex{font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:10px; fill:var(--ink-3)}
.area{fill:var(--purple-500); opacity:.09}
.linha{fill:none; stroke:var(--purple-500); stroke-width:2.2; stroke-linejoin:round; stroke-linecap:round}
.linha-parcial{stroke-dasharray:5 4; opacity:.55}
.pt{fill:var(--surface); stroke:var(--purple-500); stroke-width:2}
.pt-parcial{fill:var(--bg); stroke:var(--purple-500); stroke-width:2; stroke-dasharray:2.6 2.2}
.b-ent{fill:var(--red)} .b-rec{fill:var(--purple-500)} .parcial{opacity:.42}

/* ── Decisões ──────────────────────────────────────────────────────────────── */
.decisao{
  border:1px solid var(--line-strong); border-radius:11px; background:var(--surface);
  padding:20px 22px; margin:20px 0; box-shadow:var(--sombra);
}
.decisao > .cabeca{display:flex; align-items:baseline; gap:11px; margin-bottom:6px}
.decisao .id{
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:11px; font-weight:600; color:var(--purple-500);
  background:var(--purple-50); padding:3px 8px; border-radius:5px; flex:none;
}
.decisao h3{margin:0; font-size:17px}
.veredito{
  margin-top:16px; padding:13px 16px; border-radius:8px; background:var(--orange-50);
  border-left:3px solid var(--orange-500); font-size:14px; color:var(--ink);
}
.veredito b{
  display:block; font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:10.5px; font-weight:600;
  letter-spacing:.1em; text-transform:uppercase; color:var(--orange-700); margin-bottom:5px;
}

/* ── Nota e código ─────────────────────────────────────────────────────────── */
.nota{
  border-left:3px solid var(--line-strong); padding:2px 0 2px 17px; margin:20px 0;
  font-size:14px; color:var(--ink-2);
}
.nota.aviso{border-left-color:var(--red)}
pre{
  background:var(--surface-2); border:1px solid var(--line); border-radius:9px;
  padding:15px 17px; overflow-x:auto; margin:18px 0;
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:12.5px; line-height:1.68; color:var(--ink-2);
}
pre b{color:var(--purple-500); font-weight:600}
pre i{color:var(--ink-3); font-style:normal}
code{
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:.88em; background:var(--surface-2);
  border:1px solid var(--line); border-radius:4px; padding:1px 5px; color:var(--ink);
}

/* ── Passos ────────────────────────────────────────────────────────────────── */
ol.passos{list-style:none; counter-reset:p; padding:0; margin:20px 0 0}
ol.passos li{counter-increment:p; position:relative; padding:0 0 20px 46px; border-left:1px solid var(--line); margin-left:13px}
ol.passos li:last-child{border-left-color:transparent; padding-bottom:0}
ol.passos li::before{
  content:counter(p); position:absolute; left:-13px; top:-2px; width:26px; height:26px;
  border-radius:50%; background:var(--purple-500); color:#fff; display:grid; place-items:center;
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:12px; font-weight:600;
}
ol.passos b{display:block; font-size:14.5px; margin-bottom:3px}
ol.passos p{font-size:14px; color:var(--ink-2); margin:0}

ul.limpa{list-style:none; padding:0; margin:14px 0 0}
ul.limpa li{padding:0 0 9px 20px; position:relative; font-size:14px; color:var(--ink-2)}
ul.limpa li::before{content:""; position:absolute; left:3px; top:9px; width:6px; height:6px; border-radius:2px; background:var(--purple-500)}
ul.limpa li.nao::before{background:var(--red)}
ul.limpa b{color:var(--ink)}

footer{margin-top:56px; padding-top:22px; border-top:1px solid var(--line);
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:11.5px; color:var(--ink-3)}
@media (max-width:640px){
  body{font-size:14.5px; padding:0 15px 60px}
  header.capa{padding-top:34px}
  .kpi dd{font-size:22px}
}`

export const CORPO = `<div class="folha">

<header class="capa">
  <svg class="marca" viewBox="0 0 114 38" fill="currentColor" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Alloyal">
      <path d="M6.894 17.171c2.005 0 3.374.391 4.498 1.516V16.34s.098-1.32-1.124-1.32H2.249V9.299h11.637c3.765 0 3.912 4.058 3.912 4.058v15.842h-6.356v-1.858h-.098c-.733 1.711-2.591 2.494-4.743 2.494C2.591 29.786 0 27.292 0 23.527s2.738-6.356 6.894-6.356zm4.303 6.014c0-1.076-.88-1.809-2.347-1.809-1.369 0-2.347.684-2.347 1.809s.978 1.809 2.347 1.809c1.467.049 2.347-.684 2.347-1.809zM31.102 0h6.796v23.323 5.867h-6.796V0zM21.055 0h6.796v23.323 5.867h-6.796V0zm26.823 37.764c.684-.929 1.711-1.467 2.983-1.467s2.298.538 2.982 1.467h6.943c-1.223-4.254-4.987-7.089-9.925-7.089s-8.703 2.836-9.925 7.089h6.943zm18.491-5.632l8.361-.049a.98.98 0 0 0 .978-.978v-2.738h-.147c-.684.636-1.76 1.32-4.009 1.32-4.4 0-7.53-3.325-7.53-7.921V9.299h6.748v11.344c0 1.369 1.125 2.542 2.493 2.542s2.396-1.075 2.396-2.493V9.299h6.698l.049 26.648c0 .978-.929 2.053-2.053 2.053H66.369v-5.867zm25.758-14.961c2.005 0 3.374.391 4.498 1.516V16.34s.098-1.32-1.124-1.32h-8.068V9.299H99.07c3.764 0 3.911 4.058 3.911 4.058v15.842h-6.356v-1.858h-.098c-.733 1.711-2.591 2.494-4.743 2.494-4.009 0-6.601-2.543-6.601-6.259s2.787-6.405 6.943-6.405zm4.303 6.014c0-1.076-.88-1.809-2.347-1.809-1.369 0-2.347.684-2.347 1.809s.978 1.809 2.347 1.809c1.418.049 2.347-.684 2.347-1.809zM106.239 0h6.796v23.323 5.867h-6.796V0zM61.612 19.336c0 6.161-4.449 10.512-10.659 10.512s-10.659-4.352-10.659-10.512c0-6.112 4.449-10.463 10.659-10.463s10.659 4.352 10.659 10.463zm-14.717.147c0 2.787 1.613 4.645 4.058 4.645s4.058-1.858 4.058-4.645c0-2.885-1.614-4.792-4.058-4.792-2.494 0-4.058 1.907-4.058 4.792z" />
    </svg>
  <div class="sobre">Proposta · Receita · Pulse</div>
  <h1>Carteira em atraso</h1>
  <p class="deck">Uma estrutura para medir inadimplência e recuperação com fechamento auditável.
  Tudo abaixo foi medido contra o banco de produção hoje — nada é estimativa. Falta a sua
  aprovação em três definições antes de eu escrever a primeira linha.</p>
  <div class="carimbo">
    <span>25 de agosto de 2026</span>
    <span>Fonte: core.omie_titulo · core.account · core.vinculo_cliente</span>
    <span>Implementado em 26/08/2026 · <a href="/receita/inadimplencia">/receita/inadimplencia</a></span>
  </div>

  <dl class="kpis">
    <div class="kpi alerta"><dt>Vencido hoje</dt><dd>R$&nbsp;2.106.405<small>1.221 títulos de 344 clientes</small></dd></div>
    <div class="kpi alerta"><dt>Sobre 12 meses faturados</dt><dd>10,56%<small>de R$ 19.938.691 emitidos</small></dd></div>
    <div class="kpi"><dt>DSO</dt><dd>52 dias<small>R$ 2.831.991 em aberto no total</small></dd></div>
    <div class="kpi marca-b"><dt>O que dá para cobrar</dt><dd>R$&nbsp;305.004<small>≤ 90 dias, conta ativa, 62 clientes</small></dd></div>
  </dl>
</header>

<section id="estado" style="padding-top:34px">
  <div class="rubrica"><span class="marcador">00</span><h2>Estado: implementado, e quatro coisas que este documento errou</h2></div>
  <div class="regua"></div>
  <div class="prosa">
    <p>Construído em <b>26 de agosto de 2026</b>, em <code>/receita/inadimplencia</code> — quatro abas,
    67 competências reconstruídas e o ciclo C21 rodando às 05h00. As três decisões da seção 03
    foram tomadas <strong>como recomendado aqui, sem aprovação explícita</strong>: continuam
    abertas para revisão, e trocar qualquer uma muda o número.</p>
    <p>O que a implementação e o QA descobriram que esta proposta afirmou errado:</p>
  </div>
  <div class="rolo">
    <table>
      <caption><b>Correções ao próprio documento</b> · deixadas à vista porque um documento que se
      corrige em silêncio deixa de servir de registro</caption>
      <thead><tr><th>O que este documento diz</th><th>O que é</th></tr></thead>
      <tbody>
        <tr><td>Três movimentos de saída (pago, cancelado, ausente)</td><td>Falta o quarto e ele é o
        mais interessante: o Omie pode <b>prorrogar</b> o vencimento, e o título sai da carteira sem
        pagar nem ser cancelado. Registrar isso como baixa marcaria perda onde houve renegociação</td></tr>
        <tr><td>“Pagamento parcial não existe. Zero títulos.” (decisão C)</td><td><b>Existe.</b> Medi
        pela forma errada — o Omie põe a data de pagamento e deixa o aberto maior que zero. São 33
        títulos e R$ 45.383, o maior deles R$ 11.250 do INTERPROMO, que é o segundo nome da fila. A
        carteira é valorada pelo que está <b>em aberto</b>, não pelo valor do título</td></tr>
        <tr><td>“<code>churn_inadimplencia_centavos</code> está vazia; o C21 passa a alimentar”</td>
        <td>Errado nas duas metades: ela é alimentada pelo fluxo de <b>saídas</b>, via
        <code>fact.mrr_event</code>, e o C21 não a alimenta nem deveria. Está zerada porque nenhuma
        saída foi classificada assim ainda</td></tr>
        <tr><td>“Um dia após o vencimento” (decisão A)</td><td>Um dia é <b>pouco</b>. O pagamento
        leva um dia útil para ser processado e aparecer no Omie, e a nossa carga roda às 04h10 —
        antes de esse dia acontecer. Sem carência, quem pagava em dia entrava na fila e entrava no
        <b>topo</b>: a SWILE apareceu como maior devedora com R$ 59.625 e UM dia. Agora a cobrança
        começa depois de <b>dois dias úteis</b> — um para o pagamento aparecer, outro para poder
        concluir que não apareceu. Dias úteis e não corridos por causa da sexta-feira, que é o
        vencimento mais comum de boleto. Saíram da fila 37 títulos e R$ 155.085</td></tr>
        <tr><td>Nada sobre permissão</td><td>A tela nasceu exigindo escopo de <b>contas</b> em vez de
        <b>receita</b>, e cinco papéis com <code>receita: nenhum</code> liam a carteira inteira —
        incluindo Marketing e Produto. Corrigido, e o portão agora cobre todo o diretório</td></tr>
      </tbody>
    </table>
  </div>
  <div class="prosa"><p>E o que ficou de fora, sabidamente:</p></div>
  <ul class="limpa">
    <li class="nao"><b>Congelar um mês pela tela.</b> A coluna <code>estado</code> existe e a
    apuração respeita, mas não há botão — congelar hoje é por SQL.</li>
    <li class="nao"><b>Memória de contato na fila.</b> Os mesmos ~85 nomes reaparecem toda semana
    sem registro de quem já foi cobrado. É o que separa uma fila de uma lista.</li>
    <li class="nao"><b>O ajuste mistura duas coisas</b> — baixa parcial e edição de valor. Somam
    −R$ 25.860 em 19 meses; se crescer, vale separar.</li>
  </ul>
</section>

<section>
  <div class="rubrica"><span class="marcador">01</span><h2>O banco já responde quase tudo</h2></div>
  <div class="regua"></div>
  <div class="prosa">
    <p>A coluna <code>situacao</code> de <code>core.omie_titulo</code> é gerada a partir do texto que
    o Omie manda, e ela marca <b>1.211 títulos</b> como atrasados, somando R$ 2.056.565,59. A regra
    por data — vencido e sem pagamento — acha <b>1.222</b>, R$ 2.107.360,53. A diferença são onze
    títulos que venceram depois da última sincronização das 04h10.</p>
    <p>Isso importa para a arquitetura: <strong>a situação do Omie muda de valor quando o cliente
    paga.</strong> Ela é boa para uma tela de hoje e inútil para uma série histórica, porque o
    passado se reescreve sozinho a cada sincronização. As datas — <code>vencimento</code> e
    <code>pagamento</code> — são fato, e é sobre elas que a série tem que ser construída.</p>
  </div>

  <div class="rolo">
    <table>
      <caption><b>Envelhecimento</b> · 1.222 títulos vencidos e sem pagamento, por faixa de atraso</caption>
      <thead><tr><th>Faixa</th><th class="n">Títulos</th><th class="n">Clientes</th><th class="n">Em aberto</th><th class="n">Do total</th></tr></thead>
      <tbody>
        <tr><td>1 a 30 dias</td><td class="n">76</td><td class="n">72</td><td class="n">R$ 293.177,75</td><td class="n">13,9%</td></tr>
        <tr><td>31 a 60 dias</td><td class="n">27</td><td class="n">27</td><td class="n">R$ 56.393,37</td><td class="n">2,7%</td></tr>
        <tr><td>61 a 90 dias</td><td class="n">33</td><td class="n">30</td><td class="n">R$ 71.650,05</td><td class="n">3,4%</td></tr>
        <tr><td>91 a 180 dias</td><td class="n">102</td><td class="n">50</td><td class="n">R$ 216.789,18</td><td class="n">10,3%</td></tr>
        <tr><td>181 a 365 dias</td><td class="n">194</td><td class="n">70</td><td class="n">R$ 396.861,85</td><td class="n">18,8%</td></tr>
        <tr class="morta"><td>mais de 365 dias</td><td class="n">790</td><td class="n">208</td><td class="n">R$ 1.072.488,33</td><td class="n">50,9%</td></tr>
        <tr class="somatorio"><td>Total</td><td class="n">1.222</td><td class="n">—</td><td class="n">R$ 2.107.360,53</td><td class="n">100%</td></tr>
      </tbody>
    </table>
  </div>

  <div class="prosa">
    <p>Metade da carteira está vencida há mais de um ano. Mas o corte que muda a conversa não é o
    da idade — é o do <strong>estado da conta no painel</strong>.</p>
  </div>

  <div class="rolo">
    <table>
      <caption><b>O mesmo dinheiro, cruzado com o painel</b> · o painel já tem um estado chamado <code>suspended_by_overdue</code>, e ele carrega 520 contas</caption>
      <thead><tr><th>Estado no painel</th><th class="n">CNPJ</th><th class="n">Títulos</th><th class="n">Vencido</th><th class="n">Desse, ≤ 90 dias</th><th>Leitura</th></tr></thead>
      <tbody>
        <tr class="morta"><td>suspended_by_overdue</td><td class="n">157</td><td class="n">660</td><td class="n">R$ 914.941,35</td><td class="n">R$ 21.309,20</td><td><span class="selo q">perda</span></td></tr>
        <tr class="morta"><td>inactive</td><td class="n">69</td><td class="n">327</td><td class="n">R$ 607.174,61</td><td class="n">R$ 49.838,64</td><td><span class="selo q">perda</span></td></tr>
        <tr class="viva"><td>active</td><td class="n">96</td><td class="n">188</td><td class="n">R$ 489.327,33</td><td class="n">R$ 305.003,97</td><td><span class="selo r">cobrável</span></td></tr>
        <tr class="morta"><td>sem vínculo com o Omie</td><td class="n">22</td><td class="n">46</td><td class="n">R$ 95.569,64</td><td class="n">R$ 45.371,76</td><td><span class="selo a">vincular</span></td></tr>
        <tr class="morta"><td>suspended</td><td class="n">1</td><td class="n">1</td><td class="n">R$ 650,00</td><td class="n">—</td><td><span class="selo q">perda</span></td></tr>
      </tbody>
    </table>
  </div>

  <div class="prosa">
    <p><strong>R$ 1.522.766 — 72% do total — está em conta que o painel já suspendeu ou desativou.</strong>
    Cobrar isso é assunto jurídico ou de baixa, não de operação comercial. O que sobra como fila de
    trabalho é R$ 489.327 em conta ativa, e dentro dela R$ 305.004 com menos de noventa dias:
    <b>62 clientes, e os dez maiores concentram R$ 161.317 — 53% da fila</b>. Uma página de
    inadimplência que mostre um único número de dois milhões produz paralisia; uma que mostre
    62 nomes produz ligação.</p>
  </div>

  <div class="nota aviso"><p>Um vazamento que caiu no colo da medição: <b>sete contas que o painel
  suspendeu por atraso continuaram recebendo título</b> — doze títulos, R$ 25.109,20 emitidos nos
  últimos noventa dias. Ninguém vai pagar, e isso está inflando o faturamento emitido. A página
  proposta mostra essa lista sozinha.</p></div>
</section>

<section>
  <div class="rubrica"><span class="marcador">02</span><h2>A série histórica já existe — e é exatamente aí que ela engana</h2></div>
  <div class="regua"></div>
  <div class="prosa">
    <p>Como <code>vencimento</code> e <code>pagamento</code> são fato, o saldo em atraso de qualquer
    data passada pode ser reconstruído: vencido antes do corte, e sem pagamento até o corte. Rodei
    isso para os treze meses abaixo. <strong>O gráfico de evolução pode nascer com um ano de
    história no primeiro dia.</strong></p>
  </div>

  <div class="quadro">
    <div class="quadro-topo">
      <h4>Saldo em atraso no dia 1º de cada mês</h4>
      <div class="legenda">
        <span><i class="pastilha" style="background:var(--purple-500)"></i> saldo apurado</span>
        <span><i class="pastilha tracejada"></i> agosto ainda corre</span>
      </div>
    </div>
    <svg viewBox="0 0 980 240" class="g" role="img" aria-label="Saldo em atraso no dia 1º de cada mês, de agosto de 2025 a agosto de 2026: cresce de R$ 1.182.495 para R$ 1.976.433">
  <g class="grade"><line x1="74" y1="214.0" x2="966" y2="214.0"/><line x1="74" y1="167.3" x2="966" y2="167.3"/><line x1="74" y1="120.7" x2="966" y2="120.7"/><line x1="74" y1="74.0" x2="966" y2="74.0"/><line x1="74" y1="27.3" x2="966" y2="27.3"/></g><text x="66" y="217.5" text-anchor="end" class="ey">0</text><text x="66" y="170.8" text-anchor="end" class="ey">500 mil</text><text x="66" y="124.2" text-anchor="end" class="ey">1 mi</text><text x="66" y="77.5" text-anchor="end" class="ey">1,5 mi</text><text x="66" y="30.8" text-anchor="end" class="ey">2 mi</text>
  <path d="M74.0,103.6 L148.3,98.3 L222.7,96.2 L297.0,89.3 L371.3,78.8 L445.7,74.5 L520.0,69.1 L594.3,63.9 L668.7,49.3 L743.0,49.1 L817.3,46.1 L891.7,43.1 L891.7,214.0 L74.0,214.0 Z" class="area"/><path d="M74.0,103.6 L148.3,98.3 L222.7,96.2 L297.0,89.3 L371.3,78.8 L445.7,74.5 L520.0,69.1 L594.3,63.9 L668.7,49.3 L743.0,49.1 L817.3,46.1 L891.7,43.1" class="linha"/>
  <path d="M891.7,43.1 L966.0,29.5" class="linha linha-parcial"/><circle cx="74.0" cy="103.6" r="3.2" class="pt"/><circle cx="148.3" cy="98.3" r="3.2" class="pt"/><circle cx="222.7" cy="96.2" r="3.2" class="pt"/><circle cx="297.0" cy="89.3" r="3.2" class="pt"/><circle cx="371.3" cy="78.8" r="3.2" class="pt"/><circle cx="445.7" cy="74.5" r="3.2" class="pt"/><circle cx="520.0" cy="69.1" r="3.2" class="pt"/><circle cx="594.3" cy="63.9" r="3.2" class="pt"/><circle cx="668.7" cy="49.3" r="3.2" class="pt"/><circle cx="743.0" cy="49.1" r="3.2" class="pt"/><circle cx="817.3" cy="46.1" r="3.2" class="pt"/><circle cx="891.7" cy="43.1" r="3.2" class="pt"/><circle cx="966.0" cy="29.5" r="3.6" class="pt-parcial"/><text x="74.0" y="232" text-anchor="middle" class="ex">ago/25</text><text x="222.7" y="232" text-anchor="middle" class="ex">out/25</text><text x="371.3" y="232" text-anchor="middle" class="ex">dez/25</text><text x="520.0" y="232" text-anchor="middle" class="ex">fev/26</text><text x="668.7" y="232" text-anchor="middle" class="ex">abr/26</text><text x="817.3" y="232" text-anchor="middle" class="ex">jun/26</text><text x="966.0" y="232" text-anchor="middle" class="ex">ago/26</text>
</svg>
  </div>

  <div class="quadro">
    <div class="quadro-topo">
      <h4>O que entrou em atraso contra o que foi recuperado, mês a mês</h4>
      <div class="legenda">
        <span><i class="pastilha" style="background:var(--red)"></i> entrou em atraso</span>
        <span><i class="pastilha" style="background:var(--purple-500)"></i> recuperado</span>
        <span><i class="pastilha" style="background:var(--line-strong)"></i> agosto ainda corre</span>
      </div>
    </div>
    <svg viewBox="0 0 980 190" class="g" role="img" aria-label="Entrada em atraso contra recuperação, mês a mês: a entrada supera a recuperação em onze dos doze meses fechados">
  <g class="grade"><line x1="74" y1="164.0" x2="966" y2="164.0"/><line x1="74" y1="107.1" x2="966" y2="107.1"/><line x1="74" y1="50.2" x2="966" y2="50.2"/></g><text x="66" y="167.5" text-anchor="end" class="ey">0</text><text x="66" y="110.6" text-anchor="end" class="ey">100 mil</text><text x="66" y="53.7" text-anchor="end" class="ey">200 mil</text><rect x="79.0" y="105.2" width="27.8" height="58.8" class="b-ent"/><rect x="108.3" y="137.9" width="27.8" height="26.1" class="b-rec"/><rect x="147.6" y="96.8" width="27.8" height="67.2" class="b-ent"/><rect x="176.9" y="109.6" width="27.8" height="54.4" class="b-rec"/><rect x="216.2" y="92.2" width="27.8" height="71.8" class="b-ent"/><rect x="245.5" y="134.0" width="27.8" height="30.0" class="b-rec"/><rect x="284.8" y="64.7" width="27.8" height="99.3" class="b-ent"/><rect x="314.2" y="129.0" width="27.8" height="35.0" class="b-rec"/><rect x="353.5" y="72.0" width="27.8" height="92.0" class="b-ent"/><rect x="382.8" y="98.4" width="27.8" height="65.6" class="b-rec"/><rect x="422.1" y="69.2" width="27.8" height="94.8" class="b-ent"/><rect x="451.4" y="102.1" width="27.8" height="61.9" class="b-rec"/><rect x="490.7" y="87.4" width="27.8" height="76.6" class="b-ent"/><rect x="520.0" y="118.8" width="27.8" height="45.2" class="b-rec"/><rect x="559.3" y="30.3" width="27.8" height="133.7" class="b-ent"/><rect x="588.6" y="119.3" width="27.8" height="44.7" class="b-rec"/><rect x="627.9" y="76.0" width="27.8" height="88.0" class="b-ent"/><rect x="657.2" y="77.3" width="27.8" height="86.7" class="b-rec"/><rect x="696.5" y="97.1" width="27.8" height="66.9" class="b-ent"/><rect x="725.8" y="115.3" width="27.8" height="48.7" class="b-rec"/><rect x="765.2" y="98.9" width="27.8" height="65.1" class="b-ent"/><rect x="794.5" y="117.5" width="27.8" height="46.5" class="b-rec"/><rect x="833.8" y="55.5" width="27.8" height="108.5" class="b-ent"/><rect x="863.1" y="138.1" width="27.8" height="25.9" class="b-rec"/><rect x="902.4" y="20.5" width="27.8" height="143.5" class="b-ent parcial"/><rect x="931.7" y="95.2" width="27.8" height="68.8" class="b-rec parcial"/><text x="108.3" y="182" text-anchor="middle" class="ex">ago/25</text><text x="245.5" y="182" text-anchor="middle" class="ex">out/25</text><text x="382.8" y="182" text-anchor="middle" class="ex">dez/25</text><text x="520.0" y="182" text-anchor="middle" class="ex">fev/26</text><text x="657.2" y="182" text-anchor="middle" class="ex">abr/26</text><text x="794.5" y="182" text-anchor="middle" class="ex">jun/26</text><text x="931.7" y="182" text-anchor="middle" class="ex">ago/26</text>
</svg>
  </div>

  <div class="prosa">
    <p>Em doze meses fechados entraram <b>R$ 1.796.617,38</b> em atraso e voltaram
    <b>R$ 1.002.679,24</b>. A carteira cresceu <b>R$ 793.938,14 — 67%</b>, de R$ 1.182.495 para
    R$ 1.976.433. <strong>A recuperação cobre 55,8% do que entra</strong>, e a barra vermelha supera
    a roxa em onze dos doze meses. Não é um pico: é uma tendência de um ano.</p>
    <p>Testei o fechamento que você descreveu — saldo anterior mais o que entrou menos o que foi
    recuperado — em todos os treze meses. <strong>Fecha ao centavo, sempre.</strong> Julho para
    agosto:</p>
  </div>

  <pre>saldo em 1º/jul   <b>1.831.363,91</b>   1.151 títulos
+ entrou em julho    190.559,92        48 títulos
− recuperado         <i>-</i> 45.490,55        21 títulos
                  ─────────────
saldo em 1º/ago   <b>1.976.433,28</b>   1.178 títulos      resíduo <b>0,00</b></pre>

  <div class="prosa">
    <p>E é justamente esse zero perfeito que eu não confio, porque ele é retroativo. Ele fecha
    porque os títulos cancelados foram apagados dos <em>dois</em> lados da conta. Olhando para
    frente eles não vão se apagar — vão sair da carteira no meio do mês.
    <b>O Omie cancelou R$ 1.339.547 em títulos com vencimento em 2026 e R$ 1.269.481 em 2025</b>,
    e <code>core.omie_titulo</code> <strong>não guarda data de cancelamento</strong> — só
    <code>sincronizado_em</code>, que é sobrescrito a cada carga.</p>
    <p>É esse o argumento real para o marcador do dia 01, e não a dificuldade de reconstruir: o
    passado reconstruído hoje é diferente do passado reconstruído em dezembro, sem que nada avise.
    <strong>A foto do dia 01 é a única forma de o número de março continuar sendo o número de
    março.</strong></p>
  </div>
</section>

<section>
  <div class="rubrica"><span class="marcador">03</span><h2>Três definições, e elas mudam o número</h2></div>
  <div class="regua"></div>

  <div class="decisao">
    <div class="cabeca"><span class="id">A</span><h3>“Um dia após o faturamento” — após emitir, ou após vencer?</h3></div>
    <div class="prosa">
      <p>Não é a mesma data. A defasagem entre <code>emissao</code> e <code>vencimento</code> nos
      títulos de 2026 vai de zero a dezoito dias: 396 títulos vencem no dia da emissão, mas 303
      vencem quatorze dias depois, 295 em sete dias, e há blocos em doze, treze, dezesseis, dezessete
      e dezoito dias.</p>
    </div>
    <div class="rolo">
      <table>
        <thead><tr><th>Leitura</th><th class="n">Títulos</th><th class="n">Valor</th><th>O que ela inclui</th></tr></thead>
        <tbody>
          <tr><td>Um dia após a <b>emissão</b></td><td class="n">1.315</td><td class="n">R$ 2.704.874,81</td><td>94 títulos e R$ 598.470 que ainda estão no prazo combinado</td></tr>
          <tr class="viva"><td>Um dia após o <b>vencimento</b></td><td class="n">1.221</td><td class="n">R$ 2.106.405,19</td><td>só quem passou da data de pagar</td></tr>
        </tbody>
      </table>
    </div>
    <div class="veredito"><b>Recomendo</b>Contar do vencimento. Um título emitido dia 1º para vencer
    dia 15 não é inadimplência no dia 2 — é boleto em trânsito, e uma fila com 94 desses perde a
    confiança de quem cobra na primeira semana. Se a intenção era outra, o número da página sobe
    R$ 598.470 e eu preciso saber antes.</div>
  </div>

  <div class="decisao">
    <div class="cabeca"><span class="id">B</span><h3>Um número na página, ou dois?</h3></div>
    <div class="prosa">
      <p>A faixa acima de 365 dias é R$ 1.072.488 em 790 títulos de 208 clientes, e quase toda ela
      está em conta suspensa ou inativa. Ela não se move: no mês passado recuperamos R$ 45.490, e
      dessa faixa praticamente nada.</p>
      <p>Se a página abrir com “R$ 2,1 milhões”, esse valor vai andar de lado para sempre, porque o
      que o define é o passivo antigo — e um indicador que não responde a esforço deixa de ser lido.</p>
    </div>
    <div class="veredito"><b>Recomendo</b>Dois números, com hierarquia explícita. Em destaque a
    <b>inadimplência corrente</b> — até 90 dias, conta ativa, R$ 305.004 — que é a que responde a
    trabalho. Ao lado, a <b>carteira total</b>, R$ 2.106.405, com a faixa acima de um ano nomeada
    como cobrança morta. Nomear é o que impede o número grande de esconder o número acionável.</div>
  </div>

  <div class="decisao">
    <div class="cabeca"><span class="id">C</span><h3>Dois movimentos, ou quatro?</h3></div>
    <div class="prosa">
      <p>Você descreveu dois: entra em atraso, e recupera quando paga. Um título também pode sair da
      carteira <b>cancelado</b> — R$ 1,3 milhão por ano — ou ter o <b>valor alterado</b> no Omie
      depois de emitido. Com dois movimentos, um cancelamento aparece como recuperação que nunca
      houve, ou como uma queda que ninguém consegue explicar três meses depois.</p>
      <p>Uma coisa a medição já resolveu: <strong>pagamento parcial não existe.</strong> Zero
      títulos em aberto com parte paga. Trinta e dois títulos quitados têm resíduo de R$ 40.907,99
      somado (arredondamento e desconto). Então o título vale <code>valor_centavos</code>, inteiro,
      e <code>aberto_centavos</code> só traria ruído — foi o que fez a minha primeira conta não
      fechar por R$ 850,50.</p>
    </div>
    <div class="veredito"><b>Recomendo</b>Quatro movimentos — entrou, recuperado, cancelado, ajuste —
    e a identidade gravada como <code>CHECK</code> na tabela, não como cuidado de quem escreve a
    consulta. Fechamento que não fecha por construção é número que ninguém defende numa reunião.</div>
  </div>
</section>

<section>
  <div class="rubrica"><span class="marcador">04</span><h2>A estrutura</h2></div>
  <div class="regua"></div>

  <h3>Duas tabelas, e o grão é o título</h3>
  <div class="prosa">
    <p><code>fact.inadimplencia_titulo</code>, grão <code>(competencia, codigo_titulo)</code>. O grão
    por conta seria mais barato e estaria errado: um cliente que paga uma fatura antiga e atrasa uma
    nova no mesmo mês some das duas colunas se você só guardar o saldo dele. Recuperação exige
    identidade de título. São 1.178 linhas no último fechamento — <b>cerca de 14 mil por ano</b>,
    custo irrelevante.</p>
    <p>Cada linha carrega o valor, o vencimento, os dias de atraso, a faixa, o
    <code>account_id</code>, o estado do painel <em>naquele dia</em> — hoje não temos como saber que
    estado uma conta tinha em março, e é justamente o que a foto passa a preservar — o movimento do
    mês, e a <b>origem</b>: <code>apurado</code> ou <code>reconstruido</code>.</p>
    <p><code>analytics.inadimplencia_mes</code> é o mês fechado, espelhando
    <code>analytics.monthly_close</code>, que já existe e já tem <code>estado</code> e congelamento.
    Uma linha por competência, com os quatro movimentos, as seis faixas, o corte por estado de painel,
    e a identidade como restrição:</p>
  </div>

<pre><b>CHECK</b> (saldo_inicial_centavos + entrou_centavos
       − recuperado_centavos − cancelado_centavos
       + ajuste_centavos = saldo_final_centavos)</pre>

  <h3>O ciclo, e por que ele não roda só no dia 01</h3>
  <div class="prosa">
    <p>Entra como <b>C21</b> em <code>ops.cycle_declaration</code>, com execução registrada em
    <code>ops.cycle_run</code> — a mesma instrumentação dos nove ciclos que já rodam. Agenda
    <code>0 5 * * *</code>, depois do C20 das 04h10 que carrega o Omie; janela
    <code>mes_anterior</code>.</p>
    <p>Mas ele <strong>roda todos os dias, e é idempotente por competência</strong>. Um cron que só
    dispara no dia 01 perde o mês inteiro, para sempre, se a VM estiver fora do ar naquela manhã — e
    esse é o único dia em que o dado ainda pode ser apurado. Rodando diariamente, ele procura mês
    fechado sem foto e preenche; no dia 02 o buraco do dia 01 já se fechou sozinho.</p>
    <p>Na instalação, uma carga inicial dos dezenove meses reconstruídos, marcada
    <code>origem = 'reconstruido'</code>. O gráfico mostra essa fronteira — antes dela o número é o
    melhor que as datas permitem, depois dela é foto. <b>Escondê-la seria mentir com precisão de
    centavo.</b></p>
  </div>

  <h3>A página: <code>/receita/inadimplencia</code></h3>
  <div class="prosa">
    <p>Quatro abas, com os KPI no topo — o mesmo desenho da revisão de faturamento, reaproveitando
    <code>Abas iguais</code>, <code>TabelaOrdenavel</code>, a grade de KPI e o gráfico mensal que já
    existe na ficha do cliente. Nenhum componente novo.</p>
  </div>
  <div class="rolo">
    <table>
      <caption><b>As quatro abas</b> · a primeira é a que abre</caption>
      <thead><tr><th>Aba</th><th>O que lista</th><th class="n">Hoje</th><th>Para quê</th></tr></thead>
      <tbody>
        <tr class="viva"><td>Corrente</td><td>≤ 90 dias, conta ativa</td><td class="n">62 clientes<br>R$ 305.004</td><td>a fila de ligação da semana</td></tr>
        <tr><td>Carteira total</td><td>tudo, com filtro por faixa e por estado de painel</td><td class="n">1.221 títulos<br>R$ 2.106.405</td><td>o número contábil, e a busca por um caso</td></tr>
        <tr><td>Por cliente</td><td>agrupado, com selo do painel e maior atraso</td><td class="n">344 clientes</td><td>ver concentração e decidir corte</td></tr>
        <tr><td>Evolução</td><td>os dois gráficos acima e o fechamento mês a mês</td><td class="n">19 meses</td><td>delta, recuperação e tendência</td></tr>
      </tbody>
    </table>
  </div>
  <div class="prosa">
    <p>Cada linha leva para a ficha do cliente, que já existe, e a ficha ganha uma linha de atraso.
    <strong>Leitura apenas: nada é escrito no Omie, nenhuma conta é suspensa e nenhum e-mail sai
    daqui</strong> — a integração com o Omie segue travada em leitura, como está.</p>
  </div>
</section>

<section>
  <div class="rubrica"><span class="marcador">05</span><h2>O que os sistemas financeiros fazem, e o que vale copiar</h2></div>
  <div class="regua"></div>
  <div class="prosa">
    <p>Nada aqui é invenção nossa: contas a receber é território com prática consolidada há décadas.
    Fui olhar oito delas.</p>
  </div>
  <div class="rolo">
    <table class="bench">
      <thead><tr><th>Prática</th><th>Onde</th><th>O que faz</th><th>Decisão</th></tr></thead>
      <tbody>
        <tr><td>Aging report</td><td>SAP FI-AR, Oracle AR, Omie, Conta Azul</td><td>Faixas 1–30 / 31–60 / 61–90 / 90+ como visão canônica</td><td><span class="selo r">levamos</span> com duas faixas extras: 181–365 e 365+, porque metade da nossa carteira mora acima de um ano e 90+ viraria um balde só</td></tr>
        <tr><td>Movement schedule</td><td>reconciliação padrão de contas a receber</td><td>Saldo inicial + adições − recebimentos − baixas = saldo final, sempre publicado junto do saldo</td><td><span class="selo r">levamos</span> é exatamente a decisão C, e virou o <code>CHECK</code></td></tr>
        <tr><td>Roll-rate matrix</td><td>bancos, IFRS 9 e Basileia</td><td>Percentual de cada faixa que migra para a seguinte no mês</td><td><span class="selo a">v2</span> prevê a perda antes de ela acontecer; o grão por título já deixa isso possível sem migração nova</td></tr>
        <tr><td>Curva de coorte (vintage)</td><td>cartão de crédito e crédito ao consumo</td><td>Recuperação acompanhada por mês de origem, não por mês-calendário</td><td><span class="selo r">levamos</span> já medido: coortes maduras recuperam 84% a 93% do valor. <b>A perda estrutural é de 8% a 15% do que entra em atraso</b></td></tr>
        <tr><td>DSO, ADD e CEI</td><td>Credit Research Foundation</td><td>Normalizam a cobrança pelo que era cobrável, em vez de olhar reais recuperados</td><td><span class="selo r">levamos</span> DSO já em 52 dias; temos todos os insumos do CEI. Reais recuperados sozinho engana — cai quando faturamos menos</td></tr>
        <tr><td>Régua de cobrança e corte</td><td>Asaas, Iugu, Vindi, Superlógica</td><td>Escada de avisos e suspensão automática por dias de atraso</td><td><span class="selo q">já existe</span> o painel Lecupon faz isso: <code>suspended_by_overdue</code>, 520 contas. A página <b>lê</b> esse estado — inventar um segundo estado de inadimplência seria criar a divergência</td></tr>
        <tr><td>Churn involuntário</td><td>Baremetrics, ChartMogul, Recurly</td><td>Separam quem cancelou de quem parou de pagar, e medem a recuperação da régua</td><td><span class="selo a">emenda</span> <code>analytics.monthly_close.churn_inadimplencia_centavos</code> já existe e está vazia. O C21 passa a alimentar</td></tr>
        <tr><td>Provisão por faixa (ECL)</td><td>IFRS 9, CPC 48</td><td>Percentual de perda esperada por faixa de atraso, e não um número único</td><td><span class="selo a">versão simples</span> nomear a faixa 365+ como cobrança morta é a decisão B. Percentual por faixa quando houver histórico apurado</td></tr>
      </tbody>
    </table>
  </div>
  <div class="nota"><p>O achado do bench que mais muda o desenho é o sexto. <b>Já existe uma régua de
  cobrança rodando</b>, e ela suspendeu 520 contas. A tela não precisa de uma definição própria de
  inadimplência grave — precisa mostrar a que já está em uso, e a diferença entre o que a régua
  cortou e o que o financeiro ainda cobra.</p></div>
</section>

<section>
  <div class="rubrica"><span class="marcador">06</span><h2>Ordem de construção</h2></div>
  <div class="regua"></div>
  <ol class="passos">
    <li><b>Migração</b><p>As duas tabelas, o <code>CHECK</code> da identidade, os <em>grants</em>
    (<code>pulse_api</code> lê, <code>pulse_worker</code> escreve) e a linha do C21 em
    <code>ops.cycle_declaration</code>.</p></li>
    <li><b>A apuração num só lugar</b><p><code>packages/config/src/inadimplencia.ts</code>, como
    <code>revisao-faturamento.ts</code>: as consultas moram lá e a página só desenha. É o que impede
    a próxima tela de inventar o próprio corte de inadimplência.</p></li>
    <li><b>C21 e a carga inicial</b><p>O ciclo diário idempotente e os dezenove meses reconstruídos.
    <b>Ao fim deste passo o número já existe e já é histórico</b> — antes de qualquer tela.</p></li>
    <li><b>A página e as quatro abas</b><p>Reaproveitando os componentes existentes; a ficha do
    cliente ganha a linha de atraso.</p></li>
    <li><b>Os portões</b><p>A identidade do fechamento como teste, a fronteira
    <code>reconstruido</code>/<code>apurado</code> visível no gráfico, e uma asserção de que a página
    não escreve no Omie.</p></li>
  </ol>
</section>

<section>
  <div class="rubrica"><span class="marcador">07</span><h2>O que preciso de você</h2></div>
  <div class="regua"></div>
  <div class="prosa"><p>Três respostas, e eu começo pelo passo 1:</p></div>
  <ul class="limpa">
    <li><b>A</b> · Conto o atraso do <b>vencimento</b> (R$ 2.106.405) e não da emissão (R$ 2.704.875)?</li>
    <li><b>B</b> · A página destaca a <b>inadimplência corrente</b> — R$ 305.004, 62 clientes — e deixa a carteira total de R$ 2.106.405 em segundo plano?</li>
    <li><b>C</b> · Gravo <b>quatro movimentos</b> (entrou, recuperado, cancelado, ajuste) em vez de dois, com a identidade travada no banco?</li>
  </ul>
  <div class="prosa"><p style="margin-top:20px">E o que eu <em>não</em> vou fazer sem um pedido novo e explícito:</p></div>
  <ul class="limpa">
    <li class="nao">Escrever no Omie, inclusive baixa de título.</li>
    <li class="nao">Suspender, reativar ou cortar qualquer conta a partir desta tela.</li>
    <li class="nao">Disparar aviso, e-mail ou régua de cobrança para o cliente.</li>
  </ul>
</section>

<footer>
  Alloyal Pulse · proposta de 25/08/2026, implementada em 26/08 · as correções ao documento estão na seção 00
</footer>

</div>`
