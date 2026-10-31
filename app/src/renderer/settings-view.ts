import type { ConnectionReport, Settings } from '../shared/types'

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function field(label: string, name: string, value: string | number, type = 'text', extra = ''): string {
  return `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(String(value))}" ${extra} /></label>`
}

/** Renders the settings form into `root`. `onClose` returns to the chat view. */
export function renderSettings(
  root: HTMLElement,
  s: Settings,
  hasKey: boolean,
  onClose: (saved: Settings | null, keySaved: boolean) => void
): void {
  const keyHint = hasKey ? 'Saved — leave empty to keep it' : 'Paste the key for project “lenz” (starts with c0re_)'
  const group = (title: string, body: string, foot = '') =>
    `<section class="group-wrap"><h3>${esc(title)}</h3><div class="group">${body}</div>${foot}</section>`
  root.innerHTML = `
    <div class="view-head">
      <button type="button" class="icon back" id="settings-back" aria-label="Back to chat" title="Back (Esc)">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" /></svg>
      </button>
      <h2>Settings</h2>
    </div>
    ${group(
      'Your PC',
      `${field('C0RE address', 'serverUrl', s.serverUrl, 'url')}
      ${field('C0RE key', 'apiKey', '', 'password', `placeholder="${esc(keyHint)}" autocomplete="off" spellcheck="false"`)}
      <p class="key-status ${hasKey ? 'ok' : 'bad'}" id="key-status">${
        hasKey ? 'A key is saved on this Mac.' : 'No key saved yet. Paste it above, then press Save.'
      }</p>
      ${field('Search engine (SearXNG) address', 'searxngUrl', s.searxngUrl, 'url')}`,
      `<div class="buttons"><button type="button" class="btn" id="test">Test connection</button></div>
      <ul class="report" id="report" hidden></ul>`
    )}
    ${group(
      'Models',
      `<div class="pair">
        ${field('Accurate', 'models.accurate', s.models.accurate)}
        ${field('Fast', 'models.fast', s.models.fast)}
      </div>
      ${field('Think (used when Think is on)', 'models.thinking', s.models.thinking)}`
    )}
    ${group(
      'History',
      `<label class="switch-row">
        <span>Save chats on this Mac<small>Questions, answers and small thumbnails. Full screenshots are never kept.</small></span>
        <input type="checkbox" class="switch" name="saveHistory" ${s.saveHistory ? 'checked' : ''} />
      </label>`,
      `<div class="buttons"><button type="button" class="btn danger" id="clear-history">Delete all chats</button></div>`
    )}
    ${group(
      'Hotkeys',
      `${field('Capture screen', 'hotkeys.capture', s.hotkeys.capture)}
      ${field('Select an area', 'hotkeys.region', s.hotkeys.region)}
      ${field('Show or hide Lenz', 'hotkeys.toggle', s.hotkeys.toggle)}`
    )}
    ${group(
      'Speed',
      `<div class="pair">
        ${field('Longest answer (tokens)', 'maxAnswerTokens', s.maxAnswerTokens, 'number', 'min="64" max="4096"')}
        ${field('Image size limit (px)', 'imageMaxSide', s.imageMaxSide, 'number', 'min="512" max="4096"')}
        ${field('Search results', 'search.results', s.search.results, 'number', 'min="1" max="10"')}
        ${field('Pages to read', 'search.pagesToRead', s.search.pagesToRead, 'number', 'min="0" max="5"')}
        ${field('Page timeout (ms)', 'search.pageTimeoutMs', s.search.pageTimeoutMs, 'number', 'min="500" max="10000"')}
        ${field('Search time limit (ms)', 'search.budgetMs', s.search.budgetMs, 'number', 'min="1000" max="20000"')}
      </div>`
    )}
    ${group(
      'Quick actions',
      s.quickActions
        .map(
          (a, i) => `
        <label>${esc(a.label)}
          <input name="qa.${i}.label" value="${esc(a.label)}" aria-label="Button label" />
          <textarea name="qa.${i}.prompt" rows="2" aria-label="What it asks">${esc(a.prompt)}</textarea>
        </label>`
        )
        .join('')
    )}
    <ul class="errors" id="errors" hidden></ul>
    <div class="buttons sticky">
      <button type="button" class="btn" id="cancel">Cancel</button>
      <button type="button" class="btn primary" id="save">Save</button>
    </div>`

  const val = (name: string) => (root.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement).value
  const num = (name: string) => Number(val(name))

  const read = (): Settings => ({
    serverUrl: val('serverUrl'),
    searxngUrl: val('searxngUrl'),
    models: { accurate: val('models.accurate'), fast: val('models.fast'), thinking: val('models.thinking') },
    hotkeys: { capture: val('hotkeys.capture'), region: val('hotkeys.region'), toggle: val('hotkeys.toggle') },
    maxAnswerTokens: num('maxAnswerTokens'),
    imageMaxSide: num('imageMaxSide'),
    search: {
      results: num('search.results'),
      pagesToRead: num('search.pagesToRead'),
      pageTimeoutMs: num('search.pageTimeoutMs'),
      budgetMs: num('search.budgetMs')
    },
    quickActions: s.quickActions.map((a, i) => ({ id: a.id, label: val(`qa.${i}.label`), prompt: val(`qa.${i}.prompt`) })),
    saveHistory: (root.querySelector('[name="saveHistory"]') as HTMLInputElement).checked
  })

  const report = root.querySelector<HTMLUListElement>('#report')!
  const testBtn = root.querySelector<HTMLButtonElement>('#test')!
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true
    testBtn.textContent = 'Testing…'
    report.hidden = false
    report.innerHTML = ''
    try {
      showReport(report, await window.lenz.testConnection(read(), val('apiKey')))
    } finally {
      testBtn.disabled = false
      testBtn.textContent = 'Test connection'
    }
  })

  const errors = root.querySelector<HTMLUListElement>('#errors')!
  const saveBtn = root.querySelector<HTMLButtonElement>('#save')!
  const showErrors = (list: string[]) => {
    errors.hidden = false
    errors.innerHTML = list.map((e) => `<li>${esc(e)}</li>`).join('')
    errors.scrollIntoView({ block: 'center' })
  }
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true
    saveBtn.textContent = 'Saving…'
    try {
      const typedKey = val('apiKey')
      const r = await window.lenz.saveSettings(read(), typedKey)
      if (r.ok) return onClose(await window.lenz.getSettings(), typedKey.trim() !== '')
      showErrors(r.errors)
    } catch (e) {
      showErrors([`Couldn't save: ${String((e as Error)?.message ?? e)}`])
    } finally {
      saveBtn.disabled = false
      saveBtn.textContent = 'Save'
    }
  })
  root.querySelector('#cancel')!.addEventListener('click', () => onClose(null, false))
  root.querySelector('#settings-back')!.addEventListener('click', () => onClose(null, false))
  const clearBtn = root.querySelector<HTMLButtonElement>('#clear-history')!
  clearBtn.addEventListener('click', async () => {
    if (clearBtn.dataset['armed'] !== 'yes') {
      clearBtn.dataset['armed'] = 'yes'
      clearBtn.textContent = 'Press again to delete all chats'
      return
    }
    await window.lenz.historyClear()
    clearBtn.dataset['armed'] = ''
    clearBtn.textContent = 'All chats deleted'
    clearBtn.disabled = true
  })
}

function showReport(el: HTMLElement, r: ConnectionReport): void {
  const items: string[] = []
  items.push(
    r.server.ok
      ? `<li class="ok">C0RE reachable and key accepted (${r.server.latencyMs} ms)</li>`
      : `<li class="bad">${esc(r.server.error ?? 'Unknown error')}</li>`
  )
  if (r.server.ok) {
    items.push(
      r.models.length
        ? `<li class="ok">Vision models: ${r.models.map((m) => esc(m.name) + (m.thinking ? ' (can think)' : '')).join(', ')}</li>`
        : `<li class="bad">No vision models installed. On the PC run: ollama pull qwen3-vl:8b-instruct</li>`
    )
  }
  items.push(
    r.searxng.ok
      ? `<li class="ok">Search engine reachable</li>`
      : `<li class="bad">Can't reach the search engine: ${esc(r.searxng.error ?? 'unknown error')}</li>`
  )
  el.innerHTML = items.join('')
}
