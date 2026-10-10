// Testa o leitor de extrato do PicPay contra o PDF real e compara com o CSV.
import { readFileSync } from 'node:fs'

const src = readFileSync('./src/lib/parser.js', 'utf8')

function grab(name) {
  const start = src.indexOf(`function ${name}(`)
  if (start === -1) throw new Error(`nao achei ${name}`)
  let depth = 0
  let i = src.indexOf('{', start)
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
  String(value ?? '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')`

const names = ['parseAmount', 'groupCellsIntoLines', 'picpayDayToIso', 'extractDailyRows']
const months = src.slice(src.indexOf('const monthNumberByName'), src.indexOf('function findDateInText'))
const constants = `${src.slice(src.indexOf('const TABLE_LINE_TOLERANCE'), src.indexOf('function groupCellsIntoLines')).trim()}\n${src.slice(src.indexOf('const PICPAY_MONEY_PATTERN'), src.indexOf('// Reaproveita o mapa de meses')).trim()}\n${months.trim()}`
const api = new Function(`${helper}\n${constants}\n${names.map(grab).join('\n\n')}; return { extractDailyRows, picpayDayToIso, parseAmount }`)()

console.log('=== data por extenso ===')
for (const d of ['08 de outubro 2026', '1 de outubro de 2026', '26 de setembro de 2026', '30 de março de 2026', '99 de bogus 2026']) {
  console.log(`  ${d.padEnd(28)} -> ${JSON.stringify(api.picpayDayToIso(d))}`)
}

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync('C:/Users/guilh/AppData/Local/Temp/opencode/picpay.pdf')) }).promise

const pageCells = []
for (let n = 1; n <= doc.numPages; n += 1) {
  const page = await doc.getPage(n)
  const content = await page.getTextContent()
  pageCells.push(
    content.items
      .map((item) => ({ str: item.str ?? '', x: item.transform?.[4] ?? 0, y: item.transform?.[5] ?? 0, width: item.width ?? 0 }))
      .filter((cell) => cell.str.trim() !== ''),
  )
}

const rows = api.extractDailyRows(pageCells)
console.log(`\n=== PDF: ${rows.length} linhas ===`)
for (const row of rows) console.log(`  ${row.date} | ${row.description.padEnd(52)} | ${row.amount.padStart(12)} | ${api.parseAmount(row.amount).toFixed(2)}`)

// O CSV e a referencia confiavel.
const csv = readFileSync('C:/Users/guilh/AppData/Local/Temp/opencode/picpay.csv', 'utf8')
const linhas = csv.split(/\r?\n/).filter((line) => line.trim())
const cabecalho = linhas[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim())
const csvRows = linhas.slice(1).map((line) => {
  const partes = []
  let atual = ''
  let dentro = false
  for (const ch of line) {
    if (ch === '"') dentro = !dentro
    else if (ch === ',' && !dentro) { partes.push(atual); atual = '' } else atual += ch
  }
  partes.push(atual)
  const obj = {}
  cabecalho.forEach((h, index) => { obj[h] = (partes[index] ?? '').replace(/^"|"$/g, '').trim() })
  return obj
}).map((obj) => ({ date: obj.data, amount: api.parseAmount(obj.valor) }))

console.log(`\n=== comparacao com o CSV: ${csvRows.length} linhas ===`)

let falhas = 0
const check = (label, ok, detalhe = '') => {
  if (ok) console.log(`OK   ${label}`)
  else {
    falhas += 1
    console.log(`FALHA ${label} ${detalhe}`)
  }
}

check('o PDF traz o mesmo numero de linhas do CSV', rows.length === csvRows.length, `pdf=${rows.length} csv=${csvRows.length}`)

const chave = (row) => `${row.date}|${Math.abs(api.parseAmount(row.amount)).toFixed(2)}`
const doCsv = new Set(csvRows.map(chave))
const doPdf = new Set(rows.map(chave))
const faltando = [...doCsv].filter((k) => !doPdf.has(k))
const sobrando = [...doPdf].filter((k) => !doCsv.has(k))
check('todas as linhas do CSV aparecem no PDF', faltando.length === 0, faltando.slice(0, 4).join(' , '))
check('o PDF nao inventou linha', sobrando.length === 0, sobrando.slice(0, 4).join(' , '))
check('toda data do PDF e ISO valida', rows.every((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date)))
check('todo valor do PDF tem sinal de moeda', rows.every((row) => /R\$/.test(row.amount)))
check('toda descricao do PDF tem conteudo', rows.every((row) => row.description.length > 3))

console.log(falhas ? `\n${falhas} falha(s)` : '\n tudo certo')
process.exit(falhas ? 1 : 0)