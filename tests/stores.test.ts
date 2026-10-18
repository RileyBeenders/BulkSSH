import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DeviceStore } from '../src/main/deviceStore'
import { CredentialStore, type Cipher } from '../src/main/credentialStore'
import { KnownHosts } from '../src/main/knownHosts'
import { SettingsStore } from '../src/main/settingsStore'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bulkssh-test-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const input = { name: 'pi', host: 'pi.local', port: 22, username: 'pi', auth: { type: 'password' as const } }

describe('DeviceStore', () => {
  it('saves, reloads, updates and deletes devices', () => {
    const path = join(dir, 'devices.json')
    const store = new DeviceStore(path)
    const saved = store.save(input)
    expect(saved.id).toBeTruthy()

    const reloaded = new DeviceStore(path)
    expect(reloaded.list()).toEqual([saved])

    const updated = reloaded.save({ ...saved, name: 'pi-garage' })
    expect(new DeviceStore(path).get(saved.id)?.name).toBe('pi-garage')
    expect(updated.id).toBe(saved.id)

    reloaded.delete(saved.id)
    expect(new DeviceStore(path).list()).toEqual([])
  })

  it('deletes several devices with one call and ignores unknown ids', () => {
    const path = join(dir, 'devices.json')
    const store = new DeviceStore(path)
    const [a, b, c] = ['a', 'b', 'c'].map((name) => store.save({ ...input, name, host: `${name}.local` }))
    store.deleteMany([a.id, c.id, 'nope'])
    expect(new DeviceStore(path).list().map((d) => d.name)).toEqual(['b'])
    store.deleteMany([])
    store.deleteMany(['nope'])
    expect(new DeviceStore(path).list()).toEqual([b])
  })

  it('rejects invalid devices and unknown ids', () => {
    const store = new DeviceStore(join(dir, 'devices.json'))
    expect(() => store.save({ ...input, host: '' })).toThrow('Host is required')
    expect(() => store.save({ ...input, id: 'nope' })).toThrow('Device not found')
  })

  it('never writes extra fields such as passwords', () => {
    const path = join(dir, 'devices.json')
    new DeviceStore(path).save({ ...input, password: 'hunter2' } as typeof input)
    expect(readFileSync(path, 'utf8')).not.toContain('hunter2')
  })

  it('moves a corrupt file aside instead of overwriting it', () => {
    const path = join(dir, 'devices.json')
    writeFileSync(path, '{not json')
    expect(new DeviceStore(path).list()).toEqual([])
    expect(existsSync(path)).toBe(false)
    expect(readdirSync(dir).some((f) => f.startsWith('devices.json.corrupt-'))).toBe(true)
  })
})

describe('KnownHosts', () => {
  const info = { host: 'Pi.Local', port: 22, algorithm: 'ssh-ed25519', fingerprint: 'SHA256:aaa' }

  it('reports unknown, then match after trusting (case-insensitive host)', () => {
    const path = join(dir, 'known_hosts.json')
    const hosts = new KnownHosts(path)
    expect(hosts.check(info).result).toBe('unknown')
    hosts.trust(info)
    expect(new KnownHosts(path).check({ ...info, host: 'pi.local' }).result).toBe('match')
  })

  it('reports a changed key with the previous fingerprint', () => {
    const hosts = new KnownHosts(join(dir, 'known_hosts.json'))
    hosts.trust(info)
    expect(hosts.check({ ...info, fingerprint: 'SHA256:bbb' })).toEqual({
      result: 'changed',
      previous: { algorithm: 'ssh-ed25519', fingerprint: 'SHA256:aaa' }
    })
  })

  it('treats a different port as a different host', () => {
    const hosts = new KnownHosts(join(dir, 'known_hosts.json'))
    hosts.trust(info)
    expect(hosts.check({ ...info, port: 2222 }).result).toBe('unknown')
  })
})

describe('SettingsStore', () => {
  it('defaults to 6 per page, saves and reloads', () => {
    const path = join(dir, 'settings.json')
    expect(new SettingsStore(path).get()).toEqual({ pageSize: 6, broadcastTimeoutSec: 30, autoReconnect: true })
    new SettingsStore(path).save({ pageSize: 9, broadcastTimeoutSec: 10, autoReconnect: false })
    expect(new SettingsStore(path).get()).toEqual({ pageSize: 9, broadcastTimeoutSec: 10, autoReconnect: false })
  })

  it('rejects invalid settings without changing the saved ones', () => {
    const path = join(dir, 'settings.json')
    const store = new SettingsStore(path)
    store.save({ pageSize: 4, broadcastTimeoutSec: 30, autoReconnect: true })
    expect(() => store.save({ pageSize: 100, broadcastTimeoutSec: 30, autoReconnect: true })).toThrow('Devices per page')
    expect(new SettingsStore(path).get()).toEqual({ pageSize: 4, broadcastTimeoutSec: 30, autoReconnect: true })
  })
})

// Stand-in for Electron safeStorage: reversible, but never the plain text.
export const fakeCipher = (available = true): Cipher => ({
  available: () => available,
  encrypt: (plain) => Buffer.from([...Buffer.from(plain, 'utf8')].map((b) => b ^ 0x5a)),
  decrypt: (enc) => {
    if (enc[0] === 0xff) throw new Error('cannot decrypt')
    return Buffer.from([...enc].map((b) => b ^ 0x5a)).toString('utf8')
  }
})

describe('CredentialStore', () => {
  it('saves only ciphertext and reads it back after a restart', () => {
    const path = join(dir, 'credentials.json')
    new CredentialStore(path, fakeCipher()).set('dev-1', 'hunter2')
    expect(readFileSync(path, 'utf8')).not.toContain('hunter2')
    const reloaded = new CredentialStore(path, fakeCipher())
    expect(reloaded.get('dev-1')).toBe('hunter2')
    expect(reloaded.savedIds()).toEqual(['dev-1'])
  })

  it('forgets secrets', () => {
    const path = join(dir, 'credentials.json')
    const store = new CredentialStore(path, fakeCipher())
    store.set('dev-1', 'a')
    store.delete('dev-1')
    expect(new CredentialStore(path, fakeCipher()).has('dev-1')).toBe(false)
  })

  it('refuses to save when OS encryption is unavailable', () => {
    const store = new CredentialStore(join(dir, 'credentials.json'), fakeCipher(false))
    expect(() => store.set('dev-1', 'a')).toThrow('Secure storage is not available')
    expect(existsSync(join(dir, 'credentials.json'))).toBe(false)
  })

  it('drops entries that can no longer be decrypted', () => {
    const path = join(dir, 'credentials.json')
    writeFileSync(path, JSON.stringify({ version: 1, secrets: { 'dev-1': Buffer.from([0xff, 1]).toString('base64') } }))
    const store = new CredentialStore(path, fakeCipher())
    expect(store.get('dev-1')).toBeUndefined()
    expect(store.has('dev-1')).toBe(false)
  })
})
