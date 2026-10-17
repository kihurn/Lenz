import type { ConnectionReport, Settings } from '../shared/types'

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function field(label: string, name: string, value: string | number, type = 'text', extra = ''): string {
  return `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(String(value))}" ${extra} /></label>`
}

/** Renders the settings form into `root`. `onClose` returns to the chat view. */
export function renderSettings(root: HTMLElement, s: Settings, onClose: (saved: Settings | null) => void): void {
  root.innerHTML = `
    <h2>Settings</h2>
    <fieldset>
      <legend>Your PC</legend>
      ${field('Ollama address', 'serverUrl', s.serverUrl, 'url')}
      ${field('Search engine (SearXNG) address', 'searxngUrl', s.searxngUrl, 'url')}
      <div class="buttons"><button type="button" class="btn" id="test">Test connection</button></div>
      <ul class="report" id="report" hidden></ul>
    </fieldset>
    <fieldset>
      <legend>Models</legend>
      <div class="pair">
        ${field('Accurate', 'models.accurate', s.models.accurate)}
        ${field('Fast', 'models.fast', s.models.fast)}
      </div>
    </fieldset>
    <fieldset>
      <legend>Hotkeys</legend>
      ${field('Capture screen', 'hotkeys.capture', s.hotkeys.capture)}
      ${field('Select an area', 'hotkeys.region', s.hotkeys.region)}
      ${field('Show or hide Lenz', 'hotkeys.toggle', s.hotkeys.toggle)}
    </fieldset>
    <fieldset>
      <legend>Speed</legend>
      <div class="pair">
        ${field('Longest answer (tokens)', 'maxAnswerTokens', s.maxAnswerTokens, 'number', 'min="64" max="4096"')}
        ${field('Image size limit (px)', 'imageMaxSide', s.imageMaxSide, 'number', 'min="512" max="4096"')}
        ${field('Search results', 'search.results', s.search.results, 'number', 'min="1" max="10"')}
        ${field('Pages to read', 'search.pagesToRead', s.search.pagesToRead, 'number', 'min="0" max="5"')}
        ${field('Page timeout (ms)', 'search.pageTimeoutMs', s.search.pageTimeoutMs, 'number', 'min="500" max="10000"')}
        ${field('Search time limit (ms)', 'search.budgetMs', s.search.budgetMs, 'number', 'min="1000" max="20000"')}
      </div>
    </fieldset>
    <fieldset>
      <legend>Quick actions</legend>
      ${s.quickActions
        .map(
          (a, i) => `
        <label>${esc(a.label)}
          <input name="qa.${i}.label" value="${esc(a.label)}" aria-label="Button label" />
          <textarea name="qa.${i}.prompt" rows="2" aria-label="What it asks">${esc(a.prompt)}</textarea>
        </label>`
        )
        .join('')}
    </fieldset>
    <ul class="errors" id="errors" hidden></ul>
    <div class="buttons">
      <button type="button" class="btn primary" id="save">Save</button>
      <button type="button" class="btn" id="cancel">Cancel</button>
    </div>`

  const val = (name: string) => (root.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement).value
  const num = (name: string) => Number(val(name))

  const read = (): Settings => ({
    serverUrl: val('serverUrl'),
    searxngUrl: val('searxngUrl'),
    models: { accurate: val('models.accurate'), fast: val('models.fast') },
    hotkeys: { capture: val('hotkeys.capture'), region: val('hotkeys.region'), toggle: val('hotkeys.toggle') },
    maxAnswerTokens: num('maxAnswerTokens'),
    imageMaxSide: num('imageMaxSide'),
    search: {
      results: num('search.results'),
      pagesToRead: num('search.pagesToRead'),
      pageTimeoutMs: num('search.pageTimeoutMs'),
      budgetMs: num('search.budgetMs')
    },
    quickActions: s.quickActions.map((a, i) => ({ id: a.id, label: val(`qa.${i}.label`), prompt: val(`qa.${i}.prompt`) }))
  })

  const report = root.querySelector<HTMLUListElement>('#report')!
  const testBtn = root.querySelector<HTMLButtonElement>('#test')!
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true
    testBtn.textContent = 'Testing…'
    report.hidden = false
    report.innerHTML = ''
    try {
      showReport(report, await window.lenz.testConnection(read()))
    } finally {
      testBtn.disabled = false
      testBtn.textContent = 'Test connection'
    }
  })

  const errors = root.querySelector<HTMLUListElement>('#errors')!
  root.querySelector('#save')!.addEventListener('click', async () => {
    const next = read()
    const r = await window.lenz.saveSettings(next)
    if (r.ok) return onClose(await window.lenz.getSettings())
    errors.hidden = false
    errors.innerHTML = r.errors.map((e) => `<li>${esc(e)}</li>`).join('')
  })
  root.querySelector('#cancel')!.addEventListener('click', () => onClose(null))
}

function showReport(el: HTMLElement, r: ConnectionReport): void {
  const items: string[] = []
  items.push(
    r.ollama.ok
      ? `<li class="ok">Ollama ${esc(r.ollama.version ?? '')} reachable in ${r.ollama.latencyMs} ms</li>`
      : `<li class="bad">Can't reach Ollama: ${esc(r.ollama.error ?? 'unknown error')}</li>`
  )
  if (r.ollama.ok) {
    items.push(
      r.models.length
        ? `<li class="ok">Vision models: ${r.models.map((m) => esc(m.name) + (m.thinking ? ' (can think)' : '')).join(', ')}</li>`
        : `<li class="bad">No vision models installed. On the PC run: ollama pull qwen3-vl:8b</li>`
    )
  }
  items.push(
    r.searxng.ok
      ? `<li class="ok">Search engine reachable</li>`
      : `<li class="bad">Can't reach the search engine: ${esc(r.searxng.error ?? 'unknown error')}</li>`
  )
  el.innerHTML = items.join('')
}
