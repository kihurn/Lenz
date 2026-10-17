import { describe, expect, it } from 'vitest'
import { decideMode, encodeImage, type ImageOps, type OcrResult } from '../src/main/prepare'

const ocr = (text: number, confidence: number, coverage: number): OcrResult => ({
  text: 'x'.repeat(text),
  confidence,
  coverage
})

function fakeOps(width: number, height: number) {
  const calls: string[] = []
  const ops: ImageOps = {
    size: () => ({ width, height }),
    resize: (_png, w, h) => {
      calls.push(`resize ${w}x${h}`)
      return Buffer.from('resized')
    },
    toJpeg: (_png, q) => {
      calls.push(`jpeg ${q}`)
      return Buffer.from('jpeg')
    }
  }
  return { ops, calls }
}

describe('decideMode', () => {
  it('chooses text mode for dense confident text', () => {
    expect(decideMode(ocr(500, 0.95, 0.4))).toBe('text')
  })
  it('chooses image mode for sparse text', () => {
    expect(decideMode(ocr(50, 0.95, 0.4))).toBe('image')
  })
  it('chooses image mode for low confidence', () => {
    expect(decideMode(ocr(500, 0.6, 0.4))).toBe('image')
  })
  it('chooses image mode for low coverage', () => {
    expect(decideMode(ocr(500, 0.95, 0.1))).toBe('image')
  })
  it('falls back to image mode when OCR failed', () => {
    expect(decideMode(null)).toBe('image')
  })
  it('override wins', () => {
    expect(decideMode(ocr(500, 0.95, 0.4), 'image')).toBe('image')
    expect(decideMode(null, 'text')).toBe('text')
  })
  it('counts characters after trimming whitespace', () => {
    expect(decideMode({ text: ' '.repeat(500) + 'x'.repeat(10), confidence: 0.99, coverage: 0.5 })).toBe('image')
  })
})

describe('encodeImage', () => {
  it('downscales 2940x1912 to 1280x832', () => {
    const { ops, calls } = fakeOps(2940, 1912)
    encodeImage(Buffer.from('png'), ocr(500, 0.9, 0.4), 1280, ops)
    expect(calls[0]).toBe('resize 1280x832')
  })
  it('scales portrait images by height', () => {
    const { ops, calls } = fakeOps(1000, 2000)
    encodeImage(Buffer.from('png'), ocr(500, 0.9, 0.4), 1280, ops)
    expect(calls[0]).toBe('resize 640x1280')
  })
  it('does not upscale 800x600', () => {
    const { ops, calls } = fakeOps(800, 600)
    const r = encodeImage(Buffer.from('png'), ocr(500, 0.9, 0.4), 1280, ops)
    expect(calls).toEqual([])
    expect(r).toEqual({ base64: Buffer.from('png').toString('base64'), mime: 'image/png' })
  })
  it('uses PNG for text-heavy and JPEG q85 otherwise', () => {
    const a = fakeOps(800, 600)
    expect(encodeImage(Buffer.from('png'), ocr(500, 0.9, 0.15), 1280, a.ops).mime).toBe('image/png')
    const b = fakeOps(800, 600)
    const r = encodeImage(Buffer.from('png'), ocr(500, 0.9, 0.05), 1280, b.ops)
    expect(r).toEqual({ base64: Buffer.from('jpeg').toString('base64'), mime: 'image/jpeg' })
    expect(b.calls).toEqual(['jpeg 85'])
  })
  it('uses JPEG when OCR failed', () => {
    const { ops } = fakeOps(800, 600)
    expect(encodeImage(Buffer.from('png'), null, 1280, ops).mime).toBe('image/jpeg')
  })
})
