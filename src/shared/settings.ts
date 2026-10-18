import { DEFAULT_PAGE_SIZE } from './paging'

export interface Settings {
  // Maximum device tiles shown per grid page.
  pageSize: number
  // Per-device time limit for broadcast commands.
  broadcastTimeoutSec: number
}

export const MAX_PAGE_SIZE = 36
export const MAX_BROADCAST_TIMEOUT_SEC = 3600

export const DEFAULT_SETTINGS: Settings = { pageSize: DEFAULT_PAGE_SIZE, broadcastTimeoutSec: 30 }

// Returns a list of problems; empty means valid.
export function validateSettings(input: unknown): string[] {
  if (typeof input !== 'object' || input === null) return ['Settings must be an object']
  const s = input as Record<string, unknown>
  const errors: string[] = []
  if (!inRange(s.pageSize, 1, MAX_PAGE_SIZE)) {
    errors.push(`Devices per page must be a whole number from 1 to ${MAX_PAGE_SIZE}`)
  }
  if (!inRange(s.broadcastTimeoutSec, 1, MAX_BROADCAST_TIMEOUT_SEC)) {
    errors.push(`Broadcast timeout must be a whole number of seconds from 1 to ${MAX_BROADCAST_TIMEOUT_SEC}`)
  }
  return errors
}

// Fills in defaults for missing or invalid fields (e.g. an older settings file),
// copying only known fields.
export function normalizeSettings(input: unknown): Settings {
  const s = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  return {
    pageSize: inRange(s.pageSize, 1, MAX_PAGE_SIZE) ? s.pageSize : DEFAULT_SETTINGS.pageSize,
    broadcastTimeoutSec: inRange(s.broadcastTimeoutSec, 1, MAX_BROADCAST_TIMEOUT_SEC)
      ? s.broadcastTimeoutSec
      : DEFAULT_SETTINGS.broadcastTimeoutSec
  }
}

function inRange(v: unknown, min: number, max: number): v is number {
  return Number.isInteger(v) && (v as number) >= min && (v as number) <= max
}
