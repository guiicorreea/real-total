// Teste do leitor de tabela de extrato em PDF contra um arquivo real.
//
// Uso: baixe o PDF do banco para %TEMP%\opencode\bradesco.pdf e rode
//   node tools/pdf-statement-check.mjs
// Sem o arquivo, o teste avisa e sai sem falhar.
//
// Ele extrai as funções do fonte em src/lib/parser.js e monta células com
// posição, igual ao que o pdf.js entrega no navegador.
import { readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const parserPath = join(here, '..', 'src', 'lib', 'parser.js')
const pdfPath = process.env.STATEMENT_PDF ?? join(tmpdir(), 'opencode', 'bradesco.pdf')

if (!existsSync(pdfPath)) {
  console.log(`PDF de teste ausente em ${pdfPath}`)
  console.log('Defina STATEMENT_PDF ou copie o arquivo para esse caminho. Teste ignorado.')
  process.exit(0)
}

const src = readFileSync(parserPath, 'utf8')

function grab(name) {
  const start = src.indexOf(`function ${name}(`)
  if (start === -1) throw new Error(`nao achei ${name} em parser.js`)
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

const NAMES = [
  'parseAmount',
  'groupCellsIntoLines',
  'findHeaderCell',
  'detectTableColumns',
  'moneyColumnFor',
  'firstMoneyIn',
  'rowsFromLine',
  'extractTableRows',
]

const constants = src.slice(src.indexOf('const TABLE_LINE_TOLERANCE'), src.indexOf('function groupCellsIntoLines')).trim()
const block = NAMES.map(grab).join('\n\n')
const { extractTableRows, parseAmount } = new Function(`${constants}\n${block}; return { extractTableRows, parseAmount }`)()

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdfPath)) }).promise

const pageCells = []
for (let n = 1; n <= doc.numPages; n += 1) {
  const page = await doc.getPage(n)
  const content = await page.getTextContent()
  pageCells.push(
    content.items
      .map((item) => ({
        str: item.str ?? '',
        x: item.transform?.[4] ?? 0,
        y: item.transform?.[5] ?? 0,
        width: item.width ?? 0,
      }))
      .filter((cell) => cell.str.trim() !== ''),
  )
}

const rows = extractTableRows(pageCells)

let failures = 0
if (!rows.length) {
  failures = 1
  console.log('FALHA nenhuma linha extraida')
}

const DATE = /^\d{2}\/\d{2}\/\d{4}$/
const MONEY = /^-?\d{1,3}(\.\d{3})*,\d{2}$/

for (const row of rows) {
  const problems = []
  if (!DATE.test(row.date)) problems.push(`data invalida: ${row.date}`)
  if (!MONEY.test(row.amount)) problems.push(`valor invalido: ${row.amount}`)
  if (parseAmount(row.amount) === 0) problems.push('valor zero')
  if (!row.description) problems.push('descricao vazia')
  if (problems.length) {
    failures += 1
    console.log(`FALHA ${row.date} | ${row.description} | ${row.amount} -> ${problems.join('; ')}`)
  }
}

// Número do documento e data repetida no histórico não devem sobrar na descrição.
for (const row of rows) {
  if (/\d{2}\/\d{2}$/.test(row.description)) {
    failures += 1
    console.log(`FALHA descricao com data repetida: ${row.description}`)
  }
}

console.log(`\n${rows.length} linhas extraidas de ${doc.numPages} paginas`)
for (const row of rows) console.log(`${row.date} | ${row.description} | ${row.amount}`)

if (failures) console.log(`\n${failures} problema(s)`)
else console.log('\n tudo certo')

process.exit(failures ? 1 : 0)