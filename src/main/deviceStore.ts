import { randomUUID } from 'node:crypto'
import { normalizeDevice, validateDevice, type Device, type DeviceInput } from '@shared/device'
import { readJsonFile, writeJsonFile } from './jsonFile'

interface DeviceFile {
  version: 1
  devices: Device[]
}

// Saved devices, persisted as JSON. Never contains secrets.
export class DeviceStore {
  private devices: Device[]

  constructor(private readonly path: string) {
    const file = readJsonFile<DeviceFile>(path, { version: 1, devices: [] })
    this.devices = Array.isArray(file.devices)
      ? file.devices.filter((d) => validateDevice(d).length === 0)
      : []
  }

  list(): Device[] {
    return this.devices.map((d) => structuredClone(d))
  }

  get(id: string): Device | undefined {
    const d = this.devices.find((x) => x.id === id)
    return d && structuredClone(d)
  }

  // Adds a new device (no id) or replaces an existing one. Throws on invalid input.
  save(input: DeviceInput): Device {
    const errors = validateDevice(input)
    if (errors.length > 0) throw new Error(errors.join('; '))

    const existing = input.id !== undefined
    if (existing && !this.devices.some((d) => d.id === input.id)) {
      throw new Error('Device not found')
    }
    const device = normalizeDevice(input, input.id ?? randomUUID())
    this.devices = existing
      ? this.devices.map((d) => (d.id === device.id ? device : d))
      : [...this.devices, device]
    this.persist()
    return structuredClone(device)
  }

  delete(id: string): void {
    this.deleteMany([id])
  }

  // Removes several devices with a single write; unknown ids are ignored.
  deleteMany(ids: readonly string[]): void {
    const remove = new Set(ids)
    const kept = this.devices.filter((d) => !remove.has(d.id))
    if (kept.length === this.devices.length) return
    this.devices = kept
    this.persist()
  }

  private persist(): void {
    writeJsonFile(this.path, { version: 1, devices: this.devices } satisfies DeviceFile)
  }
}
