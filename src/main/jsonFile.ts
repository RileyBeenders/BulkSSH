import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// Reads a JSON file, returning `fallback` if it does not exist. A file that
// cannot be parsed is moved aside (never silently overwritten) and `fallback`
// is returned.
export function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  const text = readFileSync(path, 'utf8')
  try {
    return JSON.parse(text) as T
  } catch {
    const backup = `${path}.corrupt-${Date.now()}`
    renameSync(path, backup)
    console.error(`Could not parse ${path}; moved it to ${backup}`)
    return fallback
  }
}

// Writes via a temp file and rename so a crash never leaves a half-written file.
export function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, path)
}
