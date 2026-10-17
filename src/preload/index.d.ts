import type { BulkSshApi } from './index'

declare global {
  interface Window {
    bulkssh: BulkSshApi
  }
}

export {}
