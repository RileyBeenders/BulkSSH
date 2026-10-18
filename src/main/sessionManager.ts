import { readFile } from 'node:fs/promises'
import { utils } from 'ssh2'
import type { Device } from '@shared/device'
import {
  MAX_EXEC_OUTPUT_BYTES,
  type ConnectRequest,
  type ConnectResult,
  type ExecResult,
  type SessionDataEvent,
  type SessionStatus,
  type SessionStatusEvent
} from '@shared/session'
import type { CredentialStore } from './credentialStore'
import type { DeviceStore } from './deviceStore'
import type { HostKeyCheck, KnownHosts } from './knownHosts'
import { SshTransport } from './transport/sshTransport'
import type { HostKeyInfo, HostKeyVerifier, Transport } from './transport/types'

export interface SessionManagerDeps {
  devices: DeviceStore
  knownHosts: KnownHosts
  // Ask the user whether to trust an unknown or changed host key.
  confirmHostKey: (info: HostKeyInfo, check: Exclude<HostKeyCheck, { result: 'match' }>) => Promise<boolean>
  onStatus: (event: SessionStatusEvent) => void
  onData: (event: SessionDataEvent) => void
  // Saved (OS-encrypted) passwords and passphrases; optional.
  credentials?: CredentialStore
  // Whether to retry when a connection drops; read at the time of the drop.
  autoReconnect?: () => boolean
  // Waits before each retry; the length is the number of attempts.
  reconnectDelaysMs?: number[]
  createTransport?: (device: Device, creds: Credentials, req: ConnectRequest, verify: HostKeyVerifier) => Transport
}

const DEFAULT_RECONNECT_DELAYS_MS = [2000, 5000, 10000, 20000, 30000]

export interface Credentials {
  password?: string
  privateKey?: Buffer
  passphrase?: string
}

interface Session {
  transport: Transport
  status: SessionStatus
  closeRequested: boolean
  // What the last successful login used, kept in memory only so a dropped
  // connection can be re-established without asking again.
  login: { secret?: string; cols: number; rows: number }
}

interface PendingReconnect {
  timer: ReturnType<typeof setTimeout>
  attempt: number
}

class SecretNeeded extends Error {}

// Owns one transport per device and reports status/output as events.
// Each device's session is independent: one failing never affects another.
export class SessionManager {
  private readonly sessions = new Map<string, Session>()
  private readonly reconnects = new Map<string, PendingReconnect>()
  private readonly createTransport: NonNullable<SessionManagerDeps['createTransport']>

  constructor(private readonly deps: SessionManagerDeps) {
    this.createTransport = deps.createTransport ?? createSshTransport
  }

  async connect(req: ConnectRequest): Promise<ConnectResult> {
    this.cancelReconnect(req.deviceId)
    return this.open(req)
  }

  private async open(req: ConnectRequest, attempt = 0): Promise<ConnectResult> {
    const device = this.deps.devices.get(req.deviceId)
    if (!device) return { ok: false, message: 'Device not found' }

    const existing = this.sessions.get(device.id)
    if (existing && (existing.status === 'connecting' || existing.status === 'connected')) {
      return { ok: false, message: 'Already connected' }
    }

    this.setStatus(device.id, 'connecting')

    // An explicit secret wins; otherwise use a saved one if there is one.
    const saved = req.secret === undefined ? this.deps.credentials?.get(device.id) : undefined
    const secret = req.secret ?? saved

    let creds: Credentials
    try {
      creds = await this.credentialsFor(device, secret)
    } catch (err) {
      return this.failLogin(device, err, saved !== undefined)
    }

    const login = { secret, cols: req.cols, rows: req.rows }
    const transport = this.createTransport(device, creds, req, (info) => this.verifyHostKey(info))
    const session: Session = { transport, status: 'connecting', closeRequested: false, login }
    this.sessions.set(device.id, session)

    transport.onData((data) => this.deps.onData({ deviceId: device.id, data }))
    transport.onClose((reason) => {
      if (this.sessions.get(device.id) !== session) return
      this.sessions.delete(device.id)
      if (!session.closeRequested && this.deps.autoReconnect?.()) {
        this.scheduleReconnect(device.id, session.login, 0, reason ?? 'Connection lost')
      } else {
        this.setStatus(device.id, 'closed', reason)
      }
    })

    try {
      await transport.connect()
    } catch (err) {
      if (this.sessions.get(device.id) === session) this.sessions.delete(device.id)
      if (session.closeRequested) {
        this.setStatus(device.id, 'closed')
        return { ok: false, message: 'Cancelled' }
      }
      const authFailed = (err as Error).message === 'Authentication failed'
      if (authFailed) return this.failLogin(device, err, saved !== undefined, device.auth.type === 'password')
      return this.fail(device.id, err)
    }

    session.status = 'connected'
    if (req.remember === true && req.secret !== undefined) this.deps.credentials?.set(device.id, req.secret)
    else if (req.remember === false) this.deps.credentials?.delete(device.id)
    this.setStatus(device.id, 'connected', attempt > 0 ? `Reconnected after ${attempt} attempt${attempt === 1 ? '' : 's'}` : undefined)
    return { ok: true }
  }

  // Retries a dropped connection with growing delays. Stops on success, on an
  // explicit connect/close, or on errors a retry can't fix (wrong password,
  // rejected host key).
  private scheduleReconnect(deviceId: string, login: Session['login'], attempt: number, lastError: string): void {
    const delays = this.deps.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS
    if (attempt >= delays.length) {
      this.setStatus(deviceId, 'error', `Could not reconnect after ${delays.length} attempts: ${lastError}`)
      return
    }
    const seconds = Math.round(delays[attempt] / 1000)
    this.setStatus(
      deviceId,
      'reconnecting',
      `${lastError}. Reconnecting in ${seconds} s (attempt ${attempt + 1} of ${delays.length})`
    )
    const timer = setTimeout(async () => {
      if (this.reconnects.get(deviceId)?.timer !== timer) return
      this.reconnects.delete(deviceId)
      const result = await this.open({ deviceId, secret: login.secret, cols: login.cols, rows: login.rows }, attempt + 1)
      if (result.ok || this.reconnects.has(deviceId) || this.sessions.has(deviceId)) return
      if (result.needsSecret || result.message === 'Host key was not trusted' || result.message === 'Device not found') return
      this.scheduleReconnect(deviceId, login, attempt + 1, result.message)
    }, delays[attempt])
    this.reconnects.set(deviceId, { timer, attempt })
  }

  private cancelReconnect(deviceId: string): boolean {
    const pending = this.reconnects.get(deviceId)
    if (!pending) return false
    clearTimeout(pending.timer)
    this.reconnects.delete(deviceId)
    return true
  }

  write(deviceId: string, data: string): void {
    this.sessions.get(deviceId)?.transport.write(data)
  }

  // Same input to several devices (keystroke mirroring). Devices that are not
  // connected are skipped; writes are buffered, so a slow device never blocks
  // the others.
  writeMany(deviceIds: readonly string[], data: string): void {
    for (const id of new Set(deviceIds)) {
      const session = this.sessions.get(id)
      if (session?.status === 'connected') session.transport.write(data)
    }
  }

  // Runs one command on one device and never throws: every failure becomes
  // an { ok: false } result so one device can't break a broadcast.
  async exec(deviceId: string, command: string, timeoutMs: number): Promise<ExecResult> {
    const start = Date.now()
    const session = this.sessions.get(deviceId)
    if (!session || session.status !== 'connected') {
      return { ok: false, message: 'Not connected', durationMs: 0 }
    }
    if (!session.transport.exec) {
      return { ok: false, message: 'This connection type cannot run commands', durationMs: 0 }
    }
    try {
      const out = await session.transport.exec(command, { timeoutMs, maxOutputBytes: MAX_EXEC_OUTPUT_BYTES })
      return { ok: true, ...out, durationMs: Date.now() - start }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
    }
  }

  resize(deviceId: string, cols: number, rows: number): void {
    this.sessions.get(deviceId)?.transport.resize(cols, rows)
  }

  // Current state of every live or reconnecting session, so a reloaded
  // window can show them again.
  snapshot(): SessionStatusEvent[] {
    const events: SessionStatusEvent[] = []
    for (const [deviceId, s] of this.sessions) events.push({ deviceId, status: s.status })
    for (const deviceId of this.reconnects.keys()) {
      if (!this.sessions.has(deviceId)) events.push({ deviceId, status: 'reconnecting' })
    }
    return events
  }

  close(deviceId: string): void {
    if (this.cancelReconnect(deviceId)) this.setStatus(deviceId, 'closed', 'Reconnect cancelled')
    const session = this.sessions.get(deviceId)
    if (!session) return
    session.closeRequested = true
    session.transport.close()
  }

  closeAll(): void {
    for (const id of [...this.reconnects.keys(), ...this.sessions.keys()]) this.close(id)
  }

  private async credentialsFor(device: Device, secret: string | undefined): Promise<Credentials> {
    if (device.auth.type === 'password') {
      if (secret === undefined) throw new SecretNeeded('Password required')
      return { password: secret }
    }

    let privateKey: Buffer
    try {
      privateKey = await readFile(device.auth.keyPath)
    } catch {
      throw new Error(`Cannot read key file: ${device.auth.keyPath}`)
    }

    const plain = utils.parseKey(privateKey)
    if (!(plain instanceof Error)) return { privateKey }
    if (!/passphrase|encrypt/i.test(plain.message)) {
      throw new Error(`Not a usable private key: ${plain.message}`)
    }
    if (!secret) throw new SecretNeeded('This key needs a passphrase')
    if (utils.parseKey(privateKey, secret) instanceof Error) {
      throw new SecretNeeded('Wrong key passphrase')
    }
    return { privateKey, passphrase: secret }
  }

  private async verifyHostKey(info: HostKeyInfo): Promise<boolean> {
    const check = this.deps.knownHosts.check(info)
    if (check.result === 'match') return true
    const trusted = await this.deps.confirmHostKey(info, check)
    if (trusted) this.deps.knownHosts.trust(info)
    return trusted
  }

  // A login problem: a missing or wrong password/passphrase. A saved secret
  // that no longer works is forgotten so the user is asked again.
  private failLogin(device: Device, err: unknown, usedSaved: boolean, wrongSecret = false): ConnectResult {
    if (usedSaved && (wrongSecret || err instanceof SecretNeeded)) {
      this.deps.credentials?.delete(device.id)
      const what = device.auth.type === 'password' ? 'password' : 'key passphrase'
      return this.fail(device.id, new SecretNeeded(`The saved ${what} was rejected; enter it again`))
    }
    return this.fail(device.id, err, wrongSecret)
  }

  private fail(deviceId: string, err: unknown, needsSecret = false): ConnectResult {
    const message = err instanceof Error ? err.message : String(err)
    this.setStatus(deviceId, 'error', message)
    return { ok: false, message, needsSecret: needsSecret || err instanceof SecretNeeded }
  }

  private setStatus(deviceId: string, status: SessionStatus, message?: string): void {
    this.deps.onStatus({ deviceId, status, message })
  }
}

function createSshTransport(
  device: Device,
  creds: Credentials,
  req: ConnectRequest,
  verifyHostKey: HostKeyVerifier
): Transport {
  return new SshTransport({
    host: device.host,
    port: device.port,
    username: device.username,
    ...creds,
    cols: req.cols,
    rows: req.rows,
    verifyHostKey
  })
}
