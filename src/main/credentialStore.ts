import { readJsonFile, writeJsonFile } from './jsonFile'

// Encrypts with a key held by the operating system (Electron safeStorage:
// DPAPI on Windows, Keychain on macOS, libsecret on Linux). Injected so the
// store can be tested without Electron.
export interface Cipher {
  available(): boolean
  encrypt(plain: string): Buffer
  decrypt(encrypted: Buffer): string
}

interface CredentialFile {
  version: 1
  // deviceId -> base64 of the OS-encrypted password or passphrase
  secrets: Record<string, string>
}

// Passwords and key passphrases the user chose to remember. Only ciphertext
// is written to disk, and secrets never leave the main process.
export class CredentialStore {
  private secrets: Record<string, string>

  constructor(
    private readonly path: string,
    private readonly cipher: Cipher
  ) {
    const file = readJsonFile<CredentialFile>(path, { version: 1, secrets: {} })
    this.secrets = typeof file.secrets === 'object' && file.secrets !== null ? { ...file.secrets } : {}
  }

  available(): boolean {
    return this.cipher.available()
  }

  savedIds(): string[] {
    return Object.keys(this.secrets)
  }

  has(deviceId: string): boolean {
    return deviceId in this.secrets
  }

  // Undefined when nothing is saved or it can no longer be decrypted (e.g.
  // the file was copied from another Windows account); such entries are dropped.
  get(deviceId: string): string | undefined {
    const stored = this.secrets[deviceId]
    if (stored === undefined || !this.cipher.available()) return undefined
    try {
      return this.cipher.decrypt(Buffer.from(stored, 'base64'))
    } catch {
      this.delete(deviceId)
      return undefined
    }
  }

  set(deviceId: string, secret: string): void {
    if (!this.cipher.available()) throw new Error('Secure storage is not available on this system')
    this.secrets[deviceId] = this.cipher.encrypt(secret).toString('base64')
    this.persist()
  }

  delete(deviceId: string): void {
    if (!(deviceId in this.secrets)) return
    delete this.secrets[deviceId]
    this.persist()
  }

  private persist(): void {
    writeJsonFile(this.path, { version: 1, secrets: this.secrets } satisfies CredentialFile)
  }
}
