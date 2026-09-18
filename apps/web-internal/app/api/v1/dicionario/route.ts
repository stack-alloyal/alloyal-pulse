import { DIAS_CORRENTE, DIAS_MORTA, DIAS_UTEIS_PARA_APARECER } from "@pulse/config";

import { DICIONARIO_VERSAO, LIMITES, exigirToken } from "../_lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * O dicionário: o que cada recurso e cada campo SIGNIFICA, de onde vem, e as
 * regras que mudam a leitura. Versionado por `dicionario_versao` — a mesma
 * string que viaja em todo envelope. É o que responde "contra o que estou
 * comparando" antes de o número bater ou não bater.
 *
 * É código, não tabela, de propósito: a definição de uma métrica muda com o
 * código que a calcula, e mora onde ele mora — a versão sobe no mesmo PR.
 * As constantes (dias de carência, corrente, morta) vêm do domínio, não são
 * copiadas: se mudarem lá, mudam aqui.
 */
const DICIONARIO = {
  versao: DICIONARIO_VERSAO,
  principios: {
    duas_camadas:
      "O Pulse expõe a camada MEDIDA (faturado do Omie) e a REGISTRADA por gente (saídas, decisões). " +
      "Nunca funde as duas. Não há camada de CONTRATO: core.contract está vazio; contract_id é nulo em todo lugar.",
    unidades:
      "Dinheiro em centavos inteiros como string; datas ISO (AAAA-MM-DD ou date-time UTC); competência AAAA-MM; CNPJ só dígitos.",
    competencia: "Salvo indicação, a competência de um título é o MÊS DO VENCIMENTO (não o de emissão nem o de pagamento).",
    identidade:
      "account_id é a chave do Pulse. Uma conta pode ter N códigos Omie (codigo_omie[]) e um hubspot_company_id. " +
      "vinculo = 'sem_vinculo' quando nenhuma fonte foi amarrada. Título sem vínculo tem account_id nulo.",
    universo_de_cliente:
      "receita/mrr e receita/faturamento contam só títulos de CLIENTE: tags Cliente ou Cliente Hinova, ou nem Fornecedor nem Investidor; " +
      "excluídos os marcados Azul; situação válida (não previsão/cancelado) e valor > 0. É o mesmo universo da Carteira.",
    snapshot:
      "Todo envelope traz `snapshot` = carimbo do dado mais novo do recurso. Recursos sem carimbo por linha " +
      "(mrr, faturamento, inadimplencia) não aceitam atualizado_desde: o incremental é comparar snapshot.",
    limites: {
      lista_por_minuto_por_token: LIMITES.listaPorMinuto,
      exports_simultaneos_por_token: LIMITES.exportsPorToken,
      exports_simultaneos_no_total: LIMITES.exportsGlobais,
      falhas_de_auth_por_minuto_por_ip: LIMITES.falhasDeAuthPorMinutoPorIp,
    },
  },
  recursos: {
    contas: {
      fonte: "core.account + core.vinculo_cliente + core.omie_cliente",
      chave: "account_id (uuid)",
      campos: {
        cnpj: "Dígitos do CNPJ cadastrado na conta.",
        codigo_omie: "Códigos de cliente no Omie ligados à conta (por CNPJ do cadastro ou dos vínculos). Pode ter mais de um.",
        vinculo: "Fontes amarradas: 'omie', 'hubspot', 'hubspot,omie' ou 'sem_vinculo'.",
        status_core: "Estado da conta no painel Lecupon (active, suspended, suspended_by_overdue, inactive…).",
        atualizado_em: "Carimbo do cadastro da conta; base do atualizado_desde.",
      },
    },
    titulos: {
      fonte: "core.omie_titulo (carga C20 do Omie)",
      chave: "codigo_lancamento_omie (bigint)",
      campos: {
        competencia: "AAAA-MM do vencimento.",
        valor_centavos: "Valor do título.",
        recebido_centavos: "O que já foi pago (pago_centavos).",
        em_aberto_centavos: "O que falta (aberto_centavos).",
        dias_atraso: "Hoje − vencimento, só quando em aberto e vencido; senão 0.",
        status_pulse: "Situação derivada: a_vencer, vencido, recebido, previsao, cancelado…",
        sincronizado_em: "Quando a linha veio do Omie; base do atualizado_desde.",
      },
      ausentes: "Número da NF e parcela não são ingeridos do Omie hoje.",
    },
    eventos: {
      fonte: "fact.mrr_event (ledger append-only)",
      chave: "id (uuid)",
      campos: {
        tipo: "novo | expansao | contracao | churn_pedido | churn_inadimplencia | reativacao | ajuste.",
        reconstruido: "true = evento derivado do faturamento histórico, não registrado no ato.",
        chave_natural: "Idempotência: fonte:competencia:conta:tipo.",
        contract_id: "Sempre nulo (sem contrato no Pulse).",
      },
    },
    "receita/mrr": {
      fonte: "analytics.mrr_faturado_mes",
      chave: "competencia|account_id",
      campos: {
        mrr_centavos: "MRR SUAVIZADO: mês de dobra (duas cobranças) e buraco (nenhuma) corrigidos para achar a recorrência. É o número da Carteira.",
        faturado_centavos: "Faturado BRUTO no mês, sem suavizar. Dobra aparece dobrada.",
        reconstruido: "true = mês PREENCHIDO pela suavização (não houve título).",
        titulos_no_mes: "Títulos vivos com vencimento no mês para a conta — mesmo universo de /titulos, NÃO o de cliente.",
        origem: "Sempre 'faturamento'.",
      },
    },
    "receita/fechamento": {
      fonte: "analytics.monthly_close (ciclo C13)",
      chave: "competencia",
      campos: {
        identidade: "mrr_inicial + novo + expansao + reativacao − contracao − churn_pedido − churn_inadimplencia + ajuste + nao_atribuido = mrr_final.",
        nao_atribuido: "Resíduo: diferença que nenhum evento explica. Por construção fica em 0 quando o MRR vem do faturamento.",
        nrr: "Net revenue retention como RAZÃO (1.0 = 100%).",
        grr: "Gross revenue retention como RAZÃO.",
        estado: "'aberta' pode ser reapurada; 'congelada' não muda mais (decisão de gente).",
      },
    },
    "receita/faturamento": {
      fonte: "core.omie_titulo, agregado no universo de cliente",
      chave: "competencia|account_id",
      campos: {
        cobrado_centavos: "Soma dos títulos com VENCIMENTO no mês (competência). Bruto.",
        recebido_centavos: "Soma dos pagamentos com DATA DE PAGAMENTO no mês (caixa). Nulo = nada entrou.",
        diferenca: "Num mês passado, cobrado − recebido = inadimplência + timing; num mês futuro, caixa ainda não existe.",
      },
    },
    "inadimplencia/contas": {
      fonte: "fact.inadimplencia_titulo (foto do dia 1º, ciclo C21), agregado por conta",
      chave: "competencia|account_id (uuid nulo = 0000…0000)",
      campos: {
        competencia: "A FOTO do dia 1º do mês: descreve o fim do mês ANTERIOR.",
        em_aberto_centavos: "Soma do que estava no saldo na foto (movimento permaneceu ou entrou).",
        maior_atraso_dias: "Idade do título mais antigo em aberto, na data da foto.",
        faixa: "1_30 | 31_60 | 61_90 | 91_180 | 181_365 | mais_365 — do título mais antigo.",
        ativa: "status_painel = 'active' na foto (só em fotos apuradas; reconstruídas não têm estado de painel).",
        e_cliente: "Universo: true = cliente (tags), false = tudo do Omie.",
        entrou_recuperado_cancelado: "O movimento do mês: o que entrou no saldo, o que foi pago, o que saiu sem pagamento.",
      },
      regras: {
        carencia: `Um título só entra na carteira ${DIAS_UTEIS_PARA_APARECER + 1} dias úteis após vencer — o pagamento leva um dia útil para aparecer no Omie.`,
        corrente: `Até ${DIAS_CORRENTE} dias de atraso em conta ativa: a fila que responde a cobrança.`,
        morta: `Acima de ${DIAS_MORTA} dias: cobrança morta.`,
      },
    },
    "inadimplencia/titulos": {
      fonte: "fact.inadimplencia_titulo",
      chave: "competencia|codigo_lancamento_omie",
      campos: {
        movimento: "permaneceu | entrou (estava no saldo da foto) · recuperado | cancelado (saiu desde a foto anterior).",
        ajuste_centavos: "Mudança de valor de título que CONTINUOU no saldo (quase sempre baixa parcial).",
        motivo_saida: "Para cancelado: 'cancelado', 'prorrogado' ou 'ausente' (sumiu da fonte).",
        origem: "'apurado' = foto tirada no dia; 'reconstruido' = derivada das datas, sem estado de painel.",
      },
    },
    saidas: {
      fonte: "success.cancellation (camada REGISTRADA)",
      chave: "id (uuid)",
      campos: {
        estado: "anunciado | financeiro | desconto | renegociado | retido | encerrado.",
        pedido: "'cancelar' ou 'desconto'.",
        data_levantada: "Quando o cliente levantou a mão.",
        data_fim_aviso: "Fim do aviso prévio (aviso_previo_dias).",
        competencia_ultima_cobranca: "Último mês cobrado.",
        competencia_efeito_receita: "Mês em que a saída deixa de contar no MRR. É o filtro `competencia`.",
        mrr_centavos_na_levantada: "O MRR CONGELADO no momento da levantada — o valor que a saída tira da receita.",
        mrr_novo_centavos: "Para desconto/renegociação: o MRR que fica.",
        atualizado_em: "O maior carimbo entre os passos (criado, aviso, cobrança, aprovação, motivo, etapa, retenção). Base do atualizado_desde.",
      },
      ausentes: "Quem fez cada passo (*_por) fica de fora: é e-mail de gente.",
    },
    ciclos: {
      fonte: "ops.cycle_declaration + ops.cycle_run",
      chave: "ciclo (C1, C12, …)",
      campos: {
        implementado: "false = declarado no PRD, ainda não roda.",
        ultimo_status: "ok | falha | rodando | inerte.",
        ultimo_sucesso_em: "A última vez que terminou em 'ok' — o frescor real da fonte.",
      },
    },
  },
} as const;

export async function GET(req: Request): Promise<Response> {
  const auth = await exigirToken(req);
  if ("erro" in auth) return auth.erro;
  return Response.json(
    {
      recurso: "dicionario",
      gerado_em: new Date().toISOString(),
      dicionario_versao: DICIONARIO_VERSAO,
      dados: DICIONARIO,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
