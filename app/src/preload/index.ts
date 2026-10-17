import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type LenzApi, type RegionApi } from '../shared/ipc'
import type { AskEvent } from '../shared/types'

const api: LenzApi = {
  ask: (req) => ipcRenderer.send(IPC.ask, req),
  stop: () => ipcRenderer.send(IPC.stop),
  onEvent: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, ev: AskEvent) => cb(ev)
    ipcRenderer.on(IPC.event, listener)
    return () => ipcRenderer.removeListener(IPC.event, listener)
  },
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (s) => ipcRenderer.invoke(IPC.saveSettings, s),
  testConnection: (s) => ipcRenderer.invoke(IPC.testConnection, s),
  openExternal: (url) => ipcRenderer.send(IPC.openExternal, url),
  openScreenSettings: () => ipcRenderer.send(IPC.openScreenSettings),
  hidePanel: () => ipcRenderer.send(IPC.hidePanel)
}

const region: RegionApi = {
  onImage: (cb) => ipcRenderer.once(IPC.regionImage, (_e, b64: string) => cb(b64)),
  submit: (rect) => ipcRenderer.send(IPC.regionResult, rect)
}

contextBridge.exposeInMainWorld('lenz', api)
contextBridge.exposeInMainWorld('lenzRegion', region)
