import { DEFAULT_PAGE_SIZE } from './paging'

export interface Settings {
  // Maximum device tiles shown per grid page.
  pageSize: number
}

export const MAX_PAGE_SIZE = 36

export const DEFAULT_SETTINGS: Settings = { pageSize: DEFAULT_PAGE_SIZE }

// Returns a list of problems; empty means valid.
export function validateSettings(input: unknown): string[] {
  if (typeof input !== 'object' || input === null) return ['Settings must be an object']
  const s = input as Record<string, unknown>
  const errors: string[] = []
  if (!Number.isInteger(s.pageSize) || (s.pageSize as number) < 1 || (s.pageSize as number) > MAX_PAGE_SIZE) {
    errors.push(`Devices per page must be a whole number from 1 to ${MAX_PAGE_SIZE}`)
  }
  return errors
}

// Fills in defaults for missing or invalid fields (e.g. an older settings file),
// copying only known fields.
export function normalizeSettings(input: unknown): Settings {
  const s = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const pageSize = validateSettings({ pageSize: s.pageSize }).length === 0 ? (s.pageSize as number) : DEFAULT_SETTINGS.pageSize
  return { pageSize }
}
