import { afterEach, describe, expect, it } from 'vitest'
import { createOllamaClient } from '../src/main/ollama'
import { CaptureError, createPipeline, type PipelineDeps } from '../src/main/pipeline'
import type { ImageOps, OcrResult } from '../src/main/prepare'
import type { runSearch } from '../src/main/search'
import { DEFAULT_SETTINGS } from '../src/main/settings'
import type { AskEvent, AskRequest } from '../src/shared/types'
import { startMockOllama, type MockOllama, type MockOllamaOptions } from './helpers/mock-ollama'

let mock: MockOllama | undefined
afterEach(async () => {
  await mock?.close()
  mock = undefined
})

const denseText: OcrResult = { text: 'Mitochondria produce ATP. '.repeat(20), confidence: 0.95, coverage: 0.5 }
const imageOps: ImageOps = {
  size: () => ({ width: 800, height: 600 }),
  resize: (p) => p,
  toJpeg: () => Buffer.from('jpeg')
}

async function setup(
  mockOpts: MockOllamaOptions = {},
  over: Partial<PipelineDeps> & { serverUrl?: string } = {}
) {
  mock = await startMockOllama(mockOpts)
  const events: AskEvent[] = []
  let captures = 0
  const searches: string[] = []
  const deps: PipelineDeps = {
    settings: () => ({ ...DEFAULT_SETTINGS, serverUrl: over.serverUrl ?? mock!.url }),
    capture: async () => {
      captures++
      return { png: Buffer.from('png'), thumbnailDataUrl: 'data:image/png;base64,cG5n' }
    },
    ocr: async () => denseText,
    imageOps,
    ollama: (url) => createOllamaClient(url),
    search: (async (a: Parameters<typeof runSearch>[0]) => {
      searches.push(a.query)
      return { query: a.query, sources: [{ n: 1, title: 'S', url: 'https://s.example', snippet: 'snip' }], pages: [] }
    }) as typeof runSearch,
    emit: (e) => events.push(e),
    ...over
  }
  const p = createPipeline(deps)
  return { p, events, captures: () => captures, searches, mock: mock! }
}

const ask = (over: Partial<AskRequest> = {}): AskRequest => ({
  question: 'what is ATP?',
  search: false,
  think: false,
  speed: 'accurate',
  newCapture: true,
  ...over
})

const types = (es: AskEvent[]) => es.map((e) => e.type)
const tokens = (es: AskEvent[]) => es.flatMap((e) => (e.type === 'token' ? [e.text] : [])).join('')
const errorOf = (es: AskEvent[]) => es.find((e) => e.type === 'error') as Extract<AskEvent, { type: 'error' }> | undefined

describe('pipeline', () => {
  it('happy path emits capture, tokens, done in order', async () => {
    const { p, events } = await setup({ tokens: ['A', 'TP'] })
    await p.ask(ask())
    const t = types(events).filter((x) => x !== 'status')
    expect(t).toEqual(['capture', 'token', 'token', 'done'])
    expect(events.find((e) => e.type === 'capture')).toMatchObject({ mode: 'text' })
    expect(tokens(events)).toBe('ATP')
    expect(events.at(-1)).toEqual({ type: 'done', truncated: false })
  })

  it('sends text-only content for dense text and the image for image mode', async () => {
    const { p, mock } = await setup()
    await p.ask(ask())
    expect(mock.lastChatBody().messages.at(-1).images).toBeUndefined()
    await p.ask(ask({ newCapture: false, modeOverride: 'image' }))
    expect(mock.lastChatBody().messages.at(-1).images).toEqual([Buffer.from('png').toString('base64')]) // text-heavy → PNG
  })

  it('reuses capture and history for follow-ups', async () => {
    const { p, mock, captures } = await setup({ tokens: ['first answer'] })
    await p.ask(ask({ question: 'q1' }))
    await p.ask(ask({ question: 'q2', newCapture: false }))
    expect(captures()).toBe(1)
    const msgs = mock.lastChatBody().messages
    expect(msgs[1]).toEqual({ role: 'user', content: 'q1' })
    expect(msgs[2]).toEqual({ role: 'assistant', content: 'first answer' })
    expect(msgs.slice(0, -1).some((m: any) => m.images)).toBe(false)
  })

  it('a new capture starts a fresh conversation', async () => {
    const { p, mock, captures } = await setup()
    await p.ask(ask({ question: 'q1' }))
    await p.ask(ask({ question: 'q2', newCapture: true }))
    expect(captures()).toBe(2)
    expect(mock.lastChatBody().messages).toHaveLength(2)
  })

  it('uses chat settings from the spec', async () => {
    const { p, mock } = await setup()
    await p.ask(ask({ think: true }))
    const b = mock.lastChatBody()
    expect(b.model).toBe('qwen3-vl:8b')
    expect(b.think).toBe(true)
    expect(b.options).toEqual({ temperature: 0.3, num_ctx: 8192, num_predict: 512 })
  })

  it('uses fast model when speed is fast', async () => {
    const { p, mock } = await setup()
    await p.ask(ask({ speed: 'fast' }))
    expect(mock.lastChatBody().model).toBe('qwen3-vl:4b')
  })

  it('resolves quick actions into the question', async () => {
    const { p, mock } = await setup()
    await p.ask(ask({ question: '', actionId: 'summarize' }))
    expect(mock.lastChatBody().messages.at(-1).content).toContain('Summarize the key points on screen')
  })

  it('emits thinking on and off around reasoning', async () => {
    const { p, events } = await setup({ thinking: ['hmm'], tokens: ['A'] })
    await p.ask(ask({ think: true }))
    const t = types(events).filter((x) => x === 'thinking' || x === 'token')
    expect(t).toEqual(['thinking', 'thinking', 'token'])
    expect(events.filter((e) => e.type === 'thinking')).toEqual([
      { type: 'thinking', active: true },
      { type: 'thinking', active: false }
    ])
  })

  it('maps unreachable PC to pc_unreachable within 3.5 s', async () => {
    const { p, events } = await setup({ hang: true })
    const t0 = Date.now()
    await p.ask(ask())
    expect(Date.now() - t0).toBeLessThan(3500)
    expect(errorOf(events)).toMatchObject({ code: 'pc_unreachable', partial: false })
    expect(errorOf(events)!.message).toContain('Tailscale')
  })

  it('maps missing model to model_missing and names the pull command', async () => {
    const { p, events } = await setup({ missingModel: true })
    await p.ask(ask())
    expect(errorOf(events)).toMatchObject({ code: 'model_missing' })
    expect(errorOf(events)!.message).toContain('ollama pull qwen3-vl:8b')
  })

  it('keeps partial answer on stream error', async () => {
    const { p, events } = await setup({ tokens: ['a', 'b', 'c'], dropAfter: 2 })
    await p.ask(ask())
    expect(tokens(events)).toBe('ab')
    expect(errorOf(events)).toMatchObject({ code: 'stream_dropped', partial: true })
  })

  it('maps permission denial to permission_screen', async () => {
    const { p, events } = await setup(
      {},
      {
        capture: async () => {
          throw new CaptureError('permission', 'denied')
        }
      }
    )
    await p.ask(ask())
    expect(errorOf(events)).toMatchObject({ code: 'permission_screen' })
  })

  it('falls back to image mode when OCR fails', async () => {
    const { p, events, mock } = await setup({}, { ocr: async () => null })
    await p.ask(ask())
    expect(events.find((e) => e.type === 'capture')).toMatchObject({ mode: 'image' })
    expect(mock.lastChatBody().messages.at(-1).images).toHaveLength(1)
  })

  it('continues without search when SearXNG fails', async () => {
    const { p, events } = await setup(
      { tokens: ['ok'] },
      {
        search: (async () => {
          throw new Error('down')
        }) as unknown as typeof runSearch
      }
    )
    await p.ask(ask({ search: true }))
    const notice = events.find((e) => e.type === 'notice')
    expect(notice).toBeDefined()
    expect(types(events).indexOf('notice')).toBeLessThan(types(events).indexOf('token'))
    expect(tokens(events)).toBe('ok')
  })

  it('emits sources and passes web context to the model', async () => {
    const { p, events, mock } = await setup()
    await p.ask(ask({ search: true, question: 'atp synthase structure' }))
    expect(events.find((e) => e.type === 'sources')).toMatchObject({ sources: [{ n: 1, url: 'https://s.example' }] })
    expect(mock.lastChatBody().messages.at(-1).content).toContain('<web>')
  })

  it('uses question directly as search query when it looks like one', async () => {
    const { p, searches, mock } = await setup()
    await p.ask(ask({ search: true, question: 'atp synthase structure' }))
    expect(searches).toEqual(['atp synthase structure'])
    expect(mock.chatBodies()).toHaveLength(1)
  })

  it('generates a search query with a short model call otherwise', async () => {
    const { p, searches, mock } = await setup({ tokens: ['"mitochondria ATP"\nextra'] })
    await p.ask(ask({ search: true, question: 'what does this mean?' }))
    expect(searches).toEqual(['mitochondria ATP'])
    const [queryCall] = mock.chatBodies()
    expect(queryCall.options.num_predict).toBe(30)
    expect(queryCall.think).toBe(false)
    expect(queryCall.options.num_ctx).toBe(8192)
  })

  it('marks truncated answers', async () => {
    const { p, events } = await setup({ doneReason: 'length' })
    await p.ask(ask())
    expect(events.at(-1)).toEqual({ type: 'done', truncated: true })
  })

  it('shows Loading model status when first chunk is slow', async () => {
    const { p, events } = await setup({ delayMs: 2000, tokens: ['A'] })
    await p.ask(ask())
    const loading = events.findIndex((e) => e.type === 'status' && e.text === 'Loading model…')
    expect(loading).toBeGreaterThanOrEqual(0)
    expect(loading).toBeLessThan(types(events).indexOf('token'))
  })

  it('new ask aborts the in-flight ask', async () => {
    const { p, events } = await setup({ tokens: ['1', '2', '3', '4', '5', '6'], delayMs: 40 })
    const a = p.ask(ask({ question: 'A' }))
    await new Promise((r) => setTimeout(r, 150))
    const b = p.ask(ask({ question: 'B' }))
    await Promise.all([a, b])
    const lastCapture = types(events).lastIndexOf('capture')
    const after = events.slice(lastCapture)
    expect(after.filter((e) => e.type === 'token')).toHaveLength(6)
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'error')).toHaveLength(0)
  })

  it('stop ends the answer without an error', async () => {
    const { p, events } = await setup({ tokens: ['1', '2', '3', '4', '5'], delayMs: 40 })
    const a = p.ask(ask())
    await new Promise((r) => setTimeout(r, 120))
    p.stop()
    await a
    expect(events.filter((e) => e.type === 'error')).toHaveLength(0)
    expect(events.filter((e) => e.type === 'token').length).toBeLessThan(5)
  })

  it('setCapture supplies a region capture for the next ask', async () => {
    const { p, events, captures } = await setup()
    p.setCapture({ png: Buffer.from('region'), thumbnailDataUrl: 'data:image/png;base64,cmVnaW9u' })
    await p.ask(ask({ newCapture: false }))
    expect(captures()).toBe(0)
    expect(events.find((e) => e.type === 'capture')).toMatchObject({ thumbnailDataUrl: 'data:image/png;base64,cmVnaW9u' })
  })
})
