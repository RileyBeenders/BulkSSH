import { describe, expect, it } from 'vitest'
import { normalizeDevice, validateDevice, type DeviceInput } from '@shared/device'

const valid: DeviceInput = {
  name: 'router-1',
  host: '192.168.1.1',
  port: 22,
  username: 'admin',
  auth: { type: 'password' }
}

describe('validateDevice', () => {
  it('accepts a valid password device', () => {
    expect(validateDevice(valid)).toEqual([])
  })

  it('accepts a valid key device', () => {
    expect(validateDevice({ ...valid, auth: { type: 'key', keyPath: 'C:\\keys\\id_ed25519' } })).toEqual([])
  })

  it('reports each missing field', () => {
    const errors = validateDevice({ ...valid, name: ' ', host: '', username: '' })
    expect(errors).toEqual(['Name is required', 'Host is required', 'Username is required'])
  })

  it.each([0, 65536, 22.5, NaN])('rejects port %s', (port) => {
    expect(validateDevice({ ...valid, port })).toContain('Port must be a whole number from 1 to 65535')
  })

  it('rejects hosts with spaces', () => {
    expect(validateDevice({ ...valid, host: 'a b' })).toContain('Host must not contain spaces')
  })

  it('requires a key path for key auth', () => {
    expect(validateDevice({ ...valid, auth: { type: 'key', keyPath: '' } })).toContain(
      'Key file path is required'
    )
  })

  it('rejects unknown auth and non-objects', () => {
    expect(validateDevice({ ...valid, auth: { type: 'telepathy' } })).toContain('Unknown auth method')
    expect(validateDevice(null)).toEqual(['Device must be an object'])
  })
})

describe('normalizeDevice', () => {
  it('trims strings and drops unknown fields', () => {
    const input = { ...valid, name: '  r1 ', password: 'leak', auth: { type: 'password', extra: 1 } }
    expect(normalizeDevice(input as DeviceInput, 'id-1')).toEqual({
      id: 'id-1',
      name: 'r1',
      host: '192.168.1.1',
      port: 22,
      username: 'admin',
      auth: { type: 'password' }
    })
  })
})
