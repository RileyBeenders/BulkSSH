import { DEFAULT_SSH_PORT, type Device } from './device'

// Parsing the "Host(s)" box of the device form, which takes one or many
// addresses: `host`, `host:port`, `[ipv6]:port` or a bare IPv6 address,
// separated by commas, semicolons, spaces or new lines.

export interface HostEntry {
  host: string
  port: number
}

export interface HostListResult {
  entries: HostEntry[]
  // One message per entry that could not be understood.
  errors: string[]
}

export const MAX_HOSTS_PER_ADD = 500

const HOSTNAME = /^[A-Za-z0-9_](?:[A-Za-z0-9._-]*[A-Za-z0-9_])?$/
const IPV6 = /^[0-9A-Fa-f:.]+(?:%[\w.-]+)?$/

export function parseHostList(text: string): HostListResult {
  const entries: HostEntry[] = []
  const errors: string[] = []
  const seen = new Set<string>()

  for (const raw of text.split(/[\s,;]+/)) {
    // People paste lists wrapped in quotes or backticks; ignore those.
    const token = raw.replace(/^[`'"]+|[`'"]+$/g, '')
    if (token === '') continue
    const parsed = parseHost(token)
    if (typeof parsed === 'string') {
      errors.push(`"${token}": ${parsed}`)
      continue
    }
    const key = `${parsed.host.toLowerCase()}:${parsed.port}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push(parsed)
  }

  if (entries.length > MAX_HOSTS_PER_ADD) {
    errors.push(`At most ${MAX_HOSTS_PER_ADD} devices can be added at once (got ${entries.length})`)
  }
  return { entries, errors }
}

// A HostEntry, or the reason the token is not one.
function parseHost(token: string): HostEntry | string {
  if (token.includes('@')) return 'put the username in the Username field'

  let host: string
  let port: string | undefined
  const bracketed = token.match(/^\[([^\]]+)\](?::(.*))?$/)
  if (bracketed) {
    host = bracketed[1]
    port = bracketed[2]
    if (!host.includes(':') || !IPV6.test(host)) return 'not a valid IPv6 address'
  } else {
    const colons = token.split(':').length - 1
    if (colons >= 2) {
      // Bare IPv6 address; a port needs the [address]:port form.
      if (!IPV6.test(token)) return 'not a valid address'
      return { host: token, port: DEFAULT_SSH_PORT }
    }
    ;[host, port] = token.split(':')
    if (!HOSTNAME.test(host)) return 'not a valid host name or IP address'
  }

  if (port === undefined) return { host, port: DEFAULT_SSH_PORT }
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) return 'port must be a number from 1 to 65535'
  return { host, port: Number(port) }
}

// How an address is shown and typed back: the port only when it isn't 22.
export function formatHost({ host, port }: HostEntry): string {
  const h = host.includes(':') ? `[${host}]` : host
  return port === DEFAULT_SSH_PORT ? h : `${h}:${port}`
}

export interface PlannedDevice {
  name: string
  host: string
  port: number
  // Set when an identical device (same address and username) is already saved.
  existingId?: string
}

// What adding `entries` would create. One address takes the name as typed
// (or the address if the name is empty); several are numbered
// "<name>-1", "<name>-2", … or named after their addresses.
export function planDevices(
  entries: HostEntry[],
  name: string,
  username: string,
  existing: readonly Device[]
): PlannedDevice[] {
  const prefix = name.trim()
  return entries.map((entry, i) => {
    const match = existing.find(
      (d) =>
        d.host.toLowerCase() === entry.host.toLowerCase() && d.port === entry.port && d.username === username.trim()
    )
    if (match) return { name: match.name, host: match.host, port: match.port, existingId: match.id }
    const generated = entries.length === 1 ? prefix || formatHost(entry) : prefix ? `${prefix}-${i + 1}` : formatHost(entry)
    return { name: generated, host: entry.host, port: entry.port }
  })
}
