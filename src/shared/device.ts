// A saved device. Secrets (passwords, key passphrases) are never part of this
// record; they are asked for at connect time and never written to disk.

export type DeviceAuth =
  | { type: 'password' }
  | { type: 'key'; keyPath: string }

export interface Device {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth: DeviceAuth
}

// What the add/edit form submits. `id` is absent for a new device.
export type DeviceInput = Omit<Device, 'id'> & { id?: string }

export const DEFAULT_SSH_PORT = 22

// Returns a list of problems; empty means valid.
export function validateDevice(input: unknown): string[] {
  const errors: string[] = []
  if (typeof input !== 'object' || input === null) return ['Device must be an object']
  const d = input as Record<string, unknown>

  if (d.id !== undefined && (typeof d.id !== 'string' || d.id === '')) errors.push('Invalid id')
  if (!isNonEmptyString(d.name)) errors.push('Name is required')
  if (!isNonEmptyString(d.host)) errors.push('Host is required')
  else if (/\s/.test(d.host)) errors.push('Host must not contain spaces')
  if (!Number.isInteger(d.port) || (d.port as number) < 1 || (d.port as number) > 65535) {
    errors.push('Port must be a whole number from 1 to 65535')
  }
  if (!isNonEmptyString(d.username)) errors.push('Username is required')

  const auth = d.auth as Record<string, unknown> | undefined
  if (typeof auth !== 'object' || auth === null) errors.push('Auth method is required')
  else if (auth.type === 'key') {
    if (!isNonEmptyString(auth.keyPath)) errors.push('Key file path is required')
  } else if (auth.type !== 'password') errors.push('Unknown auth method')

  return errors
}

// Copies only known fields, trimming strings, so extra or hostile fields
// coming over IPC are never persisted.
export function normalizeDevice(input: DeviceInput, id: string): Device {
  const auth: DeviceAuth =
    input.auth.type === 'key'
      ? { type: 'key', keyPath: input.auth.keyPath.trim() }
      : { type: 'password' }
  return {
    id,
    name: input.name.trim(),
    host: input.host.trim(),
    port: input.port,
    username: input.username.trim(),
    auth
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}
