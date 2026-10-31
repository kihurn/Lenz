// Types shared by the main process, preload and renderer.

export type InputMode = 'text' | 'image'
export type Speed = 'fast' | 'accurate'

export interface QuickAction {
  id: string
  label: string
  prompt: string
}

export interface Source {
  n: number
  title: string
  url: string
  snippet: string
}

export type ErrorCode =
  | 'pc_unreachable'
  | 'engine_offline'
  | 'c0re_key'
  | 'model_missing'
  | 'model_not_allowed'
  | 'rate_limited'
  | 'permission_screen'
  | 'stream_dropped'
  | 'search_unavailable'
  | 'bad_settings'
  | 'unknown'

export interface AskRequest {
  question: string
  actionId?: string
  search: boolean
  think: boolean
  speed: Speed
  modeOverride?: InputMode
  newCapture: boolean
}

export type AskEvent =
  /** A new capture replaced the conversation; the panel should drop the old one. */
  | { type: 'cleared' }
  | { type: 'status'; text: string }
  /** `fresh`: a follow-up took a new look; the conversation carries on. */
  | { type: 'capture'; thumbnailDataUrl: string; mode: InputMode; fresh?: boolean }
  | { type: 'thinking'; active: boolean }
  | { type: 'token'; text: string }
  | { type: 'sources'; sources: Source[] }
  | { type: 'notice'; text: string }
  | { type: 'done'; truncated: boolean }
  | { type: 'error'; code: ErrorCode; message: string; partial: boolean }

export interface Settings {
  serverUrl: string
  searxngUrl: string
  models: { accurate: string; fast: string; thinking: string }
  hotkeys: { capture: string; region: string; toggle: string }
  maxAnswerTokens: number
  imageMaxSide: number
  search: { results: number; pagesToRead: number; pageTimeoutMs: number; budgetMs: number }
  quickActions: QuickAction[]
  /** Keep past chats on this Mac (questions, answers, small thumbnails). */
  saveHistory: boolean
}

export type SaveResult = { ok: true } | { ok: false; errors: string[] }

export interface ModelInfo {
  name: string
  vision: boolean
  thinking: boolean
}

export interface ConnectionReport {
  /** C0RE reachable and the key accepted. */
  server: { ok: boolean; latencyMs?: number; error?: string }
  models: ModelInfo[]
  searxng: { ok: boolean; error?: string }
}

export interface StoredTurn {
  /** What the panel showed as the question, e.g. "Explain · what is ATP?". */
  label: string
  /** The question as sent to the model (quick-action prompt included). */
  question: string
  answer: string
  sources?: Source[]
  /** Set on the turn that used a new screenshot. */
  thumbnailDataUrl?: string
  at: number
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  turns: StoredTurn[]
}

export interface ConversationSummary {
  id: string
  title: string
  updatedAt: number
  turns: number
  thumbnailDataUrl?: string
}

/** The panel's label for a question, shared so saved chats match what was shown. */
export function turnLabel(question: string, actionLabel?: string): string {
  return [actionLabel, question.trim()].filter(Boolean).join(' · ') || 'Explain'
}
