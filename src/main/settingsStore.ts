import { normalizeSettings, validateSettings, type Settings } from '@shared/settings'
import { readJsonFile, writeJsonFile } from './jsonFile'

// App settings, persisted as JSON in the userData folder.
export class SettingsStore {
  private settings: Settings

  constructor(private readonly path: string) {
    this.settings = normalizeSettings(readJsonFile<unknown>(path, {}))
  }

  get(): Settings {
    return { ...this.settings }
  }

  // Throws on invalid input.
  save(input: unknown): Settings {
    const errors = validateSettings(input)
    if (errors.length > 0) throw new Error(errors.join('; '))
    this.settings = normalizeSettings(input)
    writeJsonFile(this.path, this.settings)
    return this.get()
  }
}
