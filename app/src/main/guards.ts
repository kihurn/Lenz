import { z } from 'zod'
import type { AskRequest } from '../shared/types'

export function isSafeExternalUrl(url: string): boolean {
  try {
    const p = new URL(url).protocol
    return p === 'http:' || p === 'https:'
  } catch {
    return false
  }
}

const AskRequestSchema = z.object({
  question: z.string().max(10_000),
  actionId: z.string().max(64).optional(),
  search: z.boolean(),
  think: z.boolean(),
  speed: z.enum(['fast', 'accurate']),
  modeOverride: z.enum(['text', 'image']).optional(),
  newCapture: z.boolean()
})

/** Validates an ask coming from the renderer; unknown fields are dropped. */
export function parseAskRequest(input: unknown): AskRequest | null {
  const r = AskRequestSchema.safeParse(input)
  return r.success ? r.data : null
}
