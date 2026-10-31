import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createHistoryStore } from '../src/main/history'
import type { StoredTurn } from '../src/shared/types'

let dir: string
beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'lenz-history-')), 'history')
})

const turn = (label: string, at: number, extra: Partial<StoredTurn> = {}): StoredTurn => ({
  label,
  question: label,
  answer: `answer to ${label}`,
  at,
  ...extra
})

describe('history store', () => {
  it('starts empty', () => {
    expect(createHistoryStore(dir).list()).toEqual([])
  })

  it('creates a chat on the first turn and appends later ones', () => {
    const h = createHistoryStore(dir)
    const id = randomUUID()
    h.append(id, 1, turn('What is ATP?', 10, { thumbnailDataUrl: 'data:image/png;base64,AA' }))
    h.append(id, 1, turn('Explain more', 20))
    const c = h.get(id)!
    expect(c.title).toBe('What is ATP?')
    expect(c.turns.map((t) => t.label)).toEqual(['What is ATP?', 'Explain more'])
    expect(h.list()).toEqual([{ id, title: 'What is ATP?', updatedAt: 20, turns: 2, thumbnailDataUrl: 'data:image/png;base64,AA' }])
  })

  it('lists newest first and keeps only the newest chats', () => {
    const h = createHistoryStore(dir, 2)
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()]
    h.append(a, 1, turn('a', 1))
    h.append(b, 2, turn('b', 2))
    h.append(c, 3, turn('c', 3))
    expect(h.list().map((x) => x.title)).toEqual(['c', 'b'])
    expect(h.get(a)).toBeNull()
  })

  it('removes one chat or all of them', () => {
    const h = createHistoryStore(dir)
    const [a, b] = [randomUUID(), randomUUID()]
    h.append(a, 1, turn('a', 1))
    h.append(b, 2, turn('b', 2))
    h.remove(a)
    expect(h.list().map((x) => x.id)).toEqual([b])
    h.clear()
    expect(h.list()).toEqual([])
    expect(readdirSync(dir)).toEqual([])
  })

  it('refuses ids that could escape the folder', () => {
    const h = createHistoryStore(dir)
    expect(h.get('../../settings')).toBeNull()
    expect(() => h.append('../evil', 1, turn('x', 1))).toThrow()
    expect(() => h.remove('../evil')).not.toThrow()
  })
})
