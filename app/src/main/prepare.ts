import type { InputMode } from '../shared/types'

export interface OcrResult {
  text: string
  /** Mean recognition confidence, 0..1. */
  confidence: number
  /** Share of the image area covered by text boxes, 0..1. */
  coverage: number
}

/** Image operations; implemented with Electron nativeImage in the app, faked in tests. */
export interface ImageOps {
  size(png: Buffer): { width: number; height: number }
  /** Returns PNG. */
  resize(png: Buffer, width: number, height: number): Buffer
  toJpeg(png: Buffer, quality: number): Buffer
}

export const TEXT_ONLY_MIN_CHARS = 200
export const TEXT_ONLY_MIN_CONFIDENCE = 0.8
export const TEXT_ONLY_MIN_COVERAGE = 0.25
export const TEXT_HEAVY_COVERAGE = 0.15
export const JPEG_QUALITY = 85

/** Text-only is the fast path; use it only when OCR clearly captured the content. */
export function decideMode(ocr: OcrResult | null, override?: InputMode): InputMode {
  if (override) return override
  if (!ocr) return 'image'
  const dense = ocr.text.trim().length >= TEXT_ONLY_MIN_CHARS
  return dense && ocr.confidence >= TEXT_ONLY_MIN_CONFIDENCE && ocr.coverage >= TEXT_ONLY_MIN_COVERAGE
    ? 'text'
    : 'image'
}

export function encodeImage(
  png: Buffer,
  ocr: OcrResult | null,
  maxSide: number,
  ops: ImageOps
): { base64: string; mime: 'image/png' | 'image/jpeg' } {
  const { width, height } = ops.size(png)
  const scale = Math.min(1, maxSide / Math.max(width, height))
  const sized = scale < 1 ? ops.resize(png, Math.round(width * scale), Math.round(height * scale)) : png
  // PNG keeps small text sharp; JPEG is much smaller for photos and diagrams.
  if (ocr && ocr.coverage >= TEXT_HEAVY_COVERAGE) return { base64: sized.toString('base64'), mime: 'image/png' }
  return { base64: ops.toJpeg(sized, JPEG_QUALITY).toString('base64'), mime: 'image/jpeg' }
}
