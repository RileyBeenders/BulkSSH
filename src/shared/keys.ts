// Keyboard handling shared by the terminals and the app. Only the modifier
// flags and key/code are used, so tests can pass plain objects.

export interface KeyLike {
  key: string
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

// Shortcuts the app handles even while a terminal has focus; they never
// reach the device:
//   Ctrl+PageUp / Ctrl+PageDown  previous/next page (or device, in focus view)
//   Ctrl+Shift+M                 toggle mirroring
//   Ctrl+Shift+F                 toggle focus view
export function isAppShortcut(e: KeyLike): boolean {
  if (!e.ctrlKey || e.altKey || e.metaKey) return false
  if (!e.shiftKey && (e.key === 'PageUp' || e.key === 'PageDown')) return true
  return e.shiftKey && (e.code === 'KeyM' || e.code === 'KeyF')
}

// Clipboard keys, following Windows Terminal / PuTTY conventions:
//   Ctrl+Shift+C, Ctrl+Insert  copy
//   Ctrl+Shift+V, Shift+Insert paste
//   Ctrl+C                     copy only when text is selected; otherwise it
//                              is sent to the device as ^C (interrupt)
// Right-click (copy if selected, else paste) is handled separately.
export function clipboardAction(e: KeyLike, hasSelection: boolean): 'copy' | 'paste' | null {
  if (e.altKey || e.metaKey) return null
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyC') return 'copy'
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyV') return 'paste'
  if (e.ctrlKey && !e.shiftKey && e.code === 'Insert') return 'copy'
  if (!e.ctrlKey && e.shiftKey && e.code === 'Insert') return 'paste'
  if (e.ctrlKey && !e.shiftKey && e.code === 'KeyC' && hasSelection) return 'copy'
  return null
}
