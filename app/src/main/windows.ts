import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, screen, type Display, type Rectangle } from 'electron'
import { IPC } from '../shared/ipc'
import type { Rect } from './capture'
import type { CaptureResult } from './pipeline'

const PRELOAD = join(__dirname, '../preload/index.js')
const secure = {
  preload: PRELOAD,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true
} as const

function load(win: BrowserWindow, page: 'index' | 'region'): void {
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev) void win.loadURL(`${dev}/${page}.html`)
  else void win.loadFile(join(__dirname, `../renderer/${page}.html`))
}

/** Pages never navigate away or open windows; links go through openExternal. */
function lockDown(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
}

const boundsFile = () => join(app.getPath('userData'), 'panel-bounds.json')

function savedBounds(): Rectangle | undefined {
  try {
    const b = JSON.parse(readFileSync(boundsFile(), 'utf8')) as Rectangle
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y
    })
    return visible ? b : undefined
  } catch {
    return undefined
  }
}

/**
 * The floating panel: stays on top, follows every Space and full-screen app.
 * Deliberately visible to screen capture and sharing (no content protection).
 */
export function createPanel(): BrowserWindow {
  const b = savedBounds()
  const panel = new BrowserWindow({
    width: b?.width ?? 440,
    height: b?.height ?? 600,
    ...(b ? { x: b.x, y: b.y } : {}),
    minWidth: 340,
    minHeight: 240,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    fullscreenable: false,
    hasShadow: true,
    type: process.platform === 'darwin' ? 'panel' : undefined,
    vibrancy: 'hud',
    visualEffectState: 'active',
    alwaysOnTop: true,
    webPreferences: secure
  })
  panel.setAlwaysOnTop(true, 'floating')
  panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  lockDown(panel)

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const save = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      try {
        writeFileSync(boundsFile(), JSON.stringify(panel.getBounds()))
      } catch {
        /* not critical */
      }
    }, 500)
  }
  panel.on('moved', save)
  panel.on('resized', save)

  load(panel, 'index')
  return panel
}

/**
 * Shows the capture full-screen and lets the user drag a rectangle.
 * Resolves with the rectangle in display points, or null when cancelled (Esc).
 */
export function selectRegion(c: CaptureResult, display: Display): Promise<Rect | null> {
  const win = new BrowserWindow({
    ...display.bounds,
    frame: false,
    show: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    enableLargerThanScreen: true,
    hasShadow: false,
    alwaysOnTop: true,
    acceptFirstMouse: true,
    webPreferences: secure
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  lockDown(win)

  return new Promise((resolve) => {
    let done = false
    const finish = (r: Rect | null) => {
      if (done) return
      done = true
      ipcMain.removeListener(IPC.regionResult, onResult)
      if (!win.isDestroyed()) win.destroy()
      resolve(r)
    }
    const onResult = (e: Electron.IpcMainEvent, rect: unknown) => {
      if (e.sender !== win.webContents) return
      const r = rect as Rect | null
      const ok =
        r !== null &&
        typeof r === 'object' &&
        [r.x, r.y, r.width, r.height].every((n) => Number.isFinite(n)) &&
        r.width >= 4 &&
        r.height >= 4
      finish(ok ? r : null)
    }
    ipcMain.on(IPC.regionResult, onResult)
    win.on('closed', () => finish(null))
    win.on('blur', () => finish(null))
    win.webContents.once('did-finish-load', () => {
      win.webContents.send(IPC.regionImage, c.png.toString('base64'))
      win.show()
      app.focus({ steal: true })
      win.focus()
    })
    load(win, 'region')
  })
}
