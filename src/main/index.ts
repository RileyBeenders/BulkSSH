import { join } from 'node:path'
import { app, BrowserWindow, dialog, safeStorage, session as electronSession, shell } from 'electron'
import { CredentialStore } from './credentialStore'
import { DeviceStore } from './deviceStore'
import { registerIpc } from './ipc'
import { KnownHosts } from './knownHosts'
import { SessionManager } from './sessionManager'
import { SettingsStore } from './settingsStore'
import type { HostKeyCheck } from './knownHosts'
import type { HostKeyInfo } from './transport/types'

let sessions: SessionManager | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: 'BulkSSH',
    backgroundColor: '#16181d',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // Open external links in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  // SSH sessions live in this process, so if the page crashes, reload it; the
  // new page picks the sessions up again (see session:list).
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`Renderer gone (${details.reason}, exit code ${details.exitCode}); reloading`)
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) win.webContents.reload()
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

// Connecting many devices at once can raise several host-key questions;
// show them one at a time instead of stacking dialogs.
let dialogQueue: Promise<unknown> = Promise.resolve()
function queueDialog<T>(show: () => Promise<T>): Promise<T> {
  const next = dialogQueue.then(show, show)
  dialogQueue = next.catch(() => undefined)
  return next
}

async function confirmHostKey(
  win: BrowserWindow,
  info: HostKeyInfo,
  check: Exclude<HostKeyCheck, { result: 'match' }>
): Promise<boolean> {
  const target = `${info.host}:${info.port}`
  if (check.result === 'unknown') {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Unknown host key',
      message: `First connection to ${target}`,
      detail:
        `The device presented this ${info.algorithm} key:\n\n${info.fingerprint}\n\n` +
        'Only trust it if it matches the fingerprint you expect for this device.',
      buttons: ['Trust and connect', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    })
    return response === 0
  }
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    title: 'Host key changed',
    message: `The host key for ${target} has CHANGED`,
    detail:
      `Previously trusted (${check.previous.algorithm}):\n${check.previous.fingerprint}\n\n` +
      `Now presented (${info.algorithm}):\n${info.fingerprint}\n\n` +
      'This can mean the device was reinstalled, or that someone is intercepting the connection. ' +
      'Only replace the key if you know why it changed.',
    buttons: ['Cancel', 'Replace key and connect'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  })
  return response === 1
}

// The renderer may use the clipboard (terminal copy/paste) and nothing else:
// no camera, microphone, location, notifications, etc.
const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write'])

app.whenReady().then(() => {
  electronSession.defaultSession.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission))
  )
  electronSession.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission))

  const win = createWindow()
  const userData = app.getPath('userData')
  const devices = new DeviceStore(join(userData, 'devices.json'))
  const settings = new SettingsStore(join(userData, 'settings.json'))
  // OS-encrypted (DPAPI on Windows); only ciphertext reaches the disk.
  const credentials = new CredentialStore(join(userData, 'credentials.json'), {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (encrypted) => safeStorage.decryptString(encrypted)
  })
  const send = (channel: string, payload: unknown): void => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }

  sessions = new SessionManager({
    devices,
    knownHosts: new KnownHosts(join(userData, 'known_hosts.json')),
    confirmHostKey: (info, check) => queueDialog(() => confirmHostKey(win, info, check)),
    onStatus: (event) => send('session:status', event),
    onData: (event) => send('session:data', event),
    credentials,
    autoReconnect: () => settings.get().autoReconnect
  })
  registerIpc({ win, devices, sessions, settings, credentials })
})

app.on('before-quit', () => sessions?.closeAll())

app.on('window-all-closed', () => app.quit())
