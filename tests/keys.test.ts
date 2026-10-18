import { describe, expect, it } from 'vitest'
import { clipboardAction, isAppShortcut, type KeyLike } from '@shared/keys'

const key = (code: string, mods: Partial<KeyLike> = {}, k = ''): KeyLike => ({
  key: k,
  code,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods
})
const ctrl = { ctrlKey: true }
const ctrlShift = { ctrlKey: true, shiftKey: true }

describe('isAppShortcut', () => {
  it('claims paging, mirror and focus shortcuts', () => {
    expect(isAppShortcut(key('PageUp', ctrl, 'PageUp'))).toBe(true)
    expect(isAppShortcut(key('PageDown', ctrl, 'PageDown'))).toBe(true)
    expect(isAppShortcut(key('KeyM', ctrlShift, 'M'))).toBe(true)
    expect(isAppShortcut(key('KeyF', ctrlShift, 'F'))).toBe(true)
  })

  it('leaves everything else to the device', () => {
    expect(isAppShortcut(key('PageUp', {}, 'PageUp'))).toBe(false) // plain PageUp (less, vim)
    expect(isAppShortcut(key('PageUp', ctrlShift, 'PageUp'))).toBe(false)
    expect(isAppShortcut(key('KeyM', ctrl, 'm'))).toBe(false) // Ctrl+M = Enter
    expect(isAppShortcut(key('KeyF', ctrl, 'f'))).toBe(false) // Ctrl+F (readline forward)
    expect(isAppShortcut(key('KeyF', { ...ctrlShift, altKey: true }, 'F'))).toBe(false)
  })
})

describe('clipboardAction', () => {
  it('copies and pastes with Ctrl+Shift+C/V and the Insert combos', () => {
    expect(clipboardAction(key('KeyC', ctrlShift), false)).toBe('copy')
    expect(clipboardAction(key('KeyV', ctrlShift), false)).toBe('paste')
    expect(clipboardAction(key('Insert', ctrl), false)).toBe('copy')
    expect(clipboardAction(key('Insert', { shiftKey: true }), false)).toBe('paste')
  })

  it('treats Ctrl+C as copy only when text is selected', () => {
    expect(clipboardAction(key('KeyC', ctrl), true)).toBe('copy')
    expect(clipboardAction(key('KeyC', ctrl), false)).toBeNull()
  })

  it('leaves Ctrl+V and plain keys to the device', () => {
    expect(clipboardAction(key('KeyV', ctrl), false)).toBeNull() // ^V is literal-next in shells
    expect(clipboardAction(key('KeyC'), true)).toBeNull()
    expect(clipboardAction(key('Insert'), false)).toBeNull()
    expect(clipboardAction(key('KeyC', { ...ctrlShift, altKey: true }), true)).toBeNull()
  })
})
