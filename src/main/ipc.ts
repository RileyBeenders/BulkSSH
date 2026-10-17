import { app, BrowserWindow, dialog, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type { DeviceInput } from '@shared/device'
import type { ConnectRequest } from '@shared/session'
import type { DeviceStore } from './deviceStore'
import type { SessionManager } from './sessionManager'

// Every IPC message is validated here: the renderer is treated as untrusted input.
export function registerIpc(win: BrowserWindow, devices: DeviceStore, sessions: SessionManager): void {
  const fromWindow = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => e.sender === win.webContents

  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R): void => {
    ipcMain.handle(channel, (e, ...args) => {
      if (!fromWindow(e)) throw new Error('Rejected IPC from unknown sender')
      return fn(...(args as A))
    })
  }

  handle('app:version', () => app.getVersion())

  handle('devices:list', () => devices.list())
  handle('devices:save', (input: DeviceInput) => devices.save(input))
  handle('devices:delete', (id: unknown) => {
    const deviceId = requireString(id, 'id')
    sessions.close(deviceId)
    devices.delete(deviceId)
  })
  handle('devices:pickKeyFile', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose private key',
      properties: ['openFile', 'showHiddenFiles']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle('session:connect', (req: unknown) => sessions.connect(parseConnect(req)))
  handle('session:close', (id: unknown) => sessions.close(requireString(id, 'deviceId')))

  // High-frequency, fire-and-forget channels.
  ipcMain.on('session:write', (e, id: unknown, data: unknown) => {
    if (!fromWindow(e) || typeof id !== 'string' || typeof data !== 'string') return
    sessions.write(id, data)
  })
  ipcMain.on('session:resize', (e, id: unknown, cols: unknown, rows: unknown) => {
    if (!fromWindow(e) || typeof id !== 'string' || !isDimension(cols) || !isDimension(rows)) return
    sessions.resize(id, cols, rows)
  })
}

function parseConnect(req: unknown): ConnectRequest {
  if (typeof req !== 'object' || req === null) throw new Error('Invalid connect request')
  const r = req as Record<string, unknown>
  if (r.secret !== undefined && typeof r.secret !== 'string') throw new Error('Invalid secret')
  return {
    deviceId: requireString(r.deviceId, 'deviceId'),
    secret: r.secret as string | undefined,
    cols: isDimension(r.cols) ? r.cols : 80,
    rows: isDimension(r.rows) ? r.rows : 24
  }
}

function requireString(v: unknown, name: string): string {
  if (typeof v !== 'string' || v === '') throw new Error(`Invalid ${name}`)
  return v
}

function isDimension(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) > 0 && (v as number) <= 1000
}
