import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DeviceStore } from '../src/main/deviceStore'
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
    expect(new SettingsStore(path).get()).toEqual({ pageSize: 6 })
    new SettingsStore(path).save({ pageSize: 9 })
    expect(new SettingsStore(path).get()).toEqual({ pageSize: 9 })
  })

  it('rejects invalid settings without changing the saved ones', () => {
    const path = join(dir, 'settings.json')
    const store = new SettingsStore(path)
    store.save({ pageSize: 4 })
    expect(() => store.save({ pageSize: 100 })).toThrow('Devices per page')
    expect(new SettingsStore(path).get()).toEqual({ pageSize: 4 })
  })
})
