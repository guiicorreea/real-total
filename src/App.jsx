import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  Bell,
  Briefcase,
  Building2,
  CalendarDays,
  Car,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Copy,
  CircleUserRound,
  CreditCard,
  Download,
  FileText,
  Filter,
  GraduationCap,
  HeartPulse,
  Home,
  Info,
  Landmark,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  Link2,
  LogOut,
  Menu,
  Mail,
  MoreHorizontal,
  PiggyBank,
  Plus,
  Receipt,
  RefreshCw,
  ScanLine,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBasket,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Undo2,
  Upload,
  Wallet,
  X,
} from 'lucide-react'
import {
  accountTypeOptions,
  categoryMeta,
  categoryOptions,
  demoRows,
  institutionMeta,
  seedAccounts,
  seedBudgetGroups,
  seedBudgets,
  seedBudgetIncome,
  seedTransactions,
} from './data/seed.js'
import { getDemoStatementRows, parseBillPdf, parseStatement } from './lib/parser.js'
import { connectOutlook, disconnectOutlook, initializeOutlook, isOutlookConfigured, syncOutlookBills } from './lib/outlook.js'
import { clearState, loadState, pullState, saveState, setActiveUser, isCloudReady, getLastSyncedAt, ensureProfile } from './lib/storage.js'
import { getActiveUser, isCloudConfigured, onAuthChange, signIn as cloudSignIn, signOut as cloudSignOut, signUp as cloudSignUp } from './lib/supabase.js'
import { DAYS_BEFORE_OPTIONS, fetchAlertSettings, saveAlertSettings } from './lib/alerts.js'

const navItems = [
  { id: 'dashboard', label: 'Visão geral', icon: LayoutDashboard },
  { id: 'transactions', label: 'Transações', icon: ArrowLeftRight },
  { id: 'import', label: 'Importar extrato', icon: Upload },
  { id: 'bills', label: 'Boletos', icon: Mail },
  { id: 'accounts', label: 'Contas', icon: Wallet },
  { id: 'budgets', label: 'Orçamentos', icon: PiggyBank },
  { id: 'simulate', label: 'Simular', icon: SlidersHorizontal },
  { id: 'goals', label: 'Metas', icon: Target, soon: true },
]

const viewTitles = {
  dashboard: 'Visão geral',
  transactions: 'Transações',
  import: 'Importar extrato',
  bills: 'Boletos',
  accounts: 'Contas',
  budgets: 'Orçamentos',
  simulate: 'Simulação',
  goals: 'Metas',
  settings: 'Configurações',
}

const categoryIcons = {
  Alimentação: Receipt,
  Mercado: ShoppingBasket,
  Transporte: Car,
  Moradia: Home,
  Saúde: HeartPulse,
  Lazer: Sparkles,
  Assinaturas: Sparkles,
  Educação: GraduationCap,
  Compras: ShoppingBasket,
  Serviços: SlidersHorizontal,
  Trabalho: Briefcase,
  Transferência: ArrowLeftRight,
  Investimentos: TrendingUp,
  Outros: Tag,
}

const RESERVED_ACCOUNT_TYPES = ['Investimento', 'Poupança']

const budgetCategoryOptions = categoryOptions.filter((category) => !['Transferência', 'Trabalho', 'Investimentos'].includes(category))

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function inferBudgetGroup(category) {
  if (category === 'Investimentos') return 'investments'
  if (['Alimentação', 'Mercado', 'Transporte', 'Lazer', 'Compras', 'Educação'].includes(category)) return 'variable'
  return 'essential'
}

function normalizeBudgetItem(item, index = 0) {
  const category = item.category ?? item.label ?? 'Outros'
  const defaultAmount = Number(item.defaultAmount ?? item.limit ?? 0)
  return {
    id: item.id ?? `budget-${index}-${Date.now()}`,
    groupId: item.groupId ?? inferBudgetGroup(category),
    label: item.label ?? category,
    category,
    accountId: item.accountId ?? '',
    keywords: Array.isArray(item.keywords) && item.keywords.length
      ? item.keywords.filter(Boolean)
      : [normalizeText(item.label ?? category)].filter(Boolean),
    source: item.source ?? 'manual',
    billId: item.billId ?? null,
    defaultAmount,
    plannedByMonth: item.plannedByMonth ?? {},
    dueByMonth: item.dueByMonth ?? {},
    defaultDueDate: item.defaultDueDate ?? '',
  }
}

function plannedBudgetAmount(item, monthKey) {
  return Number(item.plannedByMonth?.[monthKey] ?? item.defaultAmount ?? item.limit ?? 0)
}

// Chave que agrupa o gasto de um item de orçamento: conta e categoria juntas,
// para não misturar o mesmo gasto entre itens diferentes.
function budgetSpendKey(item) {
  return `${item.accountId ?? ''}::${item.category ?? ''}`
}

function plannedBudgetDueDate(item, monthKey, billsById = {}) {
  const monthDue = item?.dueByMonth?.[monthKey]
  if (monthDue) return monthDue
  const billDue = item?.billId ? billsById[item.billId]?.dueDate : ''
  if (billDue) return billDue
  return item?.defaultDueDate ?? ''
}

function todayIsoDate(today = new Date()) {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

function daysUntilDate(dueDate, today = new Date()) {
  if (!dueDate) return null
  const target = new Date(`${dueDate}T12:00:00`).getTime()
  if (Number.isNaN(target)) return null
  return Math.round((target - new Date(`${todayIsoDate(today)}T12:00:00`).getTime()) / 86400000)
}

function dueStatus(dueDate, today = new Date()) {
  const days = daysUntilDate(dueDate, today)
  if (days === null) return null
  if (days < 0) return { level: 'danger', days, label: days === -1 ? 'venceu ontem' : `venceu há ${Math.abs(days)} dias` }
  if (days === 0) return { level: 'danger', days, label: 'vence hoje' }
  if (days === 1) return { level: 'warning', days, label: 'vence amanhã' }
  if (days <= 5) return { level: 'warning', days, label: `vence em ${days} dias` }
  if (days <= 10) return { level: 'notice', days, label: `vence em ${days} dias` }
  return { level: 'neutral', days, label: formatDate(dueDate) }
}

function billSignature(bill) {
  return [normalizeText(bill?.description ?? ''), bill?.dueDate ?? '', Number(bill?.amount || 0).toFixed(2)].join('|')
}

function findBillBySignature(bills, candidate, ignoreId = '') {
  const signature = billSignature(candidate)
  return bills.find((bill) => bill.id !== ignoreId && billSignature(bill) === signature) ?? null
}

function billShareAmount(bill) {
  return Number(bill?.amount || 0) * Number(bill?.mySharePercent ?? 100) / 100
}

function budgetItemShadowsBill(budget, monthKey, bills) {
  if (!budget?.label) return false
  return bills.some((bill) => normalizeText(bill.description ?? '') === normalizeText(budget.label)
    && bill.dueDate === (budget.dueByMonth?.[monthKey] ?? budget.defaultDueDate ?? '')
    && Math.abs(billShareAmount(bill) - plannedBudgetAmount(budget, monthKey)) < 0.01)
}

function collectDueReminders({ bills, budgets, withinDays = 10, today = new Date() }) {
  const reminders = []
  const currentMonth = monthKeyFromDate(todayIsoDate(today))
  const billsById = Object.fromEntries(bills.map((bill) => [bill.id, bill]))

  for (const bill of bills) {
    if (bill.status === 'paid' || bill.matchedTransactionId || !bill.dueDate) continue
    reminders.push({
      id: `bill-${bill.id}`,
      label: bill.description,
      category: bill.category,
      dueDate: bill.dueDate,
      amount: Number(bill.amount || 0) * Number(bill.mySharePercent ?? 100) / 100,
      status: dueStatus(bill.dueDate, today),
      origin: 'bill',
    })
  }

  for (const budget of budgets) {
    if (budget.billId && billsById[budget.billId]) continue
    if (budgetItemShadowsBill(budget, currentMonth, bills)) continue
    const dueDate = budget.dueByMonth?.[currentMonth] || budget.defaultDueDate || ''
    if (!dueDate) continue
    reminders.push({
      id: `budget-${budget.id}`,
      label: budget.label,
      category: budget.category,
      dueDate,
      amount: plannedBudgetAmount(budget, currentMonth),
      status: dueStatus(dueDate, today),
      origin: 'budget',
    })
  }

  const grouped = new Map()
  for (const reminder of reminders) {
    const signature = billSignature(reminder)
    const existing = grouped.get(signature)
    if (existing) {
      existing.count += 1
      existing.totalAmount += reminder.amount
      continue
    }
    grouped.set(signature, { ...reminder, count: 1, totalAmount: reminder.amount })
  }

  return [...grouped.values()]
    .filter((reminder) => reminder.status && (reminder.status.days < 0 || reminder.status.days <= withinDays))
    .sort((a, b) => a.status.days - b.status.days)
}

function shiftDateToMonth(date, monthKey) {
  const day = Number(String(date || '').slice(8, 10))
  if (!monthKey || !day) return date
  const lastDay = new Date(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)), 0).getDate()
  return `${monthKey}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

function toStorableCandidate(candidate) {
  const { file, ...rest } = candidate
  return { ...rest, fileMissing: !file }
}

function restoreCandidates(candidates) {
  if (!Array.isArray(candidates)) return []
  return candidates.map((candidate) => ({ ...candidate, file: null, fileMissing: true }))
}

function getTransactionAllocations(transaction) {
  const allocations = Array.isArray(transaction?.allocations)
    ? transaction.allocations.filter((allocation) => allocation && allocation.category)
    : []
  if (allocations.length) return allocations.map((allocation) => ({ ...allocation, amount: Number(allocation.amount || 0) }))
  return [{ category: transaction?.category ?? 'Outros', amount: Number(transaction?.amount || 0) }]
}

function guessCategoryFromDescription(value) {
  const text = normalizeText(value)
  if (!text) return 'Outros'
  const rules = [
    ['Moradia', /aluguel|condominio|agua|luz|energia|gas|alugueis|imoveis/],
    ['Serviços', /internet|fibra|telefone|celular|operadora|recarga|assinatura/],
    ['Transporte', /consorcio|financi|veiculo|ipva|licenciamento|auto/],
    ['Investimentos', /investimento|aplicacao|renda|tesouro/],
    ['Saúde', /saude|plano|unimed|medic|dentista/],
    ['Educação', /escola|curso|mensalidade|faculdade/],
  ]
  for (const [category, pattern] of rules) {
    if (pattern.test(text)) return category
  }
  return 'Outros'
}

function adjustBalancesForTransaction(accounts, transaction, direction = 1) {
  const destinationId = transaction.destinationAccountId ?? null
  return accounts.map((item) => {
    if (item.id === transaction.accountId) {
      const delta = transaction.type === 'income'
        ? transaction.amount
        : transaction.type === 'expense' || destinationId
          ? -transaction.amount
          : 0
      if (!delta) return item
      return { ...item, balance: Number(item.balance || 0) + delta * direction, lastUpdated: 'Agora' }
    }
    if (destinationId && item.id === destinationId) {
      return { ...item, balance: Number(item.balance || 0) + transaction.amount * direction, lastUpdated: 'Agora' }
    }
    return item
  })
}

function buildBillRecord(form, source) {
  const { file: _file, ...editingData } = source ?? {}
  const uniqueSuffix = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)
  return {
    ...editingData,
    ...form,
    id: source?.id ?? `bill-${Date.now()}-${uniqueSuffix}`,
    status: source?.status ?? 'pending',
    source: source?.source ?? 'manual',
    createdAt: source?.createdAt ?? new Date().toISOString(),
  }
}

function buildBudgetItemForBill(bill, existingBudget) {
  const competence = bill.competence || monthKeyFromDate(bill.dueDate)
  const shareAmount = Number(bill.amount || 0) * Number(bill.mySharePercent ?? 100) / 100
  const plannedByMonth = { ...(existingBudget?.plannedByMonth ?? {}) }
  if (existingBudget?.competence && existingBudget.competence !== competence) delete plannedByMonth[existingBudget.competence]
  plannedByMonth[competence] = shareAmount
  const dueByMonth = { ...(existingBudget?.dueByMonth ?? {}) }
  if (bill.dueDate) dueByMonth[competence] = bill.dueDate

  return normalizeBudgetItem({
    id: `budget-${bill.id}`,
    groupId: inferBudgetGroup(bill.category),
    label: bill.description,
    category: bill.category,
    accountId: '',
    defaultAmount: shareAmount,
    plannedByMonth,
    dueByMonth,
    defaultDueDate: bill.dueDate ?? '',
    keywords: [bill.description],
    source: 'bill',
    billId: bill.id,
  })
}

function upsertBill(currentBills, nextBill) {
  return currentBills.some((bill) => bill.id === nextBill.id)
    ? currentBills.map((bill) => (bill.id === nextBill.id ? nextBill : bill))
    : [...currentBills, nextBill]
}

function significantWords(value) {
  return String(value ?? '')
    .split(/[^a-zà-ú0-9]+/i)
    .filter(Boolean)
    .map((word) => normalizeText(word))
    .filter((word) => word.length > 3)
}

function billPaymentMatchScore(bill, transaction) {
  if (!bill || transaction?.type !== 'expense') return 0
  if (Math.abs(Number(bill.amount || 0) - Number(transaction.amount || 0)) > 0.01) return 0

  let score = 50
  if (bill.dueDate && transaction.date) {
    const due = new Date(`${bill.dueDate}T12:00:00`).getTime()
    const paid = new Date(`${transaction.date}T12:00:00`).getTime()
    const days = Math.abs(due - paid) / 86400000
    if (days <= 7) score += 25
    else if (days <= 45) score += 10
    else score -= 10
  }

  const transactionText = normalizeText(`${transaction.description ?? ''} ${transaction.merchant ?? ''}`)
  if (bill.barcode && transactionText.includes(normalizeText(bill.barcode))) score += 25
  const billWords = significantWords(`${bill.description ?? ''} ${bill.issuer ?? ''}`)
  if (billWords.some((word) => transactionText.includes(word))) score += 10
  return score
}

function billMatchCandidates(bill, transactions, matchedIds = [], limit = 6) {
  if (!bill) return []
  const billAmount = Number(bill.amount || 0)
  const billWords = significantWords(`${bill.description ?? ''} ${bill.issuer ?? ''}`)
  const dueTime = bill.dueDate ? new Date(`${bill.dueDate}T12:00:00`).getTime() : null

  return transactions
    .filter((transaction) => transaction.type === 'expense' && transaction.status !== 'ignored')
    .filter((transaction) => !matchedIds.includes(transaction.id))
    .map((transaction) => {
      const amount = Number(transaction.amount || 0)
      const difference = Math.abs(billAmount - amount)
      const text = normalizeText(`${transaction.description ?? ''} ${transaction.merchant ?? ''}`)
      const wordHits = billWords.filter((word) => text.includes(word)).length
      const barcodeHit = Boolean(bill.barcode && text.includes(normalizeText(bill.barcode)))
      const days = dueTime && transaction.date ? Math.abs(dueTime - new Date(`${transaction.date}T12:00:00`).getTime()) / 86400000 : null

      let score = 0
      if (days !== null) score += days <= 7 ? 35 : days <= 20 ? 22 : days <= 45 ? 10 : 0
      if (barcodeHit) score += 35
      score += Math.min(wordHits, 2) * 15
      if (bill.competence && transaction.date?.startsWith(bill.competence)) score += 10
      if (difference <= 0.01) score += 30

      const hasSignal = barcodeHit || wordHits > 0
      const maxDifference = hasSignal ? billAmount * 0.5 : Math.max(billAmount * 0.05, 5)

      return { transaction, amount, difference, days, wordHits, score, maxDifference }
    })
    .filter((candidate) => candidate.score >= 20 && (candidate.difference <= 0.01 || candidate.difference <= candidate.maxDifference))
    .sort((a, b) => b.score - a.score || a.difference - b.difference)
    .slice(0, limit)
}

function reconcileBillsWithTransactions(currentBills, newTransactions) {
  let bills = [...currentBills]
  const matches = []
  for (const transaction of newTransactions) {
    const candidates = bills
      .filter((bill) => bill.status !== 'paid' && !bill.matchedTransactionId)
      .map((bill) => ({ bill, score: billPaymentMatchScore(bill, transaction) }))
      .filter((candidate) => candidate.score >= 70)
      .sort((a, b) => b.score - a.score)
    const best = candidates[0]
    if (!best) continue
    bills = bills.map((bill) => bill.id === best.bill.id ? { ...bill, status: 'paid', paidAt: transaction.date, matchedTransactionId: transaction.id, matchConfidence: best.score / 100 } : bill)
    matches.push({ billId: best.bill.id, transactionId: transaction.id })
  }
  return { bills, matches }
}

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
})

const compactCurrencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
})

function formatCurrency(value, compact = false) {
  return (compact ? compactCurrencyFormatter : currencyFormatter).format(Number(value) || 0)
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' })
    .format(date)
    .replace('.', '')
}

function formatDateLong(value) {
  if (!value) return '—'
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }).format(date)
}

function formatDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}

function monthKeyFromDate(value) {
  return String(value || '').slice(0, 7)
}

function formatMonthLabel(monthKey) {
  const date = new Date(`${monthKey}-01T12:00:00`)
  if (Number.isNaN(date.getTime())) return monthKey
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(date)
}

function shiftMonth(monthKey, amount) {
  const date = new Date(`${monthKey}-01T12:00:00`)
  date.setMonth(date.getMonth() + amount)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function formatFileSize(bytes) {
  if (!bytes) return 'Arquivo de demonstração'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function classNames(...values) {
  return values.filter(Boolean).join(' ')
}

function isYieldTransaction(transaction) {
  if (transaction.type !== 'income') return false
  const text = normalizeText(`${transaction.description ?? ''} ${transaction.merchant ?? ''}`)
  return transaction.category === 'Investimentos' || /rendimento|rendimentoCaixinha|dividendo|juros|bonus|resgate|aplicacao/.test(text)
}

function transactionSignature(transaction) {
  return [
    transaction.accountId,
    transaction.date,
    Number(transaction.amount).toFixed(2),
    String(transaction.description).toLowerCase().trim(),
  ].join('|')
}

function AccountLogo({ institution, size = 'medium' }) {
  const meta = institutionMeta[institution] ?? { short: institution?.slice(0, 2).toLowerCase(), color: '#657089', soft: '#eef1f6' }
  return (
    <span
      className={classNames('institution-logo', size === 'small' && 'institution-logo--small')}
      style={{ '--logo-color': meta.color, '--logo-soft': meta.soft }}
      aria-label={institution}
    >
      {meta.short}
    </span>
  )
}

function CategoryIcon({ category, size = 17 }) {
  const Icon = categoryIcons[category] ?? Tag
  const meta = categoryMeta[category] ?? categoryMeta.Outros
  return (
    <span className="category-icon" style={{ '--category-color': meta.color, '--category-soft': meta.soft }}>
      <Icon size={size} strokeWidth={2.1} />
    </span>
  )
}

function CategoryPill({ category }) {
  const meta = categoryMeta[category] ?? categoryMeta.Outros
  return (
    <span className="category-pill" style={{ '--category-color': meta.color, '--category-soft': meta.soft }}>
      <span className="category-pill__dot" />
      {category}
    </span>
  )
}

function TypeBadge({ type }) {
  const config = {
    income: { label: 'Entrada', icon: ArrowDownRight },
    expense: { label: 'Saída', icon: ArrowUpRight },
    transfer: { label: 'Transferência', icon: ArrowLeftRight },
  }[type] ?? { label: type, icon: ArrowLeftRight }

  const Icon = config.icon
  return (
    <span className={classNames('type-badge', `type-badge--${type}`)}>
      <Icon size={13} />
      {config.label}
    </span>
  )
}

function StatCard({ label, value, helper, trend, tone = 'purple', icon: Icon }) {
  return (
    <article className="stat-card">
      <div className={classNames('stat-card__icon', `stat-card__icon--${tone}`)}>
        <Icon size={18} />
      </div>
      <div className="stat-card__content">
        <span className="eyebrow">{label}</span>
        <strong>{value}</strong>
        <span className={classNames('stat-card__helper', trend && 'stat-card__helper--positive')}>
          {trend && <TrendingUp size={13} />}
          {helper}
        </span>
      </div>
      <MoreHorizontal className="muted-icon" size={18} />
    </article>
  )
}

function EmptyState({ icon: Icon = FileText, title, description, action, onAction }) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon"><Icon size={24} /></span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <button className="button button--primary" onClick={onAction}>{action}</button>}
    </div>
  )
}

function DashboardPage({ accounts, transactions, budgets, bills, reminders, userName, onNavigate, onImportDemo }) {
  const today = new Date()
  const referenceDate = transactions[0]?.date ?? today.toISOString().slice(0, 10)
  const monthKey = referenceDate.slice(0, 7)
  const todayLabel = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(today)
  const capitalizedTodayLabel = todayLabel.charAt(0).toUpperCase() + todayLabel.slice(1)
  const monthTransactions = transactions.filter((transaction) => transaction.date.startsWith(monthKey))
  const incomeEntries = monthTransactions.filter((transaction) => transaction.type === 'income')
  const yieldEntries = incomeEntries.filter(isYieldTransaction)
  const income = incomeEntries.filter((transaction) => !isYieldTransaction(transaction)).reduce((sum, transaction) => sum + transaction.amount, 0)
  const yields = yieldEntries.reduce((sum, transaction) => sum + transaction.amount, 0)
  const expenses = monthTransactions.filter((transaction) => transaction.type === 'expense').reduce((sum, transaction) => sum + transaction.amount, 0)
  const reservedBalance = accounts
    .filter((account) => RESERVED_ACCOUNT_TYPES.includes(account.type))
    .reduce((sum, account) => sum + Number(account.balance || 0), 0)
  const availableBalance = accounts.reduce((sum, account) => sum + Number(account.balance || 0), 0) - reservedBalance
  const savingsRate = income ? Math.max(0, Math.round(((income - expenses) / income) * 100)) : 0
  const categoryTotals = monthTransactions
    .filter((transaction) => transaction.type === 'expense')
    .reduce((totals, transaction) => {
      getTransactionAllocations(transaction).forEach((allocation) => {
        totals[allocation.category] = (totals[allocation.category] ?? 0) + allocation.amount
      })
      return totals
    }, {})
  const sortedCategories = Object.entries(categoryTotals).sort(([, a], [, b]) => b - a).slice(0, 5)
  const budgetLimit = budgets.reduce((sum, budget) => sum + plannedBudgetAmount(budget, monthKey), 0)
  const budgetSpent = [...new Set(budgets.map((budget) => budget.category))].reduce((sum, category) => sum + (categoryTotals[category] ?? 0), 0)
  const budgetRemaining = budgetLimit - budgetSpent
  const budgetHelper = budgets.length ? `${formatCurrency(Math.max(0, budgetRemaining))} disponíveis` : 'Crie seu primeiro orçamento'
  const categoryTotal = sortedCategories.reduce((sum, [, value]) => sum + value, 0)
  let cursor = 0
  const gradientStops = sortedCategories.map(([category, value]) => {
    const start = cursor
    cursor += categoryTotal ? (value / categoryTotal) * 100 : 0
    return `${(categoryMeta[category]?.color ?? '#a3aabc')} ${start}% ${cursor}%`
  })
  const chartBackground = gradientStops.length ? `conic-gradient(${gradientStops.join(', ')})` : '#e9edf5'
  const plannedByCategory = budgets.reduce((totals, budget) => {
    totals[budget.category] = (totals[budget.category] ?? 0) + plannedBudgetAmount(budget, monthKey)
    return totals
  }, {})
  const totalPlannedBudget = budgets.reduce((sum, budget) => sum + plannedBudgetAmount(budget, monthKey), 0)
  const budgetUsage = totalPlannedBudget ? (expenses / totalPlannedBudget) * 100 : 0
  const isOverBudget = totalPlannedBudget > 0 && expenses > totalPlannedBudget
  const trackColor = isOverBudget ? '#f6d9d5' : '#ddd8fd'
  const ringScale = totalPlannedBudget ? Math.min(budgetUsage, 100) / 100 : 0
  let ringCursor = 0
  const ringStops = sortedCategories.map(([category, value]) => {
    const start = ringCursor
    ringCursor += categoryTotal ? (value / categoryTotal) * 100 * ringScale : 0
    return `${categoryMeta[category]?.color ?? '#a3aabc'} ${start}% ${ringCursor}%`
  })
  const usageRingBackground = ringStops.length
    ? `conic-gradient(${ringStops.join(', ')}, ${trackColor} ${ringCursor}% 100%)`
    : `conic-gradient(${trackColor} 0 100%)`
  const legendEntries = sortedCategories.length
    ? sortedCategories
    : Object.entries(plannedByCategory).sort(([, a], [, b]) => b - a).slice(0, 5).map(([category]) => [category, 0])

  return (
    <div className="page-stack">
      <section className="page-heading page-heading--dashboard">
        <div>
          <span className="eyebrow">{capitalizedTodayLabel}</span>
          <h1>Olá, {userName} <span className="wave">✦</span></h1>
          <p>Acompanhe seu dinheiro com mais clareza e menos preocupação.</p>
        </div>
        <div className="heading-actions">
          <button className="button button--ghost" onClick={() => onNavigate('import')}><Upload size={16} /> Importar extrato</button>
          <button className="button button--primary" onClick={() => onNavigate('accounts')}><Plus size={17} /> Nova conta</button>
        </div>
      </section>

      <section className="hero-grid">
        <article className="balance-card">
          <div className="balance-card__top">
            <div>
              <span className="eyebrow eyebrow--light">Patrimônio disponível</span>
              <strong className="balance-card__value">{formatCurrency(availableBalance)}</strong>
              <span className="balance-card__period"><CalendarDays size={14} /> Consolidado · {formatMonthLabel(monthKey)}</span>
              {reservedBalance > 0 && <span className="balance-card__reserved"><PiggyBank size={13} /> Guardado e investido: <strong>{formatCurrency(reservedBalance)}</strong></span>}
            </div>
            <span className="balance-card__badge"><ShieldCheck size={14} /> Dados protegidos</span>
          </div>
          <div className="balance-card__bottom">
            <div className="balance-card__trend"><TrendingUp size={15} /> 8,4% <span>vs. mês anterior</span></div>
            <div className="mini-chart" aria-hidden="true">
              <span style={{ height: '35%' }} /><span style={{ height: '48%' }} /><span style={{ height: '42%' }} /><span style={{ height: '63%' }} /><span style={{ height: '55%' }} /><span style={{ height: '76%' }} /><span style={{ height: '90%' }} />
            </div>
          </div>
        </article>
        <div className="stat-stack">
          <StatCard label="Receitas do mês" value={formatCurrency(income)} helper="+12,8% vs. mês anterior" trend icon={ArrowDownRight} tone="green" />
          <StatCard label="Despesas do mês" value={formatCurrency(expenses)} helper={budgetHelper} icon={ArrowUpRight} tone="orange" />
        </div>
        <article className="savings-card">
          <div className="savings-card__heading"><span className="eyebrow">Taxa de poupança</span><span className="savings-card__icon"><PiggyBank size={18} /></span></div>
          <strong>{savingsRate}%</strong>
          <div className="progress-track"><span style={{ width: `${Math.min(savingsRate, 100)}%` }} /></div>
          <p>Você está guardando mais este mês.</p>
          {yields > 0 && <p className="savings-card__yield"><Sparkles size={13} /> Rendimentos e Caixinha: {formatCurrency(yields)} <small>fora das receitas</small></p>}
          <button className="text-button" onClick={() => onNavigate('budgets')}>Ver orçamentos <ChevronRight size={14} /></button>
        </article>
      </section>

      <section className="quick-import">
        <div className="quick-import__icon"><ScanLine size={21} /></div>
        <div className="quick-import__copy"><strong>Atualize seus gastos automaticamente</strong><span>Envie um extrato e revise os lançamentos em poucos cliques.</span></div>
        <button className="button button--soft" onClick={onImportDemo}>Testar com dados fictícios <ChevronRight size={16} /></button>
      </section>

      <DueRemindersPanel reminders={reminders} onNavigate={onNavigate} />

      <section className="dashboard-grid">
        <article className="panel accounts-panel">
          <div className="panel-heading"><div><span className="eyebrow">Suas contas</span><h2>Resumo de contas</h2></div><button className="icon-button" onClick={() => onNavigate('accounts')} aria-label="Ver todas as contas"><ChevronRight size={18} /></button></div>
          <div className="account-list">
            {accounts.slice(0, 3).map((account) => <AccountRow key={account.id} account={account} />)}
          </div>
          <button className="panel-link" onClick={() => onNavigate('accounts')}>Gerenciar contas <ArrowUpRight size={15} /></button>
        </article>

        <article className="panel spending-panel">
          <div className="panel-heading"><div><span className="eyebrow">Previsto x realizado</span><h2>Gastos por categoria</h2></div><button className="icon-button"><MoreHorizontal size={18} /></button></div>
          <div className="spending-chart-row">
            <div className="donut-stack">
              <div className={classNames('donut-ring', isOverBudget && 'donut-ring--over')} style={{ background: usageRingBackground }} title={`Realizado ${Math.round(budgetUsage)}% do previsto`} />
              <div className="donut-chart" style={{ background: chartBackground }}><div className="donut-chart__center"><strong>{formatCurrency(expenses, true)}</strong><span>gastos</span>{totalPlannedBudget > 0 && <em className={isOverBudget ? 'text-red' : ''}>{Math.round(budgetUsage)}% do previsto</em>}</div></div>
            </div>
            <div className="chart-legend">
              {legendEntries.map(([category, value]) => {
                const planned = plannedByCategory[category] ?? 0
                return (
                  <div className="legend-row" key={category}>
                    <span className="legend-row__label"><i style={{ background: categoryMeta[category]?.color }} />{category}</span>
                    <span className="legend-row__values">
                      <strong>{formatCurrency(value, true)}</strong>
                      {planned > 0 && <small>prev. {formatCurrency(planned, true)}</small>}
                    </span>
                  </div>
                )
              })}
              {!legendEntries.length && <span className="muted-text">Nenhum gasto neste período.</span>}
              {totalPlannedBudget > 0 && (
                <div className="legend-summary">
                  <div className="legend-summary__row"><span>Previsto</span><strong>{formatCurrency(totalPlannedBudget, true)}</strong></div>
                  <div className="legend-summary__row"><span>Realizado</span><strong className={isOverBudget ? 'text-red' : ''}>{formatCurrency(expenses, true)}</strong></div>
                  <div className={classNames('legend-total', isOverBudget && 'legend-total--over')}><span>{isOverBudget ? 'Acima do previsto' : 'Disponível'}</span><strong>{formatCurrency(Math.abs(totalPlannedBudget - expenses), true)}</strong></div>
                </div>
              )}
            </div>
          </div>
        </article>
      </section>

      <section className="panel recent-panel">
        <div className="panel-heading"><div><span className="eyebrow">Movimentações</span><h2>Transações recentes</h2></div><button className="text-button" onClick={() => onNavigate('transactions')}>Ver todas <ChevronRight size={14} /></button></div>
        <TransactionTable transactions={transactions.slice(0, 5)} accounts={accounts} compact />
      </section>
    </div>
  )
}

function NotificationBell({ reminders, open, onToggle, onNavigate }) {
  const urgent = reminders.filter((reminder) => reminder.status.days <= 1).length
  const total = reminders.reduce((sum, reminder) => sum + (reminder.totalAmount ?? reminder.amount), 0)

  return (
    <div className="bell-wrap">
      <button className={classNames('topbar-icon-button', open && 'topbar-icon-button--open')} onClick={onToggle} aria-label="Notificações" aria-expanded={open}>
        <Bell size={18} />
        {urgent > 0 && <i />}
      </button>
      {open && (
        <>
          <div className="bell-backdrop" onClick={onToggle} />
          <div className="bell-pop">
            <div className="bell-pop__head">
              <div><span className="eyebrow">Notificações</span><strong>Vencimentos</strong></div>
              <button className="icon-button icon-button--subtle" onClick={onToggle} aria-label="Fechar"><X size={16} /></button>
            </div>
            {reminders.length ? (
              <>
                <div className="bell-pop__list">
                  {reminders.slice(0, 6).map((reminder) => <DueReminderRow key={reminder.id} reminder={reminder} />)}
                </div>
                <div className="bell-pop__foot">
                  <span>{formatCurrency(total)} nos próximos 10 dias</span>
                  <button className="text-button" onClick={() => onNavigate('bills')}>Ver boletos <ChevronRight size={14} /></button>
                </div>
              </>
            ) : (
              <p className="bell-pop__empty">Nenhum vencimento nos próximos 10 dias.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function DueRemindersPanel({ reminders, onNavigate }) {
  if (!reminders.length) return null
  const overdue = reminders.filter((reminder) => reminder.status.days < 0)
  const upcoming = reminders.filter((reminder) => reminder.status.days >= 0)
  const totalAmount = reminders.reduce((sum, reminder) => sum + (reminder.totalAmount ?? reminder.amount), 0)

  return (
    <section className={classNames('panel due-panel', overdue.length > 0 && 'due-panel--alert')}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Alerta de vencimento</span>
          <h2>{overdue.length ? `${overdue.length} ${overdue.length === 1 ? 'conta vencida' : 'contas vencidas'}` : 'Próximos vencimentos'}</h2>
        </div>
        <div className="due-panel__aside">
          <span>{formatCurrency(totalAmount)} nos próximos 10 dias</span>
          <button className="text-button" onClick={() => onNavigate('bills')}>Ver boletos <ChevronRight size={14} /></button>
        </div>
      </div>
      <div className="due-list">
        {overdue.map((reminder) => <DueReminderRow key={reminder.id} reminder={reminder} />)}
        {upcoming.map((reminder) => <DueReminderRow key={reminder.id} reminder={reminder} />)}
      </div>
    </section>
  )
}

function DueReminderRow({ reminder }) {
  return (
    <div className={classNames('due-item', `due-item--${reminder.status.level}`)}>
      <CategoryIcon category={reminder.category} size={16} />
      <div className="due-item__info"><strong>{reminder.label}</strong><span>{reminder.category} · {formatDate(reminder.dueDate)}</span></div>
      <strong className="due-item__amount">{formatCurrency(reminder.amount)}{reminder.count > 1 && <span className="due-item__count">duplicado</span>}</strong>
      <span className={classNames('due-chip', `due-chip--${reminder.status.level}`)}><Bell size={12} /> {reminder.status.label}</span>
    </div>
  )
}

function AccountRow({ account }) {
  return (
    <div className="account-row">
      <AccountLogo institution={account.institution} />
      <div className="account-row__info"><strong>{account.name}</strong><span>{account.institution} · {account.type}</span></div>
      <div className="account-row__balance"><strong className={account.balance < 0 ? 'negative' : ''}>{formatCurrency(account.balance)}</strong><span>{account.lastUpdated}</span></div>
      <button className="icon-button icon-button--subtle" aria-label={`Opções de ${account.name}`}><MoreHorizontal size={17} /></button>
    </div>
  )
}

function TransactionTable({ transactions, accounts, compact = false, onCategoryChange, onIgnore, onSplit, selected = [], onToggle }) {
  const accountMap = Object.fromEntries(accounts.map((account) => [account.id, account]))
  if (!transactions.length) return <EmptyState icon={Receipt} title="Nenhuma movimentação" description="Quando você importar um extrato, os lançamentos aparecerão aqui." />

  return (
    <div className={classNames('table-wrap', compact && 'table-wrap--compact')}>
      <table className="transaction-table">
        <thead><tr>{onToggle && <th className="select-cell" aria-label="Selecionar" />}<th>Transação</th><th>Categoria</th><th>Conta</th><th>Data</th><th className="align-right">Valor</th>{!compact && <th aria-label="Ações" />}</tr></thead>
        <tbody>
          {transactions.map((transaction) => {
            const account = accountMap[transaction.accountId]
            const isNegative = transaction.type === 'expense' || transaction.type === 'transfer'
            const allocations = getTransactionAllocations(transaction)
            const isSplit = allocations.length > 1
            const displayCategory = isSplit ? allocations[0].category : transaction.category
            return (
              <tr key={transaction.id} className={classNames(transaction.status === 'ignored' && 'is-ignored', onToggle && selected.includes(transaction.id) && 'is-selected')}>
                {onToggle && <td className="select-cell"><input type="checkbox" checked={selected.includes(transaction.id)} onChange={() => onToggle(transaction.id)} aria-label={`Selecionar ${transaction.description}`} /></td>}
                <td><div className="transaction-cell"><CategoryIcon category={displayCategory} /><div><strong>{transaction.merchant || transaction.description}</strong><span>{isSplit ? `Desdobrado em ${allocations.length} categorias` : transaction.description !== transaction.merchant ? transaction.description : transaction.institution}</span></div></div></td>
                <td>{onCategoryChange ? <select className="inline-select" value={transaction.category} onChange={(event) => onCategoryChange(transaction.id, event.target.value)}>{categoryOptions.map((category) => <option key={category}>{category}</option>)}</select> : isSplit ? <span className="split-pill"><SlidersHorizontal size={12} /> Desdobrado</span> : <CategoryPill category={transaction.category} />}</td>
                <td><span className="account-cell"><AccountLogo institution={account?.institution ?? transaction.institution} size="small" />{account?.name ?? 'Conta removida'}</span></td>
                <td><span className="date-cell">{formatDate(transaction.date)}</span></td>
                <td className={classNames('align-right', 'amount-cell', isNegative ? 'amount-cell--negative' : 'amount-cell--positive')}>{isNegative ? '−' : '+'} {formatCurrency(transaction.amount)}</td>
                {!compact && <td className="align-right"><div className="transaction-actions">{transaction.type === 'expense' && <button className="icon-button icon-button--subtle" onClick={() => onSplit?.(transaction)} aria-label="Desdobrar transação"><SlidersHorizontal size={16} /></button>}<button className="icon-button icon-button--subtle" onClick={() => onIgnore?.(transaction.id)} aria-label="Remover lançamento"><MoreHorizontal size={17} /></button></div></td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function AccountsPage({ accounts, transactions, onAdd, onEdit, onImport }) {
  const positiveBalance = accounts.filter((account) => account.balance >= 0).reduce((sum, account) => sum + account.balance, 0)
  const debt = accounts.filter((account) => account.balance < 0).reduce((sum, account) => sum + Math.abs(account.balance), 0)

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div><span className="eyebrow">Organização</span><h1>Suas contas</h1><p>Centralize os saldos e produtos que fazem parte da sua vida financeira.</p></div>
        <button className="button button--primary" onClick={onAdd}><Plus size={17} /> Adicionar conta</button>
      </section>
      <section className="account-summary-grid">
        <div className="summary-tile"><span className="eyebrow">Saldo consolidado</span><strong>{formatCurrency(positiveBalance - debt)}</strong><span className="summary-tile__hint"><TrendingUp size={14} /> 8,4% este mês</span></div>
        <div className="summary-tile"><span className="eyebrow">Contas ativas</span><strong>{accounts.length}</strong><span className="summary-tile__hint">Em {new Set(accounts.map((account) => account.institution)).size} instituições</span></div>
        <div className="summary-tile"><span className="eyebrow">Limite em uso</span><strong>{formatCurrency(debt)}</strong><span className="summary-tile__hint summary-tile__hint--muted">Cartões e limites</span></div>
      </section>
      <section className="panel accounts-management-panel">
        <div className="panel-heading"><div><span className="eyebrow">Portfólio</span><h2>Contas e produtos</h2></div><button className="button button--soft" onClick={onImport}><Upload size={15} /> Importar extrato</button></div>
        <div className="account-card-grid">
          {accounts.map((account) => <AccountCard key={account.id} account={account} onEdit={() => onEdit(account)} />)}
          <button className="add-account-card" onClick={onAdd}><span><Plus size={21} /></span><strong>Adicionar nova conta</strong><small>Conecte outro produto ou instituição</small></button>
        </div>
      </section>
    </div>
  )
}

function AccountCard({ account, onEdit }) {
  const isCard = account.type === 'Cartão de crédito'
  const usage = isCard && account.limit ? Math.min(100, (Math.abs(account.balance) / account.limit) * 100) : null
  return (
    <article className="account-card">
      <div className="account-card__top"><AccountLogo institution={account.institution} /><button className="icon-button icon-button--subtle" onClick={onEdit} aria-label={`Editar ${account.name}`}><Settings size={17} /></button></div>
      <span className="account-card__type">{account.type}</span>
      <strong className={classNames('account-card__balance', account.balance < 0 && 'negative')}>{formatCurrency(account.balance)}</strong>
      {isCard ? <><span className="account-card__label">Fatura atual</span><div className="progress-track progress-track--thin"><span style={{ width: `${usage}%` }} /></div><span className="account-card__limit">Limite de {formatCurrency(account.limit)}</span></> : <span className="account-card__updated"><RefreshCw size={13} /> Atualizado {account.lastUpdated.toLowerCase()}</span>}
      <div className="account-card__footer"><span><AccountLogo institution={account.institution} size="small" /> {account.institution}</span><button className="text-button" onClick={onEdit}>Editar <ChevronRight size={14} /></button></div>
    </article>
  )
}

function ReconciliationPanel({ reconciliation }) {
  if (!reconciliation) return null

  const { matches, difference } = reconciliation

  return (
    <div className={classNames('reconcile', matches ? 'reconcile--ok' : 'reconcile--warn')}>
      <div className="reconcile__head">
        <span className="reconcile__icon">{matches ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}</span>
        <div>
          <strong>Conferência de saldo do extrato</strong>
          <span>
            {reconciliation.periodStart && reconciliation.periodEnd
              ? `Período ${formatDateLong(reconciliation.periodStart)} a ${formatDateLong(reconciliation.periodEnd)}`
              : 'Período do extrato'}
          </span>
        </div>
      </div>

      <div className="reconcile__grid">
        <div><span>Saldo inicial</span><strong>{formatCurrency(reconciliation.openingBalance)}</strong></div>
        <div><span>Movimentações</span><strong>{formatCurrency(reconciliation.movement)}</strong></div>
        <div><span>Saldo esperado</span><strong>{formatCurrency(reconciliation.expected)}</strong></div>
        <div><span>Saldo no extrato</span><strong>{formatCurrency(reconciliation.closingBalance)}</strong></div>
      </div>

      <p className="reconcile__note">
        {matches
          ? 'A soma das movimentações leva exatamente do saldo inicial ao saldo que o banco imprime. Nenhuma linha ficou de fora.'
          : `A soma das movimentações não chega ao saldo do extrato. Diferença de ${formatCurrency(Math.abs(difference))}. Revise as linhas antes de confirmar.`}
      </p>
    </div>
  )
}

function OutlookImportCard({ configured, account, status, message, candidates, busy, onConnect, onSync, onOpen, onProcess }) {
  const [passwords, setPasswords] = useState({})
  if (!configured) return null

  const busyNow = status === 'syncing' || status === 'connecting'

  return (
    <section className="panel outlook-import-card">
      <div className="outlook-import-card__icon"><Mail size={20} /></div>
      <div className="outlook-import-card__copy">
        <h2>Buscar extrato no Outlook</h2>
        <p>Os PDFs de extrato que chegaram no seu e-mail aparecem aqui, prontos para importar.</p>
      </div>

      {!account ? (
        <button className="button button--soft" onClick={onConnect} disabled={busyNow}>
          {busyNow ? <><Loader2 className="spin" size={15} /> Conectando...</> : <><Link2 size={15} /> Conectar Outlook</>}
        </button>
      ) : (
        <button className="button button--soft" onClick={onSync} disabled={busyNow}>
          {busyNow ? <><Loader2 className="spin" size={15} /> Lendo...</> : <><RefreshCw size={15} /> Buscar no e-mail</>}
        </button>
      )}

      {status === 'error' && <span className="outlook-error">{message}</span>}
      {account && !candidates.length && <span className="outlook-import-card__note">{message || 'Nenhum PDF de extrato encontrado. Rode a busca novamente se acabara de receber.'}</span>}

      {candidates.length > 0 && (
        <div className="outlook-import-list">
          {candidates.map((candidate) => {
            const password = passwords[candidate.id] ?? ''
            const working = busy === candidate.id

            return (
              <div className="outlook-import-item" key={candidate.id}>
                <span className="outlook-import-item__icon"><FileText size={16} /></span>
                <div className="outlook-import-item__text">
                  <strong>{candidate.subject}</strong>
                  <span>{candidate.sender} · {formatDate(candidate.receivedAt)}</span>
                </div>

                {candidate.requiresPassword ? (
                  <div className="candidate-password">
                    <input type="password" value={password} onChange={(event) => setPasswords((current) => ({ ...current, [candidate.id]: event.target.value }))} placeholder="Senha do PDF" />
                    <button className="button button--soft" onClick={() => onProcess(candidate, password)} disabled={working || !password}>{working ? <Loader2 className="spin" size={14} /> : <Check size={14} />} Processar</button>
                  </div>
                ) : (
                  <button className="button button--soft" onClick={() => onOpen(candidate)} disabled={working}>
                    <Upload size={14} /> Importar
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ImportPage({ accounts, form, onFormChange, file, onFile, status, rows, warning, password, onPasswordChange, requiresPassword, onParse, onDemo, onReset, onUpdateRow, onSplit, onConfirm, onNavigate, reconciliation, outlook }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const availableAccounts = accounts.filter((account) => account.institution === form.institution)
  const readyRows = rows.filter((row) => row.status !== 'duplicate' && row.status !== 'ignored')
  const duplicateRows = rows.filter((row) => row.status === 'duplicate')

  const chooseFile = (nextFile) => {
    if (nextFile) onFile(nextFile)
  }

  if (status === 'success') {
    return (
      <div className="page-stack">
        <section className="success-panel">
          <div className="success-panel__icon"><CheckCircle2 size={34} /></div>
          <span className="eyebrow">Importação concluída</span>
          <h1>Tudo certo por aqui!</h1>
          <p>Seus lançamentos foram normalizados e já aparecem no seu painel. Você pode revisá-los quando quiser.</p>
          <div className="success-panel__actions"><button className="button button--primary" onClick={() => onNavigate('dashboard')}>Ver dashboard <ArrowUpRight size={16} /></button><button className="button button--ghost" onClick={onReset}>Importar outro arquivo</button></div>
        </section>
      </div>
    )
  }

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div><span className="eyebrow">Importação manual</span><h1>Importar extrato</h1><p>Envie um arquivo do seu banco e transforme movimentações em uma visão clara.</p></div>
        <div className="import-security-note"><LockKeyhole size={15} /><span>Você não precisa compartilhar senhas</span></div>
      </section>

      <div className="stepper"><Step number="1" label="Selecionar arquivo" active={status === 'idle' || status === 'parsing' || status === 'error'} done={status === 'review'} /><span /><Step number="2" label="Revisar lançamentos" active={status === 'review'} done={false} /><span /><Step number="3" label="Concluir" active={false} done={status === 'success'} /></div>

      {status !== 'review' ? (
        <>
          {outlook && status !== 'parsing' && <OutlookImportCard {...outlook} />}
          <section className="import-layout">
          <article className="panel import-card">
            <div className="import-card__heading"><div className="import-card__heading-icon"><Upload size={20} /></div><div><h2>Envie seu extrato</h2><p>Suportamos PDF, CSV e XLSX de até 10 MB.</p></div></div>
            <div className="form-grid form-grid--two">
              <label className="field"><span>Instituição</span><span className="select-wrap"><select value={form.institution} onChange={(event) => onFormChange({ institution: event.target.value })}><option>Nubank</option><option>Bradesco</option><option>PicPay</option></select><ChevronDown size={15} /></span></label>
              <label className="field"><span>Conta de destino</span><span className="select-wrap"><select value={form.accountId} onChange={(event) => onFormChange({ accountId: event.target.value })}>{availableAccounts.length ? availableAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>) : <option value="">Cadastre uma conta primeiro</option>}</select><ChevronDown size={15} /></span></label>
            </div>
            <div
              className={classNames('dropzone', dragging && 'dropzone--dragging', file && 'dropzone--selected')}
              onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files?.[0]) }}
              onClick={() => inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click() }}
            >
              <input ref={inputRef} type="file" accept=".csv,.xlsx,.pdf" onChange={(event) => chooseFile(event.target.files?.[0])} hidden />
              {file ? <><span className="dropzone__icon dropzone__icon--selected"><FileText size={23} /></span><strong>{file.name}</strong><span>{formatFileSize(file.size)} · pronto para analisar</span><small>Clique para escolher outro arquivo</small></> : <><span className="dropzone__icon"><Upload size={24} /></span><strong>Arraste seu extrato aqui</strong><span>ou clique para selecionar do computador</span><small>PDF, CSV ou XLSX · máximo 10 MB</small></>}
            </div>
            {warning && <div className="inline-alert inline-alert--warning"><AlertCircle size={17} /><span>{warning}</span></div>}
            {(file?.name?.toLowerCase().endsWith('.pdf') || requiresPassword) && <label className="field field--password"><span>Senha do PDF <small>(se houver)</small></span><span className="password-input"><LockKeyhole size={14} /><input type="password" value={password ?? ''} onChange={(event) => onPasswordChange(event.target.value)} placeholder="Informe somente se o PDF estiver protegido" autoComplete="off" /></span><small className="field-note">A senha será usada apenas nesta leitura e não será salva.</small></label>}
            <div className="import-card__actions"><button className="button button--primary" onClick={onParse} disabled={!file || status === 'parsing' || !form.accountId}>{status === 'parsing' ? <><Loader2 className="spin" size={16} /> Analisando...</> : <><ScanLine size={16} /> Analisar arquivo</>}</button><span className="form-hint"><ShieldCheck size={14} /> Processamento local neste protótipo</span></div>
          </article>

          <aside className="panel demo-panel">
            <div className="demo-panel__badge"><Sparkles size={16} /> Modo demonstração</div>
            <h2>Conheça o fluxo<br />sem usar dados reais</h2>
            <p>Escolha uma instituição para carregar um extrato fictício e ver como a classificação funciona.</p>
            <div className="demo-list">
              {Object.keys(demoRows).map((institution) => <button className="demo-row" key={institution} onClick={() => onDemo(institution)}><AccountLogo institution={institution} size="small" /><span><strong>{institution}</strong><small>{demoRows[institution].length} lançamentos de exemplo</small></span><ChevronRight size={16} /></button>)}
            </div>
            <div className="demo-panel__footer"><Info size={15} /> Depois será possível conectar seu banco com segurança.</div>
          </aside>
          </section>
        </>
      ) : (
        <section className="review-section">
          <div className="review-toolbar"><div><span className="eyebrow">Passo 2 de 3</span><h2>Revise os lançamentos</h2><p>Confira as sugestões antes de salvar. Você pode editar qualquer categoria.</p></div><button className="button button--ghost" onClick={onReset}><RefreshCw size={15} /> Trocar arquivo</button></div>
          <div className="review-stats"><div><strong>{rows.length}</strong><span>encontrados</span></div><div><strong className="text-green">{readyRows.length}</strong><span>prontos</span></div><div><strong className="text-orange">{duplicateRows.length}</strong><span>duplicados</span></div><div className="review-confidence"><Sparkles size={16} /><span>Classificação automática ativada</span></div></div>
          <ReconciliationPanel reconciliation={reconciliation} />
          <div className="panel review-panel"><div className="review-panel__head"><div><strong>{form.institution} · {accounts.find((account) => account.id === form.accountId)?.name}</strong><span>{file?.name}</span></div><span className="review-panel__secure"><ShieldCheck size={14} /> Arquivo protegido</span></div><ReviewTable rows={rows} onUpdateRow={onUpdateRow} onSplit={onSplit} /></div>
          <div className="review-actions"><span><Info size={15} /> Duplicados e transferências internas serão ignorados no consolidado.</span><button className="button button--primary" onClick={onConfirm} disabled={!readyRows.length}><Check size={17} /> Confirmar {readyRows.length} lançamentos</button></div>
        </section>
      )}
    </div>
  )
}

function Step({ number, label, active, done }) {
  return <div className={classNames('step', active && 'step--active', done && 'step--done')}><span>{done ? <Check size={14} /> : number}</span><strong>{label}</strong></div>
}

function ReviewTable({ rows, onUpdateRow, onSplit }) {
  return (
    <div className="table-wrap review-table-wrap">
      <table className="transaction-table review-table"><thead><tr><th>Data</th><th>Descrição original</th><th>Tipo</th><th>Categoria</th><th>Confiança</th><th className="align-right">Valor</th><th /></tr></thead>
        <tbody>{rows.map((row) => { const isSplit = row.allocations?.length > 1; return <tr key={row.id} className={row.status === 'duplicate' ? 'row-duplicate' : ''}><td><span className="date-cell">{formatDate(row.date)}</span></td><td><div className="review-description"><strong>{row.description}</strong><span>{isSplit ? `Desdobrado em ${row.allocations.length} categorias` : `${row.institution} · conta vinculada`}</span></div></td><td><TypeBadge type={row.type} /></td><td>{isSplit ? <span className="split-pill"><SlidersHorizontal size={12} /> Desdobrado</span> : <select className="inline-select" value={row.category} onChange={(event) => onUpdateRow(row.id, { category: event.target.value })}>{categoryOptions.map((category) => <option key={category}>{category}</option>)}</select>}</td><td><span className={classNames('confidence', row.confidence < 0.85 && 'confidence--low')}><span className="confidence__bar"><i style={{ width: `${row.confidence * 100}%` }} /></span>{Math.round(row.confidence * 100)}%</span></td><td className={classNames('align-right', 'amount-cell', row.type === 'expense' ? 'amount-cell--negative' : 'amount-cell--positive')}>{row.type === 'expense' ? '−' : '+'} {formatCurrency(row.amount)}</td><td className="align-right">{row.status === 'duplicate' ? <span className="duplicate-label">Duplicado</span> : <div className="review-row-actions">{row.type === 'expense' && <button className="icon-button icon-button--subtle" onClick={() => onSplit(row)} aria-label="Desdobrar transação"><SlidersHorizontal size={16} /></button>}<CheckCircle2 className="row-check" size={17} /></div>}</td></tr> })}</tbody></table>
    </div>
  )
}

function TransactionModal({ open, onClose, onSave, accounts, bills, linkedBill }) {
  const emptyForm = { description: '', date: todayIsoDate(), amount: '', type: 'expense', category: 'Outros', accountId: accounts[0]?.id ?? '', billId: linkedBill?.id ?? '', transferToAccountId: '' }
  const [form, setForm] = useState(emptyForm)

  useEffect(() => {
    if (!open) return
    if (!linkedBill) {
      setForm(emptyForm)
      return
    }
    const share = Number(linkedBill.amount || 0) * Number(linkedBill.mySharePercent ?? 100) / 100
    setForm({
      description: linkedBill.description,
      date: linkedBill.dueDate || todayIsoDate(),
      amount: String(Number(share.toFixed(2))).replace('.', ','),
      type: 'expense',
      category: linkedBill.category || 'Outros',
      accountId: accounts[0]?.id ?? '',
      billId: linkedBill.id,
    })
  }, [accounts, linkedBill, open])

  if (!open) return null
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const pendingBills = bills.filter((bill) => !bill.matchedTransactionId)
  const submit = (event) => {
    event.preventDefault()
    if (!form.description.trim() || Number(String(form.amount).replace(',', '.')) <= 0 || !form.date) return
    if (form.type === 'transfer' && form.transferToAccountId === form.accountId) return
    onSave({ ...form, description: form.description.trim(), amount: Number(String(form.amount).replace(',', '.')) })
  }

  const isTransfer = form.type === 'transfer'
  const destinationOptions = accounts.filter((account) => account.id !== form.accountId)

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <form className="modal" onSubmit={submit}>
        <div className="modal__header"><div><span className="eyebrow">Lançamento manual</span><h2>{linkedBill ? 'Registrar pagamento' : 'Nova transação'}</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></div>
        <p className="modal__description">{linkedBill ? 'Confirmar o pagamento cria o lançamento, que passa a contar como realizado no orçamento, e concilia o boleto.' : 'O lançamento entra como realizado no orçamento. Se você vincular um boleto, ele é conciliado automaticamente.'}</p>{linkedBill && <div className="match-target"><div><span>Boleto</span><strong>{linkedBill.description}</strong></div><div><span>Valor total</span><strong>{formatCurrency(linkedBill.amount)}</strong></div><div><span>Sua parte</span><strong>{formatCurrency(Number(linkedBill.amount || 0) * Number(linkedBill.mySharePercent ?? 100) / 100)}</strong></div></div>}
        <label className="field"><span>Descrição</span><input autoFocus value={form.description} onChange={(event) => update('description', event.target.value)} placeholder="Ex.: Aluguel de outubro" required /></label>
        <div className="form-grid form-grid--two">
          <label className="field"><span>Valor</span><span className="input-prefix"><span>R$</span><input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => update('amount', event.target.value)} placeholder="0,00" required /></span></label>
          <label className="field"><span>Data</span><input type="date" value={form.date} onChange={(event) => update('date', event.target.value)} required /></label>
        </div>
        <div className="form-grid form-grid--two">
          <label className="field"><span>Tipo</span><span className="select-wrap"><select value={form.type} onChange={(event) => update('type', event.target.value)}><option value="expense">Despesa</option><option value="income">Receita</option><option value="transfer">Transferência</option></select><ChevronDown size={15} /></span></label>
          <label className="field"><span>Categoria</span><span className="select-wrap"><select value={form.category} onChange={(event) => update('category', event.target.value)}>{categoryOptions.map((category) => <option key={category}>{category}</option>)}</select><ChevronDown size={15} /></span></label>
        </div>
        <div className="form-grid form-grid--two">
          <label className="field"><span>Conta de origem</span><span className="select-wrap"><select value={form.accountId} onChange={(event) => update('accountId', event.target.value)}><option value="">Sem conta</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.institution} · {account.name}</option>)}</select><ChevronDown size={15} /></span></label>
          {isTransfer
            ? <label className="field"><span>Conta de destino</span><span className="select-wrap"><select value={form.transferToAccountId} onChange={(event) => update('transferToAccountId', event.target.value)}><option value="">Nenhuma (só registrar)</option>{destinationOptions.map((account) => <option key={account.id} value={account.id}>{account.institution} · {account.name}</option>)}</select><ChevronDown size={15} /></span></label>
            : <label className="field"><span>Vincular boleto</span><span className="select-wrap"><select value={form.billId} onChange={(event) => update('billId', event.target.value)}><option value="">Nenhum</option>{pendingBills.map((bill) => <option key={bill.id} value={bill.id}>{bill.description} · {formatDate(bill.dueDate)}</option>)}</select><ChevronDown size={15} /></span></label>}
        </div>
        {isTransfer && <div className="inline-alert inline-alert--warning"><ArrowLeftRight size={15} /><span>O dinheiro sai da conta de origem{form.transferToAccountId ? ' e entra na conta de destino' : ''}. Transferência não conta como despesa.</span></div>}
        <div className="modal__actions"><button type="button" className="button button--ghost" onClick={onClose}>Cancelar</button><button type="submit" className="button button--primary" disabled={isTransfer && form.transferToAccountId === form.accountId}><Check size={16} /> {linkedBill ? 'Registrar pagamento' : 'Salvar lançamento'}</button></div>
      </form>
    </div>
  )
}

function TransactionsPage({ transactions, accounts, search, onSearch, onImport, onExport, onIgnore, onSplit, onAdd, onDelete, onDeleteAll }) {
  const [categoryFilter, setCategoryFilter] = useState('Todas')
  const [typeFilter, setTypeFilter] = useState('Todos')
  const [accountFilter, setAccountFilter] = useState('Todas')
  const [rawSelection, setRawSelection] = useState([])
  const filtered = transactions.filter((transaction) => {
    const query = search.trim().toLowerCase()
    const matchesSearch = !query || `${transaction.description} ${transaction.merchant} ${transaction.institution}`.toLowerCase().includes(query)
    const matchesCategory = categoryFilter === 'Todas' || getTransactionAllocations(transaction).some((allocation) => allocation.category === categoryFilter)
    const matchesType = typeFilter === 'Todos' || transaction.type === typeFilter
    const matchesAccount = accountFilter === 'Todas' || transaction.accountId === accountFilter
    return matchesSearch && matchesCategory && matchesType && matchesAccount
  })
  // Seleção nunca sobrevive a uma mudança de filtro: evitar apagar algo que
  // não está mais visível na tela.
  const filteredIds = filtered.map((transaction) => transaction.id)
  const selection = rawSelection.filter((id) => filteredIds.includes(id))
  const allSelected = filteredIds.length > 0 && selection.length === filteredIds.length

  return (
    <div className="page-stack">
      <section className="page-heading"><div><span className="eyebrow">Movimentações consolidadas</span><h1>Transações</h1><p>Consulte, filtre e acompanhe todos os lançamentos das suas contas.</p></div><div className="heading-actions"><button className="button button--soft" onClick={onAdd}><Plus size={16} /> Nova transação</button><button className="button button--ghost" onClick={onExport}><Download size={16} /> Exportar</button><button className="button button--primary" onClick={onImport}><Upload size={16} /> Importar extrato</button></div></section>
      <section className="panel transactions-panel"><div className="filters-row"><div className="search-field search-field--wide"><Search size={16} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Buscar por descrição ou instituição" /></div><span className="select-wrap"><Filter size={15} /><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option>Todas</option>{categoryOptions.map((category) => <option key={category}>{category}</option>)}</select><ChevronDown size={14} /></span><span className="select-wrap"><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option>Todos</option><option value="income">Entradas</option><option value="expense">Saídas</option><option value="transfer">Transferências</option></select><ChevronDown size={14} /></span><span className="select-wrap"><select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}><option>Todas</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><ChevronDown size={14} /></span></div><div className="table-meta"><span><strong>{filtered.length}</strong> lançamentos encontrados</span><span className="table-meta__hint"><ShieldCheck size={14} /> Dados atualizados agora</span></div>{selection.length > 0 && <div className="bulk-bar"><span><strong>{selection.length}</strong> selecionado{selection.length === 1 ? '' : 's'}</span><button className="text-button" onClick={() => setRawSelection([])}>Limpar seleção</button><button className="button button--soft" onClick={() => onDelete(selection)}><Trash2 size={15} /> Apagar selecionados</button></div>}<div className="table-meta table-meta--bulk"><button type="button" className="text-button" onClick={() => setRawSelection(allSelected ? [] : filtered.map((transaction) => transaction.id))}>{allSelected ? 'Desmarcar todos' : 'Marcar todos os listados'}</button><button type="button" className="text-button text-button--danger" onClick={onDeleteAll} disabled={!transactions.length}>Apagar todos os lançamentos</button></div><TransactionTable transactions={filtered} accounts={accounts} onIgnore={onIgnore} onSplit={onSplit} selected={selection} onToggle={(id) => setRawSelection((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} /></section>
    </div>
  )
}

function SimulationPage({ simulation, savedSimulations, groups, budgets, budgetIncome, onChange, onCopyFrom, onSave, onLoad, onDuplicate, onDelete }) {
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const income = Number(simulation.monthlyIncome || 0) + Number(simulation.extraIncome || 0)
  const expenses = simulation.items.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const leftover = income - expenses
  const isNegative = leftover < 0
  const usage = income > 0 ? (expenses / income) * 100 : 0

  const availableMonths = [...new Set(budgets.flatMap((budget) => Object.keys(budget.plannedByMonth ?? {})))]
    .filter((monthKey) => budgets.some((budget) => Number(plannedBudgetAmount(budget, monthKey)) > 0))
    .sort()
    .reverse()

  const groupTotals = groups.map((group) => ({
    ...group,
    total: simulation.items.filter((item) => item.groupId === group.id).reduce((sum, item) => sum + Number(item.amount || 0), 0),
  }))

  const update = (id, patch) => onChange({ ...simulation, items: simulation.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) })
  const addItem = () => onChange({
    ...simulation,
    items: [...simulation.items, { id: `sim-${Date.now()}`, label: '', groupId: groups[0]?.id ?? 'essential', amount: '' }],
  })
  const removeItem = (id) => onChange({ ...simulation, items: simulation.items.filter((item) => item.id !== id) })
  const hasDraft = simulation.items.length > 0 || simulation.monthlyIncome !== '' || simulation.extraIncome !== ''

  const openSave = () => {
    const base = simulation.sourceMonth ? formatMonthLabel(simulation.sourceMonth) : 'Minha simulação'
    const suggestion = savedSimulations.some((item) => item.name === base) ? `${base} ${savedSimulations.length + 1}` : base
    setSaveName(suggestion)
    setSaveOpen(true)
  }

  const confirmSave = (event) => {
    event.preventDefault()
    const name = saveName.trim()
    if (!name) return
    onSave(name)
    setSaveOpen(false)
  }

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div>
          <span className="eyebrow">Simulação rápida</span>
          <h1>Simular orçamento</h1>
          <p>Altere os valores e veja na hora quanto sobra. Nada aqui altera o seu orçamento real.</p>
        </div>
        <div className="heading-actions">
          {availableMonths.length > 0 && (
            <span className="select-wrap sim-copy-select">
              <Copy size={14} />
              <select value={simulation.sourceMonth ?? ''} onChange={(event) => onCopyFrom(event.target.value)}>
                <option value="">Copiar valores de...</option>
                {availableMonths.map((monthKey) => <option key={monthKey} value={monthKey}>{formatMonthLabel(monthKey)}</option>)}
              </select>
              <ChevronDown size={14} />
            </span>
          )}
          <button className="button button--soft" onClick={openSave} disabled={!hasDraft}><Check size={15} /> Salvar simulação</button>
          {hasDraft && <button className="button button--ghost" onClick={() => onChange({ monthlyIncome: '', extraIncome: '', items: [], sourceMonth: '' })}><Trash2 size={15} /> Limpar</button>}
        </div>
      </section>

      {simulation.sourceMonth && <div className="inline-alert inline-alert--warning"><AlertCircle size={15} /><span>Valores copiados de <strong>{formatMonthLabel(simulation.sourceMonth)}</strong>. Edite o que quiser, o orçamento original não muda.</span></div>}

      <section className="sim-summary-grid">
        <article className="sim-card">
          <label className="field"><span>Receita mensal</span><span className="input-prefix"><span>R$</span><input type="number" min="0" step="0.01" value={simulation.monthlyIncome} onChange={(event) => onChange({ ...simulation, monthlyIncome: event.target.value })} placeholder="0,00" /></span></label>
          <label className="field"><span>Renda extra</span><span className="input-prefix"><span>R$</span><input type="number" min="0" step="0.01" value={simulation.extraIncome} onChange={(event) => onChange({ ...simulation, extraIncome: event.target.value })} placeholder="0,00" /></span></label>
          <div className="sim-card__total"><span>Total de receitas</span><strong>{formatCurrency(income)}</strong></div>
        </article>

        <article className={classNames('sim-card sim-card--result', isNegative ? 'sim-card--negative' : 'sim-card--positive')}>
          <span className="eyebrow">Sobra prevista</span>
          <strong className="sim-card__big">{formatCurrency(leftover)}</strong>
          <span className="sim-card__hint">{isNegative ? 'Falta cobrir as despesas' : 'Sobra depois de pagar tudo'}</span>
          {income > 0 && <div className="progress-track"><span style={{ width: `${Math.min(usage, 100)}%` }} /></div>}
          <span className="sim-card__hint">{income > 0 ? `${Math.round(usage)}% da receita comprometida` : 'Informe a receita para calcular'}</span>
        </article>
      </section>

      <section className="panel sim-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">Despesas previstas</span><h2>{simulation.items.length} {simulation.items.length === 1 ? 'item' : 'itens'} · {formatCurrency(expenses)}</h2></div>
          <button className="button button--soft" onClick={addItem}><Plus size={15} /> Adicionar linha</button>
        </div>
        {simulation.items.length ? (
          <div className="sim-list">
            {simulation.items.map((item) => (
              <div className="sim-row" key={item.id}>
                <input className="sim-row__label" value={item.label} onChange={(event) => update(item.id, { label: event.target.value })} placeholder="Nome do item" />
                <span className="select-wrap sim-row__group"><select value={item.groupId} onChange={(event) => update(item.id, { groupId: event.target.value })}>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><ChevronDown size={13} /></span>
                <span className="input-prefix sim-row__amount"><span>R$</span><input type="number" min="0" step="0.01" value={item.amount} onChange={(event) => update(item.id, { amount: event.target.value })} placeholder="0,00" /></span>
                <button className="icon-button icon-button--subtle" onClick={() => removeItem(item.id)} aria-label={`Remover ${item.label || 'item'}`}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={SlidersHorizontal} title="Nenhuma despesa na simulação" description="Copie os valores de um mês do orçamento ou adicione linhas para testar." />
        )}
      </section>

      {groupTotals.some((group) => group.total > 0) && (
        <section className="panel sim-panel">
          <div className="panel-heading"><div><span className="eyebrow">Por grupo</span><h2>Distribuição</h2></div></div>
          <div className="sim-groups">
            {groupTotals.filter((group) => group.total > 0).map((group) => (
              <div className="sim-group" key={group.id}>
                <div className="sim-group__label"><span className="budget-group-dot" style={{ background: group.color }} /><strong>{group.name}</strong><span>{income > 0 ? `${Math.round((group.total / income) * 100)}%` : '—'}</span></div>
                <div className="sim-group__bar"><span style={{ width: `${income > 0 ? Math.min((group.total / income) * 100, 100) : 0}%`, background: group.color }} /></div>
                <strong className="sim-group__value">{formatCurrency(group.total)}</strong>
              </div>
            ))}
          </div>
        </section>
      )}
    <section className="panel sim-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">Simulações salvas</span><h2>{savedSimulations.length ? `${savedSimulations.length} ${savedSimulations.length === 1 ? 'cenário' : 'cenários'}` : 'Nenhum cenário salvo'}</h2></div>
        </div>
        {savedSimulations.length ? (
          <div className="sim-saved-list">
            {savedSimulations.map((saved) => {
              const savedIncome = Number(saved.monthlyIncome || 0) + Number(saved.extraIncome || 0)
              const savedExpenses = saved.items.reduce((sum, item) => sum + Number(item.amount || 0), 0)
              const savedLeftover = savedIncome - savedExpenses
              return (
                <article className="sim-saved" key={saved.id}>
                  <div className="sim-saved__info">
                    <strong>{saved.name}</strong>
                    <span>{saved.items.length} itens · {formatDateTime(saved.updatedAt)}</span>
                  </div>
                  <div className="sim-saved__numbers">
                    <span>Receita<strong>{formatCurrency(savedIncome)}</strong></span>
                    <span>Despesas<strong>{formatCurrency(savedExpenses)}</strong></span>
                    <span className={savedLeftover < 0 ? 'text-red' : 'text-green'}>Sobra<strong>{formatCurrency(savedLeftover)}</strong></span>
                  </div>
                  <div className="sim-saved__actions">
                    <button className="icon-button icon-button--subtle" onClick={() => onLoad(saved)} aria-label={`Abrir ${saved.name}`}><Settings size={16} /></button>
                    <button className="icon-button icon-button--subtle" onClick={() => onDuplicate(saved)} aria-label={`Duplicar ${saved.name}`}><Copy size={16} /></button>
                    <button className="icon-button icon-button--subtle" onClick={() => onDelete(saved)} aria-label={`Excluir ${saved.name}`}><Trash2 size={16} /></button>
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <EmptyState icon={Sparkles} title="Nenhuma simulação salva" description="Monte o cenário, clique em Salvar simulação e volte depois para comparar outros cenários." />
        )}
      </section>

      {saveOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSaveOpen(false) }}>
          <form className="modal" onSubmit={confirmSave}>
            <div className="modal__header"><div><span className="eyebrow">Novo cenário</span><h2>Salvar simulação</h2></div><button type="button" className="icon-button" onClick={() => setSaveOpen(false)}><X size={18} /></button></div>
            <p className="modal__description">Dê um nome para comparar este cenário com outros depois.</p>
            <label className="field"><span>Nome do cenário</span><input autoFocus value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="Ex.: Corte no aluguel" required /></label>
            <div className="match-target"><div><span>Receitas</span><strong>{formatCurrency(income)}</strong></div><div><span>Despesas</span><strong>{formatCurrency(expenses)}</strong></div><div><span>Sobra</span><strong className={isNegative ? 'text-red' : 'text-green'}>{formatCurrency(leftover)}</strong></div></div>
            <div className="modal__actions"><button type="button" className="button button--ghost" onClick={() => setSaveOpen(false)}>Cancelar</button><button type="submit" className="button button--primary"><Check size={16} /> Salvar cenário</button></div>
          </form>
        </div>
      )}
    </div>
  )
}
function BudgetsPage({ budgets, groups, income, transactions, accounts, bills, onAdd, onEdit, onDelete, onUpdateGroup, onIncomeChange, onOpenCopy }) {
  const initialMonth = monthKeyFromDate(transactions[0]?.date) || monthKeyFromDate(new Date().toISOString())
  const [monthKey, setMonthKey] = useState(initialMonth)

  useEffect(() => {
    const latestMonth = monthKeyFromDate(transactions[0]?.date)
    if (latestMonth) setMonthKey(latestMonth)
  }, [transactions])

  const monthTransactions = useMemo(() => transactions.filter((transaction) => transaction.type === 'expense' && transaction.date.startsWith(monthKey)), [monthKey, transactions])
  const spendingByCategory = useMemo(() => monthTransactions.reduce((totals, transaction) => {
    getTransactionAllocations(transaction).forEach((allocation) => {
      totals[allocation.category] = (totals[allocation.category] ?? 0) + allocation.amount
    })
    return totals
  }, {}), [monthTransactions])
  const spendingByAccountCategory = useMemo(() => monthTransactions.reduce((totals, transaction) => {
    getTransactionAllocations(transaction).forEach((allocation) => {
      const key = `${transaction.accountId}::${allocation.category}`
      totals[key] = (totals[key] ?? 0) + allocation.amount
    })
    return totals
  }, {}), [monthTransactions])
  // Nível 1 e 2: conciliação com o boleto e palavra-chave do histórico.
  // Nível 3, abaixo: a sobra por categoria.
  const spentByBudgetId = useMemo(() => {
    const spent = {}

    for (const budget of budgets) {
      let total = 0
      for (const transaction of monthTransactions) {
        if (budget.accountId && transaction.accountId !== budget.accountId) continue
        const allocations = getTransactionAllocations(transaction)

        // Nível 0: o usuário dividiu a transação entre itens do orçamento.
        // Quando ele diz que o Pix pagou aluguel, água e luz, isso vale mais
        // que qualquer palpite por categoria.
        if (allocations.some((allocation) => allocation.budgetItemId === budget.id)) {
          total += allocations
            .filter((allocation) => allocation.budgetItemId === budget.id)
            .reduce((sum, allocation) => sum + allocation.amount, 0)
          continue
        }

        if (budget.billId && transaction.linkedBillId === budget.billId) {
          total += allocations
            .filter((allocation) => !allocation.budgetItemId)
            .reduce((sum, allocation) => sum + allocation.amount, 0)
          continue
        }

        const keywords = Array.isArray(budget.keywords) ? budget.keywords.filter(Boolean) : []
        if (!keywords.length) continue
        const text = normalizeText(`${transaction.description ?? ''} ${transaction.merchant ?? ''}`)
        total += allocations
          .filter((allocation) => allocation.category === budget.category && keywords.some((keyword) => text.includes(normalizeText(keyword))))
          .reduce((sum, allocation) => sum + allocation.amount, 0)
      }
      spent[budget.id] = total
    }

    // Boleto de banco não repete o nome do boleto no histórico, então o
    // casamento por palavra quase nunca pega. É por isso que existe o
    // desdobramento por item do orçamento: ele é a forma honesta de dizer
    // que um Pix pagou aluguel, água e luz de uma vez.
    //
    // Não existe redistribution de sobra aqui de propósito. Um corte de
    // cabelo na categoria Serviços não pertence ao IPTV, e nenhum palpite
    // automático resolve isso. O realizado do grupo vem do gasto real da
    // categoria, não da soma dos itens.
    return spent
  }, [budgets, monthTransactions])

  const getSpent = (budget) => spentByBudgetId[budget.id] ?? 0
  const groupData = groups.map((group) => {
    const items = budgets.filter((budget) => budget.groupId === group.id)
    const planned = items.reduce((sum, budget) => sum + plannedBudgetAmount(budget, monthKey), 0)

    // O realizado do grupo é o gasto real das categorias dele, uma vez por
    // categoria. Somar os itens obrigaria a despejar gasto sem dono em algum
    // item, e é isso que fazia o corte de cabelo aparecer no IPTV.
    const keys = [...new Set(items.map((budget) => budgetSpendKey(budget)))]
    const realized = keys.reduce((sum, key) => {
      const first = items.find((budget) => budgetSpendKey(budget) === key)
      const total = first.accountId
        ? (spendingByAccountCategory[`${first.accountId}::${first.category}`] ?? 0)
        : (spendingByCategory[first.category] ?? 0)
      return sum + total
    }, 0)

    const attributed = items.reduce((sum, budget) => sum + getSpent(budget), 0)

    return { ...group, items, planned, realized, attributed, difference: planned - realized }
  })
  const totalPlanned = groupData.reduce((sum, group) => sum + group.planned, 0)
  const totalRealized = groupData.reduce((sum, group) => sum + group.realized, 0)
  const totalDifference = totalPlanned - totalRealized
  const usage = totalPlanned ? (totalRealized / totalPlanned) * 100 : 0
  const monthlyIncome = Number(income?.monthly?.[monthKey] ?? 0)
  const extraIncome = Number(income?.extra?.[monthKey] ?? 0)
  const totalIncome = monthlyIncome + extraIncome
  const plannedResult = totalIncome - totalPlanned
  const realizedResult = totalIncome - totalRealized
  const billsById = useMemo(() => Object.fromEntries(bills.map((bill) => [bill.id, bill])), [bills])
  const monthReminders = useMemo(() => collectDueReminders({ bills, budgets, withinDays: 3650, today: new Date() })
    .filter((reminder) => monthKeyFromDate(reminder.dueDate) === monthKey), [bills, budgets, monthKey])
  const monthOverdue = monthReminders.filter((reminder) => reminder.status.days < 0)

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div><span className="eyebrow">Planejamento mensal</span><h1>Orçamentos</h1><p>Planeje seus gastos por grupo e compare o previsto com o realizado dos extratos.</p></div>
        <button className="button button--primary" onClick={() => onAdd(monthKey)}><Plus size={17} /> Novo item</button>
      </section>

      <div className="budget-month-switcher">
        <button className="icon-button" onClick={() => setMonthKey((current) => shiftMonth(current, -1))} aria-label="Mês anterior"><ChevronLeft size={18} /></button>
        <div><CalendarDays size={15} /><strong>{formatMonthLabel(monthKey)}</strong>{monthOverdue.length > 0 && <span className="budget-month-switcher__alert"><Bell size={12} /> {monthOverdue.length} vencido{monthOverdue.length === 1 ? '' : 's'}</span>}</div>
        <button className="icon-button" onClick={() => setMonthKey((current) => shiftMonth(current, 1))} aria-label="Próximo mês"><ChevronRight size={18} /></button>
        <button className="button button--ghost budget-copy-button" onClick={() => onOpenCopy(monthKey)}><Copy size={14} /> Copiar mês</button>
      </div>

      <section className="budget-summary-grid">
        <article className="budget-summary-card"><span className="eyebrow">Total planejado</span><strong>{formatCurrency(totalPlanned)}</strong><span className="budget-summary-card__hint"><PiggyBank size={14} /> {budgets.length} itens</span></article>
        <article className="budget-summary-card"><span className="eyebrow">Total realizado</span><strong>{formatCurrency(totalRealized)}</strong><span className="budget-summary-card__hint budget-summary-card__hint--orange"><ArrowUpRight size={14} /> {Math.round(usage)}% utilizado</span></article>
        <article className={classNames('budget-summary-card', totalDifference < 0 && 'budget-summary-card--danger')}><span className="eyebrow">Saldo do orçamento</span><strong>{formatCurrency(totalDifference)}</strong><span className={classNames('budget-summary-card__hint', totalDifference < 0 ? 'text-red' : 'text-green')}>{totalDifference < 0 ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />} {totalDifference < 0 ? 'Acima do planejado' : 'Dentro do planejado'}</span></article>
        <article className="budget-summary-card budget-summary-card--progress"><div className="budget-summary-card__top"><span className="eyebrow">Resultado realizado</span><span className="budget-summary-card__percent">{formatCurrency(realizedResult, true)}</span></div><div className="progress-track"><span style={{ width: `${Math.min(Math.max((realizedResult / Math.max(totalIncome, 1)) * 100, 0), 100)}%` }} /></div><span className="budget-summary-card__hint">Receitas + extra: {formatCurrency(totalIncome)}</span></article>
      </section>

      <section className="budget-groups-grid">
        {groupData.map((group) => <BudgetGroupCard key={group.id} group={group} totalPlanned={totalPlanned} totalIncome={totalIncome} onUpdateGroup={onUpdateGroup} />)}
      </section>

      <section className="panel budgets-panel">
        <div className="panel-heading"><div><span className="eyebrow">Itens planejados</span><h2>Previsto x realizado</h2></div><span className="budgets-panel__note"><Info size={14} /> Clique no item para editar o valor deste mês</span></div>
        {budgets.length ? <div className="budget-groups-list">{groupData.map((group) => group.items.length ? <div className="budget-group-section" key={group.id}><div className="budget-group-section__heading"><div><span className="budget-group-dot" style={{ background: group.color }} /><strong>{group.name}</strong><span>{group.target}% da meta</span></div><div><span>Planejado {formatCurrency(group.planned)}</span><span>Realizado {formatCurrency(group.realized)}</span></div></div><div className="budget-list">{group.items.map((budget) => <BudgetRow key={budget.id} budget={budget} planned={plannedBudgetAmount(budget, monthKey)} spent={getSpent(budget)} sharedCategory={!budget.keywords?.length && budgets.filter((item) => item.category === budget.category && item.accountId === budget.accountId).length > 1} accountName={budget.accountId ? accounts.find((account) => account.id === budget.accountId)?.name ?? 'Conta vinculada' : 'Todas as contas'} dueDate={plannedBudgetDueDate(budget, monthKey, billsById)} onEdit={() => onEdit(budget, monthKey)} onDelete={onDelete} />)}</div></div> : null)}</div> : <EmptyState icon={PiggyBank} title="Nenhum item criado" description="Crie categorias e valores planejados para comparar com seus extratos." action="Criar item" onAction={() => onAdd(monthKey)} />}
        <button className="budget-add-line" onClick={() => onAdd(monthKey)}><Plus size={15} /> Adicionar item ao orçamento</button>
      </section>

      <section className="panel budget-income-panel">
        <div className="budget-income-panel__heading"><div><span className="eyebrow">Entradas do mês</span><h2>Receitas e resultado</h2></div><div className="budget-income-result"><span>Resultado realizado</span><strong className={realizedResult < 0 ? 'text-red' : 'text-green'}>{formatCurrency(realizedResult)}</strong></div></div>
        <div className="budget-income-fields"><label className="field"><span>Receita mensal</span><span className="input-prefix"><span>R$</span><input type="number" min="0" step="0.01" value={income?.monthly?.[monthKey] ?? ''} onChange={(event) => onIncomeChange('monthly', monthKey, event.target.value)} placeholder="0,00" /></span></label><label className="field"><span>Renda extra</span><span className="input-prefix"><span>R$</span><input type="number" min="0" step="0.01" value={income?.extra?.[monthKey] ?? ''} onChange={(event) => onIncomeChange('extra', monthKey, event.target.value)} placeholder="0,00" /></span></label><div className="budget-income-summary"><span>Resultado planejado</span><strong className={plannedResult < 0 ? 'text-red' : 'text-green'}>{formatCurrency(plannedResult)}</strong></div></div>
      </section>
    </div>
  )
}

function BudgetGroupCard({ group, totalPlanned, totalIncome, onUpdateGroup }) {
  const base = Number(totalIncome) > 0 ? Number(totalIncome) : totalPlanned
  const targetAmount = base * (Number(group.target) / 100)
  const difference = group.planned - targetAmount
  const isAbove = difference > 0.5
  const isBelow = difference < -0.5
  return <article className={classNames('budget-group-card', isAbove && 'budget-group-card--over')} style={{ '--group-color': group.color, '--group-soft': group.soft }}><div className="budget-group-card__heading"><div className="budget-group-card__title"><span className="budget-group-dot" /><strong>{group.name}</strong></div><label className="budget-target-input"><span>meta</span><input type="number" min="0" max="100" value={group.target} onChange={(event) => onUpdateGroup(group.id, event.target.value)} /><b>%</b></label></div><div className="budget-group-card__values"><div><span>Planejado</span><strong>{formatCurrency(group.planned)}</strong></div><div><span>Realizado</span><strong>{formatCurrency(group.realized)}</strong></div><div><span>Saldo</span><strong className={group.difference < 0 ? 'text-red' : 'text-green'}>{formatCurrency(group.difference)}</strong></div></div><div className="budget-group-card__target"><span>Meta proporcional: {formatCurrency(targetAmount)}</span><span className={isAbove ? 'text-red' : 'text-green'}>{isAbove ? `${formatCurrency(difference)} acima da meta` : isBelow ? `${formatCurrency(Math.abs(difference))} abaixo da meta` : 'Na meta'}</span></div></article>
}

function BudgetRow({ budget, planned, spent, sharedCategory, accountName, dueDate, onEdit, onDelete }) {
  const difference = planned - spent
  const percentage = planned ? (spent / planned) * 100 : 0
  const isOver = difference < 0
  const isClose = percentage >= 80 && !isOver
  const due = dueStatus(dueDate)
  return (
    <div className={classNames('budget-row', isOver && 'budget-row--over')}>
      <div className="budget-row__identity"><CategoryIcon category={budget.category} size={18} /><div><strong>{budget.label}</strong><span>{budget.source === 'bill' ? 'Boleto importado · ' : ''}{budget.category} · {accountName}{sharedCategory ? ' · use palavras-chave' : ''}</span>{due && <span className={classNames('budget-row__due', `budget-row__due--${due.level}`)}><CalendarDays size={12} /> Vence {formatDate(dueDate)} · {due.label}</span>}</div></div>
      <div className="budget-row__progress"><div className="budget-row__labels"><span><strong>{formatCurrency(spent)}</strong> realizado</span><strong>{formatCurrency(planned)}</strong></div><div className="progress-track"><span style={{ width: `${Math.min(percentage, 100)}%` }} /></div></div>
      <div className={classNames('budget-row__remaining', isOver && 'text-red', isClose && 'text-orange')}>{isOver ? `${formatCurrency(Math.abs(difference))} acima` : `${formatCurrency(difference)} saldo`}</div>
      <div className="budget-row__actions"><button className="icon-button icon-button--subtle" onClick={onEdit} aria-label={`Editar ${budget.label}`}><Settings size={16} /></button><button className="icon-button icon-button--subtle" onClick={() => onDelete(budget.id)} aria-label={`Excluir ${budget.label}`}><Trash2 size={16} /></button></div>
    </div>
  )
}

function BillMatchModal({ open, bill, candidates, accounts, onClose, onLink, onUnlink }) {
  if (!open || !bill) return null
  const accountMap = Object.fromEntries(accounts.map((account) => [account.id, account]))
  const exact = candidates.filter((candidate) => candidate.difference <= 0.01)
  const divergent = candidates.filter((candidate) => candidate.difference > 0.01)

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="modal modal--wide">
        <div className="modal__header">
          <div><span className="eyebrow">Conciliação manual</span><h2>Vincular pagamento</h2></div>
          <button type="button" className="icon-button" onClick={onClose}><X size={18} /></button>
        </div>
        <p className="modal__description">Escolha a transação que quitou <strong>{bill.description}</strong>. O extrato não é alterado, apenas o boleto passa a constar como pago.</p>
        <div className="match-target"><div><span>Vencimento</span><strong>{formatDate(bill.dueDate)}</strong></div><div><span>Valor do boleto</span><strong>{formatCurrency(bill.amount)}</strong></div><div><span>Sua parte</span><strong>{formatCurrency(Number(bill.amount || 0) * Number(bill.mySharePercent ?? 100) / 100)}</strong></div></div>

        {bill.matchedTransactionId && <div className="inline-alert inline-alert--warning"><AlertCircle size={15} /><span>Este boleto já está vinculado a uma transação.</span></div>}

        {!candidates.length && <EmptyState icon={Link2} title="Nenhuma transação parecida" description="Nenhuma despesa no período tem valor ou descrição similar a este boleto." />}

        {exact.length > 0 && <div className="match-group"><span className="match-group__label">Valor idêntico</span>{exact.map((candidate) => <MatchCandidateRow key={candidate.transaction.id} candidate={candidate} accountName={accountMap[candidate.transaction.accountId]?.name ?? 'Conta'} onLink={() => onLink(candidate.transaction)} />)}</div>}
        {divergent.length > 0 && <div className="match-group"><span className="match-group__label">Valor diferente</span>{divergent.map((candidate) => <MatchCandidateRow key={candidate.transaction.id} candidate={candidate} accountName={accountMap[candidate.transaction.accountId]?.name ?? 'Conta'} onLink={() => onLink(candidate.transaction)} />)}</div>}

        <div className="modal__actions">
          {bill.matchedTransactionId && <button type="button" className="button button--ghost" onClick={() => onUnlink()}><X size={16} /> Desvincular</button>}
          <button type="button" className="button button--ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  )
}

function MatchCandidateRow({ candidate, accountName, onLink }) {
  const { transaction, difference, days } = candidate
  const isExact = difference <= 0.01
  return (
    <div className={classNames('match-row', isExact ? 'match-row--exact' : 'match-row--divergent')}>
      <CategoryIcon category={transaction.category} size={16} />
      <div className="match-row__info"><strong>{transaction.merchant || transaction.description}</strong><span>{formatDate(transaction.date)} · {accountName}{days !== null ? ` · ${Math.round(days)} dia(s) do vencimento` : ''}</span></div>
      <strong className="match-row__amount">{formatCurrency(candidate.amount)}</strong>
      {!isExact && <span className="match-row__difference">dif. {formatCurrency(difference)}</span>}
      <button className="button button--soft" onClick={onLink}><Link2 size={14} /> Vincular</button>
    </div>
  )
}

function BudgetModal({ open, onClose, onSave, budget, groups, accounts, monthKey, bills }) {
  const [form, setForm] = useState({ groupId: budget?.groupId ?? groups[0]?.id ?? 'essential', label: budget?.label ?? '', category: budget?.category ?? budgetCategoryOptions[0], accountId: budget?.accountId ?? '', amount: '', keywords: budget?.keywords?.join(', ') ?? '', dueDate: '' })
  const billsById = useMemo(() => Object.fromEntries((bills ?? []).map((bill) => [bill.id, bill])), [bills])
  const currentDueDate = plannedBudgetDueDate(budget, monthKey, billsById)
  useEffect(() => {
    if (open) setForm({ groupId: budget?.groupId ?? groups[0]?.id ?? 'essential', label: budget?.label ?? '', category: budget?.category ?? budgetCategoryOptions[0], accountId: budget?.accountId ?? '', amount: budget ? plannedBudgetAmount(budget, monthKey) : '', keywords: budget?.keywords?.join(', ') ?? '', dueDate: plannedBudgetDueDate(budget, monthKey, billsById) })
  }, [accounts, billsById, budget, groups, monthKey, open])
  if (!open) return null
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const submit = (event) => {
    event.preventDefault()
    if (!form.label.trim() || Number(form.amount) < 0) return
    const plannedByMonth = { ...(budget?.plannedByMonth ?? {}), [monthKey]: Number(form.amount) }
    const dueByMonth = { ...(budget?.dueByMonth ?? {}) }
    if (form.dueDate) dueByMonth[monthKey] = form.dueDate
    else delete dueByMonth[monthKey]
    onSave({
      ...form,
      label: form.label.trim(),
      keywords: form.keywords.split(',').map((keyword) => keyword.trim()).filter(Boolean),
      defaultAmount: Number(form.amount),
      plannedByMonth,
      dueByMonth,
      defaultDueDate: form.dueDate || budget?.defaultDueDate || '',
    })
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><form className="modal" onSubmit={submit}><div className="modal__header"><div><span className="eyebrow">Planejamento mensal</span><h2>{budget ? 'Editar item' : 'Novo item'}</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></div><p className="modal__description">O valor informado será o previsto para o mês selecionado. O realizado será calculado pelas transações importadas.</p><label className="field"><span>Grupo</span><span className="select-wrap"><select value={form.groupId} onChange={(event) => update('groupId', event.target.value)}>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><ChevronDown size={15} /></span></label><label className="field"><span>Nome do item</span><input autoFocus value={form.label} onChange={(event) => update('label', event.target.value)} placeholder="Ex.: Aluguel" required /></label><label className="field"><span>Categoria para classificar o realizado</span><span className="select-wrap"><select value={form.category} onChange={(event) => update('category', event.target.value)}>{budgetCategoryOptions.map((category) => <option key={category}>{category}</option>)}</select><ChevronDown size={15} /></span></label><label className="field"><span>Palavras-chave <small>(opcional, separa itens da mesma categoria)</small></span><input value={form.keywords} onChange={(event) => update('keywords', event.target.value)} placeholder="Ex.: aluguel, água, luz" /></label><label className="field"><span>Conta vinculada <small>(opcional)</small></span><span className="select-wrap"><select value={form.accountId} onChange={(event) => update('accountId', event.target.value)}><option value="">Todas as contas</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.institution} · {account.name}</option>)}</select><ChevronDown size={15} /></span></label><label className="field"><span>Valor planejado em {formatMonthLabel(monthKey)}</span><span className="input-prefix"><span>R$</span><input type="number" min="0" step="0.01" value={form.amount} onChange={(event) => update('amount', event.target.value)} placeholder="0,00" required /></span></label><label className="field"><span>Vencimento <small>(opcional, gera alerta de vencimento)</small></span><input type="date" value={form.dueDate} onChange={(event) => update('dueDate', event.target.value)} />{currentDueDate && <small className="field__hint">Vencimento atual: {formatDate(currentDueDate)}{budget?.billId ? ' · vem do boleto importado' : ''}</small>}</label><div className="modal__actions"><button type="button" className="button button--ghost" onClick={onClose}>Cancelar</button><button type="submit" className="button button--primary"><Check size={16} /> Salvar item</button></div></form></div>
}

function SplitTransactionModal({ open, item, onClose, onSave, onUpdatePlanned, budgets = [] }) {
  const [mode, setMode] = useState('item')
  const [remainderCategory, setRemainderCategory] = useState('')
  const [allocations, setAllocations] = useState([])
  const total = Number(item?.amount || 0)
  const allocated = allocations.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0)
  const remaining = Math.round((total - allocated) * 100) / 100
  const hasRemainder = Math.abs(remaining) > 0.01

  // Pagamento acima do orçado é normal: aumento de aluguel, taxa, correção.
  // Em vez de travar o salvamento, a diferença vira uma linha visível, com
  // categoria escolhidável, e o total sempre fecha.
  const closingAllocations = hasRemainder
    ? [...allocations, { id: '__remainder__', category: remainderCategory || item?.category || 'Outros', amount: remaining, isRemainder: true }]
    : allocations
  const itemMonthKey = monthKeyFromDate(item?.date) || todayIsoDate().slice(0, 7)

  // O que o orçamento planejou por categoria, no mês do lançamento. É o
  // ponto de partida, para ninguém redigitar a meta que acabou de definir.
  const plannedByCategory = useMemo(() => {
    const totals = {}
    for (const budget of budgets) {
      const amount = plannedBudgetAmount(budget, itemMonthKey)
      if (amount > 0) totals[budget.category] = (totals[budget.category] ?? 0) + amount
    }
    return totals
  }, [budgets, itemMonthKey])

  const budgeted = useMemo(() => Object.entries(plannedByCategory).sort((a, b) => b[1] - a[1]), [plannedByCategory])

  // Itens do orçamento do mês. Um Pix que paga aluguel, água e luz de uma vez
  // se divide aqui, e cada item passa a mostrar o que dele foi pago.
  const plannedItems = useMemo(() => budgets
    .map((budget) => ({ id: budget.id, label: budget.label, category: budget.category, amount: plannedBudgetAmount(budget, itemMonthKey) }))
    .filter((budget) => budget.amount > 0)
    .sort((a, b) => b.amount - a.amount), [budgets, itemMonthKey])

  const byId = useMemo(() => Object.fromEntries(plannedItems.map((budget) => [budget.id, budget])), [plannedItems])

  const fillFromBudget = () => setAllocations((current) => current.map((allocation) => {
    if (mode === 'item' && allocation.budgetItemId && byId[allocation.budgetItemId]) return { ...allocation, amount: byId[allocation.budgetItemId].amount }
    if (mode === 'category') return { ...allocation, amount: plannedByCategory[allocation.category] ?? allocation.amount }
    return allocation
  }))

  const applyPlannedItems = () => setAllocations(plannedItems.slice(0, 8).map((budget) => ({
    id: `allocation-${Date.now()}-${budget.id}`,
    budgetItemId: budget.id,
    category: budget.category,
    amount: budget.amount,
  })))

  // Quando o que foi pago é maior que o previsto, o culpado é o orçado, e não
  // o gasto. Este botão grava o valor real no item, para o mês não ficar
  // acusando "acima do planejado" para sempre.
  const diverging = allocations
    .filter((allocation) => allocation.budgetItemId && byId[allocation.budgetItemId])
    .map((allocation) => ({ id: allocation.budgetItemId, amount: Math.round(Number(allocation.amount || 0) * 100) / 100 }))
    .filter((pair) => Math.abs(byId[pair.id].amount - pair.amount) > 0.01)

  const updatePlanned = () => {
    onUpdatePlanned?.(itemMonthKey, diverging)
    setAllocations((current) => current.filter((allocation) => !allocation.budgetItemId))
  }

  useEffect(() => {
    if (!open || !item) return

    const saved = Array.isArray(item.allocations) && item.allocations.length ? item.allocations : null
    if (saved) {
      setMode(saved.some((allocation) => allocation.budgetItemId) ? 'item' : 'category')
      setAllocations(saved.map((allocation, index) => ({
        id: allocation.id ?? `allocation-${Date.now()}-${index}`,
        budgetItemId: allocation.budgetItemId ?? null,
        category: allocation.category,
        amount: Number(allocation.amount || 0),
      })))
      return
    }

    const suggested = budgeted.filter(([, amount]) => amount > 0)
    const seed = suggested.length
      ? suggested.map(([category, amount], index) => ({ id: `allocation-${Date.now()}-${index}`, budgetItemId: null, category, amount }))
      : [{ id: `allocation-${Date.now()}-0`, budgetItemId: null, category: item.category ?? budgetCategoryOptions[0], amount: total }]
    setAllocations(seed)
  }, [item, open, budgeted])

  if (!open || !item) return null
  const updateAllocation = (id, key, value) => setAllocations((current) => current.map((allocation) => allocation.id === id ? { ...allocation, [key]: value } : allocation))
  const addAllocation = () => {
    const used = new Set(allocations.map((allocation) => allocation.category))
    const next = budgeted.find(([category]) => !used.has(category))?.[0] ?? budgetCategoryOptions.find((category) => !used.has(category)) ?? budgetCategoryOptions[0]
    setAllocations((current) => [...current, { id: `allocation-${Date.now()}`, budgetItemId: null, category: next, amount: Math.max(remaining, 0) }])
  }
  const removeAllocation = (id) => setAllocations((current) => current.filter((allocation) => allocation.id !== id))
  const submit = (event) => {
    event.preventDefault()
    if (closingAllocations.length < 2) return
    // Preserva o vínculo com o item do orçamento: sem budgetItemId a divisão
    // é salva, mas o realizado do item não sabe de nada.
    onSave(closingAllocations.map(({ category, amount, budgetItemId }) => ({ category, amount: Number(amount) || 0, budgetItemId: budgetItemId ?? null })))
  }
  const isBalanced = !hasRemainder && allocations.length > 0

  // A diferença tem dois significados possíveis, e o app não tem como saber
  // qual é. Por item, o mais comum é item orçado que este Pix não quitou.
  // Por categoria, o mais comum é gasto fora do planejamento.
  const remainderLabel = mode === 'item'
    ? (remaining > 0 ? 'sobrou do Pix' : 'não pago neste Pix')
    : (remaining > 0 ? 'abaixo do orçado' : 'acima do orçado')

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><form className="modal split-modal" onSubmit={submit}><div className="modal__header"><div><span className="eyebrow">Gasto composto</span><h2>Desdobrar transação</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></div><p className="modal__description">Distribua o valor total entre as categorias. A transação original continuará aparecem uma única vez no extrato.</p><div className="split-total"><span>Valor total</span><strong>{formatCurrency(total)}</strong></div>{plannedItems.length > 0 && <div className="split-mode"><button type="button" className={classNames('split-mode__btn', mode === 'item' && 'split-mode__btn--on')} onClick={() => setMode('item')}><Target size={14} /> Por item do orçamento</button><button type="button" className={classNames('split-mode__btn', mode === 'category' && 'split-mode__btn--on')} onClick={() => setMode('category')}>Por categoria</button></div>}{mode === 'item' && plannedItems.length > 0 && <div className="split-hint">Um pagamento pode cobrir vários boletos. Marque quais ele quita e o valor de cada um, e o realizado cai no item certo.</div>}{mode === 'item' && <button type="button" className="split-budget-button" onClick={applyPlannedItems}><Target size={15} /> Trazer os itens de {formatMonthLabel(itemMonthKey)}</button>}{mode === 'item' && plannedItems.length > 0 && <div className="split-hint">O botão traz todos os itens orçados do mês. Apague os que este pagamento não quitou, senão a diferença entra como gasto na categoria escolhida.</div>}{mode === 'category' && <button type="button" className="split-budget-button" onClick={fillFromBudget}><Target size={15} /> Preencher com o que está orçado</button>}<div className="split-allocation-list">{closingAllocations.map((allocation, index) => <div className={classNames('split-allocation-row', allocation.isRemainder && 'split-allocation-row--remainder')} key={allocation.id}><span className="split-allocation-row__number">{allocation.isRemainder ? '·' : index + 1}</span>{mode === 'item' && !allocation.isRemainder ? <span className="select-wrap"><select value={allocation.budgetItemId ?? ''} onChange={(event) => { const picked = byId[event.target.value]; updateAllocation(allocation.id, 'budgetItemId', event.target.value); if (picked) updateAllocation(allocation.id, 'category', picked.category) }}><option value="">Escolher item...</option>{plannedItems.map((budget) => <option key={budget.id} value={budget.id}>{budget.label} · {formatCurrency(budget.amount)}</option>)}</select><ChevronDown size={14} /></span> : <span className="select-wrap"><select value={allocation.category} onChange={(event) => (allocation.isRemainder ? setRemainderCategory(event.target.value) : updateAllocation(allocation.id, 'category', event.target.value))}>{budgetCategoryOptions.map((category) => <option key={category}>{category}</option>)}</select><ChevronDown size={14} /></span>}<span className="input-prefix"><span>R$</span><input type="number" min="0" step="0.01" value={allocation.amount} readOnly={allocation.isRemainder} onChange={(event) => updateAllocation(allocation.id, 'amount', event.target.value)} /></span>{allocation.isRemainder ? <span className="split-planned-hint split-planned-hint--over">{remainderLabel}</span> : (() => { const planned = mode === 'category' ? plannedByCategory[allocation.category] : byId[allocation.budgetItemId]?.amount; if (planned === undefined) return <span className="split-planned-hint" />; const diff = Number(allocation.amount || 0) - planned; return <span className={classNames('split-planned-hint', diff > 0.01 && 'split-planned-hint--over')}>{diff > 0.01 ? `+${formatCurrency(diff)} acima` : `orçado ${formatCurrency(planned)}`}</span> })()}{!allocation.isRemainder && allocations.length > 1 && <button type="button" className="icon-button icon-button--subtle" onClick={() => removeAllocation(allocation.id)} aria-label="Remover distribuição"><Trash2 size={15} /></button>}</div>)}</div>{mode === 'item' && diverging.length > 0 && <div className="split-plan-fix"><span>O que você pagou é diferente do orçado em {diverging.length} item(ns). Isso é ajuste de planejamento, não gasto extra.</span><button type="button" className="button button--soft" onClick={updatePlanned}><RefreshCw size={14} /> Atualizar o orçado com o valor pago</button></div>}<button type="button" className="split-add-button" onClick={addAllocation} disabled={mode === 'item'}><Plus size={15} /> {mode === 'item' ? 'Use os itens do orçamento acima' : 'Adicionar categoria'}</button><div className={classNames('split-remaining', isBalanced ? 'split-remaining--ok' : 'split-remaining--warning')}><span>{isBalanced ? 'Valor distribuído corretamente' : mode === 'item' && remaining < 0 ? 'Os itens marcados somam mais que o pagamento. Apague os que este Pix não quitou.' : hasRemainder ? (remaining > 0 ? 'Falta distribuir. A diferença entra na última linha.' : 'A diferença entra na última linha, como gasto da categoria escolhida.') : 'Escolha os itens do orçamento'}</span><strong>{formatCurrency(Math.abs(remaining))}</strong></div><div className="modal__actions"><button type="button" className="button button--ghost" onClick={onClose}>Cancelar</button><button type="submit" className="button button--primary" disabled={closingAllocations.length < 2}><Check size={16} /> Salvar desdobramento</button></div></form></div>
}

function BillsPage({ bills, candidates, transactions, accounts, outlookAccount, outlookStatus, outlookMessage, configured, candidatePasswords, candidateBusy, duplicateCount, onRemoveDuplicates, onConnect, onDisconnect, onSync, onAdd, onEdit, onDelete, onMatch, onLaunch, onReopen, onSaveAll, onDiscardAll, onProcessCandidate, onCandidatePasswordChange, onReviewCandidate, onReviewManualBill, onDiscardCandidate, onImportStatement }) {
  const manualInputRef = useRef(null)
  const [manualFile, setManualFile] = useState(null)
  const [manualPassword, setManualPassword] = useState('')
  const [manualBusy, setManualBusy] = useState(false)
  const [manualStatus, setManualStatus] = useState('')
  const pendingBills = bills.filter((bill) => bill.status !== 'paid')
  const overdueBills = pendingBills.filter((bill) => bill.dueDate && bill.dueDate < todayIsoDate())
  const dueSoonBills = pendingBills.filter((bill) => { const days = daysUntilDate(bill.dueDate); return days !== null && days >= 0 && days <= 5 })
  const pendingTotal = pendingBills.reduce((sum, bill) => sum + Number(bill.amount || 0) * Number(bill.mySharePercent ?? 100) / 100, 0)
  const readyCandidates = candidates.filter((candidate) => !candidate.requiresPassword && candidate.documentType !== 'statement' && Number(candidate.amount) > 0 && Boolean(candidate.dueDate) && Boolean(candidate.description)).length
  const statusLabel = outlookStatus === 'syncing' ? 'Sincronizando' : outlookStatus === 'connecting' ? 'Conectando' : outlookAccount ? 'Conectado' : 'Desconectado'

  const analyzeManualBill = async (file, password = '') => {
    if (!file) return
    setManualBusy(true)
    setManualStatus('')
    const parsed = await parseBillPdf(file, password, file.name.replace(/\.pdf$/i, ''))
    setManualBusy(false)
    if (parsed.requiresPassword) {
      setManualFile(file)
      setManualStatus('protected')
      setManualPassword('')
      return
    }
    setManualFile(null)
    setManualPassword('')
    onReviewManualBill({ ...parsed, source: 'manual', attachmentName: file.name, description: parsed.description || file.name })
  }

  const chooseManualFile = (file) => {
    if (!file) return
    analyzeManualBill(file)
  }

  return <div className="page-stack">
    <section className="page-heading"><div><span className="eyebrow">Vencimentos e competência</span><h1>Boletos</h1><p>Receba do Outlook, organize por competência e acompanhe o que ainda está pendente. Ao salvar, o boleto entra como previsto no orçamento.</p></div><div className="heading-actions">{duplicateCount > 0 && <button className="button button--ghost" onClick={onRemoveDuplicates}><Trash2 size={16} /> Remover duplicados ({duplicateCount})</button>}<button className="button button--ghost" onClick={onAdd}><Plus size={16} /> Novo boleto</button>{outlookAccount && <button className="button button--primary" onClick={onSync} disabled={outlookStatus === 'syncing'}>{outlookStatus === 'syncing' ? <><Loader2 className="spin" size={16} /> Lendo...</> : <><RefreshCw size={16} /> Sincronizar Outlook</>}</button>}</div></section>

    {!configured && <section className="outlook-setup panel"><div className="outlook-setup__icon"><Mail size={21} /></div><div><h2>Conectar Outlook/Hotmail</h2><p>Para usar a sincronização, crie um aplicativo no Microsoft Entra e informe o Client ID no arquivo <code>.env</code>. Nenhuma senha de e-mail será solicitada.</p><code>VITE_AZURE_CLIENT_ID=seu-client-id</code></div><a className="text-button" href="https://entra.microsoft.com/" target="_blank" rel="noreferrer">Abrir Microsoft Entra <Link2 size={14} /></a></section>}

    {configured && !outlookAccount && <section className="outlook-connect panel"><div className="outlook-connect__icon"><Mail size={24} /></div><div><h2>Conectar sua conta Outlook</h2><p>O Real Total irá ler apenas e-mails e anexos. Não enviará, não apagará e não pagará nada.</p>{outlookStatus === 'error' && <span className="outlook-error">{outlookMessage}</span>}</div><button className="button button--primary" onClick={onConnect} disabled={outlookStatus === 'connecting'}>{outlookStatus === 'connecting' ? <><Loader2 className="spin" size={16} /> Conectando...</> : <><Link2 size={16} /> Conectar Outlook</>}</button></section>}

    {outlookAccount && <section className="outlook-status panel"><span className="outlook-status__dot" /><div><strong>Outlook conectado: {outlookAccount.name || outlookAccount.username}</strong><span>{outlookMessage || 'Use sincronizar para buscar PDFs de boleto recentes.'}</span></div><span className="status-chip">{statusLabel}</span><button className="text-button" onClick={onDisconnect}>Desconectar</button></section>}

    <section className="panel bills-manual-import"><div className="bills-manual-import__icon"><Upload size={20} /></div><div className="bills-manual-import__copy"><h2>Importar boleto em PDF</h2><p>Escolha um PDF baixado do Outlook. A senha, se houver, será usada somente nesta leitura.</p></div><input ref={manualInputRef} type="file" accept=".pdf" hidden onChange={(event) => chooseManualFile(event.target.files?.[0])} /><button className="button button--soft" onClick={() => manualInputRef.current?.click()} disabled={manualBusy}><Upload size={15} /> {manualBusy ? 'Analisando...' : 'Selecionar PDF'}</button>{manualFile && <div className="manual-bill-password"><span>{manualFile.name} · PDF protegido</span><div className="candidate-password"><input type="password" value={manualPassword} onChange={(event) => setManualPassword(event.target.value)} placeholder="Senha do PDF" /><button className="button button--primary" onClick={() => analyzeManualBill(manualFile, manualPassword)} disabled={!manualPassword || manualBusy}><Check size={14} /> Abrir</button></div></div>}{manualStatus && manualStatus !== 'protected' && <span className="manual-bill-status">{manualStatus}</span>}</section>

    <section className="bills-summary-grid"><article className="budget-summary-card"><span className="eyebrow">Pendentes</span><strong>{formatCurrency(pendingTotal)}</strong><span className="budget-summary-card__hint"><Receipt size={14} /> {pendingBills.length} boletos</span></article><article className="budget-summary-card"><span className="eyebrow">Vencidos</span><strong className={overdueBills.length ? 'text-red' : ''}>{overdueBills.length}</strong><span className="budget-summary-card__hint"><AlertCircle size={14} /> revisar pendências</span></article><article className="budget-summary-card"><span className="eyebrow">PDFs encontrados</span><strong>{candidates.length}</strong><span className="budget-summary-card__hint"><FileText size={14} /> aguardando revisão</span></article><article className="budget-summary-card"><span className="eyebrow">Competência</span><strong>{formatMonthLabel(monthKeyFromDate(bills[0]?.dueDate) || monthKeyFromDate(new Date().toISOString()))}</strong><span className="budget-summary-card__hint"><CalendarDays size={14} /> por vencimento</span></article></section>

    {candidates.length > 0 && <section className="panel bills-candidates"><div className="panel-heading"><div><span className="eyebrow">Sincronização do Outlook</span><h2>Documentos encontrados</h2></div><div className="bills-candidates__tools"><span className="budgets-panel__note"><ShieldCheck size={14} /> Revise antes de adicionar</span>{readyCandidates > 0 && <button className="button button--primary" onClick={onSaveAll}><Check size={15} /> Salvar {readyCandidates} completo{readyCandidates === 1 ? '' : 's'}</button>}<button className="button button--ghost" onClick={onDiscardAll} disabled={!candidates.length}><Trash2 size={15} /> Descartar todos</button></div></div><div className="bill-candidate-list">{candidates.map((candidate) => { const password = candidatePasswords[candidate.id] ?? ''; const ready = !candidate.requiresPassword && (candidate.amount || candidate.dueDate); const isStatement = candidate.documentType === 'statement'; return <div className="bill-candidate" key={candidate.id}><div className="bill-candidate__main"><span className="bill-candidate__icon"><FileText size={17} /></span><div><strong>{candidate.subject}</strong><span>{candidate.sender} · {formatDate(candidate.receivedAt)} · {candidate.attachmentName}</span></div></div><div className="bill-candidate__result">{candidate.requiresPassword ? <><span className="password-required"><LockKeyhole size={13} /> PDF protegido</span>{candidate.fileMissing ? <span className="candidate-note">Sincronize o Outlook novamente para abrir este PDF.</span> : <div className="candidate-password"><input type="password" value={password} onChange={(event) => onCandidatePasswordChange(candidate.id, event.target.value)} placeholder="Senha do PDF" /><button className="button button--soft" onClick={() => onProcessCandidate(candidate, password)} disabled={candidateBusy === candidate.id || !password}>{candidateBusy === candidate.id ? <Loader2 className="spin" size={14} /> : <Check size={14} />} Processar</button></div>}</> : isStatement ? <><span className="status-chip status-chip--success">Extrato bancário</span><div className="candidate-actions">{candidate.fileMissing ? <span className="candidate-note">Sincronize o Outlook novamente para importar o extrato.</span> : <button className="button button--soft" onClick={() => onImportStatement(candidate)}><Upload size={14} /> Importar extrato</button>}<button className="text-button text-button--muted" onClick={() => onDiscardCandidate(candidate.id)}><X size={14} /> Descartar</button></div></> : <>{candidate.isInvoice && <span className="status-chip">Fatura de cartão</span>}<span className={classNames('status-chip', ready ? 'status-chip--success' : 'status-chip--warning')}>{ready ? `${candidate.amount ? formatCurrency(candidate.amount) : ''}${candidate.amount && candidate.dueDate ? ' · ' : ''}${candidate.dueDate ? formatDate(candidate.dueDate) : 'sem vencimento'}` : 'Dados incompletos'}</span><div className="candidate-actions"><button className="button button--soft" onClick={() => onReviewCandidate(candidate)}><Check size={14} /> Revisar</button><button className="text-button text-button--muted" onClick={() => onDiscardCandidate(candidate.id)}><X size={14} /> Descartar</button></div></>}</div></div> })}</div></section>}

    {bills.length > 0 && <section className={classNames('panel due-summary', overdueBills.length > 0 && 'due-summary--alert')}><div className="due-summary__icon"><Bell size={19} /></div><div className="due-summary__copy"><strong>Alerta de vencimento</strong><span>{overdueBills.length ? `${overdueBills.length} boleto(s) vencido(s)` : 'Nenhum boleto vencido'}{dueSoonBills.length ? ` · ${dueSoonBills.length} vence(m) nos próximos 5 dias` : ''}</span></div><div className="due-summary__amount"><span>Total pendente</span><strong>{formatCurrency(pendingTotal)}</strong></div></section>}

    <section className="panel bills-list-panel"><div className="panel-heading"><div><span className="eyebrow">Controle por vencimento</span><h2>Boletos cadastrados</h2></div><span className="budgets-panel__note"><CalendarDays size={14} /> Competência = mês do vencimento</span></div>{bills.length ? <div className="table-wrap"><table className="transaction-table bills-table"><thead><tr><th>Vencimento</th><th>Boleto</th><th>Categoria</th><th>Competência</th><th className="align-right">Total</th><th className="align-right">Sua parte</th><th>Status</th><th /></tr></thead><tbody>{bills.map((bill) => <tr key={bill.id}><td><span className="date-cell">{formatDate(bill.dueDate)}</span></td><td><div className="review-description"><strong>{bill.description}</strong><span>{bill.source === 'outlook' ? `Outlook · ${bill.sender || 'Remetente'}` : 'Cadastro manual'}</span></div></td><td><CategoryPill category={bill.category} /></td><td><span className="date-cell">{formatMonthLabel(bill.competence || monthKeyFromDate(bill.dueDate))}</span></td><td className="align-right amount-cell">{formatCurrency(bill.amount)}</td><td className="align-right amount-cell amount-cell--positive">{formatCurrency(Number(bill.amount || 0) * Number(bill.mySharePercent ?? 100) / 100)}</td><td><span className={classNames('status-chip', bill.status === 'paid' || bill.matchedTransactionId ? 'status-chip--success' : new Date().toISOString().slice(0, 10) > bill.dueDate ? 'status-chip--danger' : 'status-chip--warning')}>{bill.matchedTransactionId ? 'Conciliado' : bill.status === 'paid' ? 'Pago' : new Date().toISOString().slice(0, 10) > bill.dueDate ? 'Vencido' : 'Pendente'}</span>{bill.amountDifference != null && <span className="bill-difference">Pago {formatCurrency(bill.paidAmount ?? bill.amount)} · diferença {formatCurrency(bill.amountDifference)}</span>}</td><td className="align-right"><div className="transaction-actions"><button className="icon-button icon-button--subtle" onClick={() => onMatch(bill.id)} aria-label="Vincular a uma transação do extrato"><Link2 size={16} /></button>{bill.status !== 'paid' ? <button className="icon-button icon-button--subtle" onClick={() => onLaunch(bill)} aria-label="Registrar pagamento"><Receipt size={16} /></button> : <button className="icon-button icon-button--subtle" onClick={() => onReopen(bill)} aria-label="Desfazer pagamento"><Undo2 size={16} /></button>}<button className="icon-button icon-button--subtle" onClick={() => onEdit(bill)} aria-label="Editar boleto"><Settings size={16} /></button><button className="icon-button icon-button--subtle" onClick={() => onDelete(bill.id)} aria-label="Excluir boleto"><Trash2 size={16} /></button></div></td></tr>)}</tbody></table></div> : <EmptyState icon={Mail} title="Nenhum boleto cadastrado" description="Conecte o Outlook ou cadastre um boleto manualmente para organizar por competência." action="Cadastrar boleto" onAction={onAdd} />}</section>
  </div>
}

function BillModal({ open, bill, onClose, onSave }) {
  const [form, setForm] = useState({ description: bill?.description ?? '', amount: bill?.amount ?? '', dueDate: bill?.dueDate ?? '', category: bill?.category ?? 'Moradia', mySharePercent: bill?.mySharePercent ?? 100 })
  useEffect(() => { if (open) setForm({ description: bill?.description ?? '', amount: bill?.amount ?? '', dueDate: bill?.dueDate ?? '', category: bill?.category ?? 'Moradia', mySharePercent: bill?.mySharePercent ?? 100 }) }, [bill, open])
  if (!open) return null
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const submit = (event) => { event.preventDefault(); if (!form.description.trim() || !form.dueDate || Number(form.amount) <= 0) return; onSave({ ...form, description: form.description.trim(), amount: Number(form.amount), competence: form.dueDate.slice(0, 7) }) }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><form className="modal" onSubmit={submit}><div className="modal__header"><div><span className="eyebrow">Competência por vencimento</span><h2>{bill ? 'Editar boleto' : 'Novo boleto'}</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></div><p className="modal__description">O mês do orçamento será definido pelo vencimento, independentemente da data de recebimento do e-mail.</p>{bill?.warnings?.length > 0 && <div className="inline-alert inline-alert--warning"><AlertCircle size={15} /><span>{bill.warnings.join(' ')} Confira os campos abaixo antes de salvar.</span></div>}{bill?.usedBarcode && <div className="inline-alert inline-alert--warning"><AlertCircle size={15} /><span>Valor e vencimento foram lidos da linha digitável do boleto.</span></div>}<label className="field"><span>Descrição</span><input autoFocus value={form.description} onChange={(event) => update('description', event.target.value)} placeholder="Ex.: Aluguel" required /></label><div className="form-grid form-grid--two"><label className="field"><span>Valor total</span><span className="input-prefix"><span>R$</span><input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => update('amount', event.target.value)} placeholder="0,00" required /></span></label><label className="field"><span>Vencimento</span><input type="date" value={form.dueDate} onChange={(event) => update('dueDate', event.target.value)} required /></label></div><div className="form-grid form-grid--two"><label className="field"><span>Categoria do orçamento</span><span className="select-wrap"><select value={form.category} onChange={(event) => update('category', event.target.value)}>{budgetCategoryOptions.map((category) => <option key={category}>{category}</option>)}</select><ChevronDown size={15} /></span></label><label className="field"><span>Sua parte</span><span className="select-wrap"><select value={form.mySharePercent} onChange={(event) => update('mySharePercent', Number(event.target.value))}><option value="100">100% — sozinho</option><option value="50">50% — dividido</option><option value="0">0% — outra pessoa</option></select><ChevronDown size={15} /></span></label></div><div className="modal__actions"><button type="button" className="button button--ghost" onClick={onClose}>Cancelar</button><button type="submit" className="button button--primary"><Check size={16} /> Salvar boleto</button></div></form></div>
}

function institutionFromEmail(candidate, accounts) {
  const text = normalizeText(`${candidate?.sender ?? ''} ${candidate?.subject ?? ''} ${candidate?.attachmentName ?? ''}`)
  if (text.includes('bradesco')) return 'Bradesco'
  if (text.includes('nubank') || text.includes('nu pagamentos')) return 'Nubank'
  if (text.includes('picpay')) return 'PicPay'

  const known = accounts.find((account) => account.institution && text.includes(normalizeText(account.institution)))
  return known?.institution ?? ''
}

function StatementImportModal({ open, candidate, accounts, onClose, onImport }) {
  const [institution, setInstitution] = useState('Nubank')
  const [accountId, setAccountId] = useState('')
  const [password, setPassword] = useState('')
  const availableAccounts = accounts.filter((account) => account.institution === institution)
  useEffect(() => {
    if (!open) return
    // A instituição vem do remetente do e-mail, não de um padrão fixo.
    // Antes era sempre Nubank, e o extrato do Bradesco acabava na conta errada.
    const guessed = institutionFromEmail(candidate, accounts)
    const first = accounts.find((account) => account.institution === guessed) ?? accounts.find((account) => account.institution === 'Nubank') ?? accounts[0]
    setInstitution(first?.institution ?? 'Nubank')
    setAccountId(first?.id ?? '')
    setPassword('')
  }, [accounts, open, candidate])
  useEffect(() => {
    const matching = accounts.find((account) => account.institution === institution)
    if (matching && !accounts.some((account) => account.id === accountId)) setAccountId(matching.id)
  }, [accountId, accounts, institution])
  if (!open || !candidate) return null
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><form className="modal" onSubmit={(event) => { event.preventDefault(); if (accountId) onImport({ candidate, institution, accountId, password }) }}><div className="modal__header"><div><span className="eyebrow">Documento do Outlook</span><h2>Importar extrato</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></div><p className="modal__description">O PDF será enviado para a tela de revisão antes de ser salvo.</p><div className="statement-file-preview"><FileText size={17} /><div><strong>{candidate.attachmentName}</strong><span>{candidate.subject} · {candidate.sender}</span></div></div><div className="form-grid form-grid--two"><label className="field"><span>Instituição</span><span className="select-wrap"><select value={institution} onChange={(event) => setInstitution(event.target.value)}><option>Nubank</option><option>Bradesco</option><option>PicPay</option></select><ChevronDown size={15} /></span></label><label className="field"><span>Conta</span><span className="select-wrap"><select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{availableAccounts.length ? availableAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>) : <option value="">Sem conta cadastrada</option>}</select><ChevronDown size={15} /></span></label></div>{candidate.requiresPassword && <label className="field"><span>Senha do PDF</span><span className="password-input"><LockKeyhole size={14} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Senha do PDF" autoComplete="off" /></span></label>}<div className="modal__actions"><button type="button" className="button button--ghost" onClick={onClose}>Cancelar</button><button type="submit" className="button button--primary" disabled={!accountId}><Upload size={16} /> Abrir revisão</button></div></form></div>
}

function BudgetCopyModal({ open, sourceMonth, onClose, onCopy }) {
  const [targetMonth, setTargetMonth] = useState(shiftMonth(sourceMonth || '', 1))
  useEffect(() => { if (open) setTargetMonth(shiftMonth(sourceMonth || '', 1)) }, [open, sourceMonth])
  if (!open || !sourceMonth) return null
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><form className="modal" onSubmit={(event) => { event.preventDefault(); if (targetMonth && targetMonth !== sourceMonth) onCopy(targetMonth) }}><div className="modal__header"><div><span className="eyebrow">Planejamento mensal</span><h2>Copiar mês</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></div><p className="modal__description">Os valores planejados de <strong>{formatMonthLabel(sourceMonth)}</strong> serão replicados para o mês escolhido. Os gastos realizados não serão copiados.</p><label className="field"><span>Mês de destino</span><input type="month" value={targetMonth} onChange={(event) => setTargetMonth(event.target.value)} required /></label><div className="modal__actions"><button type="button" className="button button--ghost" onClick={onClose}>Cancelar</button><button type="submit" className="button button--primary" disabled={!targetMonth || targetMonth === sourceMonth}><Copy size={16} /> Copiar orçamento</button></div></form></div>
}

function ComingSoonPage({ type }) {
  const budgets = type === 'budgets'
  return (
    <div className="page-stack"><section className="page-heading"><div><span className="eyebrow">Próxima etapa</span><h1>{budgets ? 'Orçamentos' : 'Metas financeiras'}</h1><p>{budgets ? 'Defina limites por categoria e saiba quando precisa ajustar os gastos.' : 'Transforme planos em progresso visível e acompanhe cada conquista.'}</p></div></section><section className="coming-soon panel"><div className="coming-soon__art"><div className="coming-soon__orb coming-soon__orb--one" /><div className="coming-soon__orb coming-soon__orb--two" />{budgets ? <PiggyBank size={55} /> : <Target size={55} />}</div><span className="eyebrow">Em construção</span><h2>{budgets ? 'Seu dinheiro com limites mais inteligentes' : 'Cada meta, mais perto'}</h2><p>Primeiro validamos a importação e a classificação. Esta tela será ativada na próxima versão do Real Total.</p><button className="button button--soft" onClick={() => window.alert('Esta funcionalidade será adicionada em breve.')}>Avisar quando estiver pronto <Bell size={15} /></button></section></div>
  )
}

function DueAlertCard({ alert, onChange, user }) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState('')

  const patch = async (values) => {
    const next = { ...alert, ...values }
    onChange(next)
    setSaving(true)
    setSaved('')
    try {
      await saveAlertSettings(user.id, next)
      setSaved('preferencias salvas')
    } catch (error) {
      setSaved(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <article className="panel settings-card settings-card--alert">
      <div className="settings-card__icon settings-card__icon--orange"><Bell size={20} /></div>
      <h2>Alerta de vencimento</h2>
      <p>Receba um e-mail com as contas que vencem nos próximos dias, mesmo com o app fechado.</p>

      <button
        type="button"
        className={classNames('toggle', alert.enabled && 'toggle--on')}
        onClick={() => patch({ enabled: !alert.enabled })}
        disabled={saving}
        aria-pressed={alert.enabled}
      >
        <span className="toggle__track"><i /></span>
        <span className="toggle__label">{alert.enabled ? 'Ativado' : 'Desativado'}</span>
      </button>

      <label className="field"><span>E-mail de destino</span><input type="email" value={alert.email} onChange={(event) => onChange({ ...alert, email: event.target.value })} onBlur={(event) => patch({ email: event.target.value })} placeholder="voce@email.com" /></label>

      <label className="field"><span>Quando avisar</span><span className="select-wrap"><select value={alert.days_before} onChange={(event) => patch({ days_before: Number(event.target.value) })}>{DAYS_BEFORE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={15} /></span></label>

      <div className="alert-preview">
        <span className="eyebrow">Exemplo de envio</span>
        <div className="alert-preview__mail">
          <div className="alert-preview__head">Alerta de vencimento <span>7h da manhã</span></div>
          <p>Olá, {alert.email ? alert.email.split('@')[0] : 'por aqui'}, você tem 2 conta(s) vencendo em breve.</p>
          <div className="alert-preview__row"><span>Consórcio HS</span><strong>R$ 1.204,64</strong></div>
          <div className="alert-preview__row"><span>Aluguel</span><strong>R$ 1.573,00</strong></div>
        </div>
      </div>

      {saved && <span className={classNames('alert-feedback', saved.includes('salvas') ? 'alert-feedback--ok' : 'alert-feedback--error')}>{saved}</span>}

      <span className="settings-status"><i /> {alert.enabled ? 'Verificação diária às 7h' : 'Nenhum e-mail será enviado'}</span>
    </article>
  )
}

function SettingsPage({ onResetDemo, onStartEmpty, user, cloudStatus, alert: alertSettings, onAlertChange: setAlertSettings, onSignOut }) {
  const lastSync = getLastSyncedAt()
  const syncLabel = !isCloudReady()
    ? 'Modo local'
    : cloudStatus === 'sincronizando'
      ? 'Sincronizando...'
      : cloudStatus === 'offline'
        ? 'Offline, salvando neste dispositivo'
        : 'Sincronizado com a nuvem'
  return (
    <div className="page-stack">
      <section className="page-heading">
        <div><span className="eyebrow">Preferências</span><h1>Configurações</h1><p>Ajuste o comportamento do Real Total para a sua rotina.</p></div>
      </section>
      <section className="settings-grid">
        <article className="panel settings-card">
          <div className="settings-card__icon"><ShieldCheck size={20} /></div>
          <h2>Conta e sincronização</h2>
          <p>Seus dados ficam guardados na nuvem e abrem no celular e no computador, sempre com o mesmo conteúdo.</p>
          <span className="settings-status"><i /> {syncLabel}</span>
          {user?.email && <span className="settings-account">{user.email}{lastSync ? ` · última gravação ${formatDateTime(lastSync)}` : ''}</span>}
          {onSignOut && <button className="button button--ghost settings-account__action" onClick={onSignOut}><LogOut size={15} /> Sair da conta</button>}
        </article>
        <article className="panel settings-card">
          <div className="settings-card__icon settings-card__icon--purple"><Building2 size={20} /></div>
          <h2>Instituições</h2>
          <p>Bradesco, PicPay e Nubank já estão preparados para receber adaptadores de importação.</p>
          <span className="settings-status settings-status--muted"><i /> 3 instituições conectadas ao catálogo</span>
        </article>
        <DueAlertCard alert={alertSettings} onChange={setAlertSettings} user={user} />
      </section>
      <section className="panel settings-reset">
        <div className="settings-reset__copy">
          <span className="settings-reset__icon"><Trash2 size={19} /></span>
          <div><h2>Dados locais</h2><p>Apague as contas, transações e itens de orçamento salvos neste navegador antes de começar um novo teste.</p></div>
        </div>
        <div className="settings-reset__actions">
          <button className="button button--ghost" onClick={onResetDemo}><RefreshCw size={15} /> Restaurar demonstração</button>
          <button className="button button--danger" onClick={onStartEmpty}><Trash2 size={15} /> Começar do zero</button>
        </div>
      </section>
    </div>
  )
}

function AccountModal({ open, account, onClose, onSave }) {
  const blank = { name: '', institution: 'Nubank', type: 'Conta corrente', openingBalance: '', balance: '', limit: '' }
  const [form, setForm] = useState(blank)
  useEffect(() => {
    if (!open) return
    setForm(account ? {
      name: account.name ?? '',
      institution: account.institution ?? 'Nubank',
      type: account.type ?? 'Conta corrente',
      openingBalance: String(account.openingBalance ?? ''),
      balance: String(account.balance ?? ''),
      limit: String(account.limit ?? ''),
    } : blank)
  }, [account, open])
  if (!open) return null
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const submit = (event) => {
    event.preventDefault()
    if (!form.name.trim()) return
    onSave({
      ...form,
      name: form.name.trim(),
      openingBalance: Number(String(form.openingBalance).replace(',', '.')) || 0,
      balance: form.balance === '' ? 0 : Number(String(form.balance).replace(',', '.')) || 0,
      limit: form.limit === '' ? undefined : Number(String(form.limit).replace(',', '.')) || 0,
    })
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <form className="modal" onSubmit={submit}>
        <div className="modal__header"><div><span className="eyebrow">{account ? 'Editar produto' : 'Nova conta'}</span><h2>{account ? account.name : 'Adicionar produto'}</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></div>
        <p className="modal__description">{account ? 'Confira o saldo atual como está no aplicativo do banco. O Real Total não lê o extrato de posição consolidada.' : 'Cadastre um produto para receber os próximos extratos.'}</p>
        <label className="field"><span>Nome do produto</span><input autoFocus value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Ex.: Conta principal" required /></label>
        <div className="form-grid form-grid--two">
          <label className="field"><span>Instituição</span><span className="select-wrap"><select value={form.institution} onChange={(event) => update('institution', event.target.value)}><option>Nubank</option><option>Bradesco</option><option>PicPay</option></select><ChevronDown size={15} /></span></label>
          <label className="field"><span>Tipo</span><span className="select-wrap"><select value={form.type} onChange={(event) => update('type', event.target.value)}>{accountTypeOptions.map((type) => <option key={type}>{type}</option>)}</select><ChevronDown size={15} /></span></label>
        </div>
        <label className="field"><span>Saldo atual <small>(confira no app do banco)</small></span><span className="input-prefix"><span>R$</span><input type="number" step="0.01" value={form.balance} onChange={(event) => update('balance', event.target.value)} placeholder="0,00" /></span></label>
        {form.type === 'Cartão de crédito' && <label className="field"><span>Limite do cartão</span><span className="input-prefix"><span>R$</span><input type="number" step="0.01" value={form.limit} onChange={(event) => update('limit', event.target.value)} placeholder="0,00" /></span></label>}
        {account && <div className="inline-alert inline-alert--warning"><Info size={15} /><span>Contas do tipo Poupança ou Investimento ficam fora do patrimônio disponível e aparecem como "guardado e investido".</span></div>}
        <div className="modal__actions"><button type="button" className="button button--ghost" onClick={onClose}>Cancelar</button><button type="submit" className="button button--primary"><Check size={16} /> {account ? 'Salvar alterações' : 'Adicionar conta'}</button></div>
      </form>
    </div>
  )
}

function Toast({ toast, onClose }) {
  if (!toast) return null
  return <div className={classNames('toast', toast.type === 'error' && 'toast--error')}><span className="toast__icon">{toast.type === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}</span><span>{toast.message}</span><button onClick={onClose} aria-label="Fechar"><X size={14} /></button></div>
}

function LoginScreen({ onAuthenticated }) {
  const [mode, setMode] = useState('signin')
  const [form, setForm] = useState({ email: '', password: '', fullName: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (mode === 'signup') {
        const result = await cloudSignUp(form)
        if (result?.session?.user) {
          onAuthenticated(result.session.user)
        } else {
          setNotice('Conta criada. Confirme o e-mail no link enviado e depois entre.')
          setMode('signin')
        }
      } else {
        const user = await cloudSignIn(form.email, form.password)
        onAuthenticated(user)
      }
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="brand brand--auth"><span className="brand__mark"><span /></span><span>Real Total</span></div>
        <span className="eyebrow">{mode === 'signup' ? 'Criar acesso' : 'Seu dinheiro, sincronizado'}</span>
        <h1>{mode === 'signup' ? 'Criar sua conta' : 'Entrar no Real Total'}</h1>
        <p className="auth-card__text">{mode === 'signup'
          ? 'Crie uma conta para guardar seus dados na nuvem e acessar do celular.'
          : 'Seus dados ficam guardados na nuvem e abrem em qualquer dispositivo.'}</p>

        {error && <div className="inline-alert inline-alert--warning"><AlertCircle size={15} /><span>{error}</span></div>}
        {notice && <div className="inline-alert"><ShieldCheck size={15} /><span>{notice}</span></div>}

        <form onSubmit={submit}>
          {mode === 'signup' && <label className="field"><span>Nome</span><input value={form.fullName} onChange={(event) => update('fullName', event.target.value)} placeholder="Ex.: Guilherme" autoComplete="name" /></label>}
          <label className="field"><span>E-mail</span><input type="email" required value={form.email} onChange={(event) => update('email', event.target.value)} placeholder="voce@email.com" autoComplete="email" /></label>
          <label className="field"><span>Senha</span><input type="password" required minLength={6} value={form.password} onChange={(event) => update('password', event.target.value)} placeholder="Mínimo de 6 caracteres" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} /></label>
          <button className="button button--primary auth-card__submit" type="submit" disabled={busy}>
            {busy ? <><Loader2 className="spin" size={16} /> Aguarde...</> : mode === 'signup' ? 'Criar conta' : 'Entrar'}
          </button>
        </form>

        <button className="text-button auth-card__switch" onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(''); setNotice('') }}>
          {mode === 'signup' ? 'Já tenho conta. Entrar' : 'Não tenho conta. Criar agora'}
        </button>
        <span className="auth-card__note"><ShieldCheck size={13} /> Suas transações ficam privadas no banco de dados.</span>
      </div>
    </div>
  )
}

function BootScreen() {
  return (
    <div className="auth-shell">
      <div className="auth-card auth-card--boot">
        <div className="brand brand--auth"><span className="brand__mark"><span /></span><span>Real Total</span></div>
        <Loader2 className="spin" size={22} />
        <p className="auth-card__text">Carregando seus dados...</p>
      </div>
    </div>
  )
}

function App() {
  const [status, setStatus] = useState('loading')
  const [user, setUser] = useState(null)

  useEffect(() => {
    if (!isCloudConfigured) {
      setStatus('ready')
      return undefined
    }
    let active = true
    getActiveUser().then((sessionUser) => {
      if (!active) return
      setUser(sessionUser)
      setStatus('ready')
    })
    const unsubscribe = onAuthChange((sessionUser) => {
      setUser(sessionUser)
      setStatus('ready')
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  if (status === 'loading') return <BootScreen />
  if (!user) return <LoginScreen onAuthenticated={setUser} />
  return <FinanceApp key={user.id} user={user} />
}

function FinanceApp({ user }) {
  const [hydrated, setHydrated] = useState(false)
  const [accounts, setAccounts] = useState(() => loadState()?.accounts ?? seedAccounts)
  const [transactions, setTransactions] = useState(() => loadState()?.transactions ?? seedTransactions)
  const [bills, setBills] = useState(() => loadState()?.bills ?? [])
  const [budgets, setBudgets] = useState(() => (loadState()?.budgets ?? seedBudgets).map(normalizeBudgetItem))
  const [budgetGroups, setBudgetGroups] = useState(() => {
    const savedGroups = loadState()?.budgetGroups
    const validSavedGroups = Array.isArray(savedGroups) ? savedGroups : []
    return seedBudgetGroups.map((group) => validSavedGroups.find((savedGroup) => savedGroup.id === group.id) ?? group)
  })
  const [budgetIncome, setBudgetIncome] = useState(() => loadState()?.budgetIncome ?? seedBudgetIncome)
  const [simulation, setSimulation] = useState(() => loadState()?.simulation ?? { monthlyIncome: '', extraIncome: '', items: [], sourceMonth: '' })
  const [savedSimulations, setSavedSimulations] = useState(() => loadState()?.savedSimulations ?? [])
  const [outlookAccount, setOutlookAccount] = useState(null)
  const [outlookStatus, setOutlookStatus] = useState('idle')
  const [outlookMessage, setOutlookMessage] = useState('')
  const [outlookCandidates, setOutlookCandidates] = useState(() => restoreCandidates(loadState()?.outlookCandidates))
  const [candidatePasswords, setCandidatePasswords] = useState({})
  const [candidateBusy, setCandidateBusy] = useState('')
  const [billModalOpen, setBillModalOpen] = useState(false)
  const [statementModalOpen, setStatementModalOpen] = useState(false)
  const [statementCandidate, setStatementCandidate] = useState(null)
  const [copyBudgetModalOpen, setCopyBudgetModalOpen] = useState(false)
  const [copyBudgetSource, setCopyBudgetSource] = useState('')
  const [copyBudgetTarget, setCopyBudgetTarget] = useState('')
  const [billMatchId, setBillMatchId] = useState('')
  const [transactionModalOpen, setTransactionModalOpen] = useState(false)
  const [transactionModalBill, setTransactionModalBill] = useState(null)
  const [editingBill, setEditingBill] = useState(null)
  const [activeView, setActiveView] = useState('dashboard')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [accountModalOpen, setAccountModalOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState(null)
  const [budgetModalOpen, setBudgetModalOpen] = useState(false)
  const [splitModalOpen, setSplitModalOpen] = useState(false)
  const [splitItem, setSplitItem] = useState(null)
  const [splitContext, setSplitContext] = useState(null)
  const [editingBudget, setEditingBudget] = useState(null)
  const [editingBudgetMonth, setEditingBudgetMonth] = useState('')
  const [toast, setToast] = useState(null)
  const [globalSearch, setGlobalSearch] = useState('')
  const [importForm, setImportForm] = useState({ institution: 'Nubank', accountId: seedAccounts[0].id })
  const [importFile, setImportFile] = useState(null)
  const [importStatus, setImportStatus] = useState('idle')
  const [importRows, setImportRows] = useState([])
  const [importWarning, setImportWarning] = useState('')
  const [importPassword, setImportPassword] = useState('')
  const [importRequiresPassword, setImportRequiresPassword] = useState(false)
  const [importReconciliation, setImportReconciliation] = useState(null)
  const [cloudStatus, setCloudStatus] = useState('sincronizando')
  const [bellOpen, setBellOpen] = useState(false)
  const [alertSettings, setAlertSettings] = useState({ email: '', enabled: false, days_before: 1 })
  const reminders = useMemo(() => collectDueReminders({ bills, budgets }), [bills, budgets])

  useEffect(() => {
    if (!user?.email) return
    setAlertSettings((current) => ({ ...current, email: current.email || user.email }))
    if (!isCloudConfigured) return
    fetchAlertSettings(user.id)
      .then((saved) => {
        if (saved) setAlertSettings((current) => ({ ...current, ...saved }))
      })
      .catch(() => {})
  }, [user?.id, user?.email])

  const profileName = (user?.user_metadata?.full_name || '').trim()
  const userName = profileName || (user?.email ? user.email.split('@')[0] : 'Você')
  const userInitial = (userName.charAt(0) || 'R').toUpperCase()

  useEffect(() => {
    let cancelled = false
    setActiveUser(user?.id ?? null)
    ensureProfile(user)
      .catch(() => {})
      .then(() => pullState())
      .then(({ state, migrated }) => {
        if (cancelled) return
        if (state) {
          if (Array.isArray(state.accounts)) setAccounts(state.accounts)
          if (Array.isArray(state.transactions)) setTransactions(state.transactions)
          if (Array.isArray(state.bills)) setBills(state.bills)
          if (Array.isArray(state.budgets)) setBudgets(state.budgets.map(normalizeBudgetItem))
          if (Array.isArray(state.budgetGroups)) setBudgetGroups(state.budgetGroups)
          if (state.budgetIncome) setBudgetIncome(state.budgetIncome)
          if (state.simulation) setSimulation(state.simulation)
          if (Array.isArray(state.savedSimulations)) setSavedSimulations(state.savedSimulations)
          if (migrated) showToast('Seus dados deste navegador foram enviados para a nuvem.')
        }
        setCloudStatus('sincronizado')
      })
      .catch(() => {
        if (cancelled) return
        setCloudStatus('offline')
      })
      .finally(() => {
        if (!cancelled) setHydrated(true)
      })
    return () => {
      cancelled = true
      setActiveUser(null)
    }
  }, [user?.id])

  useEffect(() => saveState({
    accounts,
    transactions,
    bills,
    budgets,
    budgetGroups,
    budgetIncome,
    simulation,
    savedSimulations,
    outlookCandidates: outlookCandidates.map(toStorableCandidate),
  }), [accounts, transactions, bills, budgets, budgetGroups, budgetIncome, simulation, savedSimulations, outlookCandidates])
  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 4200)
    return () => window.clearTimeout(timer)
  }, [toast])
  // A sessão do Outlook é restaurada uma vez, ao abrir o app. Antes isso só
  // rodava na tela de Boletos, e quem entrava direto em Importar extrato via
  // "Conectar Outlook" mesmo já estando conectado.
  const outlookRestoreDone = useRef(false)
  useEffect(() => {
    if (!isOutlookConfigured() || outlookRestoreDone.current) return
    outlookRestoreDone.current = true
    initializeOutlook().then((account) => {
      if (!account) return
      setOutlookAccount(account)
      setOutlookStatus('connected')
      setOutlookMessage('Conta conectada. Sincronize para buscar boletos e extratos.')
    }).catch((error) => {
      if (error?.message) {
        setOutlookStatus('error')
        setOutlookMessage(error.message)
      }
    })
  }, [])
  useEffect(() => {
    const matching = accounts.find((account) => account.institution === importForm.institution)
    if (matching && !accounts.some((account) => account.id === importForm.accountId)) setImportForm((current) => ({ ...current, accountId: matching.id }))
  }, [accounts, importForm.accountId, importForm.institution])

  const showToast = (message, type = 'success') => setToast({ message, type })
  const navigate = (view) => { setActiveView(view); setMobileNavOpen(false) }

  const handleConnectOutlook = async () => {
    if (!isOutlookConfigured()) {
      showToast('Configure VITE_AZURE_CLIENT_ID no arquivo .env primeiro.', 'error')
      return
    }
    setOutlookStatus('connecting')
    setOutlookMessage('Abrindo a janela de autorização do Microsoft...')
    try {
      await connectOutlook()
      setOutlookMessage('Redirecionando para o Microsoft...')
    } catch (error) {
      setOutlookStatus('error')
      setOutlookMessage(error.message || 'Não foi possível conectar o Outlook.')
      showToast('Não foi possível conectar o Outlook.', 'error')
    }
  }

  const handleDisconnectOutlook = async () => {
    try {
      await disconnectOutlook()
    } catch {
      // The local session can still be cleared if the provider is unavailable.
    }
    setOutlookAccount(null)
    setOutlookStatus('idle')
    setOutlookMessage('')
    setOutlookCandidates([])
    showToast('Conta Outlook desconectada.')
  }

  const handleSyncOutlook = async () => {
    if (!outlookAccount) {
      showToast('Conecte o Outlook antes de sincronizar.', 'error')
      return
    }
    setOutlookStatus('syncing')
    setOutlookMessage('Buscando e-mails com anexos PDF...')
    try {
      const result = await syncOutlookBills({ days: 90, onProgress: ({ stage, subject }) => setOutlookMessage(stage === 'downloading' ? `Baixando PDF de ${subject}...` : 'Processando anexo...') })
      setOutlookCandidates(result.candidates)
      setOutlookStatus('connected')
      setOutlookMessage(`${result.candidates.length} PDF(s) encontrados para revisão.`)
      showToast(result.candidates.length ? `${result.candidates.length} boleto(s) encontrados.` : 'Nenhum boleto em PDF encontrado nos últimos 90 dias.')
    } catch (error) {
      setOutlookStatus('error')
      setOutlookMessage(error.message || 'Não foi possível sincronizar o Outlook.')
      showToast('Não foi possível sincronizar o Outlook.', 'error')
    }
  }

  const handleProcessCandidate = async (candidate, password) => {
    if (!candidate.file) {
      setOutlookCandidates((current) => current.map((item) => item.id === candidate.id ? { ...item, warning: 'PDF não está mais disponível. Sincronize o Outlook novamente.' } : item))
      return
    }
    setCandidateBusy(candidate.id)
    try {
      const parsed = await parseBillPdf(candidate.file, password, candidate.subject)
      if (parsed.requiresPassword) {
        setOutlookCandidates((current) => current.map((item) => item.id === candidate.id ? { ...item, warning: 'A senha informada não abriu o PDF.' } : item))
        return
      }
      setOutlookCandidates((current) => current.map((item) => item.id === candidate.id ? { ...item, ...parsed, requiresPassword: false, warning: parsed.warnings?.[0] ?? '' } : item))
      setCandidatePasswords((current) => { const next = { ...current }; delete next[candidate.id]; return next })
    } catch (error) {
      setOutlookCandidates((current) => current.map((item) => item.id === candidate.id ? { ...item, warning: error.message || 'Não foi possível analisar este PDF.' } : item))
    } finally {
      setCandidateBusy('')
    }
  }

  const openBillModal = (bill = null) => {
    setEditingBill(bill)
    setBillModalOpen(true)
  }

  const handleImportStatementCandidate = async ({ candidate, institution, accountId, password }) => {
    setStatementModalOpen(false)
    if (!candidate.file) {
      setOutlookMessage('PDF não está mais disponível. Sincronize o Outlook novamente.')
      showToast('PDF não está mais disponível. Sincronize novamente.', 'error')
      return
    }
    const isPdf = candidate.file?.type === 'application/pdf' || String(candidate.file?.name ?? '').toLowerCase().endsWith('.pdf')
    setOutlookMessage(isPdf
      ? 'Lendo o PDF. Se estiver digitalizado, o OCR leva alguns segundos.'
      : 'Abrindo o extrato na tela de revisão...')
    try {
      const result = await parseStatement(candidate.file, institution, accountId, { password })
      if (!result.rows.length) {
        setOutlookCandidates((current) => current.map((item) => item.id === candidate.id ? { ...item, warning: result.warnings[0] || 'Nenhuma movimentação encontrada neste extrato.' } : item))
        setOutlookMessage(result.warnings[0] || 'Nenhuma movimentação encontrada neste extrato.')
        showToast('Não foi possível identificar transações nesse extrato.', 'error')
        return
      }
      const existing = new Set(transactions.map(transactionSignature))
      const seen = new Set()
      const reviewedRows = result.rows.map((row) => {
        const signature = transactionSignature(row)
        const duplicate = existing.has(signature) || seen.has(signature)
        seen.add(signature)
        return { ...row, status: duplicate ? 'duplicate' : 'ready' }
      })
      setImportForm({ institution, accountId })
      setImportFile(candidate.file)
      setImportRows(reviewedRows)
      setImportWarning(result.warnings[0] || '')
      setImportReconciliation(result.reconciliation ?? null)
      setImportPassword('')
      setImportRequiresPassword(false)
      setImportStatus('review')
      setOutlookCandidates((current) => current.filter((item) => item.id !== candidate.id))
      setActiveView('import')
    } catch (error) {
      setOutlookCandidates((current) => current.map((item) => item.id === candidate.id ? { ...item, warning: error.message || 'Não foi possível abrir o extrato.' } : item))
      showToast('Não foi possível abrir o extrato.', 'error')
    }
  }

  const handleSaveBill = (form) => {
    const duplicate = findBillBySignature(bills, form, editingBill?.id ?? '')
    if (duplicate && !window.confirm(`Já existe um boleto igual salvo: ${duplicate.description} de ${formatDate(duplicate.dueDate)}.\n\nSalvar mesmo assim?`)) return
    const nextBill = buildBillRecord(form, editingBill)
    const linkedBudget = budgets.find((budget) => budget.billId === nextBill.id)
    const budgetItem = buildBudgetItemForBill(nextBill, linkedBudget)
    const wasExistingBill = editingBill ? bills.some((bill) => bill.id === editingBill.id) : false
    setBills((current) => upsertBill(current, nextBill))
    setBudgets((current) => {
      const existing = current.find((budget) => budget.billId === nextBill.id)
      return existing ? current.map((budget) => budget.billId === nextBill.id ? budgetItem : budget) : [...current, budgetItem]
    })
    if (editingBill?.source === 'outlook') setOutlookCandidates((current) => current.filter((candidate) => candidate.id !== editingBill.id))
    setBillModalOpen(false)
    setEditingBill(null)
    showToast(wasExistingBill ? 'Boleto atualizado no planejamento.' : 'Boleto salvo e incluído no orçamento.')
  }

  const buildCandidateBill = (candidate) => buildBillRecord({
    description: candidate.description,
    amount: Number(candidate.amount),
    dueDate: candidate.dueDate,
    category: candidate.category || guessCategoryFromDescription(candidate.description),
    mySharePercent: candidate.mySharePercent ?? 100,
    competence: monthKeyFromDate(candidate.dueDate),
  }, candidate)

  const isCandidateReady = (candidate) => !candidate.requiresPassword
    && candidate.documentType !== 'statement'
    && Number(candidate.amount) > 0
    && Boolean(candidate.dueDate)
    && Boolean(candidate.description)

  const handleSaveAllCandidates = () => {
    const ready = outlookCandidates.filter(isCandidateReady)
    if (!ready.length) {
      showToast('Nenhum documento pronto. Revise os que estão com dados incompletos.', 'error')
      return
    }

    const fresh = []
    let skipped = 0
    for (const candidate of ready) {
      const bill = buildCandidateBill(candidate)
      if (findBillBySignature(bills, bill, bill.id)) {
        skipped += 1
        continue
      }
      fresh.push(candidate)
    }

    const savedIds = fresh.map((candidate) => candidate.id)
    setBills((current) => fresh.reduce((list, candidate) => upsertBill(list, buildCandidateBill(candidate)), current))
    setBudgets((current) => fresh.reduce((list, candidate) => {
      const bill = buildCandidateBill(candidate)
      const budgetItem = buildBudgetItemForBill(bill, list.find((budget) => budget.billId === bill.id))
      return list.some((budget) => budget.billId === bill.id)
        ? list.map((budget) => (budget.billId === bill.id ? budgetItem : budget))
        : [...list, budgetItem]
    }, current))
    setOutlookCandidates((current) => current.filter((candidate) => !savedIds.includes(candidate.id)))

    const remaining = outlookCandidates.length - ready.length
    const parts = [`${fresh.length} documento(s) salvo(s)`]
    if (skipped) parts.push(`${skipped} já existia(m) e foi/foram ignorados`)
    if (remaining) parts.push(`${remaining} continuam na lista para revisão`)
    showToast(parts.join('. ') + '.')
  }

  const handleDiscardAllCandidates = () => {
    if (!outlookCandidates.length) return
    if (!window.confirm(`Descartar os ${outlookCandidates.length} documento(s) da sincronização?`)) return
    setOutlookCandidates([])
    showToast('Documentos descartados.')
  }

  const openTransactionModal = (bill = null) => {
    setTransactionModalBill(bill)
    setTransactionModalOpen(true)
  }

  const handleSaveTransaction = (form) => {
    const bill = form.billId ? bills.find((item) => item.id === form.billId) : null
    const account = accounts.find((item) => item.id === form.accountId)
    const destination = form.type === 'transfer' && form.transferToAccountId && form.transferToAccountId !== form.accountId
      ? accounts.find((item) => item.id === form.transferToAccountId) ?? null
      : null
    const transaction = {
      id: `transaction-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date: form.date,
      description: form.description,
      merchant: form.description,
      amount: form.amount,
      type: form.type,
      category: form.type === 'transfer' ? 'Transferência' : form.category,
      accountId: form.accountId,
      destinationAccountId: destination?.id ?? null,
      institution: account?.institution ?? 'Manual',
      status: 'confirmed',
      source: 'manual',
      linkedBillId: bill?.id ?? null,
      createdAt: new Date().toISOString(),
    }
    setTransactions((current) => [transaction, ...current])
    if (bill) {
      const difference = Number(bill.amount || 0) - transaction.amount
      setBills((current) => current.map((item) => item.id === bill.id ? {
        ...item,
        status: 'paid',
        paidAt: transaction.date,
        matchedTransactionId: transaction.id,
        matchConfidence: 1,
        manualMatch: true,
        paidAmount: transaction.amount,
        amountDifference: Math.abs(difference) > 0.01 ? Number(difference.toFixed(2)) : null,
      } : item))
    }
    setAccounts((current) => adjustBalancesForTransaction(current, transaction))
    setTransactionModalOpen(false)
    setTransactionModalBill(null)
    if (destination) showToast(`Transferência registrada: ${formatCurrency(transaction.amount)} movidos para ${destination.name}.`)
    else if (bill) showToast('Pagamento registrado. O lançamento entrou como realizado no orçamento.')
    else showToast('Lançamento manual salvo.')
  }

  const handleReopenBill = (bill) => {
    const linked = bill.matchedTransactionId ? transactions.find((transaction) => transaction.id === bill.matchedTransactionId) : null
    const shouldRemoveLinked = Boolean(linked && linked.source === 'manual')
    const message = shouldRemoveLinked
      ? `Desfazer o pagamento e excluir o lançamento manual de ${formatCurrency(linked.amount)}?`
      : 'Desfazer o pagamento deste boleto? Ele volta para pendente.'
    if (!window.confirm(message)) return
    if (shouldRemoveLinked) setTransactions((current) => current.filter((transaction) => transaction.id !== linked.id))
    setBills((current) => current.map((item) => item.id === bill.id ? {
      ...item,
      status: 'pending',
      paidAt: null,
      matchedTransactionId: null,
      matchConfidence: null,
      manualMatch: false,
      paidAmount: null,
      amountDifference: null,
    } : item))
    showToast(shouldRemoveLinked ? 'Pagamento desfeito e lançamento manual excluído.' : 'Pagamento desfeito. Boleto pendente.')
  }

  const handleLinkBillTransaction = (bill, transaction) => {
    const paidAmount = Number(transaction.amount || 0)
    const difference = Number(bill.amount || 0) - paidAmount
    setBills((current) => current.map((item) => item.id === bill.id ? {
      ...item,
      status: 'paid',
      paidAt: transaction.date,
      matchedTransactionId: transaction.id,
      matchConfidence: 1,
      manualMatch: true,
      paidAmount,
      amountDifference: Math.abs(difference) > 0.01 ? Number(difference.toFixed(2)) : null,
    } : item))
    setBillMatchId('')
    showToast(difference === 0 ? 'Boleto conciliado com a transação.' : `Boleto conciliado. Diferença de ${formatCurrency(Math.abs(difference))} mantida no extrato.`)
  }

  const handleUnlinkBillTransaction = (bill) => {
    setBills((current) => current.map((item) => item.id === bill.id ? {
      ...item,
      status: 'pending',
      paidAt: null,
      matchedTransactionId: null,
      matchConfidence: null,
      manualMatch: false,
      paidAmount: null,
      amountDifference: null,
    } : item))
    setBillMatchId('')
    showToast('Vínculo removido. O boleto voltou para pendente.')
  }

  const handleDiscardCandidate = (id) => {
    setOutlookCandidates((current) => current.filter((candidate) => candidate.id !== id))
    showToast('Boleto descartado da sincronização.')
  }

  const handleDeleteBill = (id) => {
    if (!window.confirm('Excluir este boleto do planejamento?')) return
    setBills((current) => current.filter((bill) => bill.id !== id))
    setBudgets((current) => current.filter((budget) => budget.billId !== id))
    showToast('Boleto excluído e previsto removido do orçamento.')
  }

  const handleInstitutionChange = (institution) => {
    const matching = accounts.find((account) => account.institution === institution)
    setImportForm((current) => ({ institution, accountId: matching?.id ?? '' }))
    setImportWarning('')
  }

  const handleFile = (file) => {
    setImportFile(file)
    setImportStatus('idle')
    setImportWarning('')
    setImportPassword('')
    setImportRequiresPassword(false)
    setImportRows([])
  }

  const handleDemo = (institution) => {
    const matching = accounts.find((account) => account.institution === institution)
    if (!matching) {
      showToast('Cadastre uma conta dessa instituição antes de importar.', 'error')
      return
    }
    setImportForm({ institution, accountId: matching.id })
    setImportFile({ name: `${institution.toLowerCase()}-extrato-ficticio.csv`, size: 1840 })
    setImportRows(getDemoStatementRows(institution, matching.id))
    setImportWarning('')
    setImportPassword('')
    setImportRequiresPassword(false)
    setImportStatus('review')
  }

  const handleParse = async () => {
    if (!importFile || !importForm.accountId) return
    setImportStatus('parsing')
    setImportWarning('')
    setImportReconciliation(null)
    try {
      const result = await parseStatement(importFile, importForm.institution, importForm.accountId, { password: importPassword })
      setImportRequiresPassword(Boolean(result.requiresPassword))
      if (!result.rows.length) {
        setImportStatus('error')
        setImportWarning(result.warnings[0] || 'Não encontramos transações neste arquivo. Confira o formato e tente novamente.')
        return
      }
      const existing = new Set(transactions.map(transactionSignature))
      const seen = new Set()
      const reviewedRows = result.rows.map((row) => {
        const signature = transactionSignature(row)
        const duplicate = existing.has(signature) || seen.has(signature)
        seen.add(signature)
        return { ...row, status: duplicate ? 'duplicate' : 'ready' }
      })
      setImportRows(reviewedRows)
      setImportWarning(result.warnings[0] || '')
      setImportReconciliation(result.reconciliation ?? null)
      setImportPassword('')
      setImportRequiresPassword(false)
      setImportStatus('review')
    } catch (error) {
      setImportStatus('error')
      setImportRequiresPassword(false)
      setImportWarning(error.message || 'Não foi possível analisar este arquivo.')
    }
  }

  const handleUpdateRow = (id, patch) => setImportRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row))

  const handleConfirmImport = () => {
    const ready = importRows.filter((row) => row.status !== 'duplicate' && row.status !== 'ignored')
    if (!ready.length) return
    const newTransactions = ready.map((row) => ({
      id: row.id,
      date: row.date,
      description: row.description,
      merchant: row.merchant || row.description,
      category: row.category,
      type: row.type,
      amount: row.amount,
      allocations: row.allocations ?? [],
      isSplit: Boolean(row.isSplit || row.allocations?.length > 1),
      accountId: row.accountId,
      institution: row.institution,
      status: 'confirmed',
      source: 'upload',
      confidence: row.confidence,
      linkedBillId: null,
    }))

    // A conciliação marca o boleto, mas o orçamento olha o vínculo inverso,
    // na transação. Sem esta linha o previsto nunca encontra o realizado
    // depois de importar um extrato.
    const reconciliation = reconcileBillsWithTransactions(bills, newTransactions)
    const billIdByTransaction = Object.fromEntries(reconciliation.matches.map((match) => [match.transactionId, match.billId]))
    const withLink = newTransactions.map((transaction) => ({ ...transaction, linkedBillId: billIdByTransaction[transaction.id] ?? null }))

    setTransactions((current) => [...withLink, ...current])
    setBills(reconciliation.bills)
    setImportStatus('success')
    showToast(`${newTransactions.length} lançamentos importados${reconciliation.matches.length ? ` · ${reconciliation.matches.length} boleto(s) conciliados` : ''}.`)
  }

  const resetImport = () => { setImportFile(null); setImportStatus('idle'); setImportRows([]); setImportWarning(''); setImportPassword(''); setImportRequiresPassword(false); setImportReconciliation(null) }

  const handleAddAccount = (form) => {
    const id = `acc-${form.institution.toLowerCase()}-${Date.now()}`
    const account = { id, ...form, balance: form.balance, lastUpdated: 'Agora' }
    setAccounts((current) => [...current, account])
    setAccountModalOpen(false)
    setImportForm((current) => ({ ...current, institution: form.institution, accountId: id }))
    showToast('Conta adicionada com sucesso.')
  }

  const handleSaveAccount = (form) => {
    if (!editingAccount) return handleAddAccount(form)
    setAccounts((current) => current.map((account) => (account.id === editingAccount.id ? {
      ...account,
      ...form,
      limit: form.limit ?? account.limit,
      lastUpdated: 'Agora',
    } : account)))
    setAccountModalOpen(false)
    setEditingAccount(null)
    showToast('Conta atualizada.')
  }

  const openBudgetModal = (budgetOrMonth = null, monthKey) => {
    const isBudget = budgetOrMonth && typeof budgetOrMonth === 'object'
    const budget = isBudget ? budgetOrMonth : null
    const resolvedMonth = isBudget
      ? monthKey
      : (typeof budgetOrMonth === 'string' ? budgetOrMonth : monthKey || monthKeyFromDate(transactions[0]?.date) || monthKeyFromDate(new Date().toISOString()))
    setEditingBudget(budget)
    setEditingBudgetMonth(resolvedMonth)
    setBudgetModalOpen(true)
  }

  const handleSaveBudget = (form) => {
    const month = editingBudgetMonth
    const nextDueDate = form.dueByMonth?.[month] ?? ''
    setBudgets((current) => {
      const normalized = normalizeBudgetItem(form)
      if (editingBudget) {
        return current.map((budget) => {
          if (budget.id !== editingBudget.id) return budget
          const next = { ...budget, ...normalized }
          if (budget.billId && nextDueDate) {
            const previousCompetence = monthKeyFromDate(bills.find((bill) => bill.id === budget.billId)?.dueDate ?? '')
            const nextCompetence = monthKeyFromDate(nextDueDate)
            if (previousCompetence && previousCompetence !== nextCompetence) {
              const planned = { ...next.plannedByMonth }
              const value = planned[previousCompetence]
              delete planned[previousCompetence]
              planned[nextCompetence] = planned[nextCompetence] ?? value
              next.plannedByMonth = planned
            }
          }
          return next
        })
      }
      return [...current, { ...normalized, id: `budget-${normalized.label.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}-${Date.now()}` }]
    })
    if (editingBudget?.billId && nextDueDate) {
      setBills((current) => current.map((bill) => bill.id === editingBudget.billId ? { ...bill, dueDate: nextDueDate, competence: monthKeyFromDate(nextDueDate) } : bill))
    }
    setBudgetModalOpen(false)
    setEditingBudget(null)
    setEditingBudgetMonth('')
    showToast('Item do orçamento salvo.')
  }

  const duplicateBills = useMemo(() => {
    const seen = new Map()
    return bills.filter((bill) => {
      const signature = billSignature(bill)
      if (seen.has(signature)) return true
      seen.set(signature, bill.id)
      return false
    })
  }, [bills])

  const orphanDuplicateBudgets = useMemo(() => {
    const billIds = new Set(bills.map((bill) => bill.id))
    const seen = new Map()
    return budgets.filter((budget) => {
      if (budget.billId && billIds.has(budget.billId)) return false
      const dueDate = budget.defaultDueDate || Object.values(budget.dueByMonth ?? {})[0] || ''
      if (!dueDate) return false
      if (bills.some((bill) => normalizeText(bill.description ?? '') === normalizeText(budget.label ?? '')
        && bill.dueDate === dueDate
        && Math.abs(billShareAmount(bill) - Number(budget.defaultAmount ?? 0)) < 0.01)) return true
      const signature = [normalizeText(budget.label ?? ''), dueDate, Number(budget.defaultAmount ?? 0).toFixed(2)].join('|')
      if (seen.has(signature)) return true
      seen.set(signature, budget.id)
      return false
    })
  }, [bills, budgets])

  const handleRemoveDuplicates = () => {
    const duplicateBillIds = new Set(duplicateBills.map((bill) => bill.id))
    const orphanIds = new Set(orphanDuplicateBudgets.map((budget) => budget.id))
    const total = duplicateBillIds.size + orphanIds.size
    if (!total) {
      showToast('Nenhuma duplicata encontrada.')
      return
    }
    if (!window.confirm(`Remover ${duplicateBillIds.size} boleto(s) duplicado(s) e ${orphanIds.size} item(ns) repetido(s) do orçamento?\n\nÉ mantido o registro mais antigo de cada um.`)) return
    setBills((current) => current.filter((bill) => !duplicateBillIds.has(bill.id)))
    setBudgets((current) => current.filter((budget) => !orphanIds.has(budget.id) && !duplicateBillIds.has(budget.billId)))
    showToast(`${duplicateBillIds.size} boleto(s) e ${orphanIds.size} item(ns) duplicado(s) removidos.`)
  }

  const openCopyBudgetModal = (sourceMonth) => {
    setCopyBudgetSource(sourceMonth)
    setCopyBudgetTarget('')
    setCopyBudgetModalOpen(true)
  }

  const handleCopyBudget = (targetMonth) => {
    setBudgets((current) => current.map((budget) => {
      const sourceDueDate = budget.dueByMonth?.[copyBudgetSource] ?? ''
      return {
        ...budget,
        plannedByMonth: { ...budget.plannedByMonth, [targetMonth]: plannedBudgetAmount(budget, copyBudgetSource) },
        dueByMonth: sourceDueDate ? { ...budget.dueByMonth, [targetMonth]: shiftDateToMonth(sourceDueDate, targetMonth) } : budget.dueByMonth,
      }
    }))
    setCopyBudgetModalOpen(false)
    setCopyBudgetSource('')
    showToast(`Orçamento de ${formatMonthLabel(copyBudgetSource)} copiado para ${formatMonthLabel(targetMonth)}.`)
  }

  const handleDeleteBudget = (id) => {
    const budget = budgets.find((item) => item.id === id)
    if (!budget || !window.confirm(`Excluir o item ${budget.label}?`)) return
    setBudgets((current) => current.filter((item) => item.id !== id))
    showToast('Item excluído do orçamento.')
  }

  const handleUpdateGroup = (id, target) => {
    setBudgetGroups((current) => current.map((group) => group.id === id ? { ...group, target: Math.max(0, Math.min(100, Number(target) || 0)) } : group))
  }

  const handleIncomeChange = (field, month, value) => {
    setBudgetIncome((current) => ({ ...current, [field]: { ...(current[field] ?? {}), [month]: value === '' ? '' : Number(value) } }))
  }

  const handleCopyBudgetToSimulation = (monthKey) => {
    const items = budgets
      .map((budget) => ({ id: budget.id, label: budget.label, groupId: budget.groupId, amount: plannedBudgetAmount(budget, monthKey) }))
      .filter((item) => Number(item.amount) > 0)
    setSimulation({
      sourceMonth: monthKey,
      monthlyIncome: String(budgetIncome?.monthly?.[monthKey] ?? ''),
      extraIncome: String(budgetIncome?.extra?.[monthKey] ?? ''),
      items: items.map((item) => ({ ...item, amount: String(item.amount) })),
    })
    showToast(`${items.length} valor(es) de ${formatMonthLabel(monthKey)} copiados para a simulação.`)
  }

  const handleSaveSimulation = (name) => {
    const now = new Date().toISOString()
    setSavedSimulations((current) => [...current, {
      id: `saved-sim-${Date.now()}`,
      name,
      monthlyIncome: simulation.monthlyIncome,
      extraIncome: simulation.extraIncome,
      sourceMonth: simulation.sourceMonth ?? '',
      items: simulation.items.map((item) => ({ ...item })),
      createdAt: now,
      updatedAt: now,
    }])
    showToast(`Simulação "${name}" salva.`)
  }

  const handleLoadSimulation = (saved) => {
    const hasDraft = simulation.items.length > 0 || simulation.monthlyIncome !== '' || simulation.extraIncome !== ''
    if (hasDraft && !window.confirm(`Abrir "${saved.name}"? O rascunho atual será substituído.`)) return
    setSimulation({
      monthlyIncome: saved.monthlyIncome ?? '',
      extraIncome: saved.extraIncome ?? '',
      sourceMonth: saved.sourceMonth ?? '',
      items: (saved.items ?? []).map((item, index) => ({ ...item, id: `sim-${Date.now()}-${index}` })),
    })
    showToast(`Simulação "${saved.name}" aberta.`)
  }

  const handleDuplicateSimulation = (saved) => {
    const now = new Date().toISOString()
    setSavedSimulations((current) => [...current, {
      ...saved,
      id: `saved-sim-${Date.now()}`,
      name: `${saved.name} (cópia)`,
      items: (saved.items ?? []).map((item) => ({ ...item })),
      createdAt: now,
      updatedAt: now,
    }])
    showToast(`Cópia de "${saved.name}" criada.`)
  }

  const handleDeleteSimulation = (saved) => {
    if (!window.confirm(`Excluir a simulação "${saved.name}"?`)) return
    setSavedSimulations((current) => current.filter((item) => item.id !== saved.id))
    showToast('Simulação excluída.')
  }

  const openSplitReview = (row) => {
    setSplitItem(row)
    setSplitContext('review')
    setSplitModalOpen(true)
  }

  const openSplitTransaction = (transaction) => {
    setSplitItem(transaction)
    setSplitContext('transaction')
    setSplitModalOpen(true)
  }

  const handleUpdatePlannedFromSplit = (monthKey, pairs) => {
    if (!pairs.length) return
    setBudgets((current) => current.map((budget) => {
      const value = pairs.find((pair) => pair.id === budget.id)
      if (!value) return budget
      return { ...budget, plannedByMonth: { ...budget.plannedByMonth, [monthKey]: value.amount } }
    }))
    showToast(`Orçamento de ${formatMonthLabel(monthKey)} atualizado com ${pairs.length} valor(es).`)
  }

  const handleSaveSplit = (allocations) => {
    const firstCategory = allocations[0]?.category ?? splitItem?.category
    if (splitContext === 'review') {
      setImportRows((current) => current.map((row) => row.id === splitItem.id ? { ...row, category: firstCategory, allocations, isSplit: allocations.length > 1 } : row))
    } else {
      setTransactions((current) => current.map((transaction) => transaction.id === splitItem.id ? { ...transaction, category: firstCategory, allocations, isSplit: allocations.length > 1 } : transaction))
    }
    setSplitModalOpen(false)
    setSplitItem(null)
    setSplitContext(null)
    showToast('Gasto desdobrado entre as categorias.')
  }

  const handleResetData = (mode) => {
    const message = mode === 'empty'
      ? 'Isso apagará todas as contas, transações e itens de orçamento e deixará o Real Total sem dados. Deseja continuar?'
      : 'Isso apagará os dados atuais e restaurará os dados fictícios de demonstração. Deseja continuar?'
    if (!window.confirm(message)) return

    clearState()
    if (mode === 'empty') {
      setAccounts([])
      setTransactions([])
      setBudgets(seedBudgets)
      setBudgetGroups(seedBudgetGroups)
      setBudgetIncome({ monthly: {}, extra: {} })
      setImportForm({ institution: 'Nubank', accountId: '' })
      showToast('Real Total está pronto para começar do zero.')
    } else {
      setAccounts(seedAccounts)
      setTransactions(seedTransactions)
      setBudgets(seedBudgets)
      setBudgetGroups(seedBudgetGroups)
      setBudgetIncome(seedBudgetIncome)
      setImportForm({ institution: 'Nubank', accountId: seedAccounts[0].id })
      showToast('Dados de demonstração restaurados.')
    }
    setEditingBudget(null)
    setEditingBudgetMonth('')
    setBudgetModalOpen(false)
    setBills([])
    setOutlookAccount(null)
    setOutlookStatus('idle')
    setOutlookMessage('')
    setOutlookCandidates([])
    setCandidatePasswords({})
    setCandidateBusy('')
    setBillModalOpen(false)
    setEditingBill(null)
    setCopyBudgetModalOpen(false)
    setCopyBudgetSource('')
    setStatementModalOpen(false)
    setStatementCandidate(null)
    setSplitModalOpen(false)
    setSplitItem(null)
    setSplitContext(null)
    setImportFile(null)
    setImportStatus('idle')
    setImportRows([])
    setImportWarning('')
    setImportPassword('')
    setImportRequiresPassword(false)
    setGlobalSearch('')
    setActiveView('dashboard')
  }

  const handleIgnoreTransaction = (id) => {
    const transaction = transactions.find((item) => item.id === id)
    if (!transaction) return
    const isManual = transaction.source === 'manual'
    const message = isManual
      ? 'Remover este lançamento manual?\n\nO saldo da conta volta ao valor anterior.'
      : 'Remover este lançamento?\n\nEle sai das listas e do cálculo de realizado do orçamento.'
    if (!window.confirm(message)) return
    if (isManual) setAccounts((current) => adjustBalancesForTransaction(current, transaction, -1))
    if (transaction.linkedBillId) {
      setBills((current) => current.map((bill) => (bill.id === transaction.linkedBillId ? {
        ...bill,
        status: 'pending',
        paidAt: null,
        matchedTransactionId: null,
        matchConfidence: null,
        manualMatch: false,
        paidAmount: null,
        amountDifference: null,
      } : bill)))
    }
    setTransactions((current) => current.filter((item) => item.id !== id))
    showToast(isManual ? 'Lançamento removido e saldo da conta ajustado.' : 'Lançamento removido da lista.')
  }

  // Remoção em lote. Usa a mesma regra da remoção individual: estorno do
  // saldo nos lançamentos manuais e volta do boleto para pendente.
  const handleDeleteTransactions = (ids) => {
    const selected = transactions.filter((item) => ids.includes(item.id))
    if (!selected.length) return

    const manuals = selected.filter((item) => item.source === 'manual')
    const linkedBillIds = selected.map((item) => item.linkedBillId).filter(Boolean)
    const message = selected.length === 1
      ? 'Remover 1 lançamento?\n\nEle sai das listas e do cálculo de realizado do orçamento.'
      : `Remover ${selected.length} lançamentos?\n\nEles saem das listas e do cálculo de realizado do orçamento.${linkedBillIds.length ? `\n\n${linkedBillIds.length} boleto(s) voltam para pendente.` : ''}`
    if (!window.confirm(message)) return

    if (manuals.length) setAccounts((current) => manuals.reduce((acc, transaction) => adjustBalancesForTransaction(acc, transaction, -1), current))
    if (linkedBillIds.length) {
      setBills((current) => current.map((bill) => (linkedBillIds.includes(bill.id) ? {
        ...bill,
        status: 'pending',
        paidAt: null,
        matchedTransactionId: null,
        matchConfidence: null,
        manualMatch: false,
        paidAmount: null,
        amountDifference: null,
      } : bill)))
    }
    setTransactions((current) => current.filter((item) => !ids.includes(item.id)))
    showToast(`${selected.length} lançamento(s) removido(s).`)
  }

  const handleDeleteAllTransactions = () => {
    if (!transactions.length) return
    if (!window.confirm(`Apagar TODOS os ${transactions.length} lançamentos?\n\nSome das listas, do realizado do orçamento e das receitas do painel. Os boletos e o orçamento não são apagados.`)) return
    setTransactions([])
    showToast('Todos os lançamentos foram apagados.')
  }

  const handleExport = () => {
    const header = 'data;descricao;categoria;tipo;valor;instituicao;conta;desdobramento'
    const lines = transactions.map((transaction) => {
      const allocations = getTransactionAllocations(transaction)
      const allocationText = allocations.length > 1 ? allocations.map((allocation) => `${allocation.category}:${allocation.amount.toFixed(2).replace('.', ',')}`).join('|') : ''
      return [transaction.date, transaction.description, transaction.category, transaction.type, transaction.amount.toFixed(2).replace('.', ','), transaction.institution, accounts.find((account) => account.id === transaction.accountId)?.name ?? '', allocationText].join(';')
    })
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'real-total-transacoes.csv'
    link.click()
    URL.revokeObjectURL(url)
    showToast('Arquivo CSV preparado para download.')
  }

  const renderView = () => {
    if (activeView === 'dashboard') return <DashboardPage accounts={accounts} transactions={transactions} budgets={budgets} bills={bills} reminders={reminders} userName={userName} onNavigate={navigate} onImportDemo={() => { navigate('import'); handleDemo('Nubank') }} />
    if (activeView === 'transactions') return <TransactionsPage transactions={transactions} accounts={accounts} search={globalSearch} onSearch={setGlobalSearch} onImport={() => navigate('import')} onExport={handleExport} onIgnore={handleIgnoreTransaction} onSplit={openSplitTransaction} onAdd={() => openTransactionModal()} onDelete={handleDeleteTransactions} onDeleteAll={handleDeleteAllTransactions} />
    if (activeView === 'import') return <ImportPage accounts={accounts} form={importForm} onFormChange={(patch) => patch.institution ? handleInstitutionChange(patch.institution) : setImportForm((current) => ({ ...current, ...patch }))} file={importFile} onFile={handleFile} status={importStatus} rows={importRows} warning={importWarning} password={importPassword} onPasswordChange={setImportPassword} requiresPassword={importRequiresPassword} onParse={handleParse} onDemo={handleDemo} onReset={resetImport} onUpdateRow={handleUpdateRow} onSplit={openSplitReview} onConfirm={handleConfirmImport} onNavigate={navigate} reconciliation={importReconciliation} outlook={{
    configured: isOutlookConfigured(),
    account: outlookAccount,
    status: outlookStatus,
    message: outlookMessage,
    candidates: outlookCandidates.filter((candidate) => candidate.documentType === 'statement' && !candidate.fileMissing),
    busy: candidateBusy,
    onConnect: handleConnectOutlook,
    onSync: handleSyncOutlook,
    onOpen: (candidate) => { setStatementCandidate(candidate); setStatementModalOpen(true) },
    onProcess: handleProcessCandidate,
  }} />
    if (activeView === 'bills') return <BillsPage bills={bills} candidates={outlookCandidates} transactions={transactions} accounts={accounts} outlookAccount={outlookAccount} outlookStatus={outlookStatus} outlookMessage={outlookMessage} configured={isOutlookConfigured()} candidatePasswords={candidatePasswords} candidateBusy={candidateBusy} duplicateCount={duplicateBills.length + orphanDuplicateBudgets.length} onRemoveDuplicates={handleRemoveDuplicates} onConnect={handleConnectOutlook} onDisconnect={handleDisconnectOutlook} onSync={handleSyncOutlook} onAdd={() => openBillModal()} onEdit={openBillModal} onDelete={handleDeleteBill} onMatch={setBillMatchId} onLaunch={openTransactionModal} onReopen={handleReopenBill} onSaveAll={handleSaveAllCandidates} onDiscardAll={handleDiscardAllCandidates} onProcessCandidate={handleProcessCandidate} onCandidatePasswordChange={(id, value) => setCandidatePasswords((current) => ({ ...current, [id]: value }))} onReviewCandidate={(candidate) => openBillModal({ ...candidate, source: 'outlook', sender: candidate.sender, receivedAt: candidate.receivedAt })} onReviewManualBill={(bill) => openBillModal(bill)} onDiscardCandidate={handleDiscardCandidate} onImportStatement={(candidate) => { setStatementCandidate(candidate); setStatementModalOpen(true) }} />
    if (activeView === 'accounts') return <AccountsPage accounts={accounts} transactions={transactions} onAdd={() => { setEditingAccount(null); setAccountModalOpen(true) }} onEdit={(account) => { setEditingAccount(account); setAccountModalOpen(true) }} onImport={() => navigate('import')} />
    if (activeView === 'budgets') return <BudgetsPage budgets={budgets} groups={budgetGroups} income={budgetIncome} transactions={transactions} accounts={accounts} bills={bills} onAdd={openBudgetModal} onEdit={openBudgetModal} onDelete={handleDeleteBudget} onUpdateGroup={handleUpdateGroup} onIncomeChange={handleIncomeChange} onOpenCopy={openCopyBudgetModal} />
    if (activeView === 'simulate') return <SimulationPage simulation={simulation} savedSimulations={savedSimulations} groups={budgetGroups} budgets={budgets} budgetIncome={budgetIncome} onChange={setSimulation} onCopyFrom={handleCopyBudgetToSimulation} onSave={handleSaveSimulation} onLoad={handleLoadSimulation} onDuplicate={handleDuplicateSimulation} onDelete={handleDeleteSimulation} />
    if (activeView === 'goals') return <ComingSoonPage type="goals" />
    return <SettingsPage
      user={user}
      cloudStatus={cloudStatus}
      alert={alertSettings}
      onAlertChange={setAlertSettings}
      onSignOut={isCloudConfigured ? () => cloudSignOut().catch(() => {}) : null}
      onResetDemo={() => handleResetData('demo')}
      onStartEmpty={() => handleResetData('empty')}
    />
  }

  return (
    <div className="app-shell">
      <aside className={classNames('sidebar', mobileNavOpen && 'sidebar--open')}>
        <div className="brand"><span className="brand__mark"><span /></span><span>Real Total</span></div>
        <div className="sidebar__workspace"><span className="eyebrow eyebrow--sidebar">Meu espaço</span><button className="workspace-switch"><span className="workspace-avatar">{userInitial}</span><span><strong>{userName}</strong><small>Plano pessoal</small></span><ChevronDown size={14} /></button></div>
        <nav className="main-nav"><span className="nav-label">Menu</span>{navItems.map((item) => { const Icon = item.icon; return <button key={item.id} className={classNames('nav-item', activeView === item.id && 'nav-item--active')} onClick={() => navigate(item.id)}><Icon size={18} /><span>{item.label}</span>{item.id === 'transactions' && <em>{transactions.length}</em>}{item.soon && <small>Em breve</small>}</button> })}</nav>
        <div className="sidebar__bottom"><div className="sidebar-tip"><span className="sidebar-tip__icon"><Sparkles size={15} /></span><div><strong>Dica do Real Total</strong><p>Importe um extrato para liberar seus relatórios.</p></div><ChevronRight size={14} /></div><button className="nav-item" onClick={() => navigate('settings')}><Settings size={18} /><span>Configurações</span></button><button className="nav-item sidebar-user" onClick={() => navigate('settings')}><span className="user-avatar">{userInitial}</span><div><strong>{userName}</strong><span>{user?.email ?? 'Conta local'}</span></div><LogOut size={15} /></button></div>
      </aside>
      {mobileNavOpen && <button className="sidebar-backdrop" onClick={() => setMobileNavOpen(false)} aria-label="Fechar menu" />}
      <div className="main-area">
        <header className="topbar"><button className="mobile-menu-button" onClick={() => setMobileNavOpen(true)} aria-label="Abrir menu"><Menu size={21} /></button><div className="topbar__context"><span className="topbar__mobile-brand">Real Total</span><span className="topbar__title">{viewTitles[activeView]}</span></div><div className="topbar__actions"><div className="search-field"><Search size={16} /><input value={globalSearch} onChange={(event) => { setGlobalSearch(event.target.value); if (event.target.value) setActiveView('transactions') }} onKeyDown={(event) => { if (event.key === 'Enter') setActiveView('transactions') }} placeholder="Buscar transações" /></div><NotificationBell reminders={reminders} open={bellOpen} onToggle={() => setBellOpen((current) => !current)} onNavigate={navigate} /><span className="topbar-avatar">{userInitial}</span></div></header>
        <main className="main-content">{renderView()}</main>
      </div>
      <AccountModal open={accountModalOpen} account={editingAccount} onClose={() => { setAccountModalOpen(false); setEditingAccount(null) }} onSave={handleSaveAccount} />
      <TransactionModal open={transactionModalOpen} accounts={accounts} bills={bills} linkedBill={transactionModalBill} onClose={() => { setTransactionModalOpen(false); setTransactionModalBill(null) }} onSave={handleSaveTransaction} />

      <BillMatchModal
        open={Boolean(billMatchId)}
        bill={bills.find((bill) => bill.id === billMatchId) ?? null}
        candidates={billMatchId ? billMatchCandidates(
          bills.find((bill) => bill.id === billMatchId) ?? null,
          transactions,
          bills.filter((bill) => bill.id !== billMatchId && bill.matchedTransactionId).map((bill) => bill.matchedTransactionId),
        ) : []}
        accounts={accounts}
        onClose={() => setBillMatchId('')}
        onLink={(transaction) => handleLinkBillTransaction(bills.find((bill) => bill.id === billMatchId), transaction)}
        onUnlink={() => handleUnlinkBillTransaction(bills.find((bill) => bill.id === billMatchId))}
      />

      <BudgetModal open={budgetModalOpen} budget={editingBudget} groups={budgetGroups} accounts={accounts} bills={bills} monthKey={editingBudgetMonth} onClose={() => { setBudgetModalOpen(false); setEditingBudget(null); setEditingBudgetMonth('') }} onSave={handleSaveBudget} />
      <SplitTransactionModal open={splitModalOpen} item={splitItem} budgets={budgets} onUpdatePlanned={handleUpdatePlannedFromSplit} onClose={() => { setSplitModalOpen(false); setSplitItem(null); setSplitContext(null) }} onSave={handleSaveSplit} />
      <BillModal open={billModalOpen} bill={editingBill} onClose={() => { setBillModalOpen(false); setEditingBill(null) }} onSave={handleSaveBill} />
      <StatementImportModal open={statementModalOpen} candidate={statementCandidate} accounts={accounts} onClose={() => { setStatementModalOpen(false); setStatementCandidate(null) }} onImport={handleImportStatementCandidate} />
      <BudgetCopyModal open={copyBudgetModalOpen} sourceMonth={copyBudgetSource} onClose={() => setCopyBudgetModalOpen(false)} onCopy={handleCopyBudget} />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}

export default App
