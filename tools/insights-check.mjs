// Testa as contas por trás do painel de Insights.
//
// O painel precisa acertar tres coisas que o usuario vai conferir na tela:
// quem passou do previsto, o que foi gasto sem plano, e se a poupanca faz
// sentido com a receita do mes.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'src', 'App.jsx'), 'utf8')

function grab(name) {
  const start = src.indexOf(`function ${name}(`)
  if (start === -1) throw new Error(`nao achei ${name}`)
  // Os parametros podem ser desestruturados, entao a chave abre depois do ')'.
  const bodyStart = src.indexOf('{', src.indexOf(')', start))
  let depth = 0
  let i = bodyStart
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error(`nao fechei ${name}`)
}

const helper = `const normalizeText = (value) =>
  String(value ?? '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
const isYieldTransaction = (transaction) => {
  if (transaction.type !== 'income') return false
  const text = normalizeText(\`\${transaction.description ?? ''} \${transaction.merchant ?? ''}\`)
  return transaction.category === 'Investimentos' || /rendimento|rendimentoCaixinha|dividendo|juros|bonus|resgate|aplicacao/.test(text)
}
const plannedBudgetAmount = (item, monthKey) => Number(item.plannedByMonth?.[monthKey] ?? item.defaultAmount ?? item.limit ?? 0)
const getTransactionAllocations = (transaction) => {
  const allocations = Array.isArray(transaction?.allocations) ? transaction.allocations.filter((a) => a && a.category) : []
  if (allocations.length) return allocations.map((a) => ({ ...a, amount: Number(a.amount || 0) }))
  return [{ category: transaction?.category ?? 'Outros', amount: Number(transaction?.amount || 0) }]
}`

const names = ['categorySpendForMonth', 'plannedByCategoryForMonth', 'buildInsights']
const api = new Function(`${helper}\n${names.map(grab).join('\n\n')}; return { buildInsights, categorySpendForMonth, plannedByCategoryForMonth }`)()

let failures = 0
const check = (label, ok, detalhe = '') => {
  if (ok) console.log(`OK   ${label}`)
  else {
    failures += 1
    console.log(`FALHA ${label} ${detalhe}`)
  }
}

const t = (over) => ({ accountId: 'acc-1', status: 'confirmed', source: 'upload', merchant: '', ...over })

const transacoes = [
  t({ type: 'expense', category: 'Moradia', amount: 1863.09, date: '2026-10-05' }),
  t({ type: 'expense', category: 'Compras', amount: 1244.03, date: '2026-10-05' }),
  t({ type: 'expense', category: 'Mercado', amount: 520.4, date: '2026-10-08' }),
  t({ type: 'income', category: 'Trabalho', amount: 4353.76, date: '2026-10-06' }),
  t({ type: 'income', category: 'Investimentos', amount: 0.01, date: '2026-10-07', description: 'Rendimento' }),
  t({ type: 'transfer', category: 'Transferência', amount: 2000, date: '2026-10-07' }),
  t({ type: 'expense', category: 'Mercado', amount: 480.0, date: '2026-09-20' }),
]

const budgets = [
  { id: 'b1', category: 'Moradia', plannedByMonth: { '2026-10': 1573 }, defaultAmount: 1573 },
  { id: 'b2', category: 'Mercado', plannedByMonth: { '2026-10': 600 }, defaultAmount: 600 },
]

const r = api.buildInsights({ transactions: transacoes, budgets, monthKey: '2026-10', previousMonthKey: '2026-09' })

console.log('=== resumo ===')
console.log(`  receita ${r.summary.income}  despesa ${r.summary.expenses}  sobra ${r.summary.net}  poupanca ${r.summary.savingsRate}%`)

console.log('\n=== passou do previsto ===')
for (const item of r.overspent) console.log(`  ${item.category}: previsto ${item.planned} real ${item.actual} excesso ${item.excess}`)

console.log('\n=== sem plano ===')
for (const item of r.unplanned) console.log(`  ${item.category}: ${item.actual}`)

console.log('\n=== abaixo do previsto ===')
for (const item of r.underspent) console.log(`  ${item.category}: sobrou ${item.left}`)

console.log('\n=== maiores gastos ===')
for (const item of r.top) console.log(`  ${item.category}: ${item.value.toFixed(2)} (${Math.round(item.share * 100)}%)`)

console.log('\n=== variacao vs setembro ===')
for (const item of r.trends) console.log(`  ${item.category}: ${item.before} -> ${item.after} (${item.up ? '+' : ''}${item.delta})`)

check('receita ignora rendimento', r.summary.income === 4353.76, `= ${r.summary.income}`)
check('despesa soma o mes certo', r.summary.expenses === 1863.09 + 1244.03 + 520.4, `= ${r.summary.expenses}`)
check('transferencia nao entra como despesa', !r.top.some((i) => i.category === 'Transferência'))
check('rendimento nao entra como receita', r.summary.income === 4353.76)
check('sobra e positiva quando receita passa da despesa', r.summary.net > 0, `= ${r.summary.net}`)
check('taxa de poupanca coerente', Math.abs(r.summary.savingsRate - Math.round((r.summary.net / 4353.76) * 100)) <= 1)

check('Moradia aparece acima do previsto', r.overspent.some((i) => i.category === 'Moradia' && Math.abs(i.excess - 290.09) < 0.01), JSON.stringify(r.overspent))
check('Mercado nao aparece acima do previsto', !r.overspent.some((i) => i.category === 'Mercado'))
check('Compras aparece sem plano', r.unplanned.some((i) => i.category === 'Compras' && Math.abs(i.actual - 1244.03) < 0.01))
check('Mercado aparece abaixo do previsto', r.underspent.some((i) => i.category === 'Mercado' && Math.abs(i.left - 79.6) < 0.01))
check('maior gasto e Moradia', r.top[0]?.category === 'Moradia')
// Setembro tem 480 de Mercado. Se o filtro de mes estivesse furado, outubro
// apareceria com 1000,40.
const mercadoOutubro = r.top.find((i) => i.category === 'Mercado')?.value ?? 0
check('setembro nao entra nas contas de outubro', Math.abs(mercadoOutubro - 520.4) < 0.01, `= ${mercadoOutubro}`)
check('variacao de Mercado contra setembro', r.trends.some((t2) => t2.category === 'Mercado' && Math.abs(t2.delta - 40.4) < 0.01), JSON.stringify(r.trends))
check('marcou que existe comparacao', r.summary.hasComparison === true)

// Mes sem historico: precisa funcionar sem comparacao.
const sozinho = api.buildInsights({ transactions: transacoes, budgets, monthKey: '2026-10' })
check('funciona sem mes anterior', sozinho.summary.hasComparison === false && sozinho.trends.length === 0)
check('taxa de poupanca existe sem comparacao', typeof sozinho.summary.savingsRate === 'number')

// Nada no mes: nao pode quebrar nem inventar numero.
const vazio = api.buildInsights({ transactions: [], budgets, monthKey: '2026-10' })
check('mes vazio nao quebra', vazio.summary.expenses === 0 && vazio.top.length === 0)
check('mes vazio mantem o previsto', vazio.summary.planned > 0)

console.log(failures ? `\n${failures} falha(s)` : '\n tudo certo')
process.exit(failures ? 1 : 0)