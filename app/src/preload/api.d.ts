import type { LenzApi, RegionApi } from '../shared/ipc'

declare global {
  interface Window {
    lenz: LenzApi
    lenzRegion: RegionApi
  }
}

export {}
