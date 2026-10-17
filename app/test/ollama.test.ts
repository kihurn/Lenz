import { afterEach, describe, expect, it } from 'vitest'
import { createOllamaClient, OllamaError, type ChatChunk, type ChatRequest } from '../src/main/ollama'
import { startMockOllama, type MockOllama } from './helpers/mock-ollama'

let mock: MockOllama | undefined
afterEach(async () => {
  await mock?.close()
  mock = undefined
})

const req = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  model: 'qwen3-vl:8b',
  messages: [{ role: 'user', content: 'hi', images: ['QUJD'] }],
  think: false,
  numPredict: 512,
  numCtx: 8192,
  temperature: 0.3,
  ...over
})

async function collect(it: AsyncIterable<ChatChunk>): Promise<ChatChunk[]> {
  const out: ChatChunk[] = []
  for await (const c of it) out.push(c)
  return out
}

const content = (cs: ChatChunk[]) => cs.map((c) => (c.type === 'content' ? c.text : '')).join('')

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'resolved'
  } catch (e) {
    return e instanceof OllamaError ? e.code : `other: ${String(e)}`
  }
}

describe('ollama client', () => {
  it('streams content tokens in order', async () => {
    mock = await startMockOllama({ tokens: ['Hel', 'lo'] })
    const chunks = await collect(createOllamaClient(mock.url).chat(req(), new AbortController().signal))
    expect(content(chunks)).toBe('Hello')
    expect(chunks.at(-1)).toEqual({ type: 'done', doneReason: 'stop' })
  })

  it('yields thinking chunks before content', async () => {
    mock = await startMockOllama({ thinking: ['hmm'], tokens: ['A'] })
    const chunks = await collect(createOllamaClient(mock.url).chat(req({ think: true }), new AbortController().signal))
    expect(chunks[0]).toEqual({ type: 'thinking', text: 'hmm' })
    expect(chunks[1]).toEqual({ type: 'content', text: 'A' })
  })

  it('sends options and keep_alive', async () => {
    mock = await startMockOllama()
    await collect(createOllamaClient(mock.url).chat(req({ think: true }), new AbortController().signal))
    const body = mock.lastChatBody()
    expect(body.stream).toBe(true)
    expect(body.keep_alive).toBe(-1)
    expect(body.think).toBe(true)
    expect(body.options).toEqual({ temperature: 0.3, num_ctx: 8192, num_predict: 512 })
    expect(body.messages[0].images[0]).toBe('QUJD')
  })

  it('reports length truncation', async () => {
    mock = await startMockOllama({ doneReason: 'length' })
    const chunks = await collect(createOllamaClient(mock.url).chat(req(), new AbortController().signal))
    expect(chunks.at(-1)).toEqual({ type: 'done', doneReason: 'length' })
  })

  it('missing model raises model_missing', async () => {
    mock = await startMockOllama({ missingModel: true })
    expect(await codeOf(collect(createOllamaClient(mock.url).chat(req(), new AbortController().signal)))).toBe('model_missing')
  })

  it('ping times out after 3 s', async () => {
    mock = await startMockOllama({ hang: true })
    const t0 = Date.now()
    expect(await codeOf(createOllamaClient(mock.url).ping(3000))).toBe('unreachable')
    expect(Date.now() - t0).toBeLessThan(3500)
  })

  it('ping reports version and latency', async () => {
    mock = await startMockOllama()
    const r = await createOllamaClient(mock.url).ping()
    expect(r.version).toBe('0.33.1')
    expect(r.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('unreachable host raises unreachable', async () => {
    const client = createOllamaClient('http://127.0.0.1:1')
    expect(await codeOf(client.ping())).toBe('unreachable')
    expect(await codeOf(collect(client.chat(req(), new AbortController().signal)))).toBe('unreachable')
  })

  it('stream drop raises stream error after partial tokens', async () => {
    mock = await startMockOllama({ tokens: ['a', 'b', 'c', 'd'], dropAfter: 2 })
    const got: ChatChunk[] = []
    let code = 'none'
    try {
      for await (const c of createOllamaClient(mock.url).chat(req(), new AbortController().signal)) got.push(c)
    } catch (e) {
      code = e instanceof OllamaError ? e.code : String(e)
    }
    expect(content(got)).toBe('ab')
    expect(code).toBe('stream')
  })

  it('abort stops iteration without error', async () => {
    mock = await startMockOllama({ tokens: ['a', 'b', 'c', 'd', 'e'], delayMs: 50 })
    const ac = new AbortController()
    const got: ChatChunk[] = []
    for await (const c of createOllamaClient(mock.url).chat(req(), ac.signal)) {
      got.push(c)
      if (got.length === 2) ac.abort()
    }
    expect(got.length).toBe(2)
  })

  it('listModels reports vision and thinking capabilities', async () => {
    mock = await startMockOllama()
    const models = await createOllamaClient(mock.url).listModels()
    expect(models).toEqual([
      { name: 'qwen3-vl:8b', vision: true, thinking: true },
      { name: 'qwen3-vl:4b', vision: true, thinking: false },
      { name: 'llama3.2:3b', vision: false, thinking: false }
    ])
  })
})
