import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import type { SaveResult, Settings } from '../shared/types'

const httpUrl = z
  .string()
  .trim()
  .refine((s) => {
    try {
      const u = new URL(s)
      return u.protocol === 'http:' || u.protocol === 'https:'
    } catch {
      return false
    }
  }, 'must be an http:// or https:// address')
  .transform((s) => s.replace(/\/+$/, ''))

const int = (min: number, max: number) => z.number().int().min(min).max(max)

export const SettingsSchema = z.object({
  serverUrl: httpUrl,
  searxngUrl: httpUrl,
  models: z.object({
    accurate: z.string().trim().min(1),
    fast: z.string().trim().min(1),
    thinking: z.string().trim().min(1)
  }),
  hotkeys: z.object({
    capture: z.string().min(1),
    region: z.string().min(1),
    toggle: z.string().min(1)
  }),
  maxAnswerTokens: int(64, 4096),
  imageMaxSide: int(512, 4096),
  search: z.object({
    results: int(1, 10),
    pagesToRead: int(0, 5),
    pageTimeoutMs: int(500, 10000),
    budgetMs: int(1000, 20000)
  }),
  quickActions: z
    .array(z.object({ id: z.string().min(1), label: z.string().min(1), prompt: z.string().min(1) }))
    .max(12)
})

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: 'http://kihurn-desktop:7080',
  searxngUrl: 'http://kihurn-desktop:8888',
  models: { accurate: 'qwen3-vl:8b-instruct', fast: 'qwen3-vl:4b-instruct', thinking: 'qwen3-vl:8b' },
  hotkeys: {
    capture: 'CommandOrControl+Shift+Space',
    region: 'CommandOrControl+Shift+X',
    toggle: 'CommandOrControl+Shift+L'
  },
  maxAnswerTokens: 512,
  imageMaxSide: 1280,
  search: { results: 5, pagesToRead: 2, pageTimeoutMs: 2500, budgetMs: 4000 },
  quickActions: [
    { id: 'explain', label: 'Explain', prompt: "Explain what's on screen simply." },
    { id: 'steps', label: 'Step-by-step', prompt: 'Solve or walk through what is shown, one numbered step at a time.' },
    { id: 'summarize', label: 'Summarize', prompt: 'Summarize the key points on screen as short bullets.' },
    {
      id: 'quiz',
      label: 'Quiz me',
      prompt: "Write 3 short quiz questions on this, answers hidden under an 'Answers' heading."
    },
    { id: 'define', label: 'Define', prompt: 'Define the key terms on screen in one line each.' }
  ]
}

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Old defaults from before Lenz went through C0RE, swapped for the new ones on load. */
const LEGACY: Record<string, Record<string, string>> = {
  serverUrl: { 'http://study-pc:11434': DEFAULT_SETTINGS.serverUrl },
  searxngUrl: { 'http://study-pc:8888': DEFAULT_SETTINGS.searxngUrl },
  'models.accurate': { 'qwen3-vl:8b': DEFAULT_SETTINGS.models.accurate },
  'models.fast': { 'qwen3-vl:4b': DEFAULT_SETTINGS.models.fast }
}

function migrate(stored: Json): Json {
  const out: Json = { ...stored }
  if (isObject(out.models)) out.models = { ...out.models }
  for (const [path, map] of Object.entries(LEGACY)) {
    const [a, b] = path.split('.') as [string, string?]
    const holder = b ? out[a] : out
    const key = b ?? a
    if (isObject(holder) && typeof holder[key] === 'string' && map[holder[key] as string]) {
      holder[key] = map[holder[key] as string]
    }
  }
  return out
}

/** Stored values override defaults; nested objects merge one level deep; arrays replace. */
function mergeWithDefaults(stored: Json): Json {
  const out: Json = { ...(DEFAULT_SETTINGS as unknown as Json) }
  for (const [k, v] of Object.entries(stored)) {
    const d = out[k]
    out[k] = isObject(d) && isObject(v) ? { ...d, ...v } : v
  }
  return out
}

export function loadSettings(filePath: string): Settings {
  try {
    const raw: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
    if (!isObject(raw)) return structuredClone(DEFAULT_SETTINGS)
    const parsed = SettingsSchema.safeParse(mergeWithDefaults(migrate(raw)))
    return parsed.success ? parsed.data : structuredClone(DEFAULT_SETTINGS)
  } catch {
    return structuredClone(DEFAULT_SETTINGS)
  }
}

export function saveSettings(filePath: string, s: unknown): SaveResult {
  const parsed = SettingsSchema.safeParse(s)
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
  }
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, JSON.stringify(parsed.data, null, 2))
  renameSync(tmp, filePath)
  return { ok: true }
}
