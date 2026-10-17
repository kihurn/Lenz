import type { ModelInfo } from '../shared/types'

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  /** Base64 image data without a data: prefix. */
  images?: string[]
}

export interface ChatRequest {
  model: string
  messages: OllamaMessage[]
  think: boolean
  numPredict: number
  numCtx: number
  temperature: number
}

export type ChatChunk =
  | { type: 'content'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'done'; doneReason: string }

export type OllamaErrorCode = 'unreachable' | 'model_missing' | 'http' | 'stream'

export class OllamaError extends Error {
  constructor(
    readonly code: OllamaErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'OllamaError'
  }
}

/** Longest gap allowed between streamed chunks (covers cold model loads). */
const STREAM_IDLE_MS = 60_000

const toUnreachable = (e: unknown) =>
  e instanceof OllamaError ? e : new OllamaError('unreachable', `Can't reach Ollama: ${String((e as Error)?.message ?? e)}`)

export function createOllamaClient(baseUrl: string, fetchImpl: typeof fetch = fetch) {
  const url = (path: string) => `${baseUrl.replace(/\/+$/, '')}${path}`

  async function getJson(path: string, init: RequestInit = {}, timeoutMs = 3000): Promise<any> {
    let res: Response
    try {
      res = await fetchImpl(url(path), { ...init, signal: AbortSignal.timeout(timeoutMs) })
    } catch (e) {
      throw toUnreachable(e)
    }
    if (!res.ok) throw new OllamaError('http', `Ollama returned HTTP ${res.status} for ${path}`)
    try {
      return await res.json()
    } catch (e) {
      throw toUnreachable(e)
    }
  }

  async function ping(timeoutMs = 3000): Promise<{ version: string; latencyMs: number }> {
    const t0 = Date.now()
    const body = await getJson('/api/version', {}, timeoutMs)
    return { version: String(body.version ?? 'unknown'), latencyMs: Date.now() - t0 }
  }

  async function listModels(): Promise<ModelInfo[]> {
    const tags = await getJson('/api/tags', {}, 5000)
    const names: string[] = (tags.models ?? []).map((m: { name: string }) => m.name)
    return Promise.all(
      names.map(async (name) => {
        try {
          const show = await getJson('/api/show', { method: 'POST', body: JSON.stringify({ model: name }) }, 5000)
          const caps: string[] = show.capabilities ?? []
          return { name, vision: caps.includes('vision'), thinking: caps.includes('thinking') }
        } catch {
          return { name, vision: false, thinking: false }
        }
      })
    )
  }

  async function* chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
    const idle = new AbortController()
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    const touch = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => idle.abort(), STREAM_IDLE_MS)
    }
    const combined = AbortSignal.any([signal, idle.signal])
    const fail = (e: unknown, code: OllamaErrorCode): OllamaError =>
      e instanceof OllamaError
        ? e
        : idle.signal.aborted
          ? new OllamaError('stream', 'Ollama stopped responding.')
          : new OllamaError(code, `Connection to Ollama failed: ${String((e as Error)?.message ?? e)}`)

    touch()
    try {
      let res: Response
      try {
        res = await fetchImpl(url('/api/chat'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: req.model,
            messages: req.messages,
            stream: true,
            think: req.think,
            keep_alive: -1,
            options: { temperature: req.temperature, num_ctx: req.numCtx, num_predict: req.numPredict }
          }),
          signal: combined
        })
      } catch (e) {
        if (signal.aborted) return
        throw fail(e, 'unreachable')
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        if (res.status === 404 && /not found/i.test(text)) {
          throw new OllamaError('model_missing', `Model '${req.model}' is not installed on the PC.`)
        }
        throw new OllamaError('http', `Ollama returned HTTP ${res.status}: ${text.slice(0, 200)}`)
      }
      if (!res.body) throw new OllamaError('stream', 'Ollama sent an empty response.')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        let read: ReadableStreamReadResult<Uint8Array>
        try {
          read = await reader.read()
        } catch (e) {
          if (signal.aborted) return
          throw fail(e, 'stream')
        }
        if (read.done) break
        touch()
        buffer += decoder.decode(read.value, { stream: true })
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line) continue
          let obj: any
          try {
            obj = JSON.parse(line)
          } catch {
            throw new OllamaError('stream', 'Ollama sent malformed data.')
          }
          if (obj.error) throw new OllamaError('http', String(obj.error))
          const thinking: string | undefined = obj.message?.thinking
          const text: string | undefined = obj.message?.content
          if (thinking) yield { type: 'thinking', text: thinking }
          if (text) yield { type: 'content', text }
          if (obj.done) {
            yield { type: 'done', doneReason: String(obj.done_reason ?? 'stop') }
            return
          }
          if (signal.aborted) return
        }
      }
      if (signal.aborted) return
      throw new OllamaError('stream', 'The connection to your PC dropped mid-answer.')
    } finally {
      clearTimeout(idleTimer)
    }
  }

  return { ping, listModels, chat }
}

export type OllamaClient = ReturnType<typeof createOllamaClient>
