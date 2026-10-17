import type { AskEvent, AskRequest, ConnectionReport, SaveResult, Settings } from './types'

export const IPC = {
  ask: 'lenz:ask',
  stop: 'lenz:stop',
  event: 'lenz:event',
  getSettings: 'lenz:get-settings',
  saveSettings: 'lenz:save-settings',
  testConnection: 'lenz:test-connection',
  openExternal: 'lenz:open-external',
  openScreenSettings: 'lenz:open-screen-settings',
  hidePanel: 'lenz:hide-panel',
  regionResult: 'lenz:region-result',
  regionImage: 'lenz:region-image'
} as const

/** The API the preload script exposes to the panel as `window.lenz`. */
export interface LenzApi {
  ask(req: AskRequest): void
  stop(): void
  onEvent(cb: (e: AskEvent) => void): () => void
  getSettings(): Promise<Settings>
  saveSettings(s: Settings): Promise<SaveResult>
  testConnection(s: Settings): Promise<ConnectionReport>
  openExternal(url: string): void
  openScreenSettings(): void
  hidePanel(): void
}

/** The API the preload script exposes to the region-select overlay as `window.lenzRegion`. */
export interface RegionApi {
  onImage(cb: (pngBase64: string) => void): void
  submit(rect: { x: number; y: number; width: number; height: number } | null): void
}
