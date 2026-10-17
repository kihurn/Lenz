import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runOcr } from '../src/main/ocr'

const fx = (name: string) => join(__dirname, 'fixtures', name)
const png = Buffer.alloc(1234, 7)

describe('runOcr', () => {
  it('parses helper JSON and pipes PNG bytes to stdin', async () => {
    expect(await runOcr(png, fx('fake-ocr.sh'))).toEqual({ text: 'bytes:1234', confidence: 0.93, coverage: 0.41 })
  })

  it('returns null on non-zero exit', async () => {
    expect(await runOcr(png, fx('fake-ocr-bad.sh'))).toBeNull()
  })

  it('returns null on invalid JSON', async () => {
    expect(await runOcr(png, fx('fake-ocr-garbage.sh'))).toBeNull()
  })

  it('returns null and kills helper on timeout', async () => {
    const t0 = Date.now()
    expect(await runOcr(png, fx('fake-ocr-slow.sh'), 200)).toBeNull()
    expect(Date.now() - t0).toBeLessThan(1000)
  })

  it('returns null when helper missing', async () => {
    expect(await runOcr(png, fx('does-not-exist'))).toBeNull()
  })
})
