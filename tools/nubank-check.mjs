// Testa o leitor de extrato do Nubank contra o PDF real e compara com o CSV.
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

const tableConstants = src.slice(src.indexOf('const TABLE_LINE_TOLERANCE'), src.indexOf('function groupCellsIntoLines')).trim()
const nubankConstants = src.slice(src.indexOf('const NUBANK_DAY_PATTERN'), src.indexOf('function nubankDayToIso')).trim()

const names = ['parseAmount', 'groupCellsIntoLines', 'nubankDayToIso', 'nubankSign', 'extractNubankRows']
const api = new Function(`${helper}\n${tableConstants}\n${nubankConstants}\nconst NUBANK_SUMMARY = /saldo|rendimento|total de|extrato|valores em|cpf|agencia|conta|extrato gerado|atendimento|nubank|nu pagamentos|nu financeira|cnpj|nao nos responsabilizamos|satisf/i\n${names.map(grab).join('\n\n')}; return { extractNubankRows, nubankDayToIso, nubankSign, parseAmount }`)()

let failures = 0
const check = (label, ok, detalhe = '') => {
  if (ok) console.log(`OK   ${label}`)
  else {
    failures += 1
    console.log(`FALHA ${label} ${detalhe}`)
  }
}

console.log('=== data ===')
for (const d of ['01 OUT 2026', '05 OUT 2026', '01 DE OUTUBRO DE 2026', '31 DEZ 2026', '99 XXX 2026']) {
  console.log(`  ${d.padEnd(24)} -> ${JSON.stringify(api.nubankDayToIso(d))}`)
}

console.log('\n=== sinal pela descricao ===')
check('recebida e entrada', api.nubankSign('Transferência recebida pelo Pix', -1) === 1)
check('enviada e saida', api.nubankSign('Transferência enviada pelo Pix', 1) === -1)
check('debito e saida', api.nubankSign('Compra no débito', 1) === -1)
check('fatura e saida', api.nubankSign('Pagamento de fatura', 1) === -1)
check('sem pista usa o subtotal', api.nubankSign('Algo raro', 1) === 1)

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync('C:/Users/guilh/AppData/Local/Temp/opencode/nubank.pdf')) }).promise

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

const rows = api.extractNubankRows(pageCells)
console.log(`\n=== PDF: ${rows.length} linhas ===`)
for (const row of rows) console.log(`  ${row.date} | ${row.description.slice(0, 58).padEnd(58)} | ${row.amount.padStart(14)} | ${api.parseAmount(row.amount).toFixed(2)}`)

const csv = readFileSync('C:/Users/guilh/AppData/Local/Temp/opencode/nubank.csv', 'utf8')
const linhas = csv.split(/\r?\n/).filter((line) => line.trim())
const cabecalho = linhas[0].split(',').map((h) => h.trim())
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
}).map((obj) => ({ date: obj.Data, amount: api.parseAmount(obj.Valor) }))

console.log(`\n=== comparacao com o CSV: ${csvRows.length} linhas ===`)

// O CSV traz dd/mm/aaaa, o leitor devolve ISO. Normaliza antes de comparar.
const brToIso = (value) => {
  const m = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(value)
}

const chave = (row) => `${brToIso(row.date)}|${Math.abs(api.parseAmount(row.amount)).toFixed(2)}|${api.parseAmount(row.amount) < 0 ? '-' : '+'}`
const doCsv = new Set(csvRows.map(chave))
const doPdf = new Set(rows.map(chave))
const faltando = [...doCsv].filter((k) => !doPdf.has(k))
const sobrando = [...doPdf].filter((k) => !doCsv.has(k))

check('o PDF traz o mesmo numero de linhas do CSV', rows.length === csvRows.length, `pdf=${rows.length} csv=${csvRows.length}`)
check('toda linha do CSV aparece no PDF, com o mesmo sinal', faltando.length === 0, faltando.join(' , '))
check('o PDF nao inventou linha', sobrando.length === 0, sobrando.join(' , '))
check('toda data e ISO valida', rows.every((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date)))
check('toda descricao tem conteudo', rows.every((row) => row.description.length > 5))
check('nenhum subtotal entrou como transacao', rows.every((row) => !/total de/i.test(row.description)))

console.log(failures ? `\n${failures} falha(s)` : '\n tudo certo')
process.exit(failures ? 1 : 0)