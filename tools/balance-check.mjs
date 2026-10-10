// Confere a leitura do saldo que o extrato imprime.
//
// Bradesco so traz o saldo linha a linha. PicPay e Nubank trazem um bloco de
// resumo, e e esse valor que passa a alimentar o saldo da conta.
import { readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'src', 'lib', 'parser.js'), 'utf8')

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
const months = src.slice(src.indexOf('const monthNumberByName'), src.indexOf('function findDateInText')).trim()
const balanceConstants = src.slice(src.indexOf('const STATEMENT_MONEY_PATTERN'), src.indexOf('function extractStatementBalances')).trim()
const picpayConstants = src.slice(src.indexOf('const PICPAY_MONEY_PATTERN'), src.indexOf('// Reaproveita o mapa de meses')).trim()

const names = ['parseAmount', 'groupCellsIntoLines', 'picpayDayToIso', 'extractStatementBalances']
const api = new Function(`${helper}\n${months}\n${tableConstants}\n${picpayConstants}\n${balanceConstants}\n${names.map(grab).join('\n\n')}; return { extractStatementBalances }`)()

let failures = 0
const check = (label, ok, detalhe = '') => {
  if (ok) console.log(`OK   ${label}`)
  else {
    failures += 1
    console.log(`FALHA ${label} ${detalhe}`)
  }
}

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

const dir = join(tmpdir(), 'opencode')
// O que o extrato de cada banco imprime, conferido a mao nos arquivos reais.
const esperado = {
  'picpay.pdf': { closing: 161.83, opening: null, periodEnd: '2026-10-09' },
  'nubank.pdf': { closing: 52.24, opening: 95.11, periodEnd: '2026-10-09' },
}

for (const [file, alvo] of Object.entries(esperado)) {
  const path = join(dir, file)
  if (!existsSync(path)) {
    console.log(`AVISO ${file} ausente, verificacao pulada`)
    continue
  }

  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)) }).promise
  const pages = []
  const texts = []
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    const cells = content.items
      .map((item) => ({ str: item.str ?? '', x: item.transform?.[4] ?? 0, y: item.transform?.[5] ?? 0, width: item.width ?? 0 }))
      .filter((cell) => cell.str.trim() !== '')
    pages.push(cells)
    texts.push(cells.map((cell) => cell.str).join(' '))
  }

  const got = api.extractStatementBalances(pages, texts.join('\n'))
  console.log(`\n${file}: closing=${got.closing} opening=${got.opening} fim=${got.periodEnd}`)

  check(`${file} le o saldo final`, Math.abs(got.closing - alvo.closing) < 0.005, `= ${got.closing}`)
  if (alvo.opening === null) check(`${file} nao inventa saldo inicial`, got.opening === null, `= ${got.opening}`)
  else check(`${file} le o saldo inicial`, Math.abs(got.opening - alvo.opening) < 0.005, `= ${got.opening}`)
  check(`${file} acha a data final do periodo`, got.periodEnd === alvo.periodEnd, `= ${got.periodEnd}`)
}

console.log(failures ? `\n${failures} falha(s)` : '\n tudo certo')
process.exit(failures ? 1 : 0)