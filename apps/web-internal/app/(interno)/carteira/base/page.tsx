import {
  corDoCliente,
  iniciaisDoCliente,
  kpisDaCarteira,
  mainBusinesses,
  subBusinesses,
  type LinhaDaBase,
} from "@pulse/config";
import { Aviso, Badge, Busca, Card, Chip, Chips, Kpi, KpiGrade, Table } from "@pulse/ui";
import { ScrollText } from "lucide-react";
import Link from "next/link";

import { Corpo, Topo } from "../../casca";
import { pool } from "../../../../lib/db";
import { exigir, temEscopo } from "../../../../lib/guarda";

export const dynamic = "force-dynamic";

/**
 * A base de clientes que veio do core: main business e sub business.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ SEPARADA DA CARTEIRA DE CS, e é decisão: aquela tela ordena por risco ×     │
 * │ receita e responde "onde eu olho hoje". Esta responde "quem é a base", que é │
 * │ uma pergunta de cadastro. Juntar as duas faria uma lista de 1.926 linhas com │
 * │ coluna de risco vazia — pior para as duas perguntas.                        │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * A linha abre por URL (`?abrir=<id>`) e não por JavaScript de cliente: a expansão
 * sobrevive a recarregar, pode ser compartilhada por link, e funciona antes de hidratar.
 */

const N = (v: number) => v.toLocaleString("pt-BR");

/**
 * Dinheiro em reais INTEIROS, e só nesta tabela.
 *
 * O design system manda mostrar centavos sempre, e a ficha do cliente mostra —
 * é lá que se confere um título. Aqui são duas colunas de dinheiro em 1.959
 * linhas, e os centavos custam ~50px que só existem para repetir ",00" ou ",20"
 * onde a pergunta é "quem é grande". Rolagem horizontal apagaria a coluna
 * Cliente ao rolar, que é perda maior que a dos centavos.
 */
const reais = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });

/** `2026-07` → `jul/26`. O ano vai junto: sem ele, julho de 2025 e de 2026 são o mesmo rótulo. */
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MES = (rotulo: string | null) => {
  if (!rotulo) return "";
  const [ano, mes] = rotulo.split("-");
  return `${MESES[Number(mes) - 1] ?? mes}/${(ano ?? "").slice(2)}`;
};

const CNPJ = (c: string | null) => {
  const d = (c ?? "").replace(/\D/g, "");
  if (d.length !== 14) return c ?? "—";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

/**
 * O monograma no lugar do logo. A API do core não devolve imagem — `banner` existe e é
 * booleano, é flag de módulo. Ver `iniciaisDoCliente`.
 */
function Marca({
  nome,
  chave,
  logo,
}: {
  nome: string;
  chave: string;
  logo: string | null;
}) {
  const h = corDoCliente(chave);
  return (
    <span
      aria-hidden="true"
      className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg text-corpo font-semibold tracking-tight"
      style={{
        backgroundColor: `hsl(${h} 62% 92%)`,
        color: `hsl(${h} 55% 32%)`,
      }}
    >
      {iniciaisDoCliente(nome)}
      {logo ? (
        // O monograma fica ATRÁS e a imagem por cima: se o logo não carregar, o
        // monograma aparece sozinho — sem JavaScript e sem `onerror`. Fundo branco
        // porque a maioria é SVG desenhado para fundo claro.
        <img
          src={logo}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full bg-white object-contain p-[3px]"
        />
      ) : null}
    </span>
  );
}

/** O rótulo do vínculo com o HubSpot, quando ele diz algo que a pessoa precisa saber. */
const VINCULO: Record<
  string,
  { texto: string; tom: "slate" | "amber" | "indigo" }
> = {
  canal: { texto: "canal", tom: "indigo" },
  interna: { texto: "interna", tom: "slate" },
  historico: { texto: "histórico", tom: "slate" },
  encerrado: { texto: "encerrado", tom: "slate" },
  pendente: { texto: "a decidir", tom: "amber" },
};

/**
 * Cabeçalho que organiza a lista.
 *
 * A organização mora AQUI, no cabeçalho da coluna a que se refere, e não no
 * título do card: ordenar é propriedade da coluna, e pôr o controle longe dela
 * obriga a procurar em outro lugar o comando do que está logo abaixo.
 *
 * A seta só aparece na coluna ativa — três setas acesas não dizem qual manda.
 */
function Ordenavel({
  por,
  atual,
  busca,
  children,
}: {
  por: "usuarios" | "autorizados" | "ltv" | "meses" | "mrr" | "nome";
  atual: string;
  busca: (extra: Record<string, string>) => string;
  children: React.ReactNode;
}) {
  const ativo = atual === por;
  return (
    <Link
      href={busca({ ordem: por })}
      aria-sort={ativo ? "descending" : "none"}
      className={
        ativo
          ? "inline-flex items-center gap-1 font-semibold text-purple-700"
          : "inline-flex items-center gap-1 text-ink-3 hover:text-ink"
      }
    >
      {children}
      {ativo && <span aria-hidden="true">↓</span>}
    </Link>
  );
}

/**
 * Os tamanhos de página. `todas` é o único que não é número — ver `porPagina: 0`
 * em `mainBusinesses`.
 */
const TAMANHOS = [
  { chave: "20", rotulo: "20", n: 20 },
  { chave: "50", rotulo: "50", n: 50 },
  { chave: "100", rotulo: "100", n: 100 },
  { chave: "todas", rotulo: "todas", n: 0 },
] as const;

/**
 * Um passo da paginação.
 *
 * O passo indisponível continua NA TELA, apagado, em vez de sumir: os quatro
 * controles ficam sempre no mesmo lugar, e clicar em "próxima" repetidamente não
 * faz a fileira encolher e o cursor cair sobre outro botão.
 */
function Passo({
  href,
  ativo,
  rotulo,
  children,
}: {
  href: string;
  ativo: boolean;
  rotulo: string;
  children: React.ReactNode;
}) {
  if (!ativo)
    return (
      <span aria-hidden="true" className="text-ink-4">
        {children}
      </span>
    );
  return (
    <Link
      href={href}
      aria-label={rotulo}
      className="font-semibold text-purple-700 hover:text-purple-500"
    >
      {children}
    </Link>
  );
}

function linhaDaTabela(
  l: LinhaDaBase,
  aberta: boolean,
  sub: boolean,
  buscaAtual: string,
) {
  const v = l.hubspotVinculo ? VINCULO[l.hubspotVinculo] : undefined;
  return [
    <div
      key="n"
      className={
        sub ? "flex items-center gap-2 pl-7" : "flex items-center gap-2"
      }
    >
      {!sub && l.subs > 0 ? (
        <Link
          // A seta leva para a MESMA página com o parâmetro trocado — abrir e fechar são
          // a mesma navegação, e o estado mora na URL.
          //
          // `scroll={false}` porque o padrão do Next é rolar para o topo a cada
          // navegação. Numa lista de 50 linhas isso joga a pessoa para longe da linha
          // que ela acabou de abrir: ela clica na seta do 40º cliente e a tela sobe,
          // então precisa procurar de novo onde estava. Abrir é mudança de estado da
          // MESMA tela, não ida para outra.
          scroll={false}
          href={`/carteira/base?${new URLSearchParams({
            ...(buscaAtual ? { q: buscaAtual } : {}),
            ...(aberta ? {} : { abrir: l.id }),
          }).toString()}`}
          aria-label={`${aberta ? "Fechar" : "Abrir"} os ${l.subs} sub business de ${l.razaoSocial}`}
          aria-expanded={aberta}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-surface-2 hover:text-ink"
        >
          <span
            className={
              aberta ? "rotate-90 transition-transform" : "transition-transform"
            }
          >
            ›
          </span>
        </Link>
      ) : (
        <span className="h-5 w-5 shrink-0" />
      )}
      <Marca nome={l.razaoSocial} chave={l.brandId ?? l.id} logo={l.logoUrl} />
      {/* `min-w-0` no contêiner E `max-w` no nome: sem os dois, o nome longo empurra
          a tabela e nasce a rolagem horizontal, que numa lista de 1.959 linhas faz a
          pessoa perder a coluna de referência ao rolar. */}
      <span className="min-w-0 max-w-[14ch] lg:max-w-[19ch]">
        {/* O NOME é o acesso à ficha. A seta ao lado abre os subs NESTA tela, e são
            ações diferentes: uma navega, a outra expande. Por isso o alvo de cada
            uma é visualmente distinto — o nome sublinha ao passar, a seta gira. */}
        <Link
          href={`/carteira/base/${l.id}`}
          className="block truncate font-medium text-ink hover:text-purple-700 hover:underline"
        >
          {l.razaoSocial}
        </Link>
        <span className="block text-nota text-ink-3">{CNPJ(l.cnpj)}</span>
      </span>
    </div>,
    <span key="b" className="font-mono text-meta text-ink-2">
      {l.brandId ?? "—"}
    </span>,
    <span key="h" className="font-mono text-meta text-ink-2">
      {l.hubspotCompanyId ?? "—"}
      {v ? (
        <>
          {" "}
          <Badge tone={v.tom}>{v.texto}</Badge>
        </>
      ) : null}
    </span>,
    <span key="s" className="tabular-nums text-ink-2">
      {l.subs > 0 ? N(l.subs) : "—"}
    </span>,
    <span key="ua" className="tabular-nums text-ink-2">
      {N(l.usuariosAutorizados)}
    </span>,
    <span key="uc" className="tabular-nums text-ink">
      {N(l.usuariosCadastrados)}
      {l.subs > 0 && l.subsUsuariosCadastrados > 0 ? (
        <span className="ml-1 text-nota text-ink-3">
          +{N(l.subsUsuariosCadastrados)} nos subs
        </span>
      ) : null}
    </span>,
    <span key="mrrt" className="whitespace-nowrap tabular-nums text-ink">
      {l.ltvCentavos > 0 ? reais(l.ltvCentavos) : <span className="text-ink-4">—</span>}
    </span>,
    /* MESES em coluna própria, e não mais como sufixo do valor: colado ele não era
       ordenável nem comparável de cima a baixo — a vista "quem é cliente há mais
       tempo" exigia ler linha a linha. Continua ao lado do MRR Total de propósito:
       R$ 500 mil em 60 meses e R$ 500 mil em 6 são clientes diferentes. */
    <span key="meses" className="tabular-nums text-ink-2">
      {l.ltvMeses > 0 ? l.ltvMeses : <span className="text-ink-4">—</span>}
    </span>,
    /* O MÊS vai junto do valor, sempre. Ver `mrrMesCentavos`: este é o último mês
       COM movimento, e sem o rótulo "ainda não venceu em agosto" e "não fatura
       desde março" apareceriam idênticos na tela. */
    <span key="mrrm" className="whitespace-nowrap tabular-nums text-ink">
      {l.mrrMesCentavos > 0 ? (
        <>
          <span className="block">{reais(l.mrrMesCentavos)}</span>
          <span className="block text-nota font-normal text-ink-3">
            {MES(l.mrrMesRotulo)}
          </span>
        </>
      ) : (
        <span className="text-ink-4">—</span>
      )}
    </span>,
    <Badge key="a" tone={l.ativo ? "green" : "slate"}>
      {l.ativo ? "ativo" : "inativo"}
    </Badge>,
    /* O ícone existe além do nome clicável porque a linha tem DOIS destinos: o
       nome navega, a seta expande. Quem já foi mordido por clicar no nome e ver a
       linha abrir procura um alvo inequívoco — e este é ele, sempre na mesma
       coluna, com rótulo acessível dizendo de quem é a ficha. */
    <Link
      key="ficha"
      href={`/carteira/base/${l.id}`}
      aria-label={`Abrir a ficha de ${l.razaoSocial}`}
      title="Ficha do cliente: cadastro e faturamento"
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-purple-50 hover:text-purple-700"
    >
      <ScrollText className="h-[15px] w-[15px]" />
    </Link>,
  ];
}

export default async function BaseDeClientes({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    abrir?: string;
    p?: string;
    ativos?: string;
    /** "1" = só quem faturou nos 12 meses; "0" = só quem não faturou. */
    fat?: string;
    /** Como organizar a lista: usuarios (padrão), autorizados, ltv ou nome. */
    ordem?: string;
    /** Quantas por página: 20, 50 (padrão), 100 ou todas. */
    pp?: string;
  }>;
}) {
  await exigir((p) => temEscopo(p.contas), "base de clientes");
  const q = await searchParams;
  const busca = (q.q ?? "").trim();
  const pagina = Math.max(Number(q.p ?? "1") || 1, 1);
  /* ┌────────────────────────────────────────────────────────────────────────┐
     │ SÓ ATIVOS É O PADRÃO, e o parâmetro passa a marcar o CONTRÁRIO.          │
     │                                                                          │
     │ Dos 1.959 main business, 937 estão inativos — quase metade. A lista      │
     │ abria com eles dentro, e a primeira coisa a fazer em toda sessão era     │
     │ filtrar. O padrão passa a ser a lista útil (1.022); ver a base inteira   │
     │ continua a um clique, e o chip diz qual dos dois está valendo.           │
     │                                                                          │
     │ `!== "0"` e não `=== "1"`: uma URL antiga com `?ativos=1` continua        │
     │ significando o mesmo, e uma sem parâmetro nenhum agora filtra.           │
     └────────────────────────────────────────────────────────────────────────┘ */
  const somenteAtivos = q.ativos !== "0";
  // Valor desconhecido em `?pp=` cai no padrão em vez de virar erro: parâmetro de
  // URL é digitado e colado por gente, e 50 é uma resposta melhor que uma tela 500.
  const tamanho = TAMANHOS.find((t) => t.chave === q.pp)?.chave ?? "50";
  const porPagina = TAMANHOS.find((t) => t.chave === tamanho)!.n;

  const db = pool();
  const [kpis, pag] = await Promise.all([
    kpisDaCarteira(db),
    mainBusinesses(db, {
      busca,
      pagina,
      porPagina,
      somenteAtivos,
      ordem:
        (["usuarios", "autorizados", "ltv", "meses", "mrr", "nome"] as const).find((o) => o === q.ordem) ??
        "usuarios",
    }),
  ]);

  // Só a linha aberta busca os filhos. Carregar os subs de 50 mains a cada render seria
  // 50 consultas para mostrar o que quase ninguém abre.
  const abertaId = q.abrir ?? "";
  const filhos = abertaId ? await subBusinesses(db, abertaId) : [];

  const paginas = Math.max(Math.ceil(pag.total / pag.porPagina), 1);
  const comBusca = (extra: Record<string, string>) => {
    const p: Record<string, string> = {
      ...(busca ? { q: busca } : {}),
      ...(somenteAtivos ? {} : { ativos: "0" }),
      ...(q.fat ? { fat: q.fat } : {}),
      // A organização escolhida sobrevive à busca e aos chips: trocar de filtro e
      // perder a ordem obriga a refazer duas escolhas quando só uma mudou.
      ...(q.ordem ? { ordem: q.ordem } : {}),
      // Idem o tamanho da página: quem escolheu "100" e depois filtrou não pediu
      // para voltar a 50.
      ...(tamanho !== "50" ? { pp: tamanho } : {}),
      ...extra,
    };
    // String vazia REMOVE o parâmetro. É como o chip "qualquer" desliga o recorte
    // de faturamento sem precisar de um valor sentinela na URL — `?fat=` seria
    // igual a não ter, mas apareceria na barra de endereço e no link copiado.
    for (const [k, v] of Object.entries(p)) if (v === "") delete p[k];
    return `/carteira/base?${new URLSearchParams(p).toString()}`;
  };

  /* O recorte por faturamento é aplicado AQUI e não no SQL, e a tela diz isso:
     ele filtra a página carregada, não a base inteira. Levar para a consulta
     exigiria juntar títulos antes de paginar — caro e, pior, mudaria a contagem
     total do título do card sem que a pessoa tenha pedido. */
  const visiveis = pag.linhas.filter((l) => {
    if (!q.fat) return true;
    const faturou = l.faturamento12m.some((v) => v > 0);
    return q.fat === "1" ? faturou : !faturou;
  });

  const ordem =
    (["usuarios", "autorizados", "ltv", "meses", "mrr", "nome"] as const).find((o) => o === q.ordem) ??
    "usuarios";

  const linhas: React.ReactNode[][] = [];
  for (const l of visiveis) {
    const aberta = l.id === abertaId;
    linhas.push(linhaDaTabela(l, aberta, false, busca));
    if (aberta)
      for (const f of filhos) linhas.push(linhaDaTabela(f, false, true, busca));
  }

  return (
    <>
      <Topo
        href="/carteira/base"
        titulo="Base de clientes"
        proposito="o cadastro que vem do core, por main business"
      />
      <Corpo>
        <KpiGrade colunas={6}>
          <Kpi
            rotulo="Clientes total"
            valor={N(kpis.clientesTotal)}
            nota={`${N(kpis.mainBusinesses)} main · ${N(kpis.subBusinesses)} sub · ${N(kpis.comLogo)} logos`}
          />
          <Kpi
            rotulo="Clientes ativos"
            valor={N(kpis.clientesAtivos)}
            nota={`${Math.round((kpis.clientesAtivos / Math.max(kpis.clientesTotal, 1)) * 100)}% da base`}
            tom="green"
          />
          <Kpi
            rotulo="Usuários na base"
            valor={N(kpis.usuariosAutorizados)}
            nota="autorizados a se cadastrar"
          />
          <Kpi
            rotulo="Usuários cadastrados"
            valor={N(kpis.usuariosCadastrados)}
            nota={`${Math.round((kpis.usuariosCadastrados / Math.max(kpis.usuariosAutorizados, 1)) * 100)}% dos autorizados`}
          />
          <Kpi rotulo="Usaram cupom" valor="—" nota="depende do ciclo C1" />
          <Kpi
            rotulo="Cupons resgatados"
            valor="—"
            nota="depende do ciclo C1"
          />
        </KpiGrade>

        <Aviso tom="alerta">
          <strong className="font-semibold">
            Dois KPIs estão vazios e não é falha de carga.
          </strong>{" "}
          &quot;Usaram cupom&quot; e &quot;Cupons resgatados&quot; não existem
          na API do core — as rotas{" "}
          <code className="font-mono text-meta">/coupons</code>,{" "}
          <code className="font-mono text-meta">/vouchers</code> e{" "}
          <code className="font-mono text-meta">/redemptions</code> respondem
          404 na v3. O dado vem das transações da réplica, pelo ciclo{" "}
          <strong className="font-semibold">C1</strong>, que está declarado e
          não implementado por falta do segredo{" "}
          <code className="font-mono text-meta">replica.url</code>. Mostrar
          zero ali diria &quot;ninguém usou cupom&quot;, que é diferente de
          &quot;ainda não medimos&quot;.
        </Aviso>

        <Card
          title={`Main business · ${N(pag.total)}${busca ? " encontrados" : ""}`}
          /* A busca é do design system: lupa, e botão de limpar quando há texto —
             sem ele, desfazer uma busca exige apagar caractere por caractere. O
             alternador de ativos fica ao lado, fora do form, porque é navegação e
             não termo de busca. */
          actions={
            /* Os recortes viraram CHIP e ficam no título junto da busca: são a mesma
               decisão — "qual pedaço da base eu quero ver" — e estavam em dois
               lugares e dois formatos. `fixo` porque são estado estrutural: sumir
               com "sem faturamento" porque hoje não há nenhum faria parecer que a
               base não tem essa dimensão. */
            <div className="flex flex-wrap items-center justify-end gap-3">
                {/* DUAS DIMENSÕES, DOIS GRUPOS. Estavam num grupo só, e o
                    `ativo` de "todos"/"só ativos" ainda dependia de `q.fat` —
                    escolher "com faturamento" apagava os dois, e a tela deixava
                    de dizer se estava mostrando a base inteira ou só os ativos.
                    São perguntas independentes e agora se combinam. */}
                <Chips>
                  <Chip
                    rotulo="só ativos"
                    href={comBusca({ ativos: "1" })}
                    ativo={somenteAtivos}
                    fixo
                  />
                  <Chip
                    rotulo="todos"
                    href={comBusca({ ativos: "0" })}
                    ativo={!somenteAtivos}
                    fixo
                  />
                </Chips>
                <Chips>
                  <Chip rotulo="qualquer" href={comBusca({ fat: "" })} ativo={!q.fat} fixo />
                  <Chip
                    rotulo="com faturamento"
                    href={comBusca({ fat: "1" })}
                    ativo={q.fat === "1"}
                    fixo
                  />
                  <Chip
                    rotulo="sem faturamento"
                    href={comBusca({ fat: "0" })}
                    ativo={q.fat === "0"}
                    fixo
                  />
                </Chips>
              <Busca
                action="/carteira/base"
                valor={busca}
                placeholder="nome, CNPJ, Business ID ou HubSpot ID"
                ocultos={{
                  ...(somenteAtivos ? {} : { ativos: "0" }),
                  ...(q.fat ? { fat: q.fat } : {}),
                }}
                hrefLimpar={comBusca(somenteAtivos ? {} : { ativos: "0" })}
              />
            </div>
          }
        >
          {/* A ORGANIZAÇÃO fica no cabeçalho da tabela, junto das colunas a que se
              refere: ordenar é uma propriedade da coluna, e pôr isso no título do
              card obrigava a procurar em outro lugar o controle do que está logo
              abaixo. */}
          <Table
            cols={[
              <Ordenavel key="c" por="nome" atual={ordem} busca={comBusca}>
                Cliente
              </Ordenavel>,
              "ID",
              "HubSpot ID",
              "Subs",
              <Ordenavel key="ua" por="autorizados" atual={ordem} busca={comBusca}>
                Autorizados
              </Ordenavel>,
              <Ordenavel key="u" por="usuarios" atual={ordem} busca={comBusca}>
                Cadastrados
              </Ordenavel>,
              <Ordenavel key="l" por="ltv" atual={ordem} busca={comBusca}>
                MRR Total
              </Ordenavel>,
              <Ordenavel key="m" por="meses" atual={ordem} busca={comBusca}>
                Meses
              </Ordenavel>,
              <Ordenavel key="r" por="mrr" atual={ordem} busca={comBusca}>
                MRR mês
              </Ordenavel>,
              "",
              "",
            ]}
            rows={linhas}
            vazio={
              busca
                ? `Nada encontrado para "${busca}".`
                : "A base ainda não foi carregada."
            }
          />
          {/* ┌──────────────────────────────────────────────────────────────────┐
              │ PAGINAÇÃO COMPLETA: quantas por página, onde estou, e como andar. │
              │                                                                   │
              │ Eram só "anterior/próxima" com 50 fixas — 40 idas e voltas para   │
              │ percorrer 1.959 clientes, e nenhuma forma de ver o fim da lista.  │
              │                                                                   │
              │ O tamanho volta para a PRIMEIRA página de propósito: estar na     │
              │ página 30 de 40 e trocar para 100 por página deixaria a pessoa na │
              │ página 30 de 20, que não existe — e o Postgres devolveria vazio   │
              │ sem dizer por quê.                                                │
              └──────────────────────────────────────────────────────────────────┘ */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-meta text-ink-3">
            <span className="flex items-center gap-2">
              <span className="text-nota uppercase tracking-wide">por página</span>
              <Chips>
                {TAMANHOS.map((t) => (
                  <Chip
                    key={t.chave}
                    rotulo={t.rotulo}
                    href={comBusca({ pp: t.chave, p: "1" })}
                    ativo={tamanho === t.chave}
                    fixo
                  />
                ))}
              </Chips>
            </span>
            <span className="flex items-center gap-3">
              <span>
                {tamanho === "todas"
                  ? `${N(visiveis.length)} de ${N(pag.total)}`
                  : `página ${N(pag.pagina)} de ${N(paginas)}`}
              </span>
              {paginas > 1 && (
                <span className="flex items-center gap-2">
                  {/* PRIMEIRA e ÚLTIMA existem porque "última página" é uma pergunta
                      real numa lista ordenada por tamanho: é lá que estão os clientes
                      sem faturamento nenhum. Chegar lá com "próxima" são 39 cliques. */}
                  <Passo href={comBusca({ p: "1" })} ativo={pag.pagina > 1} rotulo="Primeira página">
                    ⇤
                  </Passo>
                  <Passo
                    href={comBusca({ p: String(pag.pagina - 1) })}
                    ativo={pag.pagina > 1}
                    rotulo="Página anterior"
                  >
                    ← anterior
                  </Passo>
                  <Passo
                    href={comBusca({ p: String(pag.pagina + 1) })}
                    ativo={pag.pagina < paginas}
                    rotulo="Próxima página"
                  >
                    próxima →
                  </Passo>
                  <Passo
                    href={comBusca({ p: String(paginas) })}
                    ativo={pag.pagina < paginas}
                    rotulo="Última página"
                  >
                    ⇥
                  </Passo>
                </span>
              )}
            </span>
          </div>
          <p className="mt-3 text-meta leading-relaxed text-ink-3">
            A ordem é por usuários cadastrados, somando os sub business.
            Alfabética poria na primeira página quem tem zero usuário e
            empurraria o maior contrato para a página 30.
            <br />
            <strong className="font-semibold text-ink">Autorizados</strong> é
            quem tem direito de se cadastrar;{" "}
            <strong className="font-semibold text-ink">cadastrados</strong> é
            quem efetivamente criou conta. Nenhum dos dois é &quot;usuário
            ativo&quot; — isso depende do C1.
            <br />
            {/* As três colunas de dinheiro respondem perguntas diferentes, e sem
                esta frase elas se leem como a mesma medida em recortes distintos. */}
            <strong className="font-semibold text-ink">MRR Total</strong> é tudo
            que já entrou desta conta —{" "}
            <em>recebido</em>, não faturado: boleto cancelado ou a vencer fica de
            fora. <strong className="font-semibold text-ink">Meses</strong> é a
            vida do cliente, do primeiro ao último vencimento.{" "}
            <strong className="font-semibold text-ink">MRR mês</strong> é o{" "}
            <em>faturado</em> no último mês que teve movimento, e o mês vai junto:
            sem ele, &quot;agosto ainda não venceu&quot; e &quot;não fatura desde
            março&quot; apareceriam iguais. Valores em reais inteiros — os
            centavos estão na ficha de cada cliente.
          </p>
        </Card>
      </Corpo>
    </>
  );
}
