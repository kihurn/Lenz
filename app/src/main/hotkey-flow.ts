import type { AskEvent } from '../shared/types'
import { CaptureError, type CaptureResult } from './pipeline'

/**
 * Hotkey capture order: take the screenshot first, then show the panel, so Lenz
 * never appears in its own capture (spec §3.3).
 */
export async function captureThenShow(deps: {
  capture: () => Promise<CaptureResult>
  show: () => void
  captureNow: (c: CaptureResult) => Promise<void>
  onError: (e: unknown) => void
}): Promise<void> {
  let shot: CaptureResult
  try {
    shot = await deps.capture()
  } catch (e) {
    deps.show()
    deps.onError(e)
    return
  }
  deps.show()
  await deps.captureNow(shot)
}

export function captureErrorEvent(e: unknown): AskEvent {
  const permission = e instanceof CaptureError && e.kind === 'permission'
  return {
    type: 'error',
    code: permission ? 'permission_screen' : 'unknown',
    message: permission
      ? 'Lenz needs Screen Recording permission to see your screen.'
      : `Couldn't capture the screen: ${String((e as Error)?.message ?? e)}`,
    partial: false
  }
}
