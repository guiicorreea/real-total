export const categoryOptions = [
  'Alimentação',
  'Mercado',
  'Transporte',
  'Moradia',
  'Saúde',
  'Lazer',
  'Assinaturas',
  'Educação',
  'Compras',
  'Serviços',
  'Trabalho',
  'Transferência',
  'Investimentos',
  'Outros',
]

export const categoryMeta = {
  Alimentação: { color: '#ff9567', soft: '#fff0e9' },
  Mercado: { color: '#53b98a', soft: '#eaf8f1' },
  Transporte: { color: '#5c9df5', soft: '#eaf2ff' },
  Moradia: { color: '#8d77ed', soft: '#f0edff' },
  Saúde: { color: '#ee7277', soft: '#ffeded' },
  Lazer: { color: '#e9b34b', soft: '#fff7e4' },
  Assinaturas: { color: '#d77ce6', soft: '#faedff' },
  Educação: { color: '#4aafc4', soft: '#e9f8fb' },
  Compras: { color: '#eb8b55', soft: '#fff0e8' },
  Serviços: { color: '#7683a3', soft: '#eef1f7' },
  Trabalho: { color: '#35ae78', soft: '#e9f8f0' },
  Transferência: { color: '#8993ab', soft: '#eef1f6' },
  Investimentos: { color: '#4f8de8', soft: '#eaf2ff' },
  Outros: { color: '#a3aabc', soft: '#f0f2f6' },
}

export const institutionMeta = {
  Nubank: { short: 'nu', color: '#765df4', soft: '#eeeaff' },
  Bradesco: { short: 'br', color: '#d93d47', soft: '#ffebed' },
  PicPay: { short: 'pp', color: '#20a968', soft: '#e7f8ef' },
}

const seedToday = new Date()
const seedYear = seedToday.getFullYear()
const seedMonthNumber = seedToday.getMonth() + 1
const seedMonth = String(seedMonthNumber).padStart(2, '0')
const seedMonthKey = `${seedYear}-${seedMonth}`

function alignSeedDate(value) {
  const day = String(value).slice(8, 10)
  return `${seedYear}-${seedMonth}-${day}`
}

export const accountTypeOptions = [
  'Conta corrente',
  'Poupança',
  'Carteira',
  'Cartão de crédito',
  'Investimento',
]

export const seedAccounts = [
  {
    id: 'acc-nubank-main',
    institution: 'Nubank',
    name: 'Conta principal',
    type: 'Conta corrente',
    balance: 4280.5,
    openingBalance: 4280.5,
    lastUpdated: 'Hoje, 09:42',
  },
  {
    id: 'acc-bradesco-main',
    institution: 'Bradesco',
    name: 'Conta corrente',
    type: 'Conta corrente',
    balance: 8940.2,
    openingBalance: 8940.2,
    lastUpdated: 'Ontem, 18:20',
  },
  {
    id: 'acc-picpay-wallet',
    institution: 'PicPay',
    name: 'Carteira pessoal',
    type: 'Carteira',
    balance: 1320,
    openingBalance: 1320,
    lastUpdated: '12 mar, 14:05',
  },
  {
    id: 'acc-nubank-card',
    institution: 'Nubank',
    name: 'Cartão Roxinho',
    type: 'Cartão de crédito',
    balance: -1842.6,
    limit: 7500,
    openingBalance: 0,
    lastUpdated: 'Hoje, 08:15',
  },
]

export const seedBudgetGroups = [
  { id: 'essential', name: 'Essencial / Fixo', target: 50, color: '#5c9df5', soft: '#eaf2ff' },
  { id: 'variable', name: 'Diversos / Variável', target: 30, color: '#d77ce6', soft: '#faedff' },
  { id: 'investments', name: 'Investimentos', target: 20, color: '#4f8de8', soft: '#eaf2ff' },
]

const planningDate = new Date(seedYear, seedMonthNumber, 1)
const planningMonthKey = `${planningDate.getFullYear()}-${String(planningDate.getMonth() + 1).padStart(2, '0')}`
const plannedForPlanningMonth = (value) => ({ [planningMonthKey]: value })
const dueForPlanningMonth = (day) => ({ [planningMonthKey]: `${planningMonthKey}-${String(day).padStart(2, '0')}` })

export const seedBudgets = [
  { id: 'budget-aluguel', groupId: 'essential', label: 'Aluguel', category: 'Moradia', accountId: '', defaultAmount: 0, plannedByMonth: plannedForPlanningMonth(1573), dueByMonth: dueForPlanningMonth(10), keywords: ['aluguel'] },
  { id: 'budget-agua', groupId: 'essential', label: 'Água', category: 'Moradia', accountId: '', defaultAmount: 0, plannedByMonth: plannedForPlanningMonth(52.72), dueByMonth: dueForPlanningMonth(15), keywords: ['agua'] },
  { id: 'budget-luz', groupId: 'essential', label: 'Luz', category: 'Moradia', accountId: '', defaultAmount: 0, plannedByMonth: plannedForPlanningMonth(143.67), dueByMonth: dueForPlanningMonth(18), keywords: ['luz'] },
  { id: 'budget-internet', groupId: 'essential', label: 'Internet', category: 'Serviços', accountId: '', defaultAmount: 0, plannedByMonth: plannedForPlanningMonth(64.95), dueByMonth: dueForPlanningMonth(20), keywords: ['internet'] },
  { id: 'budget-vivo', groupId: 'essential', label: 'Vivo', category: 'Serviços', accountId: '', defaultAmount: 0, plannedByMonth: plannedForPlanningMonth(54.97), dueByMonth: dueForPlanningMonth(20), keywords: ['vivo'] },
  { id: 'budget-iptv', groupId: 'essential', label: 'IPTV', category: 'Serviços', accountId: '', defaultAmount: 0, plannedByMonth: plannedForPlanningMonth(24.9), dueByMonth: dueForPlanningMonth(22), keywords: ['iptv'] },
  { id: 'budget-consorcio', groupId: 'essential', label: 'Consórcio HS', category: 'Transporte', accountId: '', defaultAmount: 0, plannedByMonth: plannedForPlanningMonth(1204.64), dueByMonth: dueForPlanningMonth(13), keywords: ['consorcio'] },
  { id: 'budget-renegociacao', groupId: 'essential', label: 'Renegociação Hiper', category: 'Serviços', accountId: '', defaultAmount: 0, plannedByMonth: plannedForPlanningMonth(50.88), dueByMonth: dueForPlanningMonth(25), keywords: ['renegociacao', 'hiper'] },
  { id: 'budget-nubank', groupId: 'variable', label: 'Nubank', category: 'Alimentação', accountId: 'acc-nubank-main', defaultAmount: 0, plannedByMonth: plannedForPlanningMonth(576.88), dueByMonth: dueForPlanningMonth(28), keywords: ['nubank'] },
  { id: 'budget-bradesco', groupId: 'variable', label: 'Bradesco', category: 'Compras', accountId: 'acc-bradesco-main', defaultAmount: 0, plannedByMonth: plannedForPlanningMonth(303.58), dueByMonth: dueForPlanningMonth(28), keywords: ['bradesco'] },
  { id: 'budget-investimento', groupId: 'investments', label: 'Investimento', category: 'Investimentos', accountId: '', defaultAmount: 0, plannedByMonth: plannedForPlanningMonth(1316.56), dueByMonth: dueForPlanningMonth(5), keywords: ['investimento'] },
]

export const seedBudgetIncome = {
  monthly: { [planningMonthKey]: 3938.8 },
  extra: { [planningMonthKey]: 2000 },
}

const baseSeedTransactions = [
  {
    id: 'tx-001',
    date: '2025-03-18',
    description: 'Padaria do Bairro',
    merchant: 'Padaria do Bairro',
    category: 'Alimentação',
    type: 'expense',
    amount: 28.9,
    accountId: 'acc-nubank-main',
    institution: 'Nubank',
    status: 'confirmed',
    source: 'demo',
    confidence: 0.98,
  },
  {
    id: 'tx-002',
    date: '2025-03-17',
    description: 'Salário — Empresa',
    merchant: 'Empresa',
    category: 'Trabalho',
    type: 'income',
    amount: 6800,
    accountId: 'acc-bradesco-main',
    institution: 'Bradesco',
    status: 'confirmed',
    source: 'demo',
    confidence: 0.99,
  },
  {
    id: 'tx-003',
    date: '2025-03-17',
    description: 'Mercado São Lucas',
    merchant: 'Mercado São Lucas',
    category: 'Mercado',
    type: 'expense',
    amount: 186.42,
    accountId: 'acc-nubank-card',
    institution: 'Nubank',
    status: 'confirmed',
    source: 'demo',
    confidence: 0.94,
  },
  {
    id: 'tx-004',
    date: '2025-03-15',
    description: 'Netflix',
    merchant: 'Netflix',
    category: 'Assinaturas',
    type: 'expense',
    amount: 55.9,
    accountId: 'acc-picpay-wallet',
    institution: 'PicPay',
    status: 'confirmed',
    source: 'demo',
    confidence: 0.97,
  },
  {
    id: 'tx-005',
    date: '2025-03-14',
    description: 'Posto Ipiranga',
    merchant: 'Posto Ipiranga',
    category: 'Transporte',
    type: 'expense',
    amount: 210,
    accountId: 'acc-bradesco-main',
    institution: 'Bradesco',
    status: 'confirmed',
    source: 'demo',
    confidence: 0.91,
  },
  {
    id: 'tx-006',
    date: '2025-03-13',
    description: 'Farmácia São Paulo',
    merchant: 'Farmácia São Paulo',
    category: 'Saúde',
    type: 'expense',
    amount: 73.8,
    accountId: 'acc-nubank-main',
    institution: 'Nubank',
    status: 'confirmed',
    source: 'demo',
    confidence: 0.96,
  },
  {
    id: 'tx-007',
    date: '2025-03-12',
    description: 'Academia Pulse',
    merchant: 'Academia Pulse',
    category: 'Saúde',
    type: 'expense',
    amount: 119.9,
    accountId: 'acc-picpay-wallet',
    institution: 'PicPay',
    status: 'confirmed',
    source: 'demo',
    confidence: 0.95,
  },
  {
    id: 'tx-008',
    date: '2025-03-11',
    description: 'Transferência Nubank → Bradesco',
    merchant: 'Transferência',
    category: 'Transferência',
    type: 'transfer',
    amount: 1200,
    accountId: 'acc-nubank-main',
    institution: 'Nubank',
    status: 'confirmed',
    source: 'demo',
    confidence: 0.88,
  },
  {
    id: 'tx-009',
    date: '2025-03-10',
    description: 'Aluguel',
    merchant: 'Imobiliária Horizonte',
    category: 'Moradia',
    type: 'expense',
    amount: 1850,
    accountId: 'acc-bradesco-main',
    institution: 'Bradesco',
    status: 'confirmed',
    source: 'demo',
    confidence: 0.99,
  },
  {
    id: 'tx-010',
    date: '2025-03-09',
    description: 'Rendimento CDB',
    merchant: 'Rendimento CDB',
    category: 'Investimentos',
    type: 'income',
    amount: 42.36,
    accountId: 'acc-nubank-main',
    institution: 'Nubank',
    status: 'confirmed',
    source: 'demo',
    confidence: 0.93,
  },
]

export const seedTransactions = baseSeedTransactions.map((transaction) => ({ ...transaction, date: alignSeedDate(transaction.date) }))

const baseDemoRows = {
  Nubank: [
    { date: '2025-03-18', description: 'Café Central', amount: -12.5, type: 'expense', category: 'Alimentação', confidence: 0.98 },
    { date: '2025-03-18', description: 'Padaria do Bairro', amount: -28.9, type: 'expense', category: 'Alimentação', confidence: 0.98 },
    { date: '2025-03-17', description: 'Mercado São Lucas', amount: -186.42, type: 'expense', category: 'Mercado', confidence: 0.94 },
    { date: '2025-03-16', description: 'Pix recebido — João Silva', amount: 350, type: 'income', category: 'Outros', confidence: 0.86 },
    { date: '2025-03-15', description: 'Streaming Flix', amount: -39.9, type: 'expense', category: 'Assinaturas', confidence: 0.92 },
  ],
  Bradesco: [
    { date: '2025-03-18', description: 'Débito automático — Energia', amount: -148.75, type: 'expense', category: 'Moradia', confidence: 0.97 },
    { date: '2025-03-17', description: 'Salário — Empresa', amount: 6800, type: 'income', category: 'Trabalho', confidence: 0.99 },
    { date: '2025-03-16', description: 'Supermercado Central', amount: -243.18, type: 'expense', category: 'Mercado', confidence: 0.93 },
    { date: '2025-03-15', description: 'Transferência Nubank → Bradesco', amount: 1200, type: 'transfer', category: 'Transferência', confidence: 0.88 },
  ],
  PicPay: [
    { date: '2025-03-18', description: 'Padaria do Bairro', amount: -28.9, type: 'expense', category: 'Alimentação', confidence: 0.98 },
    { date: '2025-03-17', description: 'Netflix', amount: -55.9, type: 'expense', category: 'Assinaturas', confidence: 0.97 },
    { date: '2025-03-16', description: 'Recarga recebida', amount: 100, type: 'income', category: 'Outros', confidence: 0.74 },
    { date: '2025-03-15', description: 'Farmácia Central', amount: -63.2, type: 'expense', category: 'Saúde', confidence: 0.91 },
  ],
}

export const demoRows = Object.fromEntries(Object.entries(baseDemoRows).map(([institution, rows]) => [institution, rows.map((row) => ({ ...row, date: alignSeedDate(row.date) }))]))
