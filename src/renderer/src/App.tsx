import { useCallback, useEffect, useRef, useState } from 'react'
import type { Device } from '@shared/device'
import { clampPage, gridShape, pageCount, pageOf, pageSlice } from '@shared/paging'
import type { SessionStatusEvent } from '@shared/session'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import { bridge } from './bridge'
import { DeviceForm } from './components/DeviceForm'
import { DeviceList } from './components/DeviceList'
import { Pager } from './components/Pager'
import { SecretPrompt } from './components/SecretPrompt'
import { SettingsDialog } from './components/SettingsDialog'
import { Tile } from './components/Tile'
import { disposeTerminal, focusTerminal, getTerminal, hasTerminal, isAppShortcut } from './terminals'

type Editing = { device: Device | null } | null
interface PromptEntry {
  key: number
  device: Device
  message?: string
}

let promptKey = 0

export function App(): React.JSX.Element {
  const [version, setVersion] = useState('')
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [devices, setDevices] = useState<Device[]>([])
  const [statuses, setStatuses] = useState<Record<string, SessionStatusEvent>>({})
  // Devices with a tile in the grid. Tiles stay after a disconnect until closed.
  const [openIds, setOpenIds] = useState<string[]>([])
  const [page, setPage] = useState(0)
  const [activeId, setActiveId] = useState<string | null>(null)
  // A device whose page should be shown once it is in the open list.
  const [revealId, setRevealId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [prompts, setPrompts] = useState<PromptEntry[]>([])

  const devicesRef = useRef(devices)
  devicesRef.current = devices

  useEffect(() => {
    if (!bridge) return
    void bridge.getVersion().then(setVersion)
    void bridge.settings.get().then(setSettings)
    void bridge.devices.list().then(setDevices)
    return bridge.session.onStatus((event) => {
      setStatuses((s) => ({ ...s, [event.deviceId]: event }))
      writeStatusLine(devicesRef.current.find((d) => d.id === event.deviceId), event)
    })
  }, [])

  // Grid paging. Open tiles are ordered by device number, not by open order.
  const { pageSize } = settings
  const openSet = new Set(openIds)
  const openDevices = devices.filter((d) => openSet.has(d.id))
  const pages = pageCount(openDevices.length, pageSize)
  const currentPage = clampPage(page, openDevices.length, pageSize)
  const pageDevices = pageSlice(openDevices, currentPage, pageSize)
  const shape = gridShape(Math.min(pageSize, openDevices.length))
  const numberOf = (id: string): number => devices.findIndex((d) => d.id === id) + 1
  const statusOf = (id: string) => statuses[id]?.status
  const isLive = (id: string): boolean => statusOf(id) === 'connecting' || statusOf(id) === 'connected'
  const modalOpen = editing !== null || showSettings || prompts.length > 0

  useEffect(() => {
    if (!revealId) return
    const index = openDevices.findIndex((d) => d.id === revealId)
    if (index >= 0) setPage(pageOf(index, pageSize))
    setRevealId(null)
  }, [revealId, openDevices, pageSize])

  useEffect(() => {
    if (!activeId || modalOpen) return
    const frame = requestAnimationFrame(() => focusTerminal(activeId))
    return () => cancelAnimationFrame(frame)
  }, [activeId, currentPage, modalOpen])

  const goToPage = (target: number): void => {
    const next = clampPage(target, openDevices.length, pageSize)
    setPage(next)
    setActiveId(pageSlice(openDevices, next, pageSize)[0]?.id ?? null)
  }
  const goToPageRef = useRef(goToPage)
  goToPageRef.current = goToPage
  const currentPageRef = useRef(currentPage)
  currentPageRef.current = currentPage

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!isAppShortcut(e)) return
      e.preventDefault()
      goToPageRef.current(currentPageRef.current + (e.key === 'PageDown' ? 1 : -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const enqueuePrompt = useCallback((device: Device, message?: string) => {
    setPrompts((q) =>
      q.some((p) => p.device.id === device.id) ? q : [...q, { key: ++promptKey, device, message }]
    )
  }, [])

  const connect = useCallback(
    async (device: Device, secret?: string, reveal = true) => {
      if (!bridge) return
      setOpenIds((ids) => (ids.includes(device.id) ? ids : [...ids, device.id]))
      if (reveal) {
        setActiveId(device.id)
        setRevealId(device.id)
      }
      const term = getTerminal(device.id)
      const result = await bridge.session.connect({ deviceId: device.id, secret, cols: term.cols, rows: term.rows })
      if (result.ok) {
        // The tile was usually fitted while connecting; send the final size.
        bridge.session.resize(device.id, term.cols, term.rows)
      } else if (result.needsSecret) {
        enqueuePrompt(device, secret === undefined ? undefined : result.message)
      }
    },
    [enqueuePrompt]
  )

  const onConnect = (device: Device): void => {
    if (device.auth.type === 'password') enqueuePrompt(device)
    else void connect(device)
  }

  const connectAll = (): void => {
    const targets = devices.filter((d) => !isLive(d.id))
    if (targets.length === 0) return
    setActiveId(targets[0].id)
    for (const d of targets) {
      if (d.auth.type === 'password') enqueuePrompt(d)
      else void connect(d, undefined, false)
    }
    setRevealId(targets[0].id)
  }

  const disconnectAll = (): void => {
    for (const d of devices) if (isLive(d.id)) void bridge?.session.close(d.id)
  }

  const closeTile = (device: Device): void => {
    if (isLive(device.id)) void bridge?.session.close(device.id)
    setOpenIds((ids) => ids.filter((id) => id !== device.id))
    disposeTerminal(device.id)
    if (activeId === device.id) setActiveId(null)
  }

  const onSelect = (device: Device): void => {
    setActiveId(device.id)
    if (openSet.has(device.id)) setRevealId(device.id)
  }

  const onDelete = async (device: Device): Promise<void> => {
    if (!bridge || !window.confirm(`Delete "${device.name}"? This cannot be undone.`)) return
    await bridge.devices.remove(device.id)
    closeTile(device)
    setPrompts((q) => q.filter((p) => p.device.id !== device.id))
    setDevices((ds) => ds.filter((d) => d.id !== device.id))
  }

  const onSaved = (saved: Device): void => {
    setDevices((ds) =>
      ds.some((d) => d.id === saved.id) ? ds.map((d) => (d.id === saved.id ? saved : d)) : [...ds, saved]
    )
    setEditing(null)
    setActiveId(saved.id)
  }

  // Password prompts are handled one at a time, in the order requested.
  const prompt = prompts[0]
  const otherPasswordPrompts = prompt?.device.auth.type === 'password'
    ? prompts.slice(1).filter((p) => p.device.auth.type === 'password')
    : []

  const submitPrompt = (secret: string, useForOthers: boolean): void => {
    const reuse = useForOthers ? otherPasswordPrompts : []
    setPrompts((q) => q.filter((p) => p !== prompt && !reuse.includes(p)))
    void connect(prompt.device, secret)
    for (const p of reuse) void connect(p.device, secret, false)
  }

  const liveCount = devices.filter((d) => isLive(d.id)).length

  return (
    <div className="shell">
      <aside className="devices">
        <div className="devices-header">
          <h2>Devices</h2>
          <button className="primary" onClick={() => setEditing({ device: null })} disabled={!bridge}>
            + Add
          </button>
        </div>
        <div className="bulk-actions">
          <button onClick={connectAll} disabled={!bridge || liveCount === devices.length}>
            Connect all
          </button>
          <button onClick={disconnectAll} disabled={liveCount === 0}>
            Disconnect all
          </button>
        </div>
        <DeviceList
          devices={devices}
          activeId={activeId}
          openIds={openSet}
          statusOf={statusOf}
          onSelect={onSelect}
          onConnect={onConnect}
          onDisconnect={(d) => void bridge?.session.close(d.id)}
          onEdit={(d) => setEditing({ device: d })}
          onDelete={(d) => void onDelete(d)}
        />
        <footer className="sidebar-footer">
          <span className="muted">
            {bridge ? `BulkSSH ${version}` : 'Browser preview: SSH is only available in the BulkSSH app'}
          </span>
          <button onClick={() => setShowSettings(true)} title="Settings" aria-label="Settings">
            ⚙
          </button>
        </footer>
      </aside>

      <main className="workspace">
        <div className="toolbar">
          <Pager page={currentPage} pages={pages} onPage={goToPage} />
          <span className="grow" />
          <span className="muted">
            {liveCount} connected · {openDevices.length} open · {pageSize} per page
          </span>
        </div>
        {pageDevices.length > 0 ? (
          <div
            className="grid"
            style={{
              gridTemplateColumns: `repeat(${shape.cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${shape.rows}, minmax(0, 1fr))`
            }}
          >
            {pageDevices.map((d) => (
              <Tile
                key={d.id}
                device={d}
                number={numberOf(d.id)}
                status={statusOf(d.id)}
                active={d.id === activeId}
                onActivate={() => setActiveId(d.id)}
                onConnect={() => onConnect(d)}
                onDisconnect={() => void bridge?.session.close(d.id)}
                onClose={() => closeTile(d)}
              />
            ))}
          </div>
        ) : (
          <div className="empty">
            <p>{devices.length === 0 ? 'Add a device to get started.' : 'Connect a device to open it here.'}</p>
          </div>
        )}
      </main>

      {editing && <DeviceForm device={editing.device} onSaved={onSaved} onClose={() => setEditing(null)} />}
      {showSettings && (
        <SettingsDialog
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSaved={(s) => {
            setSettings(s)
            setShowSettings(false)
            if (activeId && openSet.has(activeId)) setRevealId(activeId)
          }}
        />
      )}
      {prompt && (
        <SecretPrompt
          key={prompt.key}
          device={prompt.device}
          message={prompt.message}
          othersWaiting={otherPasswordPrompts.length}
          onClose={() => setPrompts((q) => q.filter((p) => p !== prompt))}
          onSubmit={submitPrompt}
        />
      )}
    </div>
  )
}

// Status changes are also written into the device's terminal so the history
// of connects/disconnects stays visible in the scrollback. Tiles that were
// closed have no terminal any more and are skipped.
function writeStatusLine(device: Device | undefined, event: SessionStatusEvent): void {
  if (!device || !hasTerminal(device.id)) return
  const term = getTerminal(device.id)
  const target = `${device.username}@${device.host}:${device.port}`
  switch (event.status) {
    case 'connecting':
      term.write(`\x1b[90mConnecting to ${target}…\x1b[0m\r\n`)
      break
    case 'error':
      term.write(`\x1b[31m${event.message ?? 'Connection failed'}\x1b[0m\r\n`)
      break
    case 'closed':
      term.write(`\r\n\x1b[90m[Disconnected${event.message ? `: ${event.message}` : ''}]\x1b[0m\r\n`)
      break
  }
}
