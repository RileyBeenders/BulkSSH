// Session state shared between main and renderer.
// There is at most one session per device, so sessions are keyed by deviceId.

// 'reconnecting': the connection dropped and a retry is scheduled.
export type SessionStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error'

export interface SessionStatusEvent {
  deviceId: string
  status: SessionStatus
  // Human-readable reason for 'error', 'reconnecting' and sometimes 'closed'.
  message?: string
}

export interface SessionDataEvent {
  deviceId: string
  data: Uint8Array
}

export interface ConnectRequest {
  deviceId: string
  // Password, or key passphrase for key auth. When omitted, a saved secret
  // is used if there is one.
  secret?: string
  // Save `secret` (encrypted by the OS) after a successful login; false
  // forgets any saved one.
  remember?: boolean
  cols: number
  rows: number
}

export type ConnectResult =
  | { ok: true }
  // needsSecret: the key is encrypted and no (or a wrong) passphrase was given,
  // or password auth was attempted without a password.
  | { ok: false; message: string; needsSecret?: boolean }

// Result of running one broadcast command on one device (an SSH exec
// channel, separate from the interactive shell).
export type ExecResult =
  | {
      ok: true
      // Exit code, or null if the command was killed by a signal.
      code: number | null
      signal?: string
      // stdout and stderr interleaved in arrival order.
      output: string
      truncated: boolean
      durationMs: number
    }
  | { ok: false; message: string; durationMs: number }

export const MAX_EXEC_OUTPUT_BYTES = 64 * 1024
export const MAX_COMMAND_LENGTH = 10_000
