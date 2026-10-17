import { contextBridge, ipcRenderer } from 'electron'

// The only bridge between the renderer and the main process.
// Expose narrow, typed functions here; never expose ipcRenderer itself.
const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version')
}

export type BulkSshApi = typeof api

contextBridge.exposeInMainWorld('bulkssh', api)
