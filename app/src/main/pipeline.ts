import type { AskEvent, AskRequest, ErrorCode, Settings } from '../shared/types'
import { OllamaError, type OllamaClient } from './ollama'
import { decideMode, encodeImage, type ImageOps, type OcrResult } from './prepare'
import { buildMessages, buildQueryMessages, resolveQuestion, type ScreenContext, type SearchContext, type Turn } from './prompts'
import { looksLikeQuery, type runSearch } from './search'

export interface CaptureResult {
  png: Buffer
  thumbnailDataUrl: string
}

export class CaptureError extends Error {
  constructor(
    readonly kind: 'permission' | 'failed',
    message: string
  ) {
    super(message)
    this.name = 'CaptureError'
  }
}

export interface PipelineDeps {
  settings: () => Settings
  capture: () => Promise<CaptureResult>
  ocr: (png: Buffer) => Promise<OcrResult | null>
  imageOps: ImageOps
  ollama: (baseUrl: string) => OllamaClient
  search: typeof runSearch
  emit: (e: AskEvent) => void
}

// Constant across requests: changing num_ctx makes Ollama reload the model.
export const NUM_CTX = 8192
export const TEMPERATURE = 0.3
export const QUERY_MAX_TOKENS = 30
export const PING_TIMEOUT_MS = 3000
export const LOADING_HINT_MS = 1500

const DEFAULT_QUESTION = "Explain what's on screen."

class Aborted extends Error {}

interface CaptureState {
  capture: CaptureResult
  /** Started once per capture and shared, so a hotkey capture and the ask that follows OCR only once. */
  ocr?: Promise<OcrResult | null>
  /** Whether the renderer has been sent this capture's thumbnail. */
  announced: boolean
}

function describeError(e: unknown, model: string, partial: boolean): { code: ErrorCode; message: string } {
  if (e instanceof CaptureError) {
    return e.kind === 'permission'
      ? { code: 'permission_screen', message: 'Lenz needs Screen Recording permission to see your screen.' }
      : { code: 'unknown', message: `Couldn't capture the screen: ${e.message}` }
  }
  if (e instanceof OllamaError) {
    switch (e.code) {
      case 'unreachable':
        return { code: 'pc_unreachable', message: "Can't reach your PC — check it's on and Tailscale is connected." }
      case 'model_missing':
        return {
          code: 'model_missing',
          message: `Model '${model}' isn't installed on your PC. On the PC run: ollama pull ${model}`
        }
      case 'stream':
        return {
          code: 'stream_dropped',
          message: partial ? 'The connection to your PC dropped mid-answer.' : 'Your PC stopped responding.'
        }
      default:
        return { code: 'unknown', message: e.message }
    }
  }
  return { code: 'unknown', message: String((e as Error)?.message ?? e) }
}

/** First line of the model's reply, without quotes; falls back to the question. */
function cleanQuery(raw: string, fallback: string): string {
  const line = raw.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  const q = line.replace(/^["'`]+|["'`]+$/g, '').trim()
  return q || fallback
}

export function createPipeline(deps: PipelineDeps) {
  let state: CaptureState | null = null
  let history: Turn[] = []
  let current: AbortController | null = null
  let generation = 0
  /** A hotkey capture still in progress; an ask that arrives meanwhile waits for it instead of capturing again. */
  let pendingCapture: Promise<CaptureState> | null = null

  function stop(): void {
    generation++
    current?.abort()
    current = null
  }

  function setCapture(c: CaptureResult): void {
    stop()
    state = { capture: c, announced: false }
    history = []
  }

  const readScreen = (st: CaptureState) => (st.ocr ??= deps.ocr(st.capture.png))

  /** Hotkey path: capture (or take a region capture) and OCR it right away, while the user types. */
  async function captureNow(c?: CaptureResult): Promise<void> {
    stop()
    const myGen = generation
    const emit = (e: AskEvent) => {
      if (myGen === generation) deps.emit(e)
    }
    try {
      emit({ type: 'status', text: 'Capturing…' })
      const task = (async () => {
        const st: CaptureState = { capture: c ?? (await deps.capture()), announced: false }
        state = st
        history = []
        return st
      })()
      pendingCapture = task
      let st: CaptureState
      try {
        st = await task
      } finally {
        if (pendingCapture === task) pendingCapture = null
      }
      emit({ type: 'status', text: 'Reading screen…' })
      const ocr = await readScreen(st)
      if (myGen !== generation || state !== st) return
      st.announced = true
      emit({ type: 'capture', thumbnailDataUrl: st.capture.thumbnailDataUrl, mode: decideMode(ocr) })
    } catch (e) {
      const { code, message } = describeError(e, '', false)
      emit({ type: 'error', code, message, partial: false })
    }
  }

  function reset(): void {
    stop()
    state = null
    history = []
  }

  async function ask(req: AskRequest): Promise<void> {
    stop()
    const myGen = generation
    const ac = new AbortController()
    current = ac
    const live = () => myGen === generation
    const emit = (e: AskEvent) => {
      if (live()) deps.emit(e)
    }
    const check = () => {
      if (!live()) throw new Aborted()
    }

    const s = deps.settings()
    const model = req.speed === 'fast' ? s.models.fast : s.models.accurate
    let emittedTokens = false

    try {
      // 1. Screen: capture (or reuse), OCR, choose text or image.
      if (!req.newCapture && pendingCapture) {
        await pendingCapture.catch(() => undefined)
        check()
      }
      if (req.newCapture || !state) {
        emit({ type: 'status', text: 'Capturing…' })
        state = { capture: await deps.capture(), announced: false }
        history = []
        check()
      }
      const st = state
      if (!st.ocr) emit({ type: 'status', text: 'Reading screen…' })
      const ocr = await readScreen(st)
      check()
      const mode = decideMode(ocr, req.modeOverride)
      const screen: ScreenContext = { mode, ocrText: ocr?.text ?? '' }
      if (mode === 'image') {
        screen.imageBase64 = encodeImage(st.capture.png, ocr, s.imageMaxSide, deps.imageOps).base64
      }
      if (!st.announced || req.modeOverride) {
        st.announced = true
        emit({ type: 'capture', thumbnailDataUrl: st.capture.thumbnailDataUrl, mode })
      }

      // 2. Make sure the PC answers before doing anything slow.
      const client = deps.ollama(s.serverUrl)
      emit({ type: 'status', text: 'Connecting…' })
      await client.ping(PING_TIMEOUT_MS)
      check()

      const question = resolveQuestion(req.question, req.actionId, s.quickActions) || DEFAULT_QUESTION

      // 3. Optional web search. Failures never block the answer.
      let search: SearchContext | undefined
      if (req.search) {
        try {
          let query = question
          if (!looksLikeQuery(question)) {
            emit({ type: 'status', text: 'Writing search query…' })
            let raw = ''
            for await (const c of client.chat(
              {
                model,
                messages: buildQueryMessages(question, screen.ocrText),
                think: false,
                numPredict: QUERY_MAX_TOKENS,
                numCtx: NUM_CTX,
                temperature: TEMPERATURE
              },
              ac.signal
            )) {
              if (c.type === 'content') raw += c.text
            }
            check()
            query = cleanQuery(raw, question)
          }
          search = await deps.search({
            baseUrl: s.searxngUrl,
            query,
            cfg: s.search,
            signal: ac.signal,
            onStatus: (text) => emit({ type: 'status', text })
          })
          check()
          emit({ type: 'sources', sources: search.sources })
        } catch (e) {
          check()
          if (e instanceof OllamaError && e.code !== 'http') throw e
          emit({ type: 'notice', text: 'Search unavailable — answering without it.' })
        }
      }

      // 4. Stream the answer.
      emit({ type: 'status', text: 'Thinking…' })
      const loadingHint = setTimeout(() => emit({ type: 'status', text: 'Loading model…' }), LOADING_HINT_MS)
      let answer = ''
      let thinking = false
      let truncated = false
      try {
        for await (const c of client.chat(
          {
            model,
            messages: buildMessages({ screen, history, question, search }),
            think: req.think,
            numPredict: s.maxAnswerTokens,
            numCtx: NUM_CTX,
            temperature: TEMPERATURE
          },
          ac.signal
        )) {
          clearTimeout(loadingHint)
          check()
          if (c.type === 'thinking') {
            if (!thinking) emit({ type: 'thinking', active: (thinking = true) })
          } else if (c.type === 'content') {
            if (thinking) emit({ type: 'thinking', active: (thinking = false) })
            answer += c.text
            emittedTokens = true
            emit({ type: 'token', text: c.text })
          } else {
            truncated = c.doneReason === 'length'
          }
        }
      } finally {
        clearTimeout(loadingHint)
      }
      check()
      history.push({ role: 'user', text: question }, { role: 'assistant', text: answer })
      emit({ type: 'done', truncated })
    } catch (e) {
      if (e instanceof Aborted || !live()) return
      const { code, message } = describeError(e, model, emittedTokens)
      emit({ type: 'error', code, message, partial: emittedTokens })
    } finally {
      if (current === ac) current = null
    }
  }

  return { ask, stop, captureNow, setCapture, reset }
}

export type Pipeline = ReturnType<typeof createPipeline>
