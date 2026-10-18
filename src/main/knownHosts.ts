import type { HostKeyInfo } from './transport/types'
import { readJsonFile, writeJsonFile } from './jsonFile'

interface KnownHost {
  algorithm: string
  fingerprint: string
}

export type HostKeyCheck =
  | { result: 'match' }
  | { result: 'unknown' }
  | { result: 'changed'; previous: KnownHost }

// Trusted host keys, keyed by "host:port". Trust-on-first-use: the user
// confirms an unknown key once; a changed key is reported, never accepted silently.
export class KnownHosts {
  private hosts: Record<string, KnownHost>

  constructor(private readonly path: string) {
    const loaded = readJsonFile<Record<string, KnownHost>>(path, {})
    this.hosts = typeof loaded === 'object' && loaded !== null ? loaded : {}
  }

  check(info: HostKeyInfo): HostKeyCheck {
    const known = this.hosts[key(info)]
    if (!known) return { result: 'unknown' }
    if (known.fingerprint === info.fingerprint) return { result: 'match' }
    return { result: 'changed', previous: { ...known } }
  }

  trust(info: HostKeyInfo): void {
    this.hosts[key(info)] = { algorithm: info.algorithm, fingerprint: info.fingerprint }
    writeJsonFile(this.path, this.hosts)
  }
}

function key(info: { host: string; port: number }): string {
  return `${info.host.toLowerCase()}:${info.port}`
}
