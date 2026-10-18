import type { BulkSshApi } from './index'

declare global {
  interface Window {
    // Optional: absent when the renderer runs in a plain browser instead of Electron.
    bulkssh?: BulkSshApi
  }
}

export {}
