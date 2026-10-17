import { createHash } from 'node:crypto'
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2'
import type { HostKeyVerifier, Transport } from './types'

export interface SshTransportOptions {
  host: string
  port: number
  username: string
  password?: string
  privateKey?: Buffer
  passphrase?: string
  cols: number
  rows: number
  verifyHostKey: HostKeyVerifier
  readyTimeoutMs?: number
}

export class SshTransport implements Transport {
  private readonly client = new Client()
  private stream: ClientChannel | null = null
  private dataListeners: Array<(data: Uint8Array) => void> = []
  private closeListeners: Array<(reason?: string) => void> = []
  private connected = false
  private closed = false
  private hostKeyRejected = false

  constructor(private readonly opts: SshTransportOptions) {}

  connect(): Promise<void> {
    const { opts } = this
    return new Promise((resolve, reject) => {
      let settled = false
      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        this.client.end()
        reject(new Error(this.describeError(err)))
      }

      this.client.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => {
        // Network gear often uses keyboard-interactive instead of plain password auth.
        finish(prompts.map(() => opts.password ?? ''))
      })

      this.client.on('ready', () => {
        this.client.shell({ term: 'xterm-256color', cols: opts.cols, rows: opts.rows }, (err, stream) => {
          if (err) return fail(err)
          this.stream = stream
          stream.on('data', (d: Buffer) => this.emitData(d))
          stream.stderr.on('data', (d: Buffer) => this.emitData(d))
          stream.on('close', () => this.client.end())
          settled = true
          this.connected = true
          resolve()
        })
      })

      this.client.on('error', (err) => {
        if (!settled) fail(err)
        else this.emitClose(this.describeError(err))
      })

      this.client.on('close', () => {
        if (!settled) fail(new Error('Connection closed during setup'))
        else this.emitClose()
      })

      const config: ConnectConfig = {
        host: opts.host,
        port: opts.port,
        username: opts.username,
        readyTimeout: opts.readyTimeoutMs ?? 20000,
        keepaliveInterval: 15000,
        tryKeyboard: opts.password !== undefined,
        hostVerifier: (key: Buffer, verify: (valid: boolean) => void) => {
          const info = { host: opts.host, port: opts.port, ...describeHostKey(key) }
          opts.verifyHostKey(info).then(
            (ok) => {
              this.hostKeyRejected = !ok
              verify(ok)
            },
            () => {
              this.hostKeyRejected = true
              verify(false)
            }
          )
        }
      }
      if (opts.privateKey) {
        config.privateKey = opts.privateKey
        if (opts.passphrase) config.passphrase = opts.passphrase
      } else if (opts.password !== undefined) {
        config.password = opts.password
      }

      try {
        this.client.connect(config)
      } catch (err) {
        fail(err as Error)
      }
    })
  }

  write(data: string): void {
    this.stream?.write(data)
  }

  resize(cols: number, rows: number): void {
    this.stream?.setWindow(rows, cols, 0, 0)
  }

  close(): void {
    this.client.end()
  }

  onData(listener: (data: Uint8Array) => void): void {
    this.dataListeners.push(listener)
  }

  onClose(listener: (reason?: string) => void): void {
    this.closeListeners.push(listener)
  }

  private emitData(data: Buffer): void {
    for (const l of this.dataListeners) l(data)
  }

  private emitClose(reason?: string): void {
    if (!this.connected || this.closed) return
    this.closed = true
    for (const l of this.closeListeners) l(reason)
  }

  private describeError(err: Error & { code?: string; level?: string }): string {
    if (this.hostKeyRejected) return 'Host key was not trusted'
    switch (err.code) {
      case 'ECONNREFUSED':
        return `Connection refused by ${this.opts.host}:${this.opts.port}`
      case 'ENOTFOUND':
      case 'EAI_AGAIN':
        return `Host not found: ${this.opts.host}`
      case 'ETIMEDOUT':
      case 'EHOSTUNREACH':
      case 'ENETUNREACH':
        return `Cannot reach ${this.opts.host}:${this.opts.port}`
      case 'ECONNRESET':
        return 'Connection was reset'
    }
    if (err.level === 'client-authentication') return 'Authentication failed'
    if (err.level === 'client-timeout') return 'Timed out waiting for the device to respond'
    return err.message
  }
}

// A raw SSH public key blob starts with a length-prefixed algorithm name.
export function describeHostKey(key: Buffer): { algorithm: string; fingerprint: string } {
  let algorithm = 'unknown'
  if (key.length >= 4) {
    const len = key.readUInt32BE(0)
    if (len > 0 && 4 + len <= key.length) algorithm = key.subarray(4, 4 + len).toString('ascii')
  }
  const digest = createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
  return { algorithm, fingerprint: `SHA256:${digest}` }
}
