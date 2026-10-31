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

/** C0RE's own error codes, sent as `{"error":{"code","message"}}`. */
export const GATEWAY_CODES = [
  'missing_key',
  'invalid_key',
  'key_disabled',
  'key_not_public',
  'model_not_allowed',
  'rate_limited',
  'engine_offline'
] as const
export type GatewayCode = (typeof GATEWAY_CODES)[number]

export type OllamaErrorCode = 'unreachable' | 'model_missing' | 'http' | 'stream' | GatewayCode

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
  e instanceof OllamaError ? e : new OllamaError('unreachable', `Can't reach C0RE: ${String((e as Error)?.message ?? e)}`)

const isGatewayCode = (c: unknown): c is GatewayCode => GATEWAY_CODES.includes(c as GatewayCode)

/** Turns an error body (C0RE's `{error:{code,message}}` or Ollama's `{error:"..."}`) into an OllamaError. */
export function decodeError(status: number, text: string): OllamaError {
  let err: unknown
  try {
    err = JSON.parse(text)?.error
  } catch {
    err = undefined
  }
  if (err && typeof err === 'object') {
    const { code, message } = err as { code?: unknown; message?: unknown }
    const msg = typeof message === 'string' && message ? message : `HTTP ${status}`
    if (isGatewayCode(code)) return new OllamaError(code, msg)
    if (code === 'model_missing') return new OllamaError('model_missing', msg)
    return new OllamaError('http', `C0RE returned HTTP ${status}: ${msg}`)
  }
  const msg = typeof err === 'string' ? err : text.slice(0, 200)
  if (status === 404 && /not found/i.test(msg)) return new OllamaError('model_missing', msg)
  if (status === 401) return new OllamaError('invalid_key', msg || 'Unauthorized')
  if (status === 503) return new OllamaError('engine_offline', msg || 'Service unavailable')
  return new OllamaError('http', `C0RE returned HTTP ${status}: ${msg}`)
}

export function createOllamaClient(baseUrl: string, apiKey = '', fetchImpl: typeof fetch = fetch) {
  const url = (path: string) => `${baseUrl.replace(/\/+$/, '')}${path}`
  const headers = (extra: Record<string, string> = {}): Record<string, string> =>
    apiKey ? { ...extra, authorization: `Bearer ${apiKey}` } : extra

  async function getJson(path: string, init: RequestInit = {}, timeoutMs = 3000): Promise<any> {
    let res: Response
    try {
      res = await fetchImpl(url(path), {
        ...init,
        headers: headers(init.body ? { 'content-type': 'application/json' } : {}),
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (e) {
      throw toUnreachable(e)
    }
    if (!res.ok) throw decodeError(res.status, await res.text().catch(() => ''))
    try {
      return await res.json()
    } catch (e) {
      throw toUnreachable(e)
    }
  }

  /** Checks C0RE answers and accepts the key (/api/tags needs a valid key). */
  async function ping(timeoutMs = 3000): Promise<{ latencyMs: number }> {
    const t0 = Date.now()
    await getJson('/api/tags', {}, timeoutMs)
    return { latencyMs: Date.now() - t0 }
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
          // Capabilities unknown (e.g. the gateway doesn't pass /api/show): guess from the name.
          return { name, vision: /vl|vision|llava/i.test(name), thinking: /qwen3/i.test(name) && !/instruct/i.test(name) }
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
          ? new OllamaError('stream', 'Your PC stopped responding.')
          : new OllamaError(code, `Connection to C0RE failed: ${String((e as Error)?.message ?? e)}`)

    touch()
    try {
      let res: Response
      try {
        res = await fetchImpl(url('/api/chat'), {
          method: 'POST',
          headers: headers({ 'content-type': 'application/json' }),
          body: JSON.stringify({
            model: req.model,
            messages: req.messages,
            stream: true,
            think: req.think,
            options: { temperature: req.temperature, num_ctx: req.numCtx, num_predict: req.numPredict }
          }),
          signal: combined
        })
      } catch (e) {
        if (signal.aborted) return
        throw fail(e, 'unreachable')
      }

      if (!res.ok) throw decodeError(res.status, await res.text().catch(() => ''))
      if (!res.body) throw new OllamaError('stream', 'C0RE sent an empty response.')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        let read: Awaited<ReturnType<typeof reader.read>>
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
            throw new OllamaError('stream', 'C0RE sent malformed data.')
          }
          if (obj.error) throw decodeError(200, JSON.stringify({ error: obj.error }))
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

  /** Asks Ollama to load `model` now (an empty chat loads it), so the next answer starts fast. */
  async function warm(model: string, timeoutMs = 120_000): Promise<void> {
    await getJson('/api/chat', { method: 'POST', body: JSON.stringify({ model, messages: [] }) }, timeoutMs)
  }

  return { ping, listModels, chat, warm }
}

export type OllamaClient = ReturnType<typeof createOllamaClient>
