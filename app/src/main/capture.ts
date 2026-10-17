import { desktopCapturer, nativeImage, screen, type BrowserWindow, type Display } from 'electron'
import { CaptureError, type CaptureResult } from './pipeline'
import { screenPermission } from './permissions'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

const THUMB_WIDTH = 320
/** Time for the panel to disappear from the screen before capturing. */
const HIDE_SETTLE_MS = 120

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function thumbnail(img: Electron.NativeImage): string {
  const { width } = img.getSize()
  return (width > THUMB_WIDTH ? img.resize({ width: THUMB_WIDTH, quality: 'good' }) : img).toDataURL()
}

/**
 * Captures the whole display under the mouse at native resolution.
 * Lenz's own panel is hidden during the capture so it never appears in it.
 */
export async function captureDisplayUnderCursor(panel?: BrowserWindow): Promise<{ capture: CaptureResult; display: Display }> {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const wasVisible = panel?.isVisible() ?? false
  if (wasVisible) {
    panel!.hide()
    await sleep(HIDE_SETTLE_MS)
  }
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(display.size.width * display.scaleFactor),
        height: Math.round(display.size.height * display.scaleFactor)
      }
    })
    // getSources is what makes macOS show the permission prompt the first time, so check
    // afterwards. Without permission macOS returns wallpaper-only or empty images.
    if (screenPermission() !== 'granted') throw new CaptureError('permission', 'Screen Recording not allowed')
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
    if (!source || source.thumbnail.isEmpty()) throw new CaptureError('failed', 'No screen image returned')
    return { capture: { png: source.thumbnail.toPNG(), thumbnailDataUrl: thumbnail(source.thumbnail) }, display }
  } catch (e) {
    if (e instanceof CaptureError) throw e
    throw new CaptureError('failed', String((e as Error)?.message ?? e))
  } finally {
    if (wasVisible) panel!.showInactive()
  }
}

/** Crops a capture; `rect` is in display points, the image is in pixels. */
export function cropCapture(c: CaptureResult, rect: Rect, scaleFactor: number): CaptureResult {
  const img = nativeImage.createFromBuffer(c.png)
  const size = img.getSize()
  const x = Math.max(0, Math.round(rect.x * scaleFactor))
  const y = Math.max(0, Math.round(rect.y * scaleFactor))
  const cropped = img.crop({
    x,
    y,
    width: Math.max(1, Math.min(size.width - x, Math.round(rect.width * scaleFactor))),
    height: Math.max(1, Math.min(size.height - y, Math.round(rect.height * scaleFactor)))
  })
  return { png: cropped.toPNG(), thumbnailDataUrl: thumbnail(cropped) }
}
