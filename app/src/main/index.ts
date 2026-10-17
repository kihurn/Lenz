import { join } from 'node:path'
import { app, globalShortcut, ipcMain, shell, type BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import type { AskEvent, ConnectionReport, Settings } from '../shared/types'
import { captureDisplayUnderCursor, cropCapture } from './capture'
import { isSafeExternalUrl, parseAskRequest } from './guards'
import { nativeImageOps } from './native-image-ops'
import { ocrHelperPath, runOcr } from './ocr'
import { createOllamaClient } from './ollama'
import { openScreenRecordingSettings } from './permissions'
import { CaptureError, createPipeline } from './pipeline'
import { pingSearxng, runSearch } from './search'
import { loadSettings, saveSettings, SettingsSchema } from './settings'
import { createPanel, selectRegion } from './windows'

let panel: BrowserWindow
let settings: Settings
const settingsFile = () => join(app.getPath('userData'), 'settings.json')

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
  ollama: createOllamaClient,
  search: runSearch,
  emit
})

async function onCaptureHotkey(): Promise<void> {
  const capturing = pipeline.captureNow()
  showPanel()
  await capturing
}

async function onRegionHotkey(): Promise<void> {
  try {
    const { capture, display } = await captureDisplayUnderCursor(panel)
    const rect = await selectRegion(capture, display)
    if (!rect) return
    showPanel()
    await pipeline.captureNow(cropCapture(capture, rect, display.scaleFactor))
  } catch (e) {
    showPanel()
    const permission = e instanceof CaptureError && e.kind === 'permission'
    emit({
      type: 'error',
      code: permission ? 'permission_screen' : 'unknown',
      message: permission
        ? 'Lenz needs Screen Recording permission to see your screen.'
        : `Couldn't capture the screen: ${String((e as Error)?.message ?? e)}`,
      partial: false
    })
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

async function testConnection(input: unknown): Promise<ConnectionReport> {
  const parsed = SettingsSchema.safeParse(input)
  const s = parsed.success ? parsed.data : settings
  const report: ConnectionReport = { ollama: { ok: false }, models: [], searxng: { ok: false } }
  const client = createOllamaClient(s.serverUrl)
  await Promise.all([
    (async () => {
      try {
        const { version, latencyMs } = await client.ping()
        report.ollama = { ok: true, version, latencyMs }
        report.models = (await client.listModels()).filter((m) => m.vision)
      } catch (e) {
        report.ollama = { ok: false, error: String((e as Error)?.message ?? e) }
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
  ipcMain.handle(IPC.saveSettings, (_e, s) => {
    const result = saveSettings(settingsFile(), s)
    if (result.ok) {
      settings = loadSettings(settingsFile())
      registerHotkeys()
    }
    return result
  })
  ipcMain.handle(IPC.testConnection, (_e, s) => testConnection(s))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showPanel())
  void app.whenReady().then(() => {
    settings = loadSettings(settingsFile())
    panel = createPanel()
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
