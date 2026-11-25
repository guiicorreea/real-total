import sys

p = 'src/App.jsx'
s = open(p, encoding='utf-8').read()
count = 0

def rep(old, new, label):
    global s, count
    if old not in s:
        print('NOT FOUND:', label)
        sys.exit(1)
    if s.count(old) != 1:
        print('NOT UNIQUE (%d):' % s.count(old), label)
        sys.exit(1)
    s = s.replace(old, new)
    count += 1
    print('ok:', label)

# 1) Helper unico de realizado por item/mes (usado em alertas e no "marcar como realizado").
rep(
"""  return [{ category: transaction?.category ?? 'Outros', amount: Number(transaction?.amount || 0) }]
}
""",
"""  return [{ category: transaction?.category ?? 'Outros', amount: Number(transaction?.amount || 0) }]
}

// Realizado de um item do orcamento em um mes: alocacao direta, boleto
// vinculado, palavras-chave e ajuste manual. Fonte unica para alertas,
// orcamento e o botao "marcar como realizado".
function realizedForBudgetMonth(budget, monthKey, transactions = []) {
  let spent = Number(budget?.adjustments?.[monthKey] ?? 0)
  for (const transaction of transactions || []) {
    if (transaction.type !== 'expense') continue
    if (!String(transaction.date || '').startsWith(monthKey)) continue
    if (budget.accountId && transaction.accountId !== budget.accountId) continue
    const allocations = getTransactionAllocations(transaction)
    if (allocations.some((allocation) => allocation.budgetItemId === budget.id)) {
      spent += allocations
        .filter((allocation) => allocation.budgetItemId === budget.id)
        .reduce((sum, allocation) => sum + allocation.amount, 0)
      continue
    }
    if (budget.billId && transaction.linkedBillId === budget.billId) {
      spent += allocations
        .filter((allocation) => !allocation.budgetItemId)
        .reduce((sum, allocation) => sum + allocation.amount, 0)
      continue
    }
    const keywords = Array.isArray(budget.keywords) ? budget.keywords.filter(Boolean) : []
    if (!keywords.length) continue
    const text = normalizeText(`${transaction.description ?? ''} ${transaction.merchant ?? ''}`)
    spent += allocations
      .filter((allocation) => !allocation.budgetItemId && allocation.category === budget.category && keywords.some((keyword) => text.includes(normalizeText(keyword))))
      .reduce((sum, allocation) => sum + allocation.amount, 0)
  }
  return spent
}
""",
'helper realizedForBudgetMonth')

# 2) Alertas de boleto usam o helper (e continuam ignorando realizados).
rep(
"""    if (linkedBudget) {
      const month = monthKeyFromDate(bill.dueDate)
      let spent = Number(linkedBudget.adjustments?.[month] ?? 0)
      const monthTransactions = (transactions || []).filter((transaction) => transaction.type === 'expense' && transaction.date.startsWith(month))
      for (const transaction of monthTransactions) {
        if (linkedBudget.accountId && transaction.accountId !== linkedBudget.accountId) continue
        const allocations = getTransactionAllocations(transaction)
        if (allocations.some((allocation) => allocation.budgetItemId === linkedBudget.id)) {
          spent += allocations.filter((allocation) => allocation.budgetItemId === linkedBudget.id).reduce((sum, allocation) => sum + allocation.amount, 0)
          continue
        }
        if (transaction.linkedBillId === linkedBudget.billId) {
          spent += allocations.filter((allocation) => !allocation.budgetItemId).reduce((sum, allocation) => sum + allocation.amount, 0)
          continue
        }
        const keywords = Array.isArray(linkedBudget.keywords) ? linkedBudget.keywords.filter(Boolean) : []
        if (!keywords.length) continue
        const text = normalizeText(`${transaction.description ?? ''} ${transaction.merchant ?? ''}`)
        spent += allocations.filter((allocation) => allocation.category === linkedBudget.category && keywords.some((keyword) => text.includes(normalizeText(keyword)))).reduce((sum, allocation) => sum + allocation.amount, 0)
      }
      const planned = plannedBudgetAmount(linkedBudget, month)
      const billAmount = Number(bill.amount || 0) * Number(bill.mySharePercent ?? 100) / 100
      const adjusted = Number(linkedBudget.adjustments?.[month] ?? 0)
      // Já realizado: chegou no previsto, no valor do boleto ou recebeu um
      // ajuste manual de realizado. Não deve gerar alerta de vencimento.
      if (adjusted > 0) continue
      if (planned > 0 && spent >= planned - 0.01) continue
      if (billAmount > 0 && spent >= billAmount - 0.01) continue
    }""",
"""    if (linkedBudget) {
      const month = monthKeyFromDate(bill.dueDate)
      const spent = realizedForBudgetMonth(linkedBudget, month, transactions)
      const planned = plannedBudgetAmount(linkedBudget, month)
      const adjusted = Number(linkedBudget.adjustments?.[month] ?? 0)
      const billAmount = billShareAmount(bill)
      // Já realizado: recebeu ajuste manual, chegou no previsto ou no valor
      // do boleto. Não deve gerar alerta de vencimento.
      if (adjusted > 0) continue
      if (planned > 0 && spent >= planned - 0.01) continue
      if (billAmount > 0 && spent >= billAmount - 0.01) continue
    }""",
'bill reminder loop')

# 3) Alertas de item manual tambem respeitam o realizado.
rep(
"""    const dueDate = budget.dueByMonth?.[currentMonth] || budget.defaultDueDate || ''
    if (!dueDate) continue
    reminders.push({""",
"""    const dueDate = budget.dueByMonth?.[currentMonth] || budget.defaultDueDate || ''
    if (!dueDate) continue
    // Item manual já realizado (ou com ajuste manual) não gera alerta.
    if (Number(budget.adjustments?.[currentMonth] ?? 0) > 0) continue
    const planned = plannedBudgetAmount(budget, currentMonth)
    if (planned > 0 && realizedForBudgetMonth(budget, currentMonth, transactions) >= planned - 0.01) continue
    reminders.push({""",
'budget reminder loop')

# 4) Assinatura usada nos lembretes: eles tem label, nao description.
rep(
"""  return [normalizeText(bill?.description ?? ''), bill?.dueDate ?? '', Number(bill?.amount || 0).toFixed(2)].join('|')""",
"""  return [normalizeText(bill?.description ?? bill?.label ?? ''), bill?.dueDate ?? '', Number(bill?.amount || 0).toFixed(2)].join('|')""",
'billSignature label')

# 5) Orcamento abre no ultimo mes com dados, mesmo com mes salvo vazio.
rep(
"""  const initialMonth = (() => {
    try {
      const stored = window.localStorage.getItem('real-total:last-budget-month')
      if (stored) return stored
    } catch {}
    // Prefere o mês mais recente que tenha planejamento (boletos/itens),
    // para não abrir em um mês vazio quando os dados estão em outro.
    const plannedMonths = budgets.flatMap((budget) => Object.keys(budget.plannedByMonth ?? {})).sort().reverse()
    if (plannedMonths.length) return plannedMonths[0]
    return monthKeyFromDate(transactions[0]?.date) || monthKeyFromDate(new Date().toISOString())
  })()""",
"""  const initialMonth = (() => {
    let stored = ''
    try { stored = window.localStorage.getItem('real-total:last-budget-month') ?? '' } catch {}
    const plannedMonths = budgets.flatMap((budget) => Object.keys(budget.plannedByMonth ?? {})).sort().reverse()
    const hasData = (key) => Boolean(key) && (
      budgets.some((budget) => budget.plannedByMonth && key in budget.plannedByMonth)
      || transactions.some((transaction) => String(transaction.date || '').startsWith(key))
    )
    // Um mês salvo sem nenhum dado (ex.: dezembro vazio) escondia os boletos
    // de novembro. Só respeita o mês salvo se ele tiver algo.
    if (stored && hasData(stored)) return stored
    if (plannedMonths.length) return plannedMonths[0]
    return monthKeyFromDate(transactions[0]?.date) || monthKeyFromDate(new Date().toISOString())
  })()""",
'initialMonth validation')

# 6) Realizado do grupo inclui ajustes manuais (igual as linhas).
rep(
"""    const attributed = items.reduce((sum, budget) => sum + getSpent(budget), 0)

    return { ...group, items, planned, realized, attributed, difference: planned - realized }""",
"""    const attributed = items.reduce((sum, budget) => sum + getSpent(budget), 0)
    const adjustments = items.reduce((sum, budget) => sum + Number(budget.adjustments?.[monthKey] ?? 0), 0)

    return { ...group, items, planned, realized: realized + adjustments, attributed, difference: planned - realized - adjustments }""",
'group realized adjustments')

# 7) Palavras-chave nao contam de novo o que ja foi alocado a outro item.
rep(
"""        total += allocations
          .filter((allocation) => allocation.category === budget.category && keywords.some((keyword) => text.includes(normalizeText(keyword))))
          .reduce((sum, allocation) => sum + allocation.amount, 0)
      }
      spent[budget.id] = total + Number(budget.adjustments?.[monthKey] ?? 0)""",
"""        total += allocations
          .filter((allocation) => !allocation.budgetItemId && allocation.category === budget.category && keywords.some((keyword) => text.includes(normalizeText(keyword))))
          .reduce((sum, allocation) => sum + allocation.amount, 0)
      }
      spent[budget.id] = total + Number(budget.adjustments?.[monthKey] ?? 0)""",
'keyword allocation filter')

# 8) Editar item preservava id/source/billId e novo item salvava valor 0.
rep(
"""    setBudgets((current) => {
      const normalized = normalizeBudgetItem(form)
      if (editingBudget) {
        return current.map((budget) => {
          if (budget.id !== editingBudget.id) return budget
          const next = { ...budget, ...normalized, adjustments: budget.adjustments ?? {} }
          if (budget.billId && nextDueDate) {""",
"""    setBudgets((current) => {
      const normalized = normalizeBudgetItem(form)
      if (editingBudget) {
        return current.map((budget) => {
          if (budget.id !== editingBudget.id) return budget
          // O formulario nao carrega esses campos; sem preserva-los o item
          // perdia o vinculo com o boleto, trocava de id e virava duplicata.
          const next = {
            ...budget,
            ...normalized,
            id: budget.id,
            source: budget.source,
            billId: budget.billId,
            adjustments: budget.adjustments ?? {},
          }
          if (budget.billId && nextDueDate) {""",
'save budget edit preserve fields')

rep(
"""      const month = editingBudgetMonth
      const amount = Number(normalized.defaultAmount || 0)
      return [...current, { ...normalized, defaultAmount: 0, plannedByMonth: { ...normalized.plannedByMonth, [month]: amount }, id: `budget-${normalized.label.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}-${Date.now()}` }]""",
"""      const month = editingBudgetMonth
      // normalizeBudgetItem zera defaultAmount quando há plannedByMonth,
      // então o valor precisa vir do planejamento do mês (antes salvava 0).
      const amount = Number(normalized.plannedByMonth?.[month] ?? 0)
      return [...current, { ...normalized, defaultAmount: 0, plannedByMonth: { ...normalized.plannedByMonth, [month]: amount }, id: `budget-${normalized.label.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}-${Date.now()}` }]""",
'new budget amount')

# 9) Copiar mes nao deve copiar boletos (eles so existem na competencia).
rep(
"""  const handleCopyBudget = (targetMonth) => {
    setBudgets((current) => current.map((budget) => {
      const sourceDueDate = budget.dueByMonth?.[copyBudgetSource] ?? ''""",
"""  const handleCopyBudget = (targetMonth) => {
    setBudgets((current) => current.map((budget) => {
      // Boletos nunca recorrem: só o planejamento manual é copiado.
      if (budget.source === 'bill') return budget
      const sourceDueDate = budget.dueByMonth?.[copyBudgetSource] ?? ''""",
'copy budget skips bills')

# 10) Marcar como realizado usa o helper e data dentro do mes do item.
rep(
"""    const planned = plannedBudgetAmount(budget, monthKey)

    // Calcula o realizado do item (mesma lógica do BudgetsPage)
    let spent = 0
    const monthTransactions = transactions.filter((t) => t.type === 'expense' && t.date.startsWith(monthKey))
    for (const transaction of monthTransactions) {
      if (budget.accountId && transaction.accountId !== budget.accountId) continue
      const allocations = getTransactionAllocations(transaction)

      // Nível 0: alocação direta no item do orçamento
      if (allocations.some((a) => a.budgetItemId === budget.id)) {
        spent += allocations
          .filter((a) => a.budgetItemId === budget.id)
          .reduce((sum, a) => sum + a.amount, 0)
        continue
      }

      // Nível 1: boleto vinculado
      if (budget.billId && transaction.linkedBillId === budget.billId) {
        spent += allocations
          .filter((a) => !a.budgetItemId)
          .reduce((sum, a) => sum + a.amount, 0)
        continue
      }

      // Nível 2: palavras-chave
      const keywords = Array.isArray(budget.keywords) ? budget.keywords.filter(Boolean) : []
      if (!keywords.length) continue
      const text = normalizeText(`${transaction.description ?? ''} ${transaction.merchant ?? ''}`)
      spent += allocations
        .filter((a) => a.category === budget.category && keywords.some((k) => text.includes(normalizeText(k))))
        .reduce((sum, a) => sum + a.amount, 0)
    }

    spent += Number(budget.adjustments?.[monthKey] ?? 0)

    const remaining = Math.round((planned - spent) * 100) / 100""",
"""    const planned = plannedBudgetAmount(budget, monthKey)
    const spent = realizedForBudgetMonth(budget, monthKey, transactions)
    const remaining = Math.round((planned - spent) * 100) / 100""",
'mark realized helper')

rep(
"""    const transaction = {
      id: `transaction-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date: todayIsoDate(),
      description: budget.label,""",
"""    // O lançamento precisa cair no mês do item, senão o realizado de outro
    // mês nunca fecha (ex.: marcar novembro estando em dezembro).
    const today = todayIsoDate()
    const transaction = {
      id: `transaction-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date: today.startsWith(monthKey) ? today : shiftDateToMonth(today, monthKey),
      description: budget.label,""",
'mark realized date')

# 11) Desfazer pagamento devolve saldo e desvincula a transacao mantida.
rep(
"""    if (!window.confirm(message)) return
    if (shouldRemoveLinked) setTransactions((current) => current.filter((transaction) => transaction.id !== linked.id))
    setBills((current) => current.map((item) => item.id === bill.id ? {""",
"""    if (!window.confirm(message)) return
    if (shouldRemoveLinked) {
      setAccounts((current) => adjustBalancesForTransaction(current, linked, -1))
      setTransactions((current) => current.filter((transaction) => transaction.id !== linked.id))
    } else if (linked) {
      // Sem isso o extrato continuaria contando como pago no orçamento.
      setTransactions((current) => current.map((transaction) => transaction.id === linked.id ? { ...transaction, linkedBillId: null } : transaction))
    }
    setBills((current) => current.map((item) => item.id === bill.id ? {""",
'reopen bill balance/link')

# 12) Desvincular boleto limpa o vinculo na transacao.
rep(
"""  const handleUnlinkBillTransaction = (bill) => {
    setBills((current) => current.map((item) => item.id === bill.id ? {""",
"""  const handleUnlinkBillTransaction = (bill) => {
    if (bill.matchedTransactionId) {
      setTransactions((current) => current.map((transaction) => transaction.id === bill.matchedTransactionId ? { ...transaction, linkedBillId: null } : transaction))
    }
    setBills((current) => current.map((item) => item.id === bill.id ? {""",
'unlink clears transaction link')

# 13) Nao salvar (nem subir para a nuvem) antes de terminar a hidratacao.
rep(
"""  useEffect(() => saveState({
    accounts,
    transactions,
    bills,
    budgets,
    budgetGroups,
    budgetIncome,
    simulation,
    savedSimulations,
    outlookCandidates: outlookCandidates.map(toStorableCandidate),
  }), [accounts, transactions, bills, budgets, budgetGroups, budgetIncome, simulation, savedSimulations, outlookCandidates])""",
"""  useEffect(() => {
    // Sem o guarda, o estado inicial (local/seed) era enviado para a nuvem
    // antes do pull terminar, podendo sobrescrever os dados reais.
    if (!hydrated) return
    saveState({
      accounts,
      transactions,
      bills,
      budgets,
      budgetGroups,
      budgetIncome,
      simulation,
      savedSimulations,
      outlookCandidates: outlookCandidates.map(toStorableCandidate),
    })
  }, [hydrated, accounts, transactions, bills, budgets, budgetGroups, budgetIncome, simulation, savedSimulations, outlookCandidates])""",
'save effect hydration guard')

# 14) Reset "começar do zero" realmente zera o orçamento.
rep(
"""      setAccounts([])
      setTransactions([])
      setBudgets(seedBudgets)
      setBudgetGroups(seedBudgetGroups)""",
"""      setAccounts([])
      setTransactions([])
      setBudgets([])
      setBudgetGroups(seedBudgetGroups)""",
'reset empty budgets')

# 15) Remover duplicados mantem o boleto pago quando existe um.
rep(
"""  const duplicateBills = useMemo(() => {
    const seen = new Map()
    return bills.filter((bill) => {
      const signature = billSignature(bill)
      if (seen.has(signature)) return true
      seen.set(signature, bill.id)
      return false
    })
  }, [bills])""",
"""  const duplicateBills = useMemo(() => {
    const groups = new Map()
    for (const bill of bills) {
      const signature = billSignature(bill)
      groups.set(signature, [...(groups.get(signature) ?? []), bill])
    }
    const duplicates = []
    for (const list of groups.values()) {
      if (list.length < 2) continue
      // Mantém o registro já pago: apagar o pago deixaria o pendente vivo
      // e o alerta continuaria aparecendo.
      const kept = list.find((bill) => bill.status === 'paid' || bill.matchedTransactionId || bill.paidAt) ?? list[0]
      for (const bill of list) if (bill.id !== kept.id) duplicates.push(bill)
    }
    return duplicates
  }, [bills])""",
'dedupe keeps paid bill')

# 16) Modal de pagamento nao lista boletos ja pagos sem conciliacao.
rep(
"""  const pendingBills = bills.filter((bill) => !bill.matchedTransactionId)""",
"""  const pendingBills = bills.filter((bill) => bill.status !== 'paid' && !bill.matchedTransactionId && !bill.paidAt)""",
'pending bills excludes paid')

# 17) Excluir item vindo de boleto nao pode virar item zumbi (a sincronizacao recria).
rep(
"""  const handleDeleteBudget = (id) => {
    const budget = budgets.find((item) => item.id === id)
    if (!budget || !window.confirm(`Excluir o item ${budget.label}?`)) return
    setBudgets((current) => current.filter((item) => item.id !== id))
    showToast('Item excluído do orçamento.')
  }""",
"""  const handleDeleteBudget = (id) => {
    const budget = budgets.find((item) => item.id === id)
    if (!budget) return
    const message = budget.billId
      ? `Este item vem do boleto ${budget.label}. Excluir o item e também o boleto?`
      : `Excluir o item ${budget.label}?`
    if (!window.confirm(message)) return
    // A sincronização recria itens de boletos; então o boleto também sai.
    if (budget.billId) setBills((current) => current.filter((bill) => bill.id !== budget.billId))
    setBudgets((current) => current.filter((item) => item.id !== id))
    showToast('Item excluído do orçamento.')
  }""",
'delete budget linked bill')

# 18) Insights usa receita manual quando nao ha receita no extrato.
rep(
"""function buildInsights({ transactions, budgets, monthKey, previousMonthKey }) {
  const current = categorySpendForMonth(transactions, monthKey)
  const previous = previousMonthKey ? categorySpendForMonth(transactions, previousMonthKey) : null""",
"""function buildInsights({ transactions, budgets, monthKey, previousMonthKey, manualIncome = 0 }) {
  const current = categorySpendForMonth(transactions, monthKey)
  // Mesma regra do painel: sem receita no extrato, vale a receita manual.
  if (current.income <= 0 && Number(manualIncome) > 0) {
    current.income = Number(manualIncome)
    current.net = current.income + current.yield - current.expenses
  }
  const previous = previousMonthKey ? categorySpendForMonth(transactions, previousMonthKey) : null""",
'buildInsights manual income')

rep(
"""function InsightsPage({ transactions, budgets, accounts }) {""",
"""function InsightsPage({ transactions, budgets, accounts, income }) {""",
'insights signature')

rep(
"""  const availableMonths = useMemo(() => [...new Set(transactions.map((transaction) => monthKeyFromDate(transaction.date)).filter(Boolean))].sort().reverse(), [transactions])
  const insights = useMemo(() => buildInsights({
    transactions,
    budgets,
    monthKey,
    previousMonthKey: shiftMonth(monthKey, -1),
  }), [transactions, budgets, monthKey])""",
"""  const availableMonths = useMemo(() => {
    const keys = new Set(transactions.map((transaction) => monthKeyFromDate(transaction.date)).filter(Boolean))
    for (const budget of budgets) Object.keys(budget.plannedByMonth ?? {}).forEach((key) => keys.add(key))
    return [...keys].sort().reverse()
  }, [transactions, budgets])
  const manualIncome = Number(income?.monthly?.[monthKey] ?? 0) + Number(income?.extra?.[monthKey] ?? 0)
  const insights = useMemo(() => buildInsights({
    transactions,
    budgets,
    monthKey,
    previousMonthKey: shiftMonth(monthKey, -1),
    manualIncome,
  }), [transactions, budgets, monthKey, manualIncome])""",
'insights months and manual income')

rep(
"""          : <InsightsPage transactions={transactions} budgets={budgets} accounts={accounts} />}""",
"""          : <InsightsPage transactions={transactions} budgets={budgets} accounts={accounts} income={budgetIncome} />}""",
'insights call')

# 19) Conta sem lastUpdated nao pode quebrar a tela.
rep(
"""      {isCard ? <><span className="account-card__label">Fatura atual</span><div className="progress-track progress-track--thin"><span style={{ width: `${usage}%` }} /></div><span className="account-card__limit">Limite de {formatCurrency(account.limit)}</span></> : <span className="account-card__updated"><RefreshCw size={13} /> Atualizado {account.lastUpdated.toLowerCase()}</span>}""",
"""      {isCard ? <><span className="account-card__label">Fatura atual</span><div className="progress-track progress-track--thin"><span style={{ width: `${usage}%` }} /></div><span className="account-card__limit">Limite de {formatCurrency(account.limit)}</span></> : <span className="account-card__updated"><RefreshCw size={13} /> Atualizado {(account.lastUpdated ?? 'agora').toLowerCase()}</span>}""",
'account lastUpdated fallback')

# 20) Numeros fixos/de demonstracao no painel viravam informacao falsa.
rep(
"""            <div className="balance-card__trend"><TrendingUp size={15} /> 8,4% <span>vs. mês anterior</span></div>""",
"""            <div className="balance-card__trend"><TrendingUp size={15} /> <span>saldo consolidado das contas</span></div>""",
'dashboard fake trend')

rep(
"""          <StatCard label="Receitas do mês" value={formatCurrency(income)} helper="+12,8% vs. mês anterior" trend icon={ArrowDownRight} tone="green" />""",
"""          <StatCard label="Receitas do mês" value={formatCurrency(income)} helper={income > 0 ? 'extrato ou receita manual' : 'nenhuma receita neste mês'} icon={ArrowDownRight} tone="green" />""",
'dashboard fake income helper')

rep(
"""          <p>Você está guardando mais este mês.</p>""",
"""          <p>{income > 0 ? (savingsRate >= 20 ? 'Boa margem de sobra neste mês.' : savingsRate > 0 ? 'Sobra pequena neste mês.' : 'As despesas consumiram a receita.') : 'Sem receita registrada neste mês.'}</p>""",
'dashboard savings text')

rep(
"""        <div className="summary-tile"><span className="eyebrow">Saldo consolidado</span><strong>{formatCurrency(positiveBalance - debt)}</strong><span className="summary-tile__hint"><TrendingUp size={14} /> 8,4% este mês</span></div>""",
"""        <div className="summary-tile"><span className="eyebrow">Saldo consolidado</span><strong>{formatCurrency(positiveBalance - debt)}</strong><span className="summary-tile__hint"><TrendingUp size={14} /> saldo de todas as contas</span></div>""",
'accounts fake trend')

open(p, 'w', encoding='utf-8').write(s)
print('TOTAL', count)
