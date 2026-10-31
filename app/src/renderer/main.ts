import 'katex/dist/katex.min.css'
import './styles.css'
import { turnLabel, type AskEvent, type AskRequest, type Conversation, type ErrorCode, type InputMode, type Settings, type Source, type Speed } from '../shared/types'
import { renderHistory } from './history-view'
import { renderMarkdown } from './markdown'
import { renderSettings } from './settings-view'

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!

const el = {
  shell: $('#shell'),
  chat: $('#chat-view'),
  history: $('#history-view'),
  settings: $('#settings-view'),
  seg: $('#seg'),
  capture: $('#capture'),
  thumb: $<HTMLImageElement>('#thumb'),
  modeLabel: $('#mode-label'),
  thread: $('#thread'),
  empty: $('#empty'),
  notice: $('#notice'),
  actions: $('#actions'),
  form: $<HTMLFormElement>('#ask-form'),
  question: $<HTMLTextAreaElement>('#question'),
  send: $<HTMLButtonElement>('#send'),
  stop: $<HTMLButtonElement>('#stop'),
  think: $<HTMLButtonElement>('#think'),
  search: $<HTMLButtonElement>('#search'),
  mode: $<HTMLButtonElement>('#mode')
}

// Toggle state is a per-device convenience; storage may be unavailable.
interface Prefs {
  speed: Speed
  think: boolean
  search: boolean
  mode: 'auto' | InputMode
}
const PREFS_KEY = 'lenz.prefs'
let prefs: Prefs = { speed: 'accurate', think: false, search: false, mode: 'auto' }
try {
  prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}'), mode: 'auto' }
} catch {
  /* defaults */
}
const savePrefs = () => {
  try {
    // The Text/Image override applies to one capture only, so it is not remembered.
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, mode: 'auto' }))
  } catch {
    /* ignore */
  }
}

let settings: Settings
let streaming = false
let lastRequest: AskRequest | null = null

interface TurnView {
  root: HTMLElement
  status: HTMLElement
  answer: HTMLElement
  text: string
  renderTimer?: ReturnType<typeof setTimeout>
}
let turn: TurnView | null = null

// ---------- header toggles ----------

function syncToggles(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-speed]')) {
    b.setAttribute('aria-pressed', String(b.dataset['speed'] === prefs.speed))
  }
  el.seg.style.setProperty('--i', prefs.speed === 'fast' ? '0' : '1')
  el.think.setAttribute('aria-pressed', String(prefs.think))
  el.search.setAttribute('aria-pressed', String(prefs.search))
  el.mode.textContent = { auto: 'Auto', text: 'Text', image: 'Image' }[prefs.mode]
  el.mode.setAttribute('aria-pressed', String(prefs.mode !== 'auto'))
}

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-speed]')) {
  b.addEventListener('click', () => {
    prefs.speed = b.dataset['speed'] as Speed
    savePrefs()
    syncToggles()
  })
}
el.think.addEventListener('click', () => {
  prefs.think = !prefs.think
  savePrefs()
  syncToggles()
})
el.search.addEventListener('click', () => {
  prefs.search = !prefs.search
  savePrefs()
  syncToggles()
})
el.mode.addEventListener('click', () => {
  prefs.mode = prefs.mode === 'auto' ? 'text' : prefs.mode === 'text' ? 'image' : 'auto'
  savePrefs()
  syncToggles()
})

// ---------- thread ----------

const scrollDown = () => (el.thread.scrollTop = el.thread.scrollHeight)

function clearThread(): void {
  turn = null
  el.thread.replaceChildren(el.empty)
  el.notice.hidden = true
}

function startTurn(label: string): TurnView {
  el.empty.remove()
  const root = document.createElement('article')
  root.className = 'turn'
  const q = document.createElement('div')
  q.className = 'q'
  q.textContent = label
  const status = document.createElement('div')
  status.className = 'status'
  const answer = document.createElement('div')
  answer.className = 'answer streaming'
  root.append(q, status, answer)
  el.thread.append(root)
  scrollDown()
  return { root, status, answer, text: '' }
}

/** Re-render Markdown at most every 50 ms while streaming. */
function scheduleRender(t: TurnView, now = false): void {
  if (now) {
    clearTimeout(t.renderTimer)
    t.renderTimer = undefined
    t.answer.innerHTML = renderMarkdown(t.text)
    return
  }
  if (t.renderTimer) return
  t.renderTimer = setTimeout(() => {
    t.renderTimer = undefined
    const atBottom = el.thread.scrollHeight - el.thread.scrollTop - el.thread.clientHeight < 40
    t.answer.innerHTML = renderMarkdown(t.text)
    if (atBottom) scrollDown()
  }, 50)
}

function renderSources(t: TurnView, sources: Source[]): void {
  if (!sources.length) return
  const list = document.createElement('ol')
  list.className = 'sources'
  for (const s of sources) {
    const li = document.createElement('li')
    const n = document.createElement('span')
    n.className = 'n'
    n.textContent = `[${s.n}]`
    const a = document.createElement('a')
    a.href = s.url
    a.textContent = s.title
    a.title = s.url
    li.append(n, a)
    list.append(li)
  }
  t.root.append(list)
}

/** A marker in the thread where a follow-up took a new screenshot. */
function markNewLook(thumb: string): void {
  const mark = document.createElement('div')
  mark.className = 'new-look'
  const img = document.createElement('img')
  img.src = thumb
  img.alt = ''
  const label = document.createElement('span')
  label.textContent = 'Took a new look at your screen'
  mark.append(img, label)
  // Before the turn that triggered it, so it reads in order.
  if (turn && turn.root.isConnected) el.thread.insertBefore(mark, turn.root)
  else el.thread.append(mark)
}

function note(t: TurnView, text: string): void {
  const p = document.createElement('p')
  p.className = 'note'
  p.textContent = text
  t.root.append(p)
}

function setStreaming(on: boolean): void {
  streaming = on
  el.stop.hidden = !on
  el.send.hidden = on
  if (!on && turn) turn.answer.classList.remove('streaming')
}

function showError(code: ErrorCode, message: string): void {
  const t = turn ?? startTurn('')
  t.status.textContent = ''
  if (!t.text) t.answer.remove()
  const box = document.createElement('div')
  box.className = 'error'
  box.setAttribute('role', 'alert')
  box.textContent = message
  const row = document.createElement('div')
  row.className = 'row'
  const action = (label: string, fn: () => void) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'link-btn'
    b.textContent = label
    b.addEventListener('click', fn)
    row.append(b)
  }
  if (code === 'permission_screen') action('Open Screen Recording settings', () => window.lenz.openScreenSettings())
  const fixInSettings: ErrorCode[] = ['pc_unreachable', 'c0re_key', 'model_missing', 'model_not_allowed']
  const noRetry: ErrorCode[] = ['permission_screen', 'c0re_key', 'model_missing', 'model_not_allowed']
  if (fixInSettings.includes(code)) action('Open Lenz settings', () => void openSettings())
  if (!noRetry.includes(code) && lastRequest) {
    action('Retry', () => send({ ...lastRequest!, newCapture: false }, t.root.querySelector('.q')?.textContent ?? ''))
  }
  if (row.childElementCount) box.append(row)
  t.root.append(box)
  scrollDown()
}

// ---------- events from main ----------

function onEvent(e: AskEvent): void {
  switch (e.type) {
    case 'cleared':
      // A hotkey capture replaced the conversation (any answer in progress was stopped).
      setStreaming(false)
      clearThread()
      prefs.mode = 'auto'
      syncToggles()
      break
    case 'capture':
      if (e.fresh) markNewLook(e.thumbnailDataUrl)
      else if (!streaming) clearThread()
      el.capture.hidden = false
      el.thumb.src = e.thumbnailDataUrl
      el.modeLabel.textContent = e.fresh
        ? 'Took a new look'
        : e.mode === 'text'
          ? 'Reading the text on screen'
          : 'Looking at the image'
      if (!streaming) el.question.focus()
      break
    case 'status':
      if (turn && streaming) turn.status.textContent = e.text
      break
    case 'thinking':
      if (turn) turn.status.textContent = e.active ? 'Thinking it through…' : ''
      break
    case 'token':
      if (!turn) return
      turn.status.textContent = ''
      turn.text += e.text
      scheduleRender(turn)
      break
    case 'sources':
      if (turn) renderSources(turn, e.sources)
      break
    case 'notice':
      if (turn && streaming) note(turn, e.text)
      else {
        el.notice.textContent = e.text
        el.notice.hidden = false
      }
      break
    case 'done':
      if (turn) {
        scheduleRender(turn, true)
        turn.status.textContent = ''
        if (e.truncated) {
          note(
            turn,
            turn.text
              ? 'Answer cut short — ask "continue" for more.'
              : 'Ran out of room while thinking — try again with Think off, or ask a narrower question.'
          )
        }
      }
      setStreaming(false)
      break
    case 'error':
      if (turn && turn.text) scheduleRender(turn, true)
      setStreaming(false)
      showError(e.code, e.message)
      break
  }
}
window.lenz.onEvent(onEvent)

// ---------- asking ----------

function send(req: AskRequest, label: string): void {
  if (req.newCapture) {
    clearThread()
  }
  lastRequest = req
  if (turn) turn.answer.classList.remove('streaming')
  turn = startTurn(label)
  setStreaming(true)
  window.lenz.ask(req)
}

function ask(opts: { actionId?: string; newCapture?: boolean } = {}): void {
  if (streaming) window.lenz.stop()
  const question = el.question.value.trim()
  const action = opts.actionId ? settings.quickActions.find((a) => a.id === opts.actionId) : undefined
  if (!question && !action && !opts.newCapture && el.capture.hidden) return
  const label = turnLabel(question, action?.label)
  el.question.value = ''
  autosize()
  send(
    {
      question,
      actionId: opts.actionId,
      search: prefs.search,
      think: prefs.think,
      speed: prefs.speed,
      modeOverride: prefs.mode === 'auto' ? undefined : prefs.mode,
      newCapture: opts.newCapture ?? false
    },
    label
  )
}

function renderActions(): void {
  el.actions.replaceChildren(
    ...settings.quickActions.map((a) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = a.label
      b.title = a.prompt
      b.addEventListener('click', () => ask({ actionId: a.id }))
      return b
    })
  )
}

function autosize(): void {
  el.question.style.height = 'auto'
  el.question.style.height = `${Math.min(el.question.scrollHeight, 120)}px`
}

el.form.addEventListener('submit', (e) => {
  e.preventDefault()
  ask()
})
el.question.addEventListener('input', autosize)
el.question.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    ask({ newCapture: e.metaKey || e.ctrlKey })
  }
})
el.stop.addEventListener('click', () => {
  window.lenz.stop()
  setStreaming(false)
  if (turn) turn.status.textContent = ''
})
$('#recapture').addEventListener('click', () => ask({ newCapture: true }))
$('#hide').addEventListener('click', () => window.lenz.hidePanel())
$('#open-settings').addEventListener('click', () => void openSettings())
$('#open-history').addEventListener('click', () => void openHistory())

// Links in answers and sources open in the browser.
el.thread.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest('a')
  if (!a) return
  e.preventDefault()
  window.lenz.openExternal(a.href)
})

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (!el.settings.hidden) closeSettings(null, false)
  else if (!el.history.hidden) showView('chat')
  else window.lenz.hidePanel()
})

// The panel "materialises" each time it's shown.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return
  el.shell.classList.remove('appear')
  void el.shell.offsetWidth
  el.shell.classList.add('appear')
})

// ---------- views ----------

function showView(v: 'chat' | 'history' | 'settings'): void {
  el.chat.hidden = v !== 'chat'
  el.history.hidden = v !== 'history'
  el.settings.hidden = v !== 'settings'
  if (v !== 'history') el.history.replaceChildren()
  if (v !== 'settings') el.settings.replaceChildren()
  if (v === 'chat') el.question.focus()
}

// ---------- history ----------

async function openHistory(): Promise<void> {
  const chats = await window.lenz.historyList()
  showView('history')
  renderHistory(el.history, chats, {
    open: (id) => void openConversation(id),
    remove: (id) => window.lenz.historyDelete(id),
    newChat: () => {
      newChat()
      showView('chat')
    },
    close: () => showView('chat')
  })
}

function newChat(): void {
  if (streaming) window.lenz.stop()
  setStreaming(false)
  window.lenz.newChat()
  lastRequest = null
  clearThread()
  el.capture.hidden = true
}

async function openConversation(id: string): Promise<void> {
  if (streaming) window.lenz.stop()
  setStreaming(false)
  const c: Conversation | null = await window.lenz.historyOpen(id)
  if (!c) return void openHistory()
  lastRequest = null
  clearThread()
  for (const t of c.turns) {
    const v = startTurn(t.label)
    v.text = t.answer
    v.answer.classList.remove('streaming')
    v.answer.innerHTML = renderMarkdown(t.answer)
    if (t.sources) renderSources(v, t.sources)
  }
  turn = null
  const thumb = [...c.turns].reverse().find((t) => t.thumbnailDataUrl)?.thumbnailDataUrl
  el.capture.hidden = !thumb
  if (thumb) el.thumb.src = thumb
  el.modeLabel.textContent = 'Saved chat · your next question takes a new look'
  showView('chat')
  scrollDown()
}

// ---------- settings ----------

async function openSettings(): Promise<void> {
  const [current, hasKey] = await Promise.all([window.lenz.getSettings(), window.lenz.hasKey()])
  showView('settings')
  renderSettings(el.settings, current, hasKey, closeSettings)
}

function closeSettings(saved: Settings | null, keySaved: boolean): void {
  if (saved) {
    settings = saved
    applySettings()
    el.notice.textContent = keySaved ? 'Settings and C0RE key saved.' : 'Settings saved.'
    el.notice.hidden = false
  }
  showView('chat')
}

const KEY_SYMBOLS: Record<string, string> = {
  CommandOrControl: '⌘',
  Command: '⌘',
  Cmd: '⌘',
  Control: '⌃',
  Ctrl: '⌃',
  Shift: '⇧',
  Alt: '⌥',
  Option: '⌥'
}
const prettyKey = (accel: string) => accel.split('+').map((k) => KEY_SYMBOLS[k] ?? k).join('')

function applySettings(): void {
  $('#hk-capture').textContent = prettyKey(settings.hotkeys.capture)
  $('#hk-region').textContent = prettyKey(settings.hotkeys.region)
  renderActions()
}

void window.lenz.getSettings().then((s) => {
  settings = s
  applySettings()
  syncToggles()
})
