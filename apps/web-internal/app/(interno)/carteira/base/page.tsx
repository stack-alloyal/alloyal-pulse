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
 * Os 12 meses de faturamento, numa célula.
 *
 * Barra e não número: a pergunta que esta coluna responde é de RITMO — "ainda
 * fatura? todo mês? parou quando?" — e doze números lado a lado não se leem de
 * relance. A altura é relativa ao maior mês DA PRÓPRIA linha, porque comparar
 * clientes entre si é trabalho da coluna de valor, não desta.
 */
function Faturamento12m({ serie }: { serie: readonly number[] }) {
  const maior = Math.max(...serie, 1)
  const meses = serie.filter((v) => v > 0).length
  const total = serie.reduce((a, b) => a + b, 0)
  return (
    <span
      className="inline-flex h-6 items-end gap-[2px]"
      title={
        meses === 0
          ? "sem faturamento nos últimos 12 meses"
          : `${meses} de 12 meses faturados · ${(total / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`
      }
    >
      {serie.map((v, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={v > 0 ? "w-[3px] rounded-sm bg-purple-500" : "w-[3px] rounded-sm bg-line-strong"}
          style={{ height: v > 0 ? `${Math.max((v / maior) * 100, 18)}%` : "12%" }}
        />
      ))}
      <span className="sr-only">
        {meses === 0 ? "sem faturamento" : `${meses} de 12 meses faturados`}
      </span>
    </span>
  )
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
      <span className="min-w-0">
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
    <Faturamento12m key="f" serie={l.faturamento12m} />,
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
  }>;
}) {
  await exigir((p) => temEscopo(p.contas), "base de clientes");
  const q = await searchParams;
  const busca = (q.q ?? "").trim();
  const pagina = Math.max(Number(q.p ?? "1") || 1, 1);
  const somenteAtivos = q.ativos === "1";

  const db = pool();
  const [kpis, pag] = await Promise.all([
    kpisDaCarteira(db),
    mainBusinesses(db, { busca, pagina, porPagina: 50, somenteAtivos }),
  ]);

  // Só a linha aberta busca os filhos. Carregar os subs de 50 mains a cada render seria
  // 50 consultas para mostrar o que quase ninguém abre.
  const abertaId = q.abrir ?? "";
  const filhos = abertaId ? await subBusinesses(db, abertaId) : [];

  const paginas = Math.max(Math.ceil(pag.total / pag.porPagina), 1);
  const comBusca = (extra: Record<string, string>) =>
    `/carteira/base?${new URLSearchParams({
      ...(busca ? { q: busca } : {}),
      ...(somenteAtivos ? { ativos: "1" } : {}),
      ...extra,
    }).toString()}`;

  /* O recorte por faturamento é aplicado AQUI e não no SQL, e a tela diz isso:
     ele filtra a página carregada, não a base inteira. Levar para a consulta
     exigiria juntar títulos antes de paginar — caro e, pior, mudaria a contagem
     total do título do card sem que a pessoa tenha pedido. */
  const visiveis = pag.linhas.filter((l) => {
    if (!q.fat) return true;
    const faturou = l.faturamento12m.some((v) => v > 0);
    return q.fat === "1" ? faturou : !faturou;
  });

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
              <Chips>
                <Chip rotulo="todos" href={comBusca({})} ativo={!somenteAtivos && !q.fat} fixo />
                <Chip
                  rotulo="só ativos"
                  href={comBusca({ ativos: "1" })}
                  ativo={somenteAtivos && !q.fat}
                  fixo
                />
                <Chip
                  rotulo="com faturamento"
                  href={comBusca({ ...(somenteAtivos ? { ativos: "1" } : {}), fat: "1" })}
                  ativo={q.fat === "1"}
                  fixo
                />
                <Chip
                  rotulo="sem faturamento"
                  href={comBusca({ ...(somenteAtivos ? { ativos: "1" } : {}), fat: "0" })}
                  ativo={q.fat === "0"}
                  fixo
                />
              </Chips>
              <Busca
                action="/carteira/base"
                valor={busca}
                placeholder="nome, CNPJ, Business ID ou HubSpot ID"
                ocultos={{
                  ...(somenteAtivos ? { ativos: "1" } : {}),
                  ...(q.fat ? { fat: q.fat } : {}),
                }}
                hrefLimpar={comBusca(somenteAtivos ? { ativos: "1" } : {})}
              />
            </div>
          }
        >
          <Table
            cols={[
              "Cliente",
              "Business ID",
              "HubSpot ID",
              "Subs",
              "Autorizados",
              "Cadastrados",
              "12 meses",
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
          {paginas > 1 && (
            <div className="mt-4 flex items-center justify-between text-meta text-ink-3">
              <span>
                página {pag.pagina} de {N(paginas)}
              </span>
              <div className="flex gap-3">
                {pag.pagina > 1 && (
                  <Link
                    href={comBusca({ p: String(pag.pagina - 1) })}
                    className="font-semibold text-purple-700 hover:text-purple-500"
                  >
                    ← anterior
                  </Link>
                )}
                {pag.pagina < paginas && (
                  <Link
                    href={comBusca({ p: String(pag.pagina + 1) })}
                    className="font-semibold text-purple-700 hover:text-purple-500"
                  >
                    próxima →
                  </Link>
                )}
              </div>
            </div>
          )}
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
          </p>
        </Card>
      </Corpo>
    </>
  );
}
