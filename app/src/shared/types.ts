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
  | 'model_missing'
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
  | { type: 'status'; text: string }
  | { type: 'capture'; thumbnailDataUrl: string; mode: InputMode }
  | { type: 'thinking'; active: boolean }
  | { type: 'token'; text: string }
  | { type: 'sources'; sources: Source[] }
  | { type: 'notice'; text: string }
  | { type: 'done'; truncated: boolean }
  | { type: 'error'; code: ErrorCode; message: string; partial: boolean }

export interface Settings {
  serverUrl: string
  searxngUrl: string
  models: { accurate: string; fast: string }
  hotkeys: { capture: string; region: string; toggle: string }
  maxAnswerTokens: number
  imageMaxSide: number
  search: { results: number; pagesToRead: number; pageTimeoutMs: number; budgetMs: number }
  quickActions: QuickAction[]
}

export type SaveResult = { ok: true } | { ok: false; errors: string[] }

export interface ModelInfo {
  name: string
  vision: boolean
  thinking: boolean
}

export interface ConnectionReport {
  ollama: { ok: boolean; version?: string; latencyMs?: number; error?: string }
  models: ModelInfo[]
  searxng: { ok: boolean; error?: string }
}
