import { describe, expect, it } from 'vitest'
import type { Device } from '@shared/device'
import { formatHost, MAX_HOSTS_PER_ADD, parseHostList, planDevices } from '@shared/hosts'

describe('parseHostList', () => {
  it('reads the example from the request, backticks and all', () => {
    expect(parseHostList('`127.0.0.1:22`,`127.0.0.1:23`,`127.0.0.1:2222`')).toEqual({
      entries: [
        { host: '127.0.0.1', port: 22 },
        { host: '127.0.0.1', port: 23 },
        { host: '127.0.0.1', port: 2222 }
      ],
      errors: []
    })
  })

  it('defaults to port 22 and accepts commas, semicolons, spaces and new lines', () => {
    expect(parseHostList('10.0.0.1, 10.0.0.2;switch.local\n  pi-garage:2200\t"core-sw"').entries).toEqual([
      { host: '10.0.0.1', port: 22 },
      { host: '10.0.0.2', port: 22 },
      { host: 'switch.local', port: 22 },
      { host: 'pi-garage', port: 2200 },
      { host: 'core-sw', port: 22 }
    ])
  })

  it('handles IPv6 with and without a port', () => {
    expect(parseHostList('[fe80::1]:2222, [::1], 2001:db8::5').entries).toEqual([
      { host: 'fe80::1', port: 2222 },
      { host: '::1', port: 22 },
      { host: '2001:db8::5', port: 22 }
    ])
  })

  it('drops duplicates (host names are case-insensitive)', () => {
    expect(parseHostList('Router:22 router 10.0.0.1:23 10.0.0.1:23').entries).toEqual([
      { host: 'Router', port: 22 },
      { host: '10.0.0.1', port: 23 }
    ])
  })

  it('reports each bad entry and keeps the good ones', () => {
    const result = parseHostList('10.0.0.1, 10.0.0.2:0, admin@10.0.0.3, bad_host!, 10.0.0.4:ssh, [nope]:22')
    expect(result.entries).toEqual([{ host: '10.0.0.1', port: 22 }])
    expect(result.errors).toEqual([
      '"10.0.0.2:0": port must be a number from 1 to 65535',
      '"admin@10.0.0.3": put the username in the Username field',
      '"bad_host!": not a valid host name or IP address',
      '"10.0.0.4:ssh": port must be a number from 1 to 65535',
      '"[nope]:22": not a valid IPv6 address'
    ])
  })

  it('returns nothing for an empty box', () => {
    expect(parseHostList('  , ,\n')).toEqual({ entries: [], errors: [] })
  })

  it('limits how many devices one add can create', () => {
    const many = Array.from({ length: MAX_HOSTS_PER_ADD + 1 }, (_, i) => `10.0.${i >> 8}.${i & 255}`).join(',')
    expect(parseHostList(many).errors).toEqual([`At most ${MAX_HOSTS_PER_ADD} devices can be added at once (got ${MAX_HOSTS_PER_ADD + 1})`])
  })
})

describe('formatHost', () => {
  it('shows the port only when it is not 22, and brackets IPv6', () => {
    expect(formatHost({ host: '10.0.0.1', port: 22 })).toBe('10.0.0.1')
    expect(formatHost({ host: '10.0.0.1', port: 2222 })).toBe('10.0.0.1:2222')
    expect(formatHost({ host: 'fe80::1', port: 22 })).toBe('[fe80::1]')
    expect(formatHost({ host: 'fe80::1', port: 2222 })).toBe('[fe80::1]:2222')
  })

  it('round-trips through the parser', () => {
    for (const e of [{ host: 'a.b', port: 22 }, { host: '10.0.0.1', port: 2222 }, { host: 'fe80::1', port: 2200 }]) {
      expect(parseHostList(formatHost(e)).entries).toEqual([e])
    }
  })
})

describe('planDevices', () => {
  const entries = [
    { host: '10.0.0.1', port: 22 },
    { host: '10.0.0.2', port: 2222 }
  ]
  const saved: Device[] = [{ id: 'd1', name: 'edge', host: '10.0.0.2', port: 2222, username: 'admin', auth: { type: 'password' } }]

  it('numbers several devices after the name', () => {
    expect(planDevices(entries, 'switch', 'ops', []).map((p) => p.name)).toEqual(['switch-1', 'switch-2'])
  })

  it('names devices after their address when the name is empty', () => {
    expect(planDevices(entries, '  ', 'ops', []).map((p) => p.name)).toEqual(['10.0.0.1', '10.0.0.2:2222'])
  })

  it('uses the name as typed for a single device', () => {
    expect(planDevices(entries.slice(0, 1), 'core', 'ops', [])[0].name).toBe('core')
  })

  it('reuses a saved device with the same address and username', () => {
    expect(planDevices(entries, 'switch', 'admin', saved)).toEqual([
      { name: 'switch-1', host: '10.0.0.1', port: 22 },
      { name: 'edge', host: '10.0.0.2', port: 2222, existingId: 'd1' }
    ])
    // A different username is a different login, so it is a new device.
    expect(planDevices(entries, 'switch', 'ops', saved)[1].existingId).toBeUndefined()
  })
})
