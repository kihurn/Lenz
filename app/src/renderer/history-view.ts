import type { ConversationSummary } from '../shared/types'

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const DAY = 86_400_000

/** "Today", "Yesterday", "Previous 7 days", "Earlier": the groups the list is split into. */
export function groupOf(at: number, now = Date.now()): string {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  if (at >= startOfToday) return 'Today'
  if (at >= startOfToday - DAY) return 'Yesterday'
  if (at >= startOfToday - 7 * DAY) return 'Previous 7 days'
  return 'Earlier'
}

function when(at: number, now = Date.now()): string {
  const d = new Date(at)
  const g = groupOf(at, now)
  if (g === 'Today' || g === 'Yesterday') return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

export interface HistoryHandlers {
  open(id: string): void
  remove(id: string): Promise<void>
  newChat(): void
  close(): void
}

/** Renders the list of past chats into `root`. */
export function renderHistory(root: HTMLElement, chats: ConversationSummary[], h: HistoryHandlers): void {
  root.innerHTML = `
    <div class="view-head">
      <button type="button" class="icon back" id="history-back" aria-label="Back to chat" title="Back (Esc)">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" /></svg>
      </button>
      <h2>History</h2>
      <span class="spacer"></span>
      <button type="button" class="btn" id="history-new">New chat</button>
    </div>
    <div class="search-field">
      <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>
      <input type="search" id="history-filter" placeholder="Search chats" aria-label="Search chats" />
    </div>
    <div class="history-list" id="history-list"></div>`

  const listEl = root.querySelector<HTMLElement>('#history-list')!
  let items = chats

  const draw = (filter: string) => {
    const f = filter.trim().toLowerCase()
    const shown = f ? items.filter((c) => c.title.toLowerCase().includes(f)) : items
    if (!shown.length) {
      listEl.innerHTML = `<p class="history-empty">${
        items.length ? 'No chats match.' : 'No chats yet. Your conversations will appear here.'
      }</p>`
      return
    }
    const groups = new Map<string, ConversationSummary[]>()
    for (const c of shown) {
      const g = groupOf(c.updatedAt)
      groups.set(g, [...(groups.get(g) ?? []), c])
    }
    listEl.innerHTML = [...groups]
      .map(
        ([g, cs]) => `
      <section class="history-group">
        <h3>${esc(g)}</h3>
        <ul class="group">
          ${cs
            .map(
              (c) => `
            <li class="history-item" data-id="${esc(c.id)}">
              <button type="button" class="history-open">
                ${c.thumbnailDataUrl ? `<img src="${esc(c.thumbnailDataUrl)}" alt="" />` : '<span class="no-thumb"></span>'}
                <span class="history-text">
                  <span class="history-title">${esc(c.title)}</span>
                  <span class="history-meta">${esc(when(c.updatedAt))} · ${c.turns} ${c.turns === 1 ? 'question' : 'questions'}</span>
                </span>
              </button>
              <button type="button" class="icon history-delete" aria-label="Delete chat" title="Delete">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
              </button>
            </li>`
            )
            .join('')}
        </ul>
      </section>`
      )
      .join('')
  }

  const filterEl = root.querySelector<HTMLInputElement>('#history-filter')!
  filterEl.addEventListener('input', () => draw(filterEl.value))
  listEl.addEventListener('click', async (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.history-item')
    if (!item) return
    const id = item.dataset['id']!
    if ((e.target as HTMLElement).closest('.history-delete')) {
      await h.remove(id)
      items = items.filter((c) => c.id !== id)
      draw(filterEl.value)
    } else {
      h.open(id)
    }
  })
  root.querySelector('#history-back')!.addEventListener('click', () => h.close())
  root.querySelector('#history-new')!.addEventListener('click', () => h.newChat())
  draw('')
  filterEl.focus()
}
