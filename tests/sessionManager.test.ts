import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { SessionStatusEvent } from '@shared/session'
import { DeviceStore } from '../src/main/deviceStore'
import { KnownHosts } from '../src/main/knownHosts'
import { SessionManager, type SessionManagerDeps } from '../src/main/sessionManager'
import { generateKeys, startTestServer, waitFor, type TestServer } from './helpers/sshServer'

let dir: string
let server: TestServer | null
let devices: DeviceStore
let knownHosts: KnownHosts
let statuses: SessionStatusEvent[]
let output: string
let confirmHostKey: Mock<SessionManagerDeps['confirmHostKey']>
let manager: SessionManager

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bulkssh-session-'))
  server = null
  devices = new DeviceStore(join(dir, 'devices.json'))
  knownHosts = new KnownHosts(join(dir, 'known_hosts.json'))
  statuses = []
  output = ''
  confirmHostKey = vi.fn<SessionManagerDeps['confirmHostKey']>(async () => true)
  manager = new SessionManager({
    devices,
    knownHosts,
    confirmHostKey,
    onStatus: (e) => statuses.push(e),
    onData: (e) => (output += Buffer.from(e.data).toString())
  })
})

afterEach(async () => {
  manager.closeAll()
  await server?.close()
  rmSync(dir, { recursive: true, force: true })
})

function addDevice(port: number, auth: { type: 'password' } | { type: 'key'; keyPath: string } = { type: 'password' }) {
  return devices.save({ name: 'test', host: '127.0.0.1', port, username: 'alice', auth })
}

const statusList = (id: string): string[] => statuses.filter((s) => s.deviceId === id).map((s) => s.status)

describe('SessionManager with password auth', () => {
  it('connects, streams output, sends input and resizes', async () => {
    server = await startTestServer({ username: 'alice', password: 's3cret' })
    const device = addDevice(server.port)

    const result = await manager.connect({ deviceId: device.id, secret: 's3cret', cols: 100, rows: 30 })
    expect(result).toEqual({ ok: true })
    expect(statusList(device.id)).toEqual(['connecting', 'connected'])
    expect(server.ptys[0]).toMatchObject({ cols: 100, rows: 30, term: 'xterm-256color' })

    await waitFor(() => output.includes('welcome'))
    manager.write(device.id, 'ls')
    await waitFor(() => output.includes('echo:ls'))

    manager.resize(device.id, 120, 40)
    await waitFor(() => server!.resizes.length === 1)
    expect(server.resizes[0]).toMatchObject({ cols: 120, rows: 40 })

    manager.close(device.id)
    await waitFor(() => statusList(device.id).at(-1) === 'closed')
  })

  it('asks to trust an unknown host key once, then remembers it', async () => {
    server = await startTestServer({ username: 'alice', password: 'pw' })
    const device = addDevice(server.port)

    await manager.connect({ deviceId: device.id, secret: 'pw', cols: 80, rows: 24 })
    expect(confirmHostKey).toHaveBeenCalledTimes(1)
    const [info, check] = confirmHostKey.mock.calls[0]
    expect(check).toEqual({ result: 'unknown' })
    expect(info).toMatchObject({ host: '127.0.0.1', port: server.port, algorithm: 'ssh-ed25519' })
    expect(info.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/)

    manager.close(device.id)
    await waitFor(() => statusList(device.id).at(-1) === 'closed')
    expect(await manager.connect({ deviceId: device.id, secret: 'pw', cols: 80, rows: 24 })).toEqual({ ok: true })
    expect(confirmHostKey).toHaveBeenCalledTimes(1)
  })

  it('refuses to connect when the host key is not trusted', async () => {
    server = await startTestServer({ username: 'alice', password: 'pw' })
    const device = addDevice(server.port)
    confirmHostKey.mockResolvedValueOnce(false)

    const result = await manager.connect({ deviceId: device.id, secret: 'pw', cols: 80, rows: 24 })
    expect(result).toMatchObject({ ok: false, message: 'Host key was not trusted' })
    expect(knownHosts.check({ host: '127.0.0.1', port: server.port, algorithm: '', fingerprint: '' }).result).toBe(
      'unknown'
    )
  })

  it('reports a changed host key to the user', async () => {
    server = await startTestServer({ username: 'alice', password: 'pw' })
    const device = addDevice(server.port)
    knownHosts.trust({ host: '127.0.0.1', port: server.port, algorithm: 'ssh-ed25519', fingerprint: 'SHA256:old' })
    confirmHostKey.mockResolvedValueOnce(false)

    const result = await manager.connect({ deviceId: device.id, secret: 'pw', cols: 80, rows: 24 })
    expect(result.ok).toBe(false)
    expect(confirmHostKey.mock.calls[0][1]).toMatchObject({ result: 'changed', previous: { fingerprint: 'SHA256:old' } })
  })

  it('reports a wrong password and asks for it again', async () => {
    server = await startTestServer({ username: 'alice', password: 'right' })
    const device = addDevice(server.port)

    const result = await manager.connect({ deviceId: device.id, secret: 'wrong', cols: 80, rows: 24 })
    expect(result).toEqual({ ok: false, message: 'Authentication failed', needsSecret: true })
    expect(statusList(device.id)).toEqual(['connecting', 'error'])
  })

  it('asks for a password before connecting when none is given', async () => {
    const device = addDevice(1)
    const result = await manager.connect({ deviceId: device.id, cols: 80, rows: 24 })
    expect(result).toEqual({ ok: false, message: 'Password required', needsSecret: true })
  })

  it('rejects a second connect while connected', async () => {
    server = await startTestServer({ username: 'alice', password: 'pw' })
    const device = addDevice(server.port)
    await manager.connect({ deviceId: device.id, secret: 'pw', cols: 80, rows: 24 })
    const again = await manager.connect({ deviceId: device.id, secret: 'pw', cols: 80, rows: 24 })
    expect(again).toEqual({ ok: false, message: 'Already connected' })
  })

  it('gives a readable error when nothing is listening', async () => {
    server = await startTestServer({ username: 'alice', password: 'pw' })
    const port = server.port
    await server.close()
    server = null
    const device = addDevice(port)

    const result = await manager.connect({ deviceId: device.id, secret: 'pw', cols: 80, rows: 24 })
    expect(result).toMatchObject({ ok: false, message: `Connection refused by 127.0.0.1:${port}` })
  })
})

describe('SessionManager with key auth', () => {
  it('connects with an unencrypted key', async () => {
    const keys = generateKeys()
    server = await startTestServer({ username: 'alice', publicKey: keys.public })
    const keyPath = join(dir, 'id_test')
    writeFileSync(keyPath, keys.private)
    const device = addDevice(server.port, { type: 'key', keyPath })

    expect(await manager.connect({ deviceId: device.id, cols: 80, rows: 24 })).toEqual({ ok: true })
  })

  it('asks for a passphrase for an encrypted key and checks it', async () => {
    const keys = generateKeys({ passphrase: 'open sesame', cipher: 'aes256-ctr', rounds: 16 })
    server = await startTestServer({ username: 'alice', publicKey: keys.public })
    const keyPath = join(dir, 'id_test_enc')
    writeFileSync(keyPath, keys.private)
    const device = addDevice(server.port, { type: 'key', keyPath })

    expect(await manager.connect({ deviceId: device.id, cols: 80, rows: 24 })).toEqual({
      ok: false,
      message: 'This key needs a passphrase',
      needsSecret: true
    })
    expect(await manager.connect({ deviceId: device.id, secret: 'nope', cols: 80, rows: 24 })).toEqual({
      ok: false,
      message: 'Wrong key passphrase',
      needsSecret: true
    })
    expect(await manager.connect({ deviceId: device.id, secret: 'open sesame', cols: 80, rows: 24 })).toEqual({
      ok: true
    })
  })

  it('reports a missing key file', async () => {
    const device = addDevice(22, { type: 'key', keyPath: join(dir, 'missing') })
    const result = await manager.connect({ deviceId: device.id, cols: 80, rows: 24 })
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('Cannot read key file') })
  })
})

describe('SessionManager mirroring and broadcast', () => {
  async function connectTwo() {
    server = await startTestServer({ username: 'alice', password: 'pw' })
    const a = addDevice(server.port)
    const b = addDevice(server.port)
    await manager.connect({ deviceId: a.id, secret: 'pw', cols: 80, rows: 24 })
    await manager.connect({ deviceId: b.id, secret: 'pw', cols: 80, rows: 24 })
    return { a, b }
  }

  it('writes the same input to several devices and skips unknown ones', async () => {
    const outputs: Record<string, string> = {}
    manager = new SessionManager({
      devices,
      knownHosts,
      confirmHostKey,
      onStatus: () => {},
      onData: (e) => (outputs[e.deviceId] = (outputs[e.deviceId] ?? '') + Buffer.from(e.data).toString())
    })
    const { a, b } = await connectTwo()
    manager.writeMany([a.id, b.id, 'not-a-device', a.id], 'pwd')
    await waitFor(() => !!outputs[a.id]?.includes('echo:pwd') && !!outputs[b.id]?.includes('echo:pwd'))
    // Duplicate ids are written once.
    expect(outputs[a.id].match(/echo:pwd/g)).toHaveLength(1)
  })

  it('runs a command and returns output and exit code', async () => {
    const { a } = await connectTwo()
    const result = await manager.exec(a.id, 'uptime', 5000)
    expect(result).toMatchObject({ ok: true, code: 0, output: 'ran:uptime', truncated: false })
  })

  it('reports non-zero exit codes and includes stderr', async () => {
    const { a } = await connectTwo()
    const result = await manager.exec(a.id, 'exit 3', 5000)
    expect(result).toMatchObject({ ok: true, code: 3 })
    expect(result.ok && result.output).toContain('bye')
    expect(result.ok && result.output).toContain('oops')
  })

  it('truncates very large output', async () => {
    const { a } = await connectTwo()
    const result = await manager.exec(a.id, 'big 100000', 5000)
    expect(result.ok && result.output.length).toBe(64 * 1024)
    expect(result.ok && result.truncated).toBe(true)
  })

  it('times out one device without affecting the others', async () => {
    const { a, b } = await connectTwo()
    const [slow, fast] = await Promise.all([manager.exec(a.id, 'hang', 300), manager.exec(b.id, 'uptime', 5000)])
    expect(slow).toMatchObject({ ok: false, message: 'Timed out after 0 s' })
    expect(fast).toMatchObject({ ok: true, code: 0 })
    // The interactive shell of the timed-out device still works.
    manager.write(a.id, 'still-here')
    await waitFor(() => output.includes('echo:still-here'))
  })

  it('reports devices that are not connected', async () => {
    const device = addDevice(1)
    expect(await manager.exec(device.id, 'uptime', 5000)).toEqual({ ok: false, message: 'Not connected', durationMs: 0 })
  })
})
