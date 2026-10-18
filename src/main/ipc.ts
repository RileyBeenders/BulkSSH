import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type { DeviceInput } from '@shared/device'
import { MAX_COMMAND_LENGTH, type ConnectRequest } from '@shared/session'
import type { CredentialStore } from './credentialStore'
import type { DeviceStore } from './deviceStore'
import type { SessionManager } from './sessionManager'
import type { SettingsStore } from './settingsStore'

// Every IPC message is validated here: the renderer is treated as untrusted input.
export interface IpcDeps {
  win: BrowserWindow
  devices: DeviceStore
  sessions: SessionManager
  settings: SettingsStore
  credentials: CredentialStore
}

const MAX_EXPORT_CHARS = 50 * 1024 * 1024

export function registerIpc({ win, devices, sessions, settings, credentials }: IpcDeps): void {
  const fromWindow = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => e.sender === win.webContents

  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R): void => {
    ipcMain.handle(channel, (e, ...args) => {
      if (!fromWindow(e)) throw new Error('Rejected IPC from unknown sender')
      return fn(...(args as A))
    })
  }

  handle('app:version', () => app.getVersion())

  handle('settings:get', () => settings.get())
  handle('settings:save', (input: unknown) => settings.save(input))

  handle('devices:list', () => devices.list())
  handle('devices:save', (input: DeviceInput) => devices.save(input))
  handle('devices:delete', (id: unknown) => {
    const deviceId = requireString(id, 'id')
    sessions.close(deviceId)
    credentials.delete(deviceId)
    devices.delete(deviceId)
  })
  // Deleting a device also disconnects it and forgets its saved secret.
  handle('devices:deleteMany', (ids: unknown) => {
    if (!isIdList(ids)) throw new Error('Invalid device list')
    for (const id of ids) {
      sessions.close(id)
      credentials.delete(id)
    }
    devices.deleteMany(ids)
  })

  // The renderer only learns *whether* a secret is saved, never the secret.
  handle('credentials:status', () => ({ available: credentials.available(), saved: credentials.savedIds() }))
  handle('credentials:forget', (id: unknown) => credentials.delete(requireString(id, 'deviceId')))

  // Export: the user picks the file in a native dialog; the renderer only
  // supplies a suggested name and the text.
  handle('files:saveText', async (name: unknown, text: unknown) => {
    if (typeof name !== 'string' || typeof text !== 'string' || text.length > MAX_EXPORT_CHARS) {
      throw new Error('Invalid export')
    }
    const safeName = basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'bulkssh-output.txt'
    const result = await dialog.showSaveDialog(win, {
      title: 'Export output',
      defaultPath: safeName,
      filters: [
        { name: 'Text', extensions: ['txt', 'log'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, text, 'utf8')
    return result.filePath
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
  handle('session:list', () => sessions.snapshot())
  handle('session:exec', (id: unknown, command: unknown) => {
    if (typeof command !== 'string' || command.trim() === '' || command.length > MAX_COMMAND_LENGTH) {
      throw new Error('Invalid command')
    }
    return sessions.exec(requireString(id, 'deviceId'), command, settings.get().broadcastTimeoutSec * 1000)
  })

  // High-frequency, fire-and-forget channels.
  ipcMain.on('session:write', (e, id: unknown, data: unknown) => {
    if (!fromWindow(e) || typeof id !== 'string' || typeof data !== 'string') return
    sessions.write(id, data)
  })
  ipcMain.on('session:writeMany', (e, ids: unknown, data: unknown) => {
    if (!fromWindow(e) || !isIdList(ids) || typeof data !== 'string') return
    sessions.writeMany(ids, data)
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
  if (r.remember !== undefined && typeof r.remember !== 'boolean') throw new Error('Invalid remember flag')
  return {
    deviceId: requireString(r.deviceId, 'deviceId'),
    secret: r.secret as string | undefined,
    remember: r.remember as boolean | undefined,
    cols: isDimension(r.cols) ? r.cols : 80,
    rows: isDimension(r.rows) ? r.rows : 24
  }
}

function requireString(v: unknown, name: string): string {
  if (typeof v !== 'string' || v === '') throw new Error(`Invalid ${name}`)
  return v
}

function isIdList(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= 1000 && v.every((id) => typeof id === 'string' && id !== '')
}

function isDimension(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) > 0 && (v as number) <= 1000
}
