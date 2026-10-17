import { shell, systemPreferences } from 'electron'

export type ScreenPermission = 'granted' | 'denied' | 'not-determined' | 'unknown'

export function screenPermission(): ScreenPermission {
  if (process.platform !== 'darwin') return 'granted'
  const s = systemPreferences.getMediaAccessStatus('screen')
  if (s === 'restricted') return 'denied'
  return s
}

export function openScreenRecordingSettings(): void {
  if (process.platform === 'darwin') {
    void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
  }
}
