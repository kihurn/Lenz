// Lenz test kit: runs eval/cases.json through Fast, Accurate and Think against your PC (via C0RE)
// and reports how many answers were right and how long they took.
//
//   read -s C0RE_KEY && export C0RE_KEY        (paste the key, press Enter; it isn't shown)
//   npm run eval                                (all modes)
//   npm run eval -- --modes accurate,think      (some modes)
//   npm run eval -- --only algebra-q2,mcq       (some cases)
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOllamaClient } from '../src/main/ollama'
import { runOcr } from '../src/main/ocr'
import { createPipeline, pickModel } from '../src/main/pipeline'
import type { ImageOps } from '../src/main/prepare'
import { runSearch } from '../src/main/search'
import { DEFAULT_SETTINGS, loadSettings } from '../src/main/settings'
import type { AskEvent, Settings, Speed, Timing } from '../src/shared/types'

interface Case {
  id: string
  screen?: string
  question: string
  search?: boolean
  expect: { any?: string[]; all?: string[]; not?: string[]; manual?: boolean; today?: boolean }
}
type Mode = 'fast' | 'accurate' | 'think'
const MODE_LABEL: Record<Mode, string> = { fast: 'Fast', accurate: 'Accurate', think: 'Think' }

const ROOT = join(__dirname, '..')
const EVAL = join(ROOT, 'eval')
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

// ---------- settings + key ----------

function settings(): Settings {
  for (const dir of ['Lenz', 'lenz']) {
    const f = join(homedir(), 'Library', 'Application Support', dir, 'settings.json')
    if (existsSync(f)) return loadSettings(f)
  }
  return structuredClone(DEFAULT_SETTINGS)
}

const key = process.env['C0RE_KEY']?.trim() ?? ''
if (!key) {
  console.error('Set your C0RE key first:  read -s C0RE_KEY && export C0RE_KEY   (paste it, press Enter)')
  process.exit(1)
}

// ---------- images without Electron (macOS `sips` does the resizing) ----------

const tmp = mkdtempSync(join(tmpdir(), 'lenz-eval-'))
let tmpN = 0
function sips(png: Buffer, args: string[], ext: string): Buffer {
  const src = join(tmp, `in${tmpN}.png`)
  const out = join(tmp, `out${tmpN++}.${ext}`)
  writeFileSync(src, png)
  execFileSync('sips', [...args, src, '--out', out], { stdio: 'ignore' })
  return readFileSync(out)
}
const imageOps: ImageOps = {
  size: (png) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }),
  resize: (png, width, height) => (process.platform === 'darwin' ? sips(png, ['-z', String(height), String(width)], 'png') : png),
  toJpeg: (png, quality) =>
    process.platform === 'darwin' ? sips(png, ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality)], 'jpg') : png
}
const ocrHelper = join(ROOT, 'native', 'ocr', 'build', 'lenz-ocr')

// ---------- grading ----------

/** Lower-case, drop Markdown/LaTeX noise and all spaces, so "x = 9", "$x=9$" and "x \\= 9" match. */
const compact = (s: string) =>
  s
    .toLowerCase()
    .replace(/\\(text|mathrm|mathbf|textbf|left|right|quad|,|;|!)/g, ' ')
    .replace(/[\\${}*_`&]/g, '')
    .replace(/\s+/g, '')

function todayPhrases(d = new Date()): string[] {
  const month = d.toLocaleString('en-US', { month: 'long' })
  const short = d.toLocaleString('en-US', { month: 'short' })
  const day = d.getDate()
  const iso = d.toISOString().slice(0, 10)
  return [`${month} ${day}`, `${day} ${month}`, `${short} ${day}`, `${day} ${short}`, iso]
}

function grade(c: Case, answer: string): '✓' | '✗' | '?' {
  const a = compact(answer)
  const has = (p: string) => a.includes(compact(p))
  if (!answer.trim()) return '✗'
  if (c.expect.manual) return '?'
  if (c.expect.not?.some(has)) return '✗'
  if (c.expect.today) return todayPhrases().some(has) ? '✓' : '✗'
  if (c.expect.all && !c.expect.all.every(has)) return '✗'
  if (c.expect.any && !c.expect.any.some(has)) return '✗'
  return '✓'
}

// ---------- run ----------

interface Result {
  id: string
  mode: Mode
  grade: '✓' | '✗' | '?'
  answer: string
  error?: string
  timing?: Timing
}

async function runCase(c: Case, mode: Mode, s: Settings): Promise<Result> {
  const events: AskEvent[] = []
  const png = c.screen ? readFileSync(join(EVAL, 'screens', c.screen)) : undefined
  const p = createPipeline({
    settings: () => s,
    apiKey: () => key,
    capture: async () => ({ png: png ?? Buffer.alloc(0), thumbnailDataUrl: '' }),
    ocr: (img) => runOcr(img, ocrHelper),
    imageOps,
    ollama: (url, k) => createOllamaClient(url, k),
    search: runSearch,
    emit: (e) => events.push(e)
  })
  if (png) p.setCapture({ png, thumbnailDataUrl: '' })
  await p.ask({
    question: c.question,
    search: !!c.search,
    think: mode === 'think',
    speed: (mode === 'fast' ? 'fast' : 'accurate') as Speed,
    newCapture: false
  })
  const answer = events.flatMap((e) => (e.type === 'token' ? [e.text] : [])).join('')
  const err = events.find((e) => e.type === 'error') as Extract<AskEvent, { type: 'error' }> | undefined
  const done = events.find((e) => e.type === 'done') as Extract<AskEvent, { type: 'done' }> | undefined
  return { id: c.id, mode, grade: err ? '✗' : grade(c, answer), answer, error: err?.message, timing: done?.timing }
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const sec = (ms: number) => (Number.isNaN(ms) ? '–' : `${(ms / 1000).toFixed(1)} s`)

async function main(): Promise<void> {
  const s = settings()
  const server = arg('server') // e.g. --server http://127.0.0.1:11434 for the pretend server
  if (server) s.serverUrl = server
  const all: Case[] = JSON.parse(readFileSync(join(EVAL, 'cases.json'), 'utf8')).cases
  const only = arg('only')?.split(',')
  const cases = only ? all.filter((c) => only.includes(c.id)) : all
  const modes = (arg('modes') ?? 'fast,accurate,think').split(',') as Mode[]
  if (!existsSync(ocrHelper)) console.warn('⚠ OCR helper not built (npm run build:ocr) — every screen will be sent as an image.\n')

  const client = createOllamaClient(s.serverUrl, key)
  await client.ping(5000).catch((e) => {
    console.error(`Can't reach C0RE at ${s.serverUrl}: ${(e as Error).message}`)
    process.exit(1)
  })

  const results: Result[] = []
  for (const mode of modes) {
    const model = pickModel(s, { speed: mode === 'fast' ? 'fast' : 'accurate', think: mode === 'think' })
    process.stdout.write(`\n${MODE_LABEL[mode]} (${model}) — loading model… `)
    await client.warm(model).catch(() => {})
    console.log('ready')
    for (const c of cases) {
      const r = await runCase(c, mode, s)
      results.push(r)
      const t = r.timing ? sec(r.timing.totalMs) : '–'
      console.log(`  ${r.grade} ${c.id.padEnd(20)} ${t.padStart(7)}${r.error ? `  (${r.error})` : ''}`)
    }
  }

  // Summary
  console.log('\nMode       Right    Median time  Median first words')
  for (const mode of modes) {
    const rs = results.filter((r) => r.mode === mode)
    const graded = rs.filter((r) => r.grade !== '?')
    const right = graded.filter((r) => r.grade === '✓').length
    const total = median(rs.flatMap((r) => (r.timing ? [r.timing.totalMs] : [])))
    const first = median(rs.flatMap((r) => (r.timing?.firstTokenMs !== undefined ? [r.timing.firstTokenMs] : [])))
    console.log(
      `${MODE_LABEL[mode].padEnd(10)} ${`${right}/${graded.length}`.padEnd(8)} ${sec(total).padEnd(12)} ${sec(first)}`
    )
  }

  // Full report with every answer, for checking the "?" ones and wrong answers.
  const dir = join(EVAL, 'results')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const file = join(dir, `${stamp}.md`)
  const lines = [`# Lenz eval ${new Date().toLocaleString()}`, '', `Server: ${s.serverUrl}`, '']
  for (const c of cases) {
    lines.push(`## ${c.id}`, '', `**Q:** ${c.question}${c.screen ? ` _(screen: ${c.screen})_` : ''}${c.search ? ' _(search on)_' : ''}`, '')
    for (const r of results.filter((x) => x.id === c.id)) {
      const t = r.timing
      const time = t ? `${sec(t.totalMs)}, first words ${sec(t.firstTokenMs ?? NaN)}${t.searchMs !== undefined ? `, search ${sec(t.searchMs)}` : ''}` : ''
      const body = r.error ? `Error: ${r.error}` : r.answer.trim() || '_(no answer)_'
      lines.push(`### ${r.grade} ${MODE_LABEL[r.mode]} — ${time}`, '', body, '')
    }
  }
  writeFileSync(file, lines.join('\n'))
  writeFileSync(join(dir, `${stamp}.json`), JSON.stringify(results, null, 2))
  console.log(`\nFull answers: ${file}`)
}

void main()
