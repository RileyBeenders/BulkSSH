import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { bridge } from './bridge'

// One xterm.js terminal per device, kept outside React so scrollback survives
// switching between devices (and, later, between grid and focus views).

interface Entry {
  term: Terminal
  fit: FitAddon
  el: HTMLDivElement
  opened: boolean
}

const entries = new Map<string, Entry>()
let unsubscribe: (() => void) | null = null

export function getTerminal(deviceId: string): Terminal {
  return entry(deviceId).term
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
  e.term.focus()
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
      fontSize: 14,
      scrollback: 5000,
      theme: { background: '#0f1115' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.onData((data) => bridge?.session.write(deviceId, data))
    term.onResize(({ cols, rows }) => bridge?.session.resize(deviceId, cols, rows))
    const el = document.createElement('div')
    el.className = 'term-host'
    e = { term, fit, el, opened: false }
    entries.set(deviceId, e)
  }
  return e
}
