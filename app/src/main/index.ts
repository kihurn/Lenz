import { join } from 'node:path'
import { app, globalShortcut, ipcMain, safeStorage, shell, type BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import type { AskEvent, ConnectionReport, Settings } from '../shared/types'
import { captureDisplayUnderCursor, cropCapture } from './capture'
import { captureErrorEvent, captureThenShow } from './hotkey-flow'
import { isSafeExternalUrl, parseAskRequest } from './guards'
import { nativeImageOps } from './native-image-ops'
import { ocrHelperPath, runOcr } from './ocr'
import { createOllamaClient, OllamaError } from './ollama'
import { openScreenRecordingSettings } from './permissions'
import { createPipeline } from './pipeline'
import { createHistoryStore } from './history'
import { checkKey, createKeyStore } from './secrets'
import { pingSearxng, runSearch } from './search'
import { loadSettings, saveSettings, SettingsSchema } from './settings'
import { createPanel, selectRegion } from './windows'

let panel: BrowserWindow
let settings: Settings
const settingsFile = () => join(app.getPath('userData'), 'settings.json')
let keyStore: ReturnType<typeof createKeyStore>
let historyStore: ReturnType<typeof createHistoryStore>
const apiKey = () => keyStore?.get() ?? ''

function emit(e: AskEvent): void {
  if (!panel.isDestroyed()) panel.webContents.send(IPC.event, e)
}

function showPanel(): void {
  panel.show()
  panel.focus()
}

const pipeline = createPipeline({
  settings: () => settings,
  capture: async () => (await captureDisplayUnderCursor(panel)).capture,
  ocr: (png) => runOcr(png, ocrHelperPath(app.isPackaged, process.resourcesPath, app.getAppPath())),
  imageOps: nativeImageOps(),
  apiKey,
  ollama: (url, key) => createOllamaClient(url, key),
  search: runSearch,
  emit,
  record: (id, createdAt, turn) => historyStore?.append(id, createdAt, turn)
})

let capturing = false

/** Screenshot first, then show the panel, so Lenz is never in its own capture. */
async function onCaptureHotkey(): Promise<void> {
  if (capturing) return
  capturing = true
  try {
    await captureThenShow({
      capture: async () => (await captureDisplayUnderCursor(panel)).capture,
      show: showPanel,
      captureNow: (c) => pipeline.captureNow(c),
      onError: (e) => emit(captureErrorEvent(e))
    })
  } finally {
    capturing = false
  }
}

async function onRegionHotkey(): Promise<void> {
  if (capturing) return
  capturing = true
  try {
    const { capture, display } = await captureDisplayUnderCursor(panel)
    const rect = await selectRegion(capture, display)
    if (!rect) return
    showPanel()
    await pipeline.captureNow(cropCapture(capture, rect, display.scaleFactor))
  } catch (e) {
    showPanel()
    emit(captureErrorEvent(e))
  } finally {
    capturing = false
  }
}

function registerHotkeys(): void {
  globalShortcut.unregisterAll()
  const bindings: [string, () => void][] = [
    [settings.hotkeys.capture, () => void onCaptureHotkey()],
    [settings.hotkeys.region, () => void onRegionHotkey()],
    [settings.hotkeys.toggle, () => (panel.isVisible() ? panel.hide() : showPanel())]
  ]
  const failed: string[] = []
  for (const [accel, fn] of bindings) {
    try {
      if (!globalShortcut.register(accel, fn)) failed.push(accel)
    } catch {
      failed.push(accel)
    }
  }
  if (failed.length) {
    emit({ type: 'notice', text: `Hotkey ${failed.join(', ')} is unavailable (used by another app). Change it in Settings.` })
  }
}

/** A typed-in key if there is one, otherwise the saved key. */
function keyToUse(typed: unknown): string {
  if (typeof typed === 'string' && typed.trim()) {
    const c = checkKey(typed)
    return c.ok ? c.key : typed.trim()
  }
  return apiKey()
}

async function testConnection(input: unknown, typedKey: unknown): Promise<ConnectionReport> {
  const parsed = SettingsSchema.safeParse(input)
  const s = parsed.success ? parsed.data : settings
  const report: ConnectionReport = { server: { ok: false }, models: [], searxng: { ok: false } }
  const client = createOllamaClient(s.serverUrl, keyToUse(typedKey))
  await Promise.all([
    (async () => {
      try {
        const { latencyMs } = await client.ping()
        report.server = { ok: true, latencyMs }
        report.models = (await client.listModels()).filter((m) => m.vision)
      } catch (e) {
        report.server = { ok: false, error: connectionError(e) }
      }
    })(),
    (async () => {
      try {
        await pingSearxng(s.searxngUrl)
        report.searxng = { ok: true }
      } catch (e) {
        report.searxng = { ok: false, error: String((e as Error)?.message ?? e) }
      }
    })()
  ])
  return report
}

function connectionError(e: unknown): string {
  if (e instanceof OllamaError) {
    switch (e.code) {
      case 'missing_key':
        return 'No C0RE key yet — paste it above.'
      case 'invalid_key':
        return "C0RE didn't accept the key — copy it again from the C0RE dashboard."
      case 'key_disabled':
        return 'The key is switched off in C0RE.'
      case 'key_not_public':
        return 'The key only works over Tailscale — use http://kihurn-desktop:7080.'
      case 'engine_offline':
        return 'C0RE is up, but Ollama on the PC is offline.'
      case 'rate_limited':
        return 'Too many requests — try again in a moment.'
    }
  }
  return `Can't reach C0RE: ${String((e as Error)?.message ?? e)}`
}

function registerIpc(): void {
  const fromPanel = (e: { sender: Electron.WebContents }) => e.sender === panel.webContents

  ipcMain.on(IPC.ask, (e, raw) => {
    if (!fromPanel(e)) return
    const req = parseAskRequest(raw)
    if (req) void pipeline.ask(req)
  })
  ipcMain.on(IPC.stop, (e) => fromPanel(e) && pipeline.stop())
  ipcMain.on(IPC.hidePanel, (e) => fromPanel(e) && panel.hide())
  ipcMain.on(IPC.openScreenSettings, (e) => fromPanel(e) && openScreenRecordingSettings())
  ipcMain.on(IPC.openExternal, (e, url) => {
    if (fromPanel(e) && typeof url === 'string' && isSafeExternalUrl(url)) void shell.openExternal(url)
  })
  ipcMain.handle(IPC.getSettings, () => settings)
  ipcMain.handle(IPC.hasKey, (e) => fromPanel(e) && keyStore.has())
  ipcMain.handle(IPC.saveSettings, (e, s, typedKey) => {
    if (!fromPanel(e)) return { ok: false, errors: ['Not allowed.'] }
    let key: string | null = null
    if (typeof typedKey === 'string' && typedKey.trim()) {
      const c = checkKey(typedKey)
      if (!c.ok) {
        console.warn('[lenz] key not saved:', c.error)
        return { ok: false, errors: [c.error] }
      }
      key = c.key
    }
    const result = saveSettings(settingsFile(), s)
    if (result.ok && key !== null) {
      try {
        keyStore.set(key)
      } catch (e) {
        console.warn('[lenz] key not saved:', e)
        return { ok: false, errors: [`C0RE key: ${String((e as Error)?.message ?? e)}`] }
      }
    }
    if (!result.ok) console.warn('[lenz] settings not saved:', result.errors)
    if (result.ok) {
      settings = loadSettings(settingsFile())
      registerHotkeys()
    }
    return result
  })
  ipcMain.handle(IPC.historyList, (e) => (fromPanel(e) ? historyStore.list() : []))
  ipcMain.handle(IPC.historyOpen, (e, id) => {
    if (!fromPanel(e) || typeof id !== 'string') return null
    const c = historyStore.get(id)
    if (c) pipeline.resume(c)
    return c
  })
  ipcMain.handle(IPC.historyDelete, (e, id) => {
    if (fromPanel(e) && typeof id === 'string') historyStore.remove(id)
  })
  ipcMain.handle(IPC.historyClear, (e) => {
    if (fromPanel(e)) historyStore.clear()
  })
  ipcMain.on(IPC.newChat, (e) => fromPanel(e) && pipeline.reset())
  ipcMain.on(IPC.warm, (e, raw) => {
    if (!fromPanel(e) || typeof raw !== 'object' || raw === null) return
    const { speed, think } = raw as { speed?: unknown; think?: unknown }
    if ((speed === 'fast' || speed === 'accurate') && typeof think === 'boolean') pipeline.warm({ speed, think })
  })
  ipcMain.handle(IPC.testConnection, (e, s, typedKey) =>
    fromPanel(e) ? testConnection(s, typedKey) : Promise.reject(new Error('Not allowed.'))
  )
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showPanel())
  void app.whenReady().then(() => {
    settings = loadSettings(settingsFile())
    keyStore = createKeyStore(join(app.getPath('userData'), 'c0re-key.bin'), safeStorage)
    historyStore = createHistoryStore(join(app.getPath('userData'), 'history'))
    panel = createPanel()
    // ⌘W hides the panel; only Quit (⌘Q) ends Lenz.
    let quitting = false
    app.on('before-quit', () => (quitting = true))
    panel.on('close', (e) => {
      if (quitting) return
      e.preventDefault()
      panel.hide()
    })
    registerIpc()
    panel.webContents.once('did-finish-load', () => {
      registerHotkeys()
      showPanel()
    })
    app.on('activate', () => showPanel())
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
  app.on('window-all-closed', () => app.quit())
}
