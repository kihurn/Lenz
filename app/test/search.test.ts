import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fetchPageText, looksLikeQuery, PAGE_TEXT_MAX_CHARS, pingSearxng, runSearch, searchSearxng } from '../src/main/search'

const article = readFileSync(join(__dirname, 'fixtures/article.html'), 'utf8')
const servers: Server[] = []
afterEach(() => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections()
    s.close()
  }
})

type Handler = (path: string, res: import('node:http').ServerResponse) => void
async function serve(handler: Handler): Promise<string> {
  const s = createServer((req, res) => handler(req.url ?? '/', res))
  servers.push(s)
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`
}

const never = new AbortController().signal

function searxng(results: { title: string; url: string; content: string }[], pageBase = '') {
  return serve((path, res) => {
    if (path.startsWith('/search')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ query: 'q', results: results.map((r) => ({ ...r, url: r.url.replace('PAGE', pageBase) })) }))
    } else {
      res.writeHead(404)
      res.end()
    }
  })
}

describe('looksLikeQuery', () => {
  it.each([
    ['capital of australia', true],
    ['when was penicillin discovered', true],
    ['what does this mean', false],
    ['explain the graph above', false],
    ['', false],
    ['one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen', false]
  ])('%s → %s', (q, expected) => {
    expect(looksLikeQuery(q)).toBe(expected)
  })
})

describe('searchSearxng', () => {
  it('maps SearXNG results to numbered sources and drops non-http results', async () => {
    const base = await searxng([
      { title: 'A', url: 'https://a.example/1', content: 'sa' },
      { title: 'Bad', url: 'javascript:alert(1)', content: 'x' },
      { title: 'B', url: 'http://b.example/2', content: 'sb' }
    ])
    expect(await searchSearxng(base, 'q', 5, never)).toEqual([
      { n: 1, title: 'A', url: 'https://a.example/1', snippet: 'sa' },
      { n: 2, title: 'B', url: 'http://b.example/2', snippet: 'sb' }
    ])
  })

  it('limits the number of results', async () => {
    const base = await searxng(Array.from({ length: 8 }, (_, i) => ({ title: `T${i}`, url: `https://x/${i}`, content: '' })))
    expect(await searchSearxng(base, 'q', 3, never)).toHaveLength(3)
  })

  it('sends the query with JSON format', async () => {
    let seen = ''
    const base = await serve((path, res) => {
      seen = path
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"results":[]}')
    })
    await searchSearxng(base, 'krebs cycle steps', 5, never)
    expect(seen).toBe('/search?q=krebs+cycle+steps&format=json')
  })

  it('throws when SearXNG unreachable', async () => {
    await expect(searchSearxng('http://127.0.0.1:1', 'q', 5, never)).rejects.toThrow()
  })
})

describe('fetchPageText', () => {
  it('extracts article text', async () => {
    const base = await serve((_p, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(article)
    })
    const text = await fetchPageText(`${base}/a`, 2000, never)
    expect(text).toContain('powerhouse of the cell')
    expect(text).not.toContain('NAVTEXT')
    expect(text!.length).toBeLessThanOrEqual(PAGE_TEXT_MAX_CHARS)
  })

  it('skips non-HTML pages', async () => {
    const base = await serve((_p, res) => {
      res.writeHead(200, { 'content-type': 'application/pdf' })
      res.end('%PDF-1.7')
    })
    expect(await fetchPageText(`${base}/a.pdf`, 2000, never)).toBeNull()
  })

  it('caps oversize pages without throwing', async () => {
    const big = '<html><body><article><p>' + 'word '.repeat(600_000) + '</p></article></body></html>' // ~3 MB
    const base = await serve((_p, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(big)
    })
    const text = await fetchPageText(`${base}/big`, 3000, never)
    expect(text === null || text.length <= PAGE_TEXT_MAX_CHARS).toBe(true)
  })

  it('returns null on timeout', async () => {
    const base = await serve(() => {
      /* never respond */
    })
    const t0 = Date.now()
    expect(await fetchPageText(`${base}/slow`, 200, never)).toBeNull()
    expect(Date.now() - t0).toBeLessThan(1000)
  })

  it('returns null on HTTP error', async () => {
    const base = await serve((_p, res) => {
      res.writeHead(500, { 'content-type': 'text/html' })
      res.end('oops')
    })
    expect(await fetchPageText(`${base}/e`, 2000, never)).toBeNull()
  })
})

describe('runSearch', () => {
  const cfg = { results: 5, pagesToRead: 2, pageTimeoutMs: 2500, budgetMs: 4000 }

  it('returns sources and page text with status updates', async () => {
    const pages = await serve((_p, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(article)
    })
    const base = await searxng(
      Array.from({ length: 5 }, (_, i) => ({ title: `T${i}`, url: `PAGE/${i}`, content: `s${i}` })),
      pages
    )
    const statuses: string[] = []
    const ctx = await runSearch({ baseUrl: base, query: 'mitochondria', cfg, signal: never, onStatus: (s) => statuses.push(s) })
    expect(ctx.query).toBe('mitochondria')
    expect(ctx.sources).toHaveLength(5)
    expect(ctx.pages.map((p) => p.n)).toEqual([1, 2])
    expect(ctx.pages[0]!.text).toContain('powerhouse')
    expect(statuses).toEqual(['Searching…', 'Reading 2 pages…'])
  })

  it('returns sources even when pages time out', async () => {
    const slow = await serve(() => {
      /* never respond */
    })
    const base = await searxng(
      Array.from({ length: 5 }, (_, i) => ({ title: `T${i}`, url: `PAGE/${i}`, content: '' })),
      slow
    )
    const t0 = Date.now()
    const ctx = await runSearch({
      baseUrl: base,
      query: 'q',
      cfg: { ...cfg, pageTimeoutMs: 5000, budgetMs: 500 },
      signal: never,
      onStatus: () => {}
    })
    expect(ctx.sources).toHaveLength(5)
    expect(ctx.pages).toEqual([])
    expect(Date.now() - t0).toBeLessThan(1000)
  })

  it('throws when SearXNG fails', async () => {
    await expect(
      runSearch({ baseUrl: 'http://127.0.0.1:1', query: 'q', cfg, signal: never, onStatus: () => {} })
    ).rejects.toThrow()
  })
})

describe('pingSearxng', () => {
  it('resolves for a JSON-serving server', async () => {
    const base = await searxng([])
    await expect(pingSearxng(base)).resolves.toBeUndefined()
  })

  it('rejects within 3.5 s when it hangs', async () => {
    const base = await serve(() => {})
    const t0 = Date.now()
    await expect(pingSearxng(base, 3000)).rejects.toThrow()
    expect(Date.now() - t0).toBeLessThan(3500)
  })
})
