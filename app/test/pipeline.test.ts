import { afterEach, describe, expect, it } from 'vitest'
import { createOllamaClient } from '../src/main/ollama'
import { CaptureError, createPipeline, MODEL_SWITCH_NOTICE, type PipelineDeps } from '../src/main/pipeline'
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
  const { serverUrl, ...depsOver } = over
  const events: AskEvent[] = []
  let captures = 0
  const searches: string[] = []
  const deps: PipelineDeps = {
    settings: () => ({ ...DEFAULT_SETTINGS, serverUrl: serverUrl ?? mock!.url }),
    apiKey: () => 'c0re_test',
    capture: async () => {
      captures++
      return { png: Buffer.from('png'), thumbnailDataUrl: 'data:image/png;base64,cG5n' }
    },
    ocr: async () => denseText,
    imageOps,
    ollama: (url, key) => createOllamaClient(url, key),
    search: (async (a: Parameters<typeof runSearch>[0]) => {
      searches.push(a.query)
      return { query: a.query, sources: [{ n: 1, title: 'S', url: 'https://s.example', snippet: 'snip' }], pages: [] }
    }) as typeof runSearch,
    emit: (e) => events.push(e),
    ...depsOver
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
    expect(events.at(-1)).toMatchObject({ type: 'done', truncated: false })
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
    await p.ask(ask())
    const b = mock.lastChatBody()
    expect(b.model).toBe('qwen3-vl:8b-instruct')
    expect(b.think).toBe(false)
    expect(b.options).toEqual({ temperature: 0.3, num_ctx: 8192, num_predict: 1536 })
  })

  it('uses fast model when speed is fast', async () => {
    const { p, mock } = await setup()
    await p.ask(ask({ speed: 'fast' }))
    expect(mock.lastChatBody().model).toBe('qwen3-vl:4b-instruct')
  })

  it('Think switches to the thinking model, whatever the speed', async () => {
    const { p, mock } = await setup()
    await p.ask(ask({ think: true, speed: 'fast' }))
    expect(mock.lastChatBody()).toMatchObject({ model: 'qwen3-vl:8b', think: true })
    // thinking counts against the limit, so Think gets extra room
    expect(mock.lastChatBody().options.num_predict).toBe(1536 + 3072)
  })

  it('warns once when switching to or from the thinking model', async () => {
    const { p, events } = await setup()
    const notices = () => events.filter((e) => e.type === 'notice').length
    await p.ask(ask())
    expect(notices()).toBe(0)
    await p.ask(ask({ newCapture: false, speed: 'fast' }))
    expect(notices()).toBe(0) // instruct models fit in VRAM together
    await p.ask(ask({ newCapture: false, think: true }))
    expect(notices()).toBe(1)
    expect(events.find((e) => e.type === 'notice')).toEqual({ type: 'notice', text: MODEL_SWITCH_NOTICE })
    await p.ask(ask({ newCapture: false, think: true }))
    expect(notices()).toBe(1)
    await p.ask(ask({ newCapture: false }))
    expect(notices()).toBe(2)
  })

  it('takes a new look for "what am I looking at now?" but keeps the conversation', async () => {
    const { p, events, mock, captures } = await setup()
    await p.ask(ask({ question: 'what is ATP?' }))
    events.length = 0
    await p.ask(ask({ question: 'ok what am I looking at now?', newCapture: false }))
    expect(captures()).toBe(2)
    expect(events.find((e) => e.type === 'capture')).toMatchObject({ fresh: true })
    expect(events.some((e) => e.type === 'cleared')).toBe(false)
    expect(mock.lastChatBody().messages).toHaveLength(4) // system + previous Q&A + new question
  })

  it('reuses the screenshot for an ordinary follow-up', async () => {
    const { p, captures } = await setup()
    await p.ask(ask({ question: 'what is ATP?' }))
    await p.ask(ask({ question: 'explain step 2 more', newCapture: false }))
    expect(captures()).toBe(1)
  })

  it('does not take a new look on the first question about a capture', async () => {
    const { p, captures } = await setup()
    await p.captureNow() // the hotkey just took the screenshot
    await p.ask(ask({ question: 'what is this page?', newCapture: false }))
    expect(captures()).toBe(1)
  })

  it('records finished turns to history, one chat per conversation', async () => {
    const saved: { id: string; label: string; thumb?: string }[] = []
    const { p } = await setup({}, { record: (id, _c, t) => saved.push({ id, label: t.label, thumb: t.thumbnailDataUrl }) })
    await p.ask(ask({ question: 'q1' }))
    await p.ask(ask({ question: '', actionId: 'summarize', newCapture: false }))
    await p.ask(ask({ question: 'q3', newCapture: true }))
    expect(saved.map((s) => s.label)).toEqual(['q1', 'Summarize', 'q3'])
    expect(saved[0]!.id).toBe(saved[1]!.id)
    expect(saved[2]!.id).not.toBe(saved[0]!.id)
    expect(saved.map((s) => !!s.thumb)).toEqual([true, false, true])
  })

  it('does not record when history is off', async () => {
    const saved: unknown[] = []
    const { p } = await setup({}, {
      settings: () => ({ ...DEFAULT_SETTINGS, serverUrl: mock!.url, saveHistory: false }),
      record: (...a) => saved.push(a)
    })
    await p.ask(ask())
    expect(saved).toEqual([])
  })

  it('resumes a saved chat: history is sent, plain follow-ups chat, screen questions look', async () => {
    const saved: string[] = []
    const { p, mock, captures, events } = await setup({}, { record: (id) => saved.push(id) })
    const id = '00000000-0000-4000-8000-000000000001'
    p.resume({
      id,
      title: 'old',
      createdAt: 1,
      updatedAt: 2,
      turns: [{ label: 'old q', question: 'old q', answer: 'old a', at: 2 }]
    })
    await p.ask(ask({ question: 'and a follow-up', newCapture: false }))
    expect(captures()).toBe(0)
    const msgs = mock.lastChatBody().messages
    expect(msgs[1]).toMatchObject({ role: 'user', content: 'old q' })
    expect(msgs[2]).toMatchObject({ role: 'assistant', content: 'old a' })
    expect(saved).toEqual([id])
    await p.ask(ask({ question: "what's on my screen?", newCapture: false }))
    expect(captures()).toBe(1)
    expect(saved).toEqual([id, id])
    expect(events.find((e) => e.type === 'capture')).toMatchObject({ fresh: true })
  })

  it('chats without a screenshot when the question does not need the screen', async () => {
    const { p, events, mock, captures } = await setup()
    await p.ask(ask({ question: 'what is photosynthesis?', newCapture: false }))
    expect(captures()).toBe(0)
    expect(events.some((e) => e.type === 'noscreen')).toBe(true)
    expect(events.some((e) => e.type === 'capture')).toBe(false)
    const last = mock.lastChatBody().messages.at(-1)
    expect(last.content).toBe('what is photosynthesis?')
    expect(last.images).toBeUndefined()
    expect(errorOf(events)).toBeUndefined()
  })

  it('looks at the screen when the first question points at it', async () => {
    const { p, captures, mock } = await setup()
    await p.ask(ask({ question: 'explain this', newCapture: false }))
    expect(captures()).toBe(1)
    expect(mock.lastChatBody().messages.at(-1).content).toContain('<screen>')
  })

  it('quick actions always look at the screen', async () => {
    const { p, captures } = await setup()
    await p.ask(ask({ question: '', actionId: 'summarize', newCapture: false }))
    expect(captures()).toBe(1)
  })

  it('Add screen (lookNow) captures but keeps the chat going', async () => {
    const { p, captures, mock, events } = await setup()
    await p.ask(ask({ question: 'what is photosynthesis?', newCapture: false }))
    await p.ask(ask({ question: '', newCapture: false, lookNow: true }))
    expect(captures()).toBe(1)
    expect(mock.lastChatBody().messages).toHaveLength(4)
    expect(events.find((e) => e.type === 'capture')).toMatchObject({ fresh: true })
  })

  it('a plain chat follow-up stays without a screenshot', async () => {
    const { p, captures } = await setup()
    await p.ask(ask({ question: 'what is photosynthesis?', newCapture: false }))
    await p.ask(ask({ question: 'explain that more simply', newCapture: false }))
    expect(captures()).toBe(0)
  })

  it('reports how long the answer took', async () => {
    const { p, events } = await setup()
    await p.ask(ask({ search: true }))
    const done = events.find((e) => e.type === 'done') as Extract<AskEvent, { type: 'done' }>
    expect(done.timing).toMatchObject({ model: 'qwen3-vl:8b-instruct', mode: 'Accurate' })
    const t = done.timing!
    expect(t.totalMs).toBeGreaterThanOrEqual(t.firstTokenMs!)
    expect(t.screenMs).toBeGreaterThanOrEqual(0)
    expect(t.searchMs).toBeGreaterThanOrEqual(0)
  })

  it('warm-up loads the model the toggles will use, once a minute at most', async () => {
    const { p, mock } = await setup()
    p.warm({ speed: 'accurate', think: true })
    p.warm({ speed: 'fast', think: true })
    await new Promise((r) => setTimeout(r, 100))
    expect(mock.chatBodies()).toEqual([{ model: 'qwen3-vl:8b', messages: [] }])
  })

  it('sends the saved C0RE key', async () => {
    const { p, events, mock } = await setup({ requireKey: 'c0re_test' })
    await p.ask(ask())
    expect(errorOf(events)).toBeUndefined()
    expect(mock.authHeaders().every((h) => h === 'Bearer c0re_test')).toBe(true)
  })

  it.each([
    ['missing_key', 401, 'c0re_key', 'Paste it in Settings'],
    ['invalid_key', 401, 'c0re_key', 'dashboard'],
    ['key_disabled', 403, 'c0re_key', 'switched off'],
    ['key_not_public', 403, 'c0re_key', 'Tailscale'],
    ['model_not_allowed', 403, 'model_not_allowed', "'qwen3-vl:8b-instruct'"],
    ['rate_limited', 429, 'rate_limited', 'wait a moment'],
    ['engine_offline', 503, 'engine_offline', 'Ollama']
  ])('explains C0RE error %s in plain words', async (gwCode, status, code, text) => {
    const { p, events } = await setup({ gatewayError: { status, code: gwCode, message: 'x' } })
    await p.ask(ask())
    expect(errorOf(events)).toMatchObject({ code, partial: false })
    expect(errorOf(events)!.message).toContain(text)
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
    expect(errorOf(events)!.message).toContain('ollama pull qwen3-vl:8b-instruct')
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
    expect(events.at(-1)).toMatchObject({ type: 'done', truncated: true })
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

  it('captureNow captures, reads the screen and announces it without asking', async () => {
    const { p, events, captures, mock } = await setup()
    await p.captureNow()
    expect(captures()).toBe(1)
    expect(events.find((e) => e.type === 'capture')).toMatchObject({ mode: 'text' })
    expect(mock.chatBodies()).toHaveLength(0)
  })

  it('ask after captureNow reuses the capture and its OCR', async () => {
    let ocrCalls = 0
    const { p, captures, mock } = await setup(
      {},
      {
        ocr: async () => {
          ocrCalls++
          return denseText
        }
      }
    )
    const pending = p.captureNow()
    await p.ask(ask({ newCapture: false }))
    await pending
    expect(captures()).toBe(1)
    expect(ocrCalls).toBe(1)
    expect(mock.chatBodies()).toHaveLength(1)
  })

  it('captureNow tells the panel to drop the old conversation first', async () => {
    const { p, events } = await setup()
    await p.captureNow()
    expect(events[0]).toEqual({ type: 'cleared' })
  })

  it('captureNow during a stream ends the old answer with cleared, not silence', async () => {
    const { p, events } = await setup({ tokens: ['1', '2', '3', '4', '5', '6'], delayMs: 40 })
    const a = p.ask(ask())
    await new Promise((r) => setTimeout(r, 150))
    await p.captureNow()
    await a
    const cleared = events.findIndex((e) => e.type === 'cleared')
    expect(cleared).toBeGreaterThan(types(events).indexOf('token'))
    expect(events.slice(cleared).some((e) => e.type === 'token')).toBe(false)
    expect(events.filter((e) => e.type === 'done' || e.type === 'error')).toHaveLength(0)
  })

  it('an older capture finishing late does not replace a newer one', async () => {
    const releases: (() => void)[] = []
    const { p, mock } = await setup(
      {},
      {
        capture: () =>
          new Promise((r) => {
            const name = releases.length === 0 ? 'old' : 'new'
            releases.push(() => r({ png: Buffer.from(name), thumbnailDataUrl: `data:,${name}` }))
          }),
        ocr: async (png) => ({ text: `${png.toString()} `.repeat(100), confidence: 0.95, coverage: 0.5 })
      }
    )
    const first = p.captureNow()
    await Promise.resolve()
    const second = p.captureNow()
    await Promise.resolve()
    releases[1]!() // newer capture finishes first
    await second
    releases[0]!() // older one finishes late
    await first
    await p.ask(ask({ newCapture: false }))
    expect(mock.lastChatBody().messages.at(-1).content).toContain('<screen>\nnew')
  })

  it('captureNow accepts a ready-made region capture', async () => {
    const { p, events, captures } = await setup()
    await p.captureNow({ png: Buffer.from('region'), thumbnailDataUrl: 'data:image/png;base64,cmVnaW9u' })
    expect(captures()).toBe(0)
    expect(events.find((e) => e.type === 'capture')).toMatchObject({ thumbnailDataUrl: 'data:image/png;base64,cmVnaW9u' })
  })

  it('captureNow reports permission errors', async () => {
    const { p, events } = await setup(
      {},
      {
        capture: async () => {
          throw new CaptureError('permission', 'denied')
        }
      }
    )
    await p.captureNow()
    expect(errorOf(events)).toMatchObject({ code: 'permission_screen' })
  })

  it('setCapture supplies a region capture for the next ask', async () => {
    const { p, events, captures } = await setup()
    p.setCapture({ png: Buffer.from('region'), thumbnailDataUrl: 'data:image/png;base64,cmVnaW9u' })
    await p.ask(ask({ newCapture: false }))
    expect(captures()).toBe(0)
    expect(events.find((e) => e.type === 'capture')).toMatchObject({ thumbnailDataUrl: 'data:image/png;base64,cmVnaW9u' })
  })
})
