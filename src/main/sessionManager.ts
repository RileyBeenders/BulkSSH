import { readFile } from 'node:fs/promises'
import { utils } from 'ssh2'
import type { Device } from '@shared/device'
import type {
  ConnectRequest,
  ConnectResult,
  SessionDataEvent,
  SessionStatus,
  SessionStatusEvent
} from '@shared/session'
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
  createTransport?: (device: Device, creds: Credentials, req: ConnectRequest, verify: HostKeyVerifier) => Transport
}

export interface Credentials {
  password?: string
  privateKey?: Buffer
  passphrase?: string
}

interface Session {
  transport: Transport
  status: SessionStatus
  closeRequested: boolean
}

class SecretNeeded extends Error {}

// Owns one transport per device and reports status/output as events.
// Each device's session is independent: one failing never affects another.
export class SessionManager {
  private readonly sessions = new Map<string, Session>()
  private readonly createTransport: NonNullable<SessionManagerDeps['createTransport']>

  constructor(private readonly deps: SessionManagerDeps) {
    this.createTransport = deps.createTransport ?? createSshTransport
  }

  async connect(req: ConnectRequest): Promise<ConnectResult> {
    const device = this.deps.devices.get(req.deviceId)
    if (!device) return { ok: false, message: 'Device not found' }

    const existing = this.sessions.get(device.id)
    if (existing && (existing.status === 'connecting' || existing.status === 'connected')) {
      return { ok: false, message: 'Already connected' }
    }

    this.setStatus(device.id, 'connecting')

    let creds: Credentials
    try {
      creds = await this.credentialsFor(device, req.secret)
    } catch (err) {
      return this.fail(device.id, err)
    }

    const transport = this.createTransport(device, creds, req, (info) => this.verifyHostKey(info))
    const session: Session = { transport, status: 'connecting', closeRequested: false }
    this.sessions.set(device.id, session)

    transport.onData((data) => this.deps.onData({ deviceId: device.id, data }))
    transport.onClose((reason) => {
      if (this.sessions.get(device.id) !== session) return
      this.sessions.delete(device.id)
      this.setStatus(device.id, 'closed', reason)
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
      return this.fail(device.id, err, authFailed && device.auth.type === 'password')
    }

    session.status = 'connected'
    this.setStatus(device.id, 'connected')
    return { ok: true }
  }

  write(deviceId: string, data: string): void {
    this.sessions.get(deviceId)?.transport.write(data)
  }

  resize(deviceId: string, cols: number, rows: number): void {
    this.sessions.get(deviceId)?.transport.resize(cols, rows)
  }

  close(deviceId: string): void {
    const session = this.sessions.get(deviceId)
    if (!session) return
    session.closeRequested = true
    session.transport.close()
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id)
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
