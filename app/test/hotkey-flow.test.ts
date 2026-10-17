import { describe, expect, it } from 'vitest'
import { captureErrorEvent, captureThenShow } from '../src/main/hotkey-flow'
import { CaptureError, type CaptureResult } from '../src/main/pipeline'

const shot: CaptureResult = { png: Buffer.from('png'), thumbnailDataUrl: 'data:,' }

describe('captureThenShow', () => {
  it('shows the panel only after the screen has been captured', async () => {
    const log: string[] = []
    let release!: () => void
    const done = captureThenShow({
      capture: () =>
        new Promise<CaptureResult>((r) => {
          log.push('capture started')
          release = () => {
            log.push('capture finished')
            r(shot)
          }
        }),
      show: () => log.push('show'),
      captureNow: async (c) => {
        log.push(`captureNow ${c === shot}`)
      },
      onError: () => log.push('error')
    })
    await Promise.resolve()
    expect(log).toEqual(['capture started'])
    release()
    await done
    expect(log).toEqual(['capture started', 'capture finished', 'show', 'captureNow true'])
  })

  it('shows the panel and reports the error when capture fails', async () => {
    const log: string[] = []
    await captureThenShow({
      capture: async () => {
        throw new CaptureError('permission', 'denied')
      },
      show: () => log.push('show'),
      captureNow: async () => {
        log.push('captureNow')
      },
      onError: (e) => log.push(`error ${(e as CaptureError).kind}`)
    })
    expect(log).toEqual(['show', 'error permission'])
  })
})

describe('captureErrorEvent', () => {
  it('maps permission errors to permission_screen', () => {
    expect(captureErrorEvent(new CaptureError('permission', 'x'))).toMatchObject({ type: 'error', code: 'permission_screen' })
  })
  it('maps other failures to unknown with the reason', () => {
    const e = captureErrorEvent(new Error('boom'))
    expect(e).toMatchObject({ type: 'error', code: 'unknown', partial: false })
    expect(e.type === 'error' && e.message).toContain('boom')
  })
})
