import type { TabId } from './Shell';

export interface TourStep {
  /** aba que precisa estar aberta */
  tab?: TabId;
  /** valor do atributo data-tour do elemento destacado; sem alvo = cartão no centro */
  target?: string;
  title: string;
  body: string;
}

/** O roteiro do guia. Cada passo destaca a parte real da tela, na aba certa. */
export const TOUR_STEPS: TourStep[] = [
  {
    title: 'Bem-vindo ao VryGraphic',
    body: 'Um controle financeiro com cara de terminal. Em um minuto você vê para que serve cada parte. Dá para pular agora e rever quando quiser no botão GUIA, no topo.',
  },
  { tab: 'visao', target: 'abas', title: 'Três áreas', body: 'Visão geral é o resumo do mês. Transações é onde você lança, edita e exclui. Plano reúne orçamentos, metas e alertas. Contas guarda suas contas, categorias e contas fixas. Agente é o terminal com IA.' },
  { tab: 'visao', target: 'ticker', title: 'Faixa de números', body: 'Os números do mês passando: patrimônio, taxa de poupança, gastos, uso do orçamento e limite livre do cartão. Passe o mouse para pausar.' },
  { tab: 'visao', target: 'saldo', title: 'Saldo diário', body: 'Cada vela é um dia da conta corrente: verde quando o saldo subiu, cinza quando desceu. As barras de baixo são o gasto do dia; em laranja, os dias mais caros do mês.' },
  { tab: 'visao', target: 'alocacao', title: 'Para onde foi o salário', body: 'Quanto você guardou e quanto foi para cada categoria. O ▲ marca as categorias que passaram do orçamento.' },
  { tab: 'visao', target: 'patrimonio', title: 'Patrimônio e projeção', body: 'A soma de todas as contas, mês a mês. A linha tracejada projeta os próximos meses pela média dos últimos seis, com uma faixa de margem.' },
  { tab: 'visao', target: 'calor', title: 'Mapa de calor', body: 'O gasto de cada dia do mês por dia da semana. Quanto mais forte a cor, mais caro o dia.' },
  { tab: 'visao', target: 'vencimentos', title: 'O que vence no próximo mês', body: 'Fatura do cartão e contas fixas, comparadas com o saldo da conta corrente. Dá para ver de antemão se o dinheiro cobre.' },
  { tab: 'visao', target: 'alertas', title: 'Alertas', body: 'Avisos de orçamento perto do limite, fatura fechando e metas que mudaram de previsão. Os novos aparecem num contador no topo.' },
  { tab: 'visao', target: 'meses', title: 'Meses anteriores', body: 'Volte mês a mês: todos os painéis são recalculados para o mês escolhido.' },
  {
    tab: 'transacoes',
    target: 'comando',
    title: 'Lançar escrevendo',
    body: 'Escreva como você fala: "mercado 120,50 alimentação". Comece com + para receita, use 7x para parcelar e "ontem" ou 15/10 para a data. A prévia mostra o que vai ser gravado antes do Enter.',
  },
  { tab: 'transacoes', target: 'filtros', title: 'Filtrar e buscar', body: 'Troque o mês, filtre por tipo ou conta e busque pela descrição. O resumo ao lado acompanha o filtro.' },
  { tab: 'transacoes', target: 'lista', title: 'Editar e excluir', body: 'Editar muda o lançamento na própria linha. Excluir tem botão de desfazer. Parcelas e contas fixas aparecem com etiqueta.' },
  { tab: 'transacoes', target: 'contas', title: 'Saldo das contas', body: 'O saldo de cada conta agora. No cartão aparece também o limite livre.' },
  { tab: 'transacoes', target: 'transferir', title: 'Transferir', body: 'Mova dinheiro entre contas, por exemplo para guardar na reserva ou pagar a fatura do cartão.' },
  {
    tab: 'plano',
    target: 'orcamento',
    title: 'Orçamento do mês',
    body: 'Clique num limite para definir quanto quer gastar em cada categoria. A barra mostra o uso, e a sugestão para o mês seguinte vem da média dos últimos três meses.',
  },
  { tab: 'plano', target: 'simulador', title: 'Simulador de metas', body: 'Mexa no aporte e no rendimento e veja na hora quando a meta chega e quanto os juros somam. Gostou? Salve na meta.' },
  { tab: 'plano', target: 'metas', title: 'Metas', body: 'Crie metas ligadas a uma conta, como uma reserva ou uma viagem. O progresso usa o saldo dessa conta.' },
  { tab: 'plano', target: 'regras', title: 'Regras de alerta', body: 'Escolha quais avisos receber e ajuste os números, por exemplo avisar quando uma categoria passar de 80% do limite.' },
  { tab: 'contas', target: 'contas-lista', title: 'Suas contas', body: 'Conta corrente, poupança, cartão (com limite, fechamento e vencimento) e dinheiro. Os apelidos são o que você digita no comando, como "nu" para o cartão.' },
  { tab: 'contas', target: 'categorias', title: 'Categorias', body: 'Crie, renomeie ou exclua categorias de despesa e receita. Excluir não apaga os lançamentos antigos.' },
  { tab: 'contas', target: 'fixas', title: 'Contas fixas', body: 'Aluguel, assinaturas, salário: cadastre uma vez e elas são lançadas sozinhas no dia, todo mês. Dá para pausar quando quiser.' },
  {
    tab: 'agente',
    target: 'agente',
    title: 'Vry Agent',
    body: 'Converse com seus dados: "quanto gastei com mercado?", "lança padaria 18,90". O agente só usa as ferramentas do app e pede [s/n] antes de gravar. No modo dev, com o app rodando no seu PC, abre um terminal de verdade com o Claude Code.',
  },
  { target: 'guia', title: 'Pronto para começar', body: 'Esse é o tour. Quando quiser rever, é só clicar em GUIA aqui no topo.' },
];
