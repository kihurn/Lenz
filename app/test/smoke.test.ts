import { describe, expect, it } from 'vitest'
import type { AskEvent } from '../src/shared/types'
import { IPC } from '../src/shared/ipc'

describe('shared types', () => {
  it('accepts a done event', () => {
    const e: AskEvent = { type: 'done', truncated: false }
    expect(e.type).toBe('done')
  })

  it('exposes IPC channel names', () => {
    expect(IPC.ask).toBe('lenz:ask')
  })
})
