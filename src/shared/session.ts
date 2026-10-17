// Session state shared between main and renderer.
// There is at most one session per device, so sessions are keyed by deviceId.

export type SessionStatus = 'connecting' | 'connected' | 'closed' | 'error'

export interface SessionStatusEvent {
  deviceId: string
  status: SessionStatus
  // Human-readable reason for 'error' (and sometimes 'closed').
  message?: string
}

export interface SessionDataEvent {
  deviceId: string
  data: Uint8Array
}

export interface ConnectRequest {
  deviceId: string
  // Password, or key passphrase for key auth. Used once, never stored.
  secret?: string
  cols: number
  rows: number
}

export type ConnectResult =
  | { ok: true }
  // needsSecret: the key is encrypted and no (or a wrong) passphrase was given,
  // or password auth was attempted without a password.
  | { ok: false; message: string; needsSecret?: boolean }
