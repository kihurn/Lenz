import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ModelInfo } from '../../src/shared/types'

export interface MockOllamaOptions {
  tokens?: string[]
  thinking?: string[]
  doneReason?: string
  /** Destroy the connection after this many content tokens. */
  dropAfter?: number
  /** Delay before each streamed chunk (and before the first one). */
  delayMs?: number
  models?: ModelInfo[]
  missingModel?: boolean
  /** Accept connections but never respond. */
  hang?: boolean
  port?: number
}

export interface MockOllama {
  url: string
  close(): Promise<void>
  lastChatBody(): any
  chatBodies(): any[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
  })
}

export async function startMockOllama(opts: MockOllamaOptions = {}): Promise<MockOllama> {
  const bodies: any[] = []
  const models = opts.models ?? [
    { name: 'qwen3-vl:8b', vision: true, thinking: true },
    { name: 'qwen3-vl:4b', vision: true, thinking: false },
    { name: 'llama3.2:3b', vision: false, thinking: false }
  ]

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (opts.hang) return // never respond
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const body = req.method === 'POST' ? await readBody(req) : ''

    if (req.url === '/api/version') return json(200, { version: '0.33.1' })
    if (req.url === '/api/tags') return json(200, { models: models.map((m) => ({ name: m.name, model: m.name })) })
    if (req.url === '/api/show') {
      const m = models.find((x) => x.name === JSON.parse(body).model)
      if (!m) return json(404, { error: 'model not found' })
      const capabilities = ['completion', ...(m.vision ? ['vision'] : []), ...(m.thinking ? ['thinking'] : [])]
      return json(200, { capabilities })
    }
    if (req.url === '/api/chat') {
      const parsed = JSON.parse(body)
      bodies.push(parsed)
      if (opts.missingModel) return json(404, { error: `model '${parsed.model}' not found` })
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      const send = async (obj: unknown) => {
        if (opts.delayMs) await sleep(opts.delayMs)
        await new Promise<void>((r) => res.write(JSON.stringify(obj) + '\n', () => r()))
      }
      for (const t of opts.thinking ?? []) {
        await send({ model: parsed.model, message: { role: 'assistant', content: '', thinking: t }, done: false })
      }
      let n = 0
      for (const t of opts.tokens ?? ['Hello', ' world']) {
        if (res.destroyed) return
        await send({ model: parsed.model, message: { role: 'assistant', content: t }, done: false })
        n++
        if (opts.dropAfter !== undefined && n >= opts.dropAfter) {
          await sleep(30) // let the client receive what was already written
          res.destroy()
          return
        }
      }
      await send({ model: parsed.model, message: { role: 'assistant', content: '' }, done: true, done_reason: opts.doneReason ?? 'stop' })
      res.end()
      return
    }
    json(404, { error: 'not found' })
  }

  const server = createServer((req, res) => void handle(req, res))
  await new Promise<void>((r) => server.listen(opts.port ?? 0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    lastChatBody: () => bodies[bodies.length - 1],
    chatBodies: () => bodies,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections()
        server.close(() => r())
      })
  }
}
