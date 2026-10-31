import { randomUUID } from 'node:crypto'
import { turnLabel, type AskEvent, type AskRequest, type Conversation, type ErrorCode, type Settings, type Source, type StoredTurn } from '../shared/types'
import { wantsFreshLook } from './fresh-look'
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
  /** The C0RE key ('' when none is saved). */
  apiKey: () => string
  ollama: (baseUrl: string, apiKey: string) => OllamaClient
  search: typeof runSearch
  emit: (e: AskEvent) => void
  /** Saves a finished turn to chat history (skipped when history is off). */
  record?: (conversationId: string, createdAt: number, turn: StoredTurn) => void
}

// Constant across requests: changing num_ctx makes Ollama reload the model.
export const NUM_CTX = 8192
export const TEMPERATURE = 0.3
export const QUERY_MAX_TOKENS = 30
export const PING_TIMEOUT_MS = 3000
export const LOADING_HINT_MS = 1500
export const MODEL_SWITCH_NOTICE = 'Switching model — the first answer takes a few extra seconds while it loads.'

/** Think uses the thinking model; otherwise Fast or Accurate. */
export function pickModel(s: Settings, req: Pick<AskRequest, 'speed' | 'think'>): string {
  if (req.think) return s.models.thinking
  return req.speed === 'fast' ? s.models.fast : s.models.accurate
}

const DEFAULT_QUESTION = "Explain what's on screen."

class Aborted extends Error {}

interface CaptureState {
  capture: CaptureResult
  /** Started once per capture and shared, so a hotkey capture and the ask that follows OCR only once. */
  ocr?: Promise<OcrResult | null>
  /** Whether the renderer has been sent this capture's thumbnail. */
  announced: boolean
  /** Taken mid-conversation (a new look), so the panel keeps the thread. */
  fresh?: boolean
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
      case 'engine_offline':
        return { code: 'engine_offline', message: "Your PC is on, but its AI engine (Ollama) is offline. Start Ollama on the PC." }
      case 'missing_key':
        return { code: 'c0re_key', message: 'Lenz needs its C0RE key. Paste it in Settings.' }
      case 'invalid_key':
        return {
          code: 'c0re_key',
          message: "C0RE didn't accept the key. Copy it again from the C0RE dashboard (Keys → eye button) into Settings."
        }
      case 'key_disabled':
        return { code: 'c0re_key', message: "Lenz's key is switched off in C0RE. Turn it back on in the C0RE dashboard." }
      case 'key_not_public':
        return {
          code: 'c0re_key',
          message: "Lenz's key only works over Tailscale. Use the Tailscale address (http://kihurn-desktop:7080) in Settings."
        }
      case 'model_not_allowed':
        return {
          code: 'model_not_allowed',
          message: `C0RE doesn't let Lenz use '${model}'. Allow it for the lenz key in the C0RE dashboard, or pick another model in Settings.`
        }
      case 'rate_limited':
        return { code: 'rate_limited', message: 'Too many requests for the Lenz key — wait a moment and try again.' }
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
  /** The model of the last answer, to warn when Think swaps the thinking model in or out. */
  let lastModel: string | null = null
  /** The chat being saved to history; a new one starts whenever the conversation resets. */
  let conv: { id: string; createdAt: number } | null = null
  /** The capture whose thumbnail is already saved with this chat. */
  let recordedCapture: CaptureState | null = null

  function newConversation(): void {
    history = []
    conv = null
    recordedCapture = null
  }

  function stop(): void {
    generation++
    current?.abort()
    current = null
  }

  function setCapture(c: CaptureResult): void {
    stop()
    state = { capture: c, announced: false }
    newConversation()
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
      emit({ type: 'cleared' })
      emit({ type: 'status', text: 'Capturing…' })
      const task = (async () => {
        const st: CaptureState = { capture: c ?? (await deps.capture()), announced: false }
        // A newer capture may have started meanwhile; never let an older one replace it.
        if (myGen === generation) {
          state = st
          newConversation()
        }
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
    newConversation()
  }

  /** Continues a saved chat: its turns become the history; the next ask looks at the screen afresh. */
  function resume(c: Conversation): void {
    stop()
    state = null
    history = c.turns.flatMap((t) => [
      { role: 'user' as const, text: t.question },
      { role: 'assistant' as const, text: t.answer }
    ])
    conv = { id: c.id, createdAt: c.createdAt }
    recordedCapture = null
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
    const model = pickModel(s, req)
    let emittedTokens = false

    try {
      // 1. Screen: capture (or reuse), OCR, choose text or image.
      if (!req.newCapture && pendingCapture) {
        // Adopt the newest hotkey capture still in flight instead of capturing again.
        const adopted = await pendingCapture.catch(() => null)
        check()
        if (adopted && state !== adopted) {
          state = adopted
          newConversation()
        }
      }
      // A follow-up about what's on screen *now* takes a new look but keeps the conversation.
      const fresh = !req.newCapture && !!state && history.length > 0 && wantsFreshLook(req.question)
      if (req.newCapture || !state || fresh) {
        emit({ type: 'status', text: fresh ? 'Taking a new look…' : 'Capturing…' })
        const captured = await deps.capture()
        check()
        // A resumed chat (no screen yet) keeps its history too; only an explicit new capture resets it.
        if (req.newCapture) newConversation()
        state = { capture: captured, announced: false }
        state.fresh = fresh || history.length > 0
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
        emit({ type: 'capture', thumbnailDataUrl: st.capture.thumbnailDataUrl, mode, ...(st.fresh ? { fresh: true } : {}) })
      }

      // 2. Make sure the PC answers before doing anything slow.
      const client = deps.ollama(s.serverUrl, deps.apiKey())
      emit({ type: 'status', text: 'Connecting…' })
      await client.ping(PING_TIMEOUT_MS)
      check()

      // Swapping the thinking model in or out makes Ollama reload; say so before the wait.
      const thinkModel = s.models.thinking
      if (lastModel !== model && (model === thinkModel || lastModel === thinkModel)) {
        emit({ type: 'notice', text: MODEL_SWITCH_NOTICE })
      }
      lastModel = model

      const question = resolveQuestion(req.question, req.actionId, s.quickActions) || DEFAULT_QUESTION

      // 3. Optional web search. Failures never block the answer.
      let search: SearchContext | undefined
      let sources: Source[] | undefined
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
          sources = search.sources
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
      if (deps.record && s.saveHistory) {
        conv ??= { id: randomUUID(), createdAt: Date.now() }
        const action = req.actionId ? s.quickActions.find((a) => a.id === req.actionId) : undefined
        const turn: StoredTurn = { label: turnLabel(req.question, action?.label), question, answer, at: Date.now() }
        if (sources?.length) turn.sources = sources
        if (recordedCapture !== st) turn.thumbnailDataUrl = st.capture.thumbnailDataUrl
        recordedCapture = st
        try {
          deps.record(conv.id, conv.createdAt, turn)
        } catch {
          /* history is a convenience; never fail the answer over it */
        }
      }
    } catch (e) {
      if (e instanceof Aborted || !live()) return
      const { code, message } = describeError(e, model, emittedTokens)
      emit({ type: 'error', code, message, partial: emittedTokens })
    } finally {
      if (current === ac) current = null
    }
  }

  return { ask, stop, captureNow, setCapture, reset, resume }
}

export type Pipeline = ReturnType<typeof createPipeline>
