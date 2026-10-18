import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { bridge } from './bridge'

// One xterm.js terminal per device, kept outside React so scrollback survives
// switching pages (and, later, between grid and focus views).

interface Entry {
  term: Terminal
  fit: FitAddon
  el: HTMLDivElement
  opened: boolean
}

const entries = new Map<string, Entry>()
let unsubscribe: (() => void) | null = null

// Where typed input goes. The app replaces this to add keystroke mirroring.
type InputHandler = (deviceId: string, data: string) => void
let inputHandler: InputHandler = (deviceId, data) => bridge?.session.write(deviceId, data)

export function setInputHandler(handler: InputHandler): void {
  inputHandler = handler
}

// Shortcuts the app handles even while a terminal has focus:
// Ctrl+PageUp/PageDown change page, Ctrl+Shift+M toggles mirroring.
export function isAppShortcut(e: KeyboardEvent): boolean {
  if (!e.ctrlKey || e.altKey || e.metaKey) return false
  if (!e.shiftKey && (e.key === 'PageUp' || e.key === 'PageDown')) return true
  return e.shiftKey && e.code === 'KeyM'
}

export function hasTerminal(deviceId: string): boolean {
  return entries.has(deviceId)
}

export function getTerminal(deviceId: string): Terminal {
  return entry(deviceId).term
}

export function focusTerminal(deviceId: string): void {
  entries.get(deviceId)?.term.focus()
}

// Mounts the device's terminal into `container`; returns a detach function.
export function attachTerminal(deviceId: string, container: HTMLElement): () => void {
  const e = entry(deviceId)
  container.appendChild(e.el)
  if (!e.opened) {
    e.term.open(e.el)
    e.opened = true
  }
  const refit = (): void => {
    if (container.clientWidth > 0 && container.clientHeight > 0) e.fit.fit()
  }
  refit()
  const observer = new ResizeObserver(refit)
  observer.observe(container)
  return () => {
    observer.disconnect()
    e.el.remove()
  }
}

export function disposeTerminal(deviceId: string): void {
  entries.get(deviceId)?.term.dispose()
  entries.delete(deviceId)
}

function entry(deviceId: string): Entry {
  if (!unsubscribe && bridge) {
    unsubscribe = bridge.session.onData(({ deviceId: id, data }) => entries.get(id)?.term.write(data))
  }
  let e = entries.get(deviceId)
  if (!e) {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      scrollback: 5000,
      theme: { background: '#0f1115' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    // Returning false lets the key bubble to the app instead of the device.
    term.attachCustomKeyEventHandler((ev) => !isAppShortcut(ev))
    term.onData((data) => inputHandler(deviceId, data))
    term.onResize(({ cols, rows }) => bridge?.session.resize(deviceId, cols, rows))
    const el = document.createElement('div')
    el.className = 'term-host'
    e = { term, fit, el, opened: false }
    entries.set(deviceId, e)
  }
  return e
}
