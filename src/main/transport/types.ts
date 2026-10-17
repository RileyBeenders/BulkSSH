// Every connection type (SSH now; telnet, serial later) implements Transport,
// so the session manager and UI never depend on a specific protocol library.

export interface Transport {
  // Resolves once an interactive shell is open; rejects with a user-facing Error.
  connect(): Promise<void>
  write(data: string): void
  resize(cols: number, rows: number): void
  close(): void
  onData(listener: (data: Uint8Array) => void): void
  // Fires once, after connect() resolved, when the connection ends.
  onClose(listener: (reason?: string) => void): void
}

export interface HostKeyInfo {
  host: string
  port: number
  algorithm: string
  // OpenSSH-style SHA256 fingerprint, e.g. "SHA256:abc..."
  fingerprint: string
}

// Return true to trust the key and continue connecting.
export type HostKeyVerifier = (info: HostKeyInfo) => Promise<boolean>
