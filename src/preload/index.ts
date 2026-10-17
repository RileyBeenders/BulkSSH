import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Device, DeviceInput } from '@shared/device'
import type {
  ConnectRequest,
  ConnectResult,
  SessionDataEvent,
  SessionStatusEvent
} from '@shared/session'

// The only bridge between the renderer and the main process.
// Expose narrow, typed functions here; never expose ipcRenderer itself.

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_e: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),

  devices: {
    list: (): Promise<Device[]> => ipcRenderer.invoke('devices:list'),
    save: (input: DeviceInput): Promise<Device> => ipcRenderer.invoke('devices:save', input),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('devices:delete', id),
    pickKeyFile: (): Promise<string | null> => ipcRenderer.invoke('devices:pickKeyFile')
  },

  session: {
    connect: (req: ConnectRequest): Promise<ConnectResult> => ipcRenderer.invoke('session:connect', req),
    close: (deviceId: string): Promise<void> => ipcRenderer.invoke('session:close', deviceId),
    write: (deviceId: string, data: string): void => ipcRenderer.send('session:write', deviceId, data),
    resize: (deviceId: string, cols: number, rows: number): void =>
      ipcRenderer.send('session:resize', deviceId, cols, rows),
    onData: (listener: (e: SessionDataEvent) => void) => subscribe('session:data', listener),
    onStatus: (listener: (e: SessionStatusEvent) => void) => subscribe('session:status', listener)
  }
}

export type BulkSshApi = typeof api

contextBridge.exposeInMainWorld('bulkssh', api)
