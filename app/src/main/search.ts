import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import type { Settings, Source } from '../shared/types'
import type { SearchContext } from './prompts'

export const PAGE_TEXT_MAX_CHARS = 1500
export const PAGE_MAX_BYTES = 1_500_000
const MAX_QUERY_WORDS = 12

/** Words that point at the screen; a question containing them needs the screen to be understood. */
const DEICTIC = new Set(['this', 'these', 'that', 'those', 'here', 'above', 'below', 'screen', 'shown', 'it'])

/** True when the question can be sent to the search engine as-is, saving a model call. */
export function looksLikeQuery(question: string): boolean {
  const words = question.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []
  return words.length > 0 && words.length <= MAX_QUERY_WORDS && !words.some((w) => DEICTIC.has(w))
}

const isHttp = (u: string) => {
  try {
    const p = new URL(u).protocol
    return p === 'http:' || p === 'https:'
  } catch {
    return false
  }
}

const withTimeout = (signal: AbortSignal, ms: number) => AbortSignal.any([signal, AbortSignal.timeout(ms)])

export async function searchSearxng(
  baseUrl: string,
  query: string,
  limit: number,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch
): Promise<Source[]> {
  const params = new URLSearchParams({ q: query, format: 'json' })
  const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/search?${params}`, { signal: withTimeout(signal, 5000) })
  if (!res.ok) throw new Error(`SearXNG returned HTTP ${res.status}`)
  const body = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] }
  return (body.results ?? [])
    .filter((r) => typeof r.url === 'string' && isHttp(r.url))
    .slice(0, limit)
    .map((r, i) => ({ n: i + 1, title: String(r.title ?? r.url), url: r.url!, snippet: String(r.content ?? '') }))
}

export async function pingSearxng(baseUrl: string, timeoutMs = 3000, fetchImpl: typeof fetch = fetch): Promise<void> {
  await searchSearxng(baseUrl, 'test', 1, AbortSignal.timeout(timeoutMs), fetchImpl)
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (total < maxBytes) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  void reader.cancel().catch(() => {})
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, maxBytes))
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Fetches a page and returns its main text, or null for anything unusable. Never throws. */
export async function fetchPageText(
  url: string,
  timeoutMs: number,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  try {
    const sig = withTimeout(signal, timeoutMs)
    const res = await fetchImpl(url, { signal: sig, headers: { accept: 'text/html' }, redirect: 'follow' })
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/html')) {
      void res.body?.cancel().catch(() => {})
      return null
    }
    const html = await readCapped(res, PAGE_MAX_BYTES)
    const { document } = parseHTML(html)
    const article = new Readability(document as unknown as Document).parse()
    const text = collapse(article?.textContent ?? document.body?.textContent ?? '')
    return text ? text.slice(0, PAGE_TEXT_MAX_CHARS) : null
  } catch {
    return null
  }
}

/**
 * Queries SearXNG, then reads the top pages in parallel. The whole call is bounded by
 * cfg.budgetMs: when it expires, whatever has finished is returned.
 * Throws only when SearXNG itself fails.
 */
export async function runSearch(args: {
  baseUrl: string
  query: string
  cfg: Settings['search']
  signal: AbortSignal
  onStatus: (s: string) => void
  fetchImpl?: typeof fetch
}): Promise<SearchContext> {
  const { baseUrl, query, cfg, signal, onStatus, fetchImpl = fetch } = args
  const budget = new AbortController()
  const timer = setTimeout(() => budget.abort(), cfg.budgetMs)
  const sig = AbortSignal.any([signal, budget.signal])
  try {
    onStatus('Searching…')
    const sources = await searchSearxng(baseUrl, query, cfg.results, sig, fetchImpl)
    const toRead = sources.slice(0, cfg.pagesToRead)
    const pages: { n: number; text: string }[] = []
    if (toRead.length > 0 && !sig.aborted) {
      onStatus(`Reading ${toRead.length} page${toRead.length === 1 ? '' : 's'}…`)
      const reads = toRead.map(async (s) => {
        const text = await fetchPageText(s.url, cfg.pageTimeoutMs, sig, fetchImpl)
        if (text) pages.push({ n: s.n, text })
      })
      const expired = new Promise<void>((r) => sig.addEventListener('abort', () => r(), { once: true }))
      await Promise.race([Promise.all(reads), expired])
    }
    return { query, sources, pages: [...pages].sort((a, b) => a.n - b.n) }
  } finally {
    clearTimeout(timer)
    budget.abort() // cancel any page reads still in flight
  }
}
