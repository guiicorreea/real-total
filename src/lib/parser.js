import Papa from 'papaparse'
import readXlsxFile from 'read-excel-file/browser'
import { categoryOptions, demoRows } from '../data/seed.js'

export const statementAdapters = {
  Nubank: { id: 'nubank', label: 'Nubank', formats: ['csv', 'xlsx', 'pdf'] },
  Bradesco: { id: 'bradesco', label: 'Bradesco', formats: ['csv', 'xlsx', 'pdf'] },
  PicPay: { id: 'picpay', label: 'PicPay', formats: ['csv', 'xlsx', 'pdf'] },
  generic: { id: 'generic', label: 'Genérico', formats: ['csv', 'xlsx', 'pdf'] },
}

const headerAliases = {
  date: [
    'data',
    'date',
    'data da movimentação',
    'data do lançamento',
    'data da transação',
    'data movimento',
  ],
  description: [
    'descrição',
    'descricao',
    'description',
    'merchant',
    'estabelecimento',
    'histórico',
    'historico',
    'lançamento',
    'lancamento',
    'memória',
    'memoria',
    'detalhe',
    'descricao do lancamento',
  ],
  amount: ['valor', 'amount', 'valor da transação', 'valor movimentado', 'montante'],
  debit: ['débito', 'debito', 'saída', 'saida', 'valor débito', 'valor debito'],
  credit: ['crédito', 'credito', 'entrada', 'valor crédito', 'valor credito'],
  type: ['tipo', 'type', 'natureza', 'operação', 'operacao', 'tipo de operação'],
  category: ['categoria', 'category', 'classificação', 'classificacao'],
  balance: ['saldo', 'balance', 'saldo após', 'saldo apos'],
}

const normalizeText = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

function findColumn(row, aliases) {
  const keys = Object.keys(row)
  const normalizedKeys = keys.map((key) => ({ key, normalized: normalizeText(key) }))
  const aliasSet = aliases.map(normalizeText)

  const exact = normalizedKeys.find(({ normalized }) => aliasSet.includes(normalized))
  if (exact) return exact.key

  const partial = normalizedKeys.find(({ normalized }) =>
    aliasSet.some((alias) => normalized.includes(alias) || alias.includes(normalized)),
  )

  return partial?.key
}

function parseAmount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value === null || value === undefined || String(value).trim() === '') return 0

  let text = String(value).trim()
  const parenthesized = text.startsWith('(') && text.endsWith(')')
  const hasExplicitMinus = text.includes('-')
  text = text.replace(/[^\d,.-]/g, '')

  if (!text) return 0

  const comma = text.lastIndexOf(',')
  const dot = text.lastIndexOf('.')

  if (comma !== -1 && dot !== -1) {
    if (comma > dot) {
      text = text.replace(/\./g, '').replace(',', '.')
    } else {
      text = text.replace(/,/g, '')
    }
  } else if (comma !== -1) {
    const decimalDigits = text.length - comma - 1
    text = decimalDigits === 2 ? text.replace(',', '.') : text.replace(/,/g, '')
  } else if (dot !== -1) {
    const decimalDigits = text.length - dot - 1
    if (decimalDigits === 3 && text.split('.').length > 1) {
      text = text.replace(/\./g, '')
    }
  }

  const result = Number(text)
  if (!Number.isFinite(result)) return 0
  return parenthesized || hasExplicitMinus ? -Math.abs(result) : result
}

const monthNumberByName = {
  jan: 1, janeiro: 1,
  fev: 2, fevereiro: 2,
  mar: 3, marco: 3, março: 3,
  abr: 4, abril: 4,
  mai: 5, maio: 5,
  jun: 6, junho: 6,
  jul: 7, julho: 7,
  ago: 8, agosto: 8,
  set: 9, setembro: 9,
  out: 10, outubro: 10,
  nov: 11, novembro: 11,
  dez: 12, dezembro: 12,
}

function findDateInText(value) {
  const text = String(value ?? '')
  const iso = text.match(/(?:^|[^\d])(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`

  const brazilian = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/)
  if (brazilian) {
    const [, day, month, rawYear] = brazilian
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const named = text.match(/\b(\d{1,2})\s+(?:de\s+)?([a-zçãé]+)\.?(?:\s+de)?\s+(\d{2,4})\b/i)
  if (named) {
    const month = monthNumberByName[normalizeText(named[2])]
    if (month) {
      const year = named[3].length === 2 ? `20${named[3]}` : named[3]
      return `${year}-${String(month).padStart(2, '0')}-${named[1].padStart(2, '0')}`
    }
  }

  return null
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return toIsoDate(value)
  if (!value) return toIsoDate(new Date())

  const text = String(value).trim()
  const isoDate = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (isoDate) {
    const [, year, month, day] = isoDate
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const brazilian = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (brazilian) {
    const [, day, month, rawYear] = brazilian
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const namedDate = findDateInText(text)
  if (namedDate) return namedDate

  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? toIsoDate(new Date()) : toIsoDate(parsed)
}

function toIsoDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function detectBillDocumentType(text = '', reference = '', parsed = {}) {
  const source = `${reference ?? ''} ${text ?? ''}`

  const invoicePattern = /(fatura\s+(do|d[oa])\s+cart[ãa]o|fechamento\s+da\s+fatura|data\s+de\s+fechamento|pagamento\s+m[íi]nimo|compras\s+no\s+cart[ãa]o|limite\s+(total|dispon[íi]vel)|\bfatura\b)/i
  const extractPattern = /\bextrato\b/i
  const billLabelPattern = /(linha\s+digit[áa]vel|valor\s+do\s+documento|n[úu]mero\s+do\s+documento|pagar\s+at[ée]\s+\w|benefici[áa]rio|nosso\s+n[úu]mero)/i
  const statementPattern = /(hist[óo]rico\s+de\s+(movimenta|transa|lança)|movimenta[çc][õo]es\s+do\s+per[íi]odo|saldo\s+(anterior|final|atual)|lançamentos\s+do\s+conta|conta\s+corrente)/gi

  const hasInvoice = invoicePattern.test(source)
  const hasExtract = extractPattern.test(source)
  const hasBillCode = Array.isArray(parsed.lineCodes) && parsed.lineCodes.some((item) => item.valid)
  const hasBillLabels = billLabelPattern.test(source)

  // Linha digitavel e marcadores de boleto sao mais fortes que a palavra "extrato":
  // consorcios e financiadoras imprimem "extrato da mensalidade" no proprio boleto.
  if (hasBillCode || hasBillLabels) return { documentType: 'bill', isInvoice: hasInvoice && !hasExtract }
  if (hasExtract) return { documentType: 'statement', isInvoice: false }
  if (hasInvoice) return { documentType: 'bill', isInvoice: true }

  const statementScore = [...source.matchAll(statementPattern)].length
  return statementScore >= 2 ? { documentType: 'statement', isInvoice: false } : { documentType: 'bill', isInvoice: false }
}

function cleanDescription(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text || 'Lançamento sem descrição'
}

function inferType(rawType, signedAmount, description) {
  const type = normalizeText(rawType)
  const text = normalizeText(description)

  if (type.includes('transfer') || text.includes('transferencia') || text.includes('pix enviado') && text.includes('pix recebido')) {
    return 'transfer'
  }
  if (
    type.includes('debito') ||
    type.includes('saida') ||
    type.includes('expense') ||
    type.includes('compra') ||
    type.includes('pagamento') ||
    type.includes('withdrawal')
  ) {
    return 'expense'
  }
  if (
    type.includes('credito') ||
    type.includes('entrada') ||
    type.includes('income') ||
    type.includes('deposito') ||
    type.includes('recebimento')
  ) {
    return 'income'
  }
  if (signedAmount < 0) return 'expense'
  if (signedAmount > 0) return 'income'
  return 'expense'
}

function inferCategory(description, type) {
  if (type === 'transfer') return 'Transferência'
  const text = normalizeText(description)

  if (text.includes('salario') || text.includes('salário') || text.includes('folha') || text.includes('pagamento')) return 'Trabalho'
  if (text.includes('rendimento') || text.includes('dividendo') || text.includes('cdb') || text.includes('tesouro') || text.includes('investimento')) return 'Investimentos'
  if (text.includes('aluguel') || text.includes('condominio') || text.includes('energia') || text.includes('agua') || text.includes('internet')) return 'Moradia'
  if (text.includes('mercado') || text.includes('supermercado') || text.includes('feira') || text.includes('hortifruti')) return 'Mercado'
  if (text.includes('restaurante') || text.includes('padaria') || text.includes('cafe') || text.includes('ifood') || text.includes('alimento')) return 'Alimentação'
  if (text.includes('uber') || text.includes('99') || text.includes('posto') || text.includes('combustivel') || text.includes('metro') || text.includes('estacionamento')) return 'Transporte'
  if (text.includes('farmacia') || text.includes('medico') || text.includes('academia') || text.includes('saude')) return 'Saúde'
  if (text.includes('netflix') || text.includes('spotify') || text.includes('streaming') || text.includes('assinatura')) return 'Assinaturas'
  if (text.includes('curso') || text.includes('escola') || text.includes('faculdade') || text.includes('livro')) return 'Educação'
  if (text.includes('shopee') || text.includes('amazon') || text.includes('roupa') || text.includes('compra')) return 'Compras'
  if (text.includes('cinema') || text.includes('show') || text.includes('bar') || text.includes('lazer')) return 'Lazer'
  return 'Outros'
}

function rawValue(row, column) {
  return column ? row[column] : ''
}

export function normalizeRows(rows, institution, accountId) {
  return rows
    .map((row, index) => {
      const dateColumn = findColumn(row, headerAliases.date)
      const descriptionColumn = findColumn(row, headerAliases.description)
      const amountColumn = findColumn(row, headerAliases.amount)
      const debitColumn = findColumn(row, headerAliases.debit)
      const creditColumn = findColumn(row, headerAliases.credit)
      const typeColumn = findColumn(row, headerAliases.type)
      const categoryColumn = findColumn(row, headerAliases.category)

      const description = cleanDescription(rawValue(row, descriptionColumn))
      let signedAmount = parseAmount(rawValue(row, amountColumn))

      if (!amountColumn && (debitColumn || creditColumn)) {
        const debit = Math.abs(parseAmount(rawValue(row, debitColumn)))
        const credit = Math.abs(parseAmount(rawValue(row, creditColumn)))
        signedAmount = debit ? -debit : credit
      }

      const type = inferType(rawValue(row, typeColumn), signedAmount, description)
      const amount = Math.abs(signedAmount)
      const category = categoryOptions.includes(rawValue(row, categoryColumn))
        ? rawValue(row, categoryColumn)
        : inferCategory(description, type)

      return {
        id: `${institution.toLowerCase()}-${accountId}-${Date.now()}-${index}`,
        date: parseDate(rawValue(row, dateColumn)),
        description,
        merchant: description,
        category,
        type,
        amount,
        signedAmount,
        institution,
        adapterId: statementAdapters[institution]?.id ?? statementAdapters.generic.id,
        accountId,
        status: 'ready',
        source: 'upload',
        confidence: type === 'transfer' ? 0.84 : category === 'Outros' ? 0.78 : 0.94,
      }
    })
    .filter((row) => row.description.toLowerCase() !== 'lançamento sem descrição' || row.amount > 0)
}

async function parseCsv(file) {
  const text = await file.text()
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.replace(/^\uFEFF/, '').trim(),
      complete: (results) => {
        if (results.errors?.length && !results.data.length) {
          reject(new Error(results.errors[0].message))
          return
        }
        resolve({ rows: results.data, warnings: results.errors?.map((error) => error.message) ?? [] })
      },
      error: (error) => reject(error),
    })
  })
}

async function parseSpreadsheet(file) {
  const matrix = await readXlsxFile(file)
  if (!matrix.length) return { rows: [], warnings: [] }

  const headers = matrix[0].map((value, index) => String(value ?? `coluna${index + 1}`).trim() || `coluna${index + 1}`)
  const rows = matrix.slice(1)
    .filter((values) => values.some((value) => String(value ?? '').trim()))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])))

  return { rows, warnings: [] }
}

function parsePdfText(text) {
  const cleanText = text.split(String.fromCharCode(0)).join(' ').replace(/[ \t]+/g, ' ')
  const dateMatches = [...cleanText.matchAll(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g)]
  const rows = []

  for (let index = 0; index < dateMatches.length; index += 1) {
    const start = dateMatches[index].index + dateMatches[index][0].length
    const end = dateMatches[index + 1]?.index ?? cleanText.length
    const segment = cleanText.slice(start, end).trim()
    if (!segment) continue

    // No extrato digital o valor fecha a linha, então é o primeiro caminho.
    let amountMatch = segment.match(/(-?\s*R?\$\s*[\d.]+,\d{2})\s*$/)

    // OCR costuma embaralhar as colunas e devolver o valor no meio da linha.
    if (!amountMatch) amountMatch = segment.match(/(-?\s*R?\$\s*[\d.]+,\d{2})/)
    if (!amountMatch) continue

    const before = segment.slice(0, amountMatch.index).replace(/[-–—:]+$/, '').trim()
    const after = segment.slice(amountMatch.index + amountMatch[0].length).replace(/^[-–—:]+/, '').trim()
    const description = before || after

    rows.push({
      date: dateMatches[index][1],
      description,
      amount: amountMatch[1],
    })
  }

  return rows
}

// Extrato bancário vem quase sempre em PDF digitalizado, sem texto embutido.
// Sem OCR não há o que ler, então cada página é rasterizada e passada no
// tesseract. Só cai neste caminho quando o texto extraído não gerou linhas.
const OCR_STATEMENT_MAX_PAGES = 3

// Extrato bancário em PDF chega como tabela, com data, histórico, documento,
// crédito, débito e saldo. O texto puro perde as colunas: sem elas não dá para
// saber que 1.244,03 é débito e 44,36 é o saldo, e o não se distingue de
// crédito. Por isso a leitura usa a posição de cada trecho na página.
//
// Valores numéricos são alinhados à direita, então casam pela borda direita.
// Data e histórico são alinhados à esquerda, então casam pela borda esquerda.

const TABLE_LINE_TOLERANCE = 12
const TABLE_DATE_PATTERN = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/
const TABLE_MONEY_PATTERN = /^-?\d{1,3}(\.\d{3})*,\d{2}$/
const TABLE_NUMBER_PATTERN = /^-?\d[\d.]*(,\d+)?$/
const TABLE_COLUMN_TOLERANCE = 30

function groupCellsIntoLines(cells) {
  const sorted = [...cells].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines = []

  for (const cell of sorted) {
    const line = lines.find((item) => Math.abs(item.y - cell.y) <= TABLE_LINE_TOLERANCE)
    if (line) line.cells.push(cell)
    else lines.push({ y: cell.y, cells: [cell] })
  }

  return lines.map((line) => ({ y: line.y, cells: line.cells.sort((a, b) => a.x - b.x) }))
}

function findHeaderCell(cells, pattern) {
  return cells.find((cell) => pattern.test(cell.str.trim())) ?? null
}

function detectTableColumns(cells) {
  const date = findHeaderCell(cells, /^data$/i)
  const credit = findHeaderCell(cells, /cr[eé]dito/i)
  const debit = findHeaderCell(cells, /d[eé]bito/i)
  const balance = findHeaderCell(cells, /saldo/i)

  // Sem crédito e sem débito não há como montar a linha de movimentação.
  if (!date || (!credit && !debit)) return null

  const document_ = findHeaderCell(cells, /docto|documento/i)
  // Documento também é numérico, então entra na lista de colunas que casam
  // pela borda direita. Sem isso o número do documento vira parte da descrição.
  const numbers = [
    document_ && { key: 'document', right: document_.x + document_.width },
    credit && { key: 'credit', right: credit.x + credit.width },
    debit && { key: 'debit', right: debit.x + debit.width },
    balance && { key: 'balance', right: balance.x + balance.width },
  ].filter(Boolean)

  return {
    descriptionStart: date.x + date.width,
    descriptionEnd: (document_ ?? credit ?? debit).x,
    money: numbers,
  }
}

function moneyColumnFor(cell, money) {
  const right = cell.x + cell.width
  let best = null
  let bestDelta = Infinity

  for (const column of money) {
    const delta = Math.abs(right - column.right)
    if (delta < bestDelta) {
      bestDelta = delta
      best = column
    }
  }

  return bestDelta <= TABLE_COLUMN_TOLERANCE ? best : null
}

function firstMoneyIn(cells, key) {
  const cell = cells.find((item) => item.key === key && TABLE_MONEY_PATTERN.test(item.str.trim()))
  return cell ? cell.str.trim() : null
}

function rowsFromLine(line, columns) {
  const text = line.cells.map((cell) => cell.str).join(' ').replace(/\s+/g, ' ').trim()
  if (!text || /^total\b/i.test(text)) return { skipped: true, balance: null, amountValue: 0 }

  const classified = line.cells.map((cell) => {
    const value = cell.str.trim()
    if (TABLE_DATE_PATTERN.test(value)) return { key: 'date', str: value }
    if (TABLE_NUMBER_PATTERN.test(value) && /\d/.test(value)) {
      const column = moneyColumnFor(cell, columns.money)
      return { key: column ? column.key : null, str: value }
    }
    return {
      key: cell.x > columns.descriptionStart && cell.x < columns.descriptionEnd ? 'description' : 'other',
      str: value,
    }
  })

  const date = classified.find((cell) => cell.key === 'date')?.str ?? null
  const rawDescription = classified
    .filter((cell) => cell.key === 'description')
    .map((cell) => cell.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Bradesco suffixa no histórico a data da operação, que repete a coluna.
  const description = rawDescription.replace(/\s+\d{2}\/\d{2}$/, '').trim() || rawDescription

  const credit = firstMoneyIn(classified, 'credit')
  const debit = firstMoneyIn(classified, 'debit')
  const balanceCell = classified.find((cell) => cell.key === 'balance')

  // Bradesco imprime crédito e débito em colunas separadas, sempre com sinal
  // positivo. O app usa sinal negativo para despesa, então o débito vira
  // negativo e o crédito continua positivo.
  const amount = debit ? `-${debit.replace(/^-/, '')}` : credit
  const amountValue = amount ? parseAmount(amount) : 0
  const balance = balanceCell ? parseAmount(balanceCell.str) : null

  if (!amount || Math.abs(amountValue) < 0.005) return { skipped: true, balance, amountValue }

  return { skipped: false, date, description, amount, amountValue, balance }
}

// A conferência de saldo usa o que o próprio extrato afirma: o saldo da
// primeira linha menos o movimento dela dá o saldo inicial, e o saldo da
// última linha é o final. Se a soma das movimentações não levar de um ao
// outro, alguma linha entrou errada ou ficou de fora.
function buildReconciliation(rows, openingLine, closingLine) {
  if (!openingLine || !closingLine) return null

  const openingBalance = openingLine.balance - openingLine.amountValue
  const closingBalance = closingLine.balance
  const movement = rows.reduce((total, row) => total + parseAmount(row.amount), 0)
  const expected = openingBalance + movement
  const difference = Math.round((expected - closingBalance) * 100) / 100

  return {
    openingBalance: Math.round(openingBalance * 100) / 100,
    closingBalance: Math.round(closingBalance * 100) / 100,
    movement: Math.round(movement * 100) / 100,
    expected: Math.round(expected * 100) / 100,
    difference,
    matches: Math.abs(difference) < 0.01,
    periodStart: rows[0]?.date ?? null,
    periodEnd: rows[rows.length - 1]?.date ?? null,
  }
}

function extractTableRows(pages) {
  const rows = []
  let openingLine = null
  let closingLine = null

  for (const cells of pages) {
    const lines = groupCellsIntoLines(cells)
    const headerIndex = lines.findIndex((line) => detectTableColumns(line.cells))
    if (headerIndex === -1) continue

    const columns = detectTableColumns(lines[headerIndex].cells)
    let currentDate = ''

    for (const line of lines.slice(headerIndex + 1)) {
      const parsed = rowsFromLine(line, columns)
      if (parsed.date) currentDate = parsed.date
      if (!currentDate) continue

      if (parsed.balance !== null) {
        if (!openingLine) openingLine = { balance: parsed.balance, amountValue: parsed.amountValue }
        closingLine = { balance: parsed.balance }
      }

      if (parsed.skipped) continue
      rows.push({ date: currentDate, description: parsed.description, amount: parsed.amount })
    }
  }

  return { rows, reconciliation: buildReconciliation(rows, openingLine, closingLine) }
}

async function parsePdf(file, password = '') {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`
    const data = new Uint8Array(await file.arrayBuffer())
    const document = await pdfjs.getDocument({ data, ...(password ? { password } : {}) }).promise
    const pages = []
    const pageCells = []

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const cells = content.items
        .map((item) => ({
          str: item.str ?? '',
          x: item.transform?.[4] ?? 0,
          y: item.transform?.[5] ?? 0,
          width: item.width ?? 0,
        }))
        .filter((cell) => cell.str.trim() !== '')
      pageCells.push(cells)
      pages.push(cells.map((cell) => cell.str).join(' '))
    }

    let extracted = extractTableRows(pageCells)
    let rows = extracted.rows
    if (!rows.length) rows = parsePdfText(pages.join('\n'))

    if (!rows.length) {
      const limit = Math.min(document.numPages, OCR_STATEMENT_MAX_PAGES)
      for (let pageNumber = 1; pageNumber <= limit && !rows.length; pageNumber += 1) {
        const canvas = await renderPdfPage(pdfjs, document, pageNumber)
        if (!canvas) continue
        for (const mode of ['4', '6']) {
          const ocrText = await recognizeWithOcr(canvas, mode)
          if (!ocrText) continue
          rows = parsePdfText(ocrText)
          if (rows.length) break
        }
      }
    }

    return {
      rows,
      requiresPassword: false,
      reconciliation: extracted.reconciliation,
      warnings: rows.length ? [] : ['O PDF foi carregado, mas não encontramos linhas tabulares. Tente CSV/XLSX para uma leitura mais precisa.'],
    }
  } catch (error) {
    const requiresPassword = error?.name === 'PasswordException' || /password/i.test(error?.message ?? '')
    return {
      rows: [],
      requiresPassword,
      reconciliation: null,
      warnings: [requiresPassword ? 'Este PDF está protegido. Informe a senha do boleto para analisar o documento.' : 'Não foi possível extrair texto deste PDF automaticamente. O arquivo foi recebido, mas a leitura precisa de CSV/XLSX ou de uma revisão manual.'],
    }
  }
}

export async function parseStatement(file, institution, accountId, options = {}) {
  const fileName = file?.name?.toLowerCase() ?? ''
  const extension = fileName.split('.').pop()
  let result

  if (extension === 'csv' || file.type === 'text/csv') {
    result = await parseCsv(file)
  } else if (extension === 'xlsx' || file.type.includes('spreadsheet') || file.type.includes('excel')) {
    result = await parseSpreadsheet(file)
  } else if (extension === 'pdf' || file.type === 'application/pdf') {
    result = await parsePdf(file, options.password)
  } else {
    throw new Error('Formato não suportado. Envie um arquivo CSV, XLSX ou PDF.')
  }

  return {
    adapter: statementAdapters[institution] ?? statementAdapters.generic,
    rows: normalizeRows(result.rows, institution, accountId),
    warnings: result.warnings,
    requiresPassword: Boolean(result.requiresPassword),
    reconciliation: result.reconciliation ?? null,
  }
}

const BARCODE_BASE_DATE = Date.UTC(1997, 9, 7)
const BARCODE_RENEWED_BASE_DATE = Date.UTC(2025, 1, 22)
const DAY_IN_MS = 86400000

function resolveBarcodeDueDate(factor, today = new Date()) {
  if (!Number.isFinite(factor) || factor < 1 || factor > 9999) return null

  const reference = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const window = (date) => {
    const distance = (date.getTime() - reference) / DAY_IN_MS
    return distance >= -400 && distance <= 900
  }

  const renewed = new Date(BARCODE_RENEWED_BASE_DATE + (factor - 1000) * DAY_IN_MS)
  if (Number.isFinite(renewed.getTime()) && window(renewed)) return renewed.toISOString().slice(0, 10)

  const legacy = new Date(BARCODE_BASE_DATE + factor * DAY_IN_MS)
  if (Number.isFinite(legacy.getTime()) && window(legacy)) return legacy.toISOString().slice(0, 10)

  return null
}

function mod10CheckDigit(digits) {
  let sum = 0
  let weight = 2
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    sum += Number(digits[index]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  return (10 - (sum % 10)) % 10
}

function readBillLineCode(code) {
  if (!/^\d{47}$/.test(code) || code[3] !== '9') return null

  const freeField = code.slice(4, 9) + code.slice(10, 20) + code.slice(21, 31)
  const barcode = `${code.slice(0, 4)}0${code.slice(33, 37)}${code.slice(37, 47)}${freeField}`
  const valid = mod10CheckDigit(barcode) === Number(code[32])

  const amount = Number(code.slice(37, 47)) / 100
  const dueDate = resolveBarcodeDueDate(Number(code.slice(33, 37)))

  return {
    code,
    valid,
    amount: amount > 0 && amount <= 9999999.99 ? amount : null,
    dueDate,
  }
}

function collectBillLineCodes(text) {
  const source = String(text ?? '')
  const found = new Set()

  const store = (digits) => {
    if (digits.length < 47) return
    for (let start = 0; start + 47 <= digits.length; start += 1) found.add(digits.slice(start, start + 47))
  }

  for (const run of source.match(/\d(?:[^\dA-Za-z]{0,3}\d)+/g) ?? []) store(run.replace(/\D/g, ''))
  for (const block of source.replace(/[^\d]/g, ' ').split(/\s+/)) store(block)

  return [...found].map((code) => readBillLineCode(code)).filter(Boolean)
}

function cleanMoneyToken(value) {
  const token = String(value ?? '').replace(/[^\d.,-]/g, '').trim()
  if (!token) return ''
  if (!/\d[\d.,]*[,.]\d{2}$/.test(token)) return ''
  return token
}

function readLabeledAmount(text) {
  const strongLabelPattern = /(?:valor\s+do\s+documento|valor\s+total|valor\s+da\s+fatura|valor\s+da\s+parcela|total\s+da\s+fatura|total\s+d[aoe]\s+parcela|total\s+a\s+pagar|total\s+do\s+documento|valor\s+a\s+pagar|pagamento\s+m[íi]nimo)[^0-9]{0,60}(R?\s*\$?\s*\d[\d\s.,]*)/gi
  const currencyPattern = /R\s*\$?\s*\d[\d\s.,]*/gi
  const loosePattern = /(?<![\d.])(?:\d{1,3}(?:\.\d{3})+|\d+)[,.]\d{2}(?![\d])/g

  for (const pattern of [strongLabelPattern, currencyPattern, loosePattern]) {
    for (const match of text.matchAll(pattern)) {
      const token = cleanMoneyToken(match[1] ?? match[0])
      if (token && Math.abs(parseAmount(token)) > 0) return token
    }
  }

  return ''
}

function extractBillAmountText(text, lineCodes = collectBillLineCodes(text)) {
  const trustedCode = lineCodes.find((item) => item.valid && item.amount)
  if (trustedCode) return trustedCode.amount.toFixed(2).replace('.', ',')

  const labeled = readLabeledAmount(text)
  if (labeled) return labeled

  const anyCode = lineCodes.find((item) => item.amount)
  if (anyCode) return anyCode.amount.toFixed(2)

  return ''
}

function extractBillDueDate(text, lineCodes = [], amount = null) {
  const trustedCode = lineCodes.find((item) => item.valid && item.dueDate)
  if (trustedCode) return trustedCode.dueDate

  if (amount) {
    const matchingCode = lineCodes.find((item) => item.amount !== null && Math.abs(item.amount - amount) < 0.02 && item.dueDate)
    if (matchingCode) return matchingCode.dueDate
  }

  const source = String(text ?? '')
  const labels = [...source.matchAll(/vencimento|venc\.|data\s+de\s+vencimento|due\s+date|data\s+limite/gi)]
  for (const label of labels) {
    const start = label.index + label[0].length
    const after = source.slice(start, start + 140)
    if (/data\s+de\s+(pagamento|emiss|impress)/i.test(after)) continue
    const afterDate = findDateInText(after)
    if (afterDate) return afterDate

    const before = source.slice(Math.max(0, label.index - 32), label.index)
    if (!/(vencimento|pagamento|emiss|impress|documento|linha)/i.test(before)) {
      const beforeDate = findDateInText(before)
      if (beforeDate) return beforeDate
    }
  }

  const looseCode = lineCodes.find((item) => item.dueDate)
  if (looseCode) return looseCode.dueDate

  return findDateInText(source)
}

let ocrWorkerPromise = null

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = import('tesseract.js')
      .then(({ createWorker }) => createWorker('por'))
      .then(async (worker) => {
        await worker.setParameters({ preserve_interword_spaces: '1' })
        return worker
      })
      .catch((error) => {
        ocrWorkerPromise = null
        throw error
      })
  }
  return ocrWorkerPromise
}

async function renderPdfPage(pdfjs, pdfDocument, pageNumber) {
  try {
    const page = await pdfDocument.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 3 })
    const canvas = window.document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    return canvas
  } catch {
    return null
  }
}

async function renderFirstPdfPage(pdfjs, pdfDocument) {
  return renderPdfPage(pdfjs, pdfDocument, 1)
}

async function recognizeWithOcr(canvas, mode) {
  let worker = null
  try {
    worker = await getOcrWorker()
    await worker.setParameters({ tessedit_pageseg_mode: mode })
    const result = await worker.recognize(canvas)
    return result?.data?.text ?? ''
  } catch {
    await worker?.terminate?.().catch(() => {})
    ocrWorkerPromise = null
    return ''
  }
}

export async function parseBillPdf(file, password = '', fallbackDescription = '') {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`
    const data = new Uint8Array(await file.arrayBuffer())
    const document = await pdfjs.getDocument({ data, ...(password ? { password } : {}) }).promise
    const pages = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(content.items.map((item) => item.str).join(' '))
    }

    let text = pages.join(' ').replace(/\s+/g, ' ').trim()
    const readFields = () => {
      const lineCodes = collectBillLineCodes(text)
      const trusted = lineCodes.find((item) => item.valid) ?? null
      const amountText = extractBillAmountText(text, lineCodes)
      const amount = amountText ? Math.abs(parseAmount(amountText)) : null
      const matchedByAmount = amount
        ? lineCodes.find((item) => item.amount !== null && Math.abs(item.amount - amount) < 0.02) ?? null
        : null

      return {
        lineCodes,
        trusted,
        matchedByAmount,
        amount,
        dueDate: extractBillDueDate(text, lineCodes, amount),
      }
    }

    let fields = readFields()

    if (!fields.amount || !fields.dueDate) {
      const canvas = await renderFirstPdfPage(pdfjs, document)
      const baseText = pages.join(' ').replace(/\s+/g, ' ').trim()
      for (const mode of ['4', '6']) {
        const ocrText = canvas ? await recognizeWithOcr(canvas, mode) : ''
        if (ocrText) {
          text = `${baseText} ${ocrText.replace(/\s+/g, ' ').trim()}`.trim()
          fields = readFields()
        }
        if (fields.amount && fields.dueDate) break
      }
    }

    const lineCode = fields.trusted ?? fields.matchedByAmount ?? fields.lineCodes.find((item) => item.dueDate) ?? fields.lineCodes[0] ?? null
    const barcodeMatch = text.match(/\b\d{40,50}\b/)
    const description = cleanDescription(fallbackDescription || text.slice(0, 120))
    const { documentType, isInvoice } = detectBillDocumentType(text, fallbackDescription, { lineCodes: fields.lineCodes })
    const warnings = [
      !fields.amount ? 'Não foi possível identificar o valor do documento automaticamente.' : null,
      !fields.dueDate ? 'Não foi possível identificar o vencimento automaticamente.' : null,
    ].filter(Boolean)

    return {
      amount: fields.amount,
      dueDate: fields.dueDate,
      description,
      barcode: barcodeMatch?.[0] ?? lineCode?.code ?? null,
      documentType,
      isInvoice,
      requiresPassword: false,
      hasText: Boolean(text),
      usedBarcode: Boolean(fields.trusted ?? fields.matchedByAmount),
      warnings,
      warning: warnings[0] ?? '',
    }
  } catch (error) {
    const requiresPassword = error?.name === 'PasswordException' || /password/i.test(error?.message ?? '')
    return {
      amount: null,
      dueDate: null,
      description: fallbackDescription,
      barcode: null,
      documentType: 'unknown',
      requiresPassword,
      hasText: false,
      warning: requiresPassword ? 'Informe a senha do PDF para analisar este boleto.' : 'Não foi possível ler o PDF do boleto automaticamente.',
    }
  }
}

export function getDemoStatementRows(institution, accountId) {
  return normalizeRows(demoRows[institution] ?? [], institution, accountId)
}
