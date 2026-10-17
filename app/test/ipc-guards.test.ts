import { describe, expect, it } from 'vitest'
import { isSafeExternalUrl, parseAskRequest } from '../src/main/guards'

describe('isSafeExternalUrl', () => {
  it.each([
    ['https://en.wikipedia.org/wiki/ATP', true],
    ['http://example.com', true],
    ['javascript:alert(1)', false],
    ['file:///etc/passwd', false],
    ['x-apple.systempreferences:foo', false],
    ['not a url', false]
  ])('%s → %s', (u, ok) => expect(isSafeExternalUrl(u)).toBe(ok))
})

describe('parseAskRequest', () => {
  const valid = { question: 'q', search: false, think: true, speed: 'fast', newCapture: true }

  it('accepts a valid request', () => {
    expect(parseAskRequest(valid)).toEqual(valid)
  })
  it('keeps optional fields', () => {
    expect(parseAskRequest({ ...valid, actionId: 'quiz', modeOverride: 'image' })).toMatchObject({
      actionId: 'quiz',
      modeOverride: 'image'
    })
  })
  it('rejects missing question', () => {
    const { question: _q, ...rest } = valid
    expect(parseAskRequest(rest)).toBeNull()
  })
  it('rejects wrong speed', () => {
    expect(parseAskRequest({ ...valid, speed: 'turbo' })).toBeNull()
  })
  it('rejects non-objects and oversize questions', () => {
    expect(parseAskRequest('hi')).toBeNull()
    expect(parseAskRequest({ ...valid, question: 'x'.repeat(10_001) })).toBeNull()
  })
  it('strips unknown fields', () => {
    expect(parseAskRequest({ ...valid, evil: 1 })).not.toHaveProperty('evil')
  })
})
