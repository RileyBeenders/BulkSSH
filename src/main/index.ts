import { join } from 'node:path'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { DeviceStore } from './deviceStore'
import { registerIpc } from './ipc'
import { KnownHosts } from './knownHosts'
import { SessionManager } from './sessionManager'
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

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
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

app.whenReady().then(() => {
  const win = createWindow()
  const userData = app.getPath('userData')
  const devices = new DeviceStore(join(userData, 'devices.json'))
  const send = (channel: string, payload: unknown): void => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }

  sessions = new SessionManager({
    devices,
    knownHosts: new KnownHosts(join(userData, 'known_hosts.json')),
    confirmHostKey: (info, check) => confirmHostKey(win, info, check),
    onStatus: (event) => send('session:status', event),
    onData: (event) => send('session:data', event)
  })
  registerIpc(win, devices, sessions)
})

app.on('before-quit', () => sessions?.closeAll())

app.on('window-all-closed', () => app.quit())
