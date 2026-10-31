import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Conversation, ConversationSummary, StoredTurn } from '../shared/types'

export const MAX_CONVERSATIONS = 200
const TITLE_MAX = 80
const ID_RE = /^[0-9a-f-]{36}$/

/**
 * Past chats, one JSON file each in `dir`, so saving a turn rewrites only its own chat.
 * Holds questions, answers, sources and small thumbnails, never full screenshots.
 */
export function createHistoryStore(dir: string, max = MAX_CONVERSATIONS) {
  const file = (id: string) => {
    if (!ID_RE.test(id)) throw new Error('bad conversation id')
    return join(dir, `${id}.json`)
  }

  function read(id: string): Conversation | null {
    try {
      const c = JSON.parse(readFileSync(file(id), 'utf8')) as Conversation
      return c && Array.isArray(c.turns) ? c : null
    } catch {
      return null
    }
  }

  function write(c: Conversation): void {
    mkdirSync(dir, { recursive: true })
    const path = file(c.id)
    writeFileSync(`${path}.tmp`, JSON.stringify(c))
    renameSync(`${path}.tmp`, path)
  }

  function ids(): string[] {
    try {
      return readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -5))
        .filter((id) => ID_RE.test(id))
    } catch {
      return []
    }
  }

  function list(): ConversationSummary[] {
    return ids()
      .map(read)
      .filter((c): c is Conversation => c !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
        turns: c.turns.length,
        thumbnailDataUrl: c.turns.find((t) => t.thumbnailDataUrl)?.thumbnailDataUrl
      }))
  }

  /** Adds a turn, creating the chat on its first turn, and drops the oldest chats beyond `max`. */
  function append(id: string, createdAt: number, turn: StoredTurn): void {
    const c = read(id) ?? {
      id,
      title: turn.label.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) || 'Chat',
      createdAt,
      updatedAt: turn.at,
      turns: []
    }
    c.turns.push(turn)
    c.updatedAt = turn.at
    write(c)
    const all = list()
    for (const old of all.slice(max)) remove(old.id)
  }

  function remove(id: string): void {
    try {
      rmSync(file(id), { force: true })
    } catch {
      /* bad id: nothing to delete */
    }
  }

  function clear(): void {
    for (const id of ids()) remove(id)
  }

  return { list, get: (id: string) => (ID_RE.test(id) ? read(id) : null), append, remove, clear }
}

export type HistoryStore = ReturnType<typeof createHistoryStore>
