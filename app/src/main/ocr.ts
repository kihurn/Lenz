import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { OcrResult } from './prepare'

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/**
 * Runs the bundled `lenz-ocr` helper (Apple Vision) on a PNG.
 * Never throws: any failure returns null so the caller falls back to image mode.
 */
export function runOcr(png: Buffer, helperPath: string, timeoutMs = 4000): Promise<OcrResult | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (r: OcrResult | null, why?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (why) console.warn(`[lenz] OCR unavailable: ${why}`)
      resolve(r)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (e) {
      finish(null, String(e))
      return
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(null, `timed out after ${timeoutMs} ms`)
    }, timeoutMs)

    let out = ''
    let err = ''
    child.stdout?.on('data', (d) => (out += d))
    child.stderr?.on('data', (d) => (err += d))
    child.on('error', (e) => finish(null, e.message))
    child.on('close', (code) => {
      if (code !== 0) return finish(null, `exit ${code}: ${err.trim()}`)
      try {
        const j = JSON.parse(out.trim())
        if (typeof j.text !== 'string' || typeof j.confidence !== 'number' || typeof j.coverage !== 'number') {
          return finish(null, 'unexpected output shape')
        }
        finish({ text: j.text, confidence: clamp01(j.confidence), coverage: clamp01(j.coverage) })
      } catch {
        finish(null, 'invalid JSON')
      }
    })
    child.stdin?.on('error', () => {}) // helper may exit before reading everything
    child.stdin?.end(png)
  })
}

/** Location of the helper: bundled in Resources when packaged, built locally in dev. */
export function ocrHelperPath(isPackaged: boolean, resourcesPath: string, appPath: string): string {
  return isPackaged ? join(resourcesPath, 'lenz-ocr') : join(appPath, 'native/ocr/build/lenz-ocr')
}
