import { useCallback, useEffect, useRef, useState } from 'react'
import { dangerReasons, LineTracker } from '@shared/danger'
import type { Device } from '@shared/device'
import { isTerminalReport, mirrorTargets } from '@shared/mirror'
import { clampPage, gridShape, pageCount, pageOf, pageSlice } from '@shared/paging'
import type { ExecResult, SessionStatusEvent } from '@shared/session'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import { bridge } from './bridge'
import { BroadcastBar } from './components/BroadcastBar'
import { formatResults, type BroadcastRun } from './broadcast'
import { BroadcastResults } from './components/BroadcastResults'
import { ConfirmDanger, type DangerConfirmation } from './components/ConfirmDanger'
import { ConfirmDelete } from './components/ConfirmDelete'
import { DeviceForm, type DeviceFormResult } from './components/DeviceForm'
import { DeviceList } from './components/DeviceList'
import { Pager } from './components/Pager'
import { SecretPrompt } from './components/SecretPrompt'
import { SettingsDialog } from './components/SettingsDialog'
import { Tile } from './components/Tile'
import {
  bufferText,
  disposeTerminal,
  focusTerminal,
  getTerminal,
  hasTerminal,
  isAppShortcut,
  setInputHandler
} from './terminals'

type Editing = { device: Device | null } | null
interface PromptEntry {
  key: number
  device: Device
  message?: string
  // Queued by a bulk action (Connect all, adding several devices): offer the
  // same password for the rest of the queue by default.
  bulk?: boolean
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
  // "Edit list" mode: pick several devices to delete at once.
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Devices that receive mirrored keystrokes and broadcast commands.
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const [mirrorOn, setMirrorOn] = useState(false)
  // Focus view: one device full size instead of the grid.
  const [focusId, setFocusId] = useState<string | null>(null)
  const mirrorBeforeFocus = useRef(false)
  const [broadcast, setBroadcast] = useState<BroadcastRun | null>(null)
  const broadcastId = useRef(0)
  // A risky command waiting for confirmation, and what to do if confirmed.
  const [confirmation, setConfirmation] = useState<(DangerConfirmation & { run: () => void }) | null>(null)
  // Saved-password state; the secrets themselves stay in the main process.
  const [savedSecrets, setSavedSecrets] = useState<ReadonlySet<string>>(new Set())
  const [canRemember, setCanRemember] = useState(false)
  // One command-line tracker per device, to check lines typed while mirroring.
  const trackers = useRef(new Map<string, LineTracker>())

  const devicesRef = useRef(devices)
  devicesRef.current = devices

  useEffect(() => {
    if (!bridge) return
    void bridge.getVersion().then(setVersion)
    void bridge.settings.get().then(setSettings)
    void bridge.devices.list().then(setDevices)
    void refreshCredentials()
    // After a reload (e.g. the page crashed) sessions may still be live in the
    // main process: show them again.
    void bridge.session.list().then((live) => {
      if (live.length === 0) return
      setStatuses((s) => ({ ...s, ...Object.fromEntries(live.map((e) => [e.deviceId, e])) }))
      setOpenIds((ids) => [...new Set([...ids, ...live.map((e) => e.deviceId)])])
    })
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
  const isLive = (id: string): boolean => {
    const s = statusOf(id)
    return s === 'connecting' || s === 'connected' || s === 'reconnecting'
  }
  const isConnected = (id: string): boolean => statusOf(id) === 'connected'
  const modalOpen = editing !== null || showSettings || prompts.length > 0 || confirmation !== null || confirmDelete

  useEffect(() => {
    if (!revealId) return
    const index = openDevices.findIndex((d) => d.id === revealId)
    if (index >= 0) setPage(pageOf(index, pageSize))
    setRevealId(null)
  }, [revealId, openDevices, pageSize])

  const focusDevice = focusId && openSet.has(focusId) ? (devices.find((d) => d.id === focusId) ?? null) : null

  useEffect(() => {
    if (!activeId || modalOpen) return
    const frame = requestAnimationFrame(() => focusTerminal(activeId))
    return () => cancelAnimationFrame(frame)
  }, [activeId, currentPage, modalOpen, focusDevice])

  const goToPage = (target: number): void => {
    const next = clampPage(target, openDevices.length, pageSize)
    setPage(next)
    setActiveId(pageSlice(openDevices, next, pageSize)[0]?.id ?? null)
  }

  // Entering focus view turns mirroring off so typing reaches only the focused
  // device. Leaving restores the previous setting, unless mirroring was
  // switched on again while in focus view.
  const enterFocus = (deviceId: string): void => {
    if (!focusDevice) {
      mirrorBeforeFocus.current = mirrorOn
      setMirrorOn(false)
    }
    setFocusId(deviceId)
    setActiveId(deviceId)
  }
  const exitFocus = (): void => {
    if (!focusDevice) return
    if (!mirrorOn) setMirrorOn(mirrorBeforeFocus.current)
    setFocusId(null)
    setActiveId(focusDevice.id)
    setRevealId(focusDevice.id)
  }
  // In focus view, step to the previous/next open device.
  const stepFocus = (delta: number): void => {
    if (!focusDevice || openDevices.length === 0) return
    const index = openDevices.findIndex((d) => d.id === focusDevice.id)
    const next = openDevices[(index + delta + openDevices.length) % openDevices.length]
    setFocusId(next.id)
    setActiveId(next.id)
  }

  const handleShortcut = (e: KeyboardEvent): void => {
    if (e.code === 'KeyM') setMirrorOn((on) => !on)
    else if (e.code === 'KeyF') {
      if (focusDevice) exitFocus()
      else if (activeId && openSet.has(activeId)) enterFocus(activeId)
    } else {
      const delta = e.key === 'PageDown' ? 1 : -1
      if (focusDevice) stepFocus(delta)
      else goToPage(currentPage + delta)
    }
  }
  const shortcutRef = useRef(handleShortcut)
  shortcutRef.current = handleShortcut
  const modalOpenRef = useRef(modalOpen)
  modalOpenRef.current = modalOpen

  // Mirror routing. Typed input always goes to the tile it was typed in (the
  // driver); with mirroring on it also goes to every other checked, connected
  // device. Terminal replies (cursor reports, mouse events…) are never mirrored.
  const mirrorState = useRef({ mirrorOn, checked, isConnected })
  mirrorState.current = { mirrorOn, checked, isConnected }
  useEffect(() => {
    setInputHandler((deviceId, data) => {
      if (!bridge) return
      const m = mirrorState.current
      if (isTerminalReport(data)) return bridge.session.write(deviceId, data)

      let tracker = trackers.current.get(deviceId)
      if (!tracker) trackers.current.set(deviceId, (tracker = new LineTracker()))
      const targets = m.mirrorOn ? mirrorTargets(deviceId, m.checked, m.isConnected) : []
      const send = (): void => {
        tracker.commit(data)
        if (targets.length > 0) bridge?.session.writeMany([deviceId, ...targets], data)
        else bridge?.session.write(deviceId, data)
      }
      if (targets.length === 0) return send()

      // Mirrored: hold an Enter that would run a risky line on several devices.
      const risky = tracker.preview(data).map((l) => ({ ...l, reasons: dangerReasons(l.line) })).filter((l) => l.reasons.length > 0)
      if (risky.length === 0) return send()
      const all = devicesRef.current
      setConfirmation({
        kind: 'mirror',
        command: risky.map((l) => l.line).join('\n'),
        reasons: [...new Set(risky.flatMap((l) => l.reasons))],
        uncertain: risky.some((l) => !l.known),
        targets: [deviceId, ...targets].map((id) => ({
          number: all.findIndex((d) => d.id === id) + 1,
          name: all.find((d) => d.id === id)?.name ?? id
        })),
        run: send
      })
    })
  }, [])

  const refreshCredentials = async (): Promise<void> => {
    if (!bridge) return
    const status = await bridge.credentials.status()
    setCanRemember(status.available)
    setSavedSecrets(new Set(status.saved))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!isAppShortcut(e) || modalOpenRef.current) return
      e.preventDefault()
      shortcutRef.current(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const enqueuePrompt = useCallback((device: Device, message?: string, bulk = false) => {
    setPrompts((q) =>
      q.some((p) => p.device.id === device.id) ? q : [...q, { key: ++promptKey, device, message, bulk }]
    )
  }, [])

  const connect = useCallback(
    async (device: Device, secret?: string, reveal = true, remember?: boolean) => {
      if (!bridge) return
      setOpenIds((ids) => (ids.includes(device.id) ? ids : [...ids, device.id]))
      if (reveal) {
        setActiveId(device.id)
        setRevealId(device.id)
      }
      const term = getTerminal(device.id)
      const result = await bridge.session.connect({ deviceId: device.id, secret, remember, cols: term.cols, rows: term.rows })
      if (remember !== undefined || !result.ok) void refreshCredentials()
      if (result.ok) {
        // The tile was usually fitted while connecting; send the final size.
        bridge.session.resize(device.id, term.cols, term.rows)
      } else if (result.needsSecret) {
        enqueuePrompt(device, secret === undefined ? undefined : result.message)
      }
    },
    [enqueuePrompt]
  )

  // Password devices are prompted for, unless a password is saved.
  const needsPrompt = (device: Device): boolean => device.auth.type === 'password' && !savedSecrets.has(device.id)

  const onConnect = (device: Device): void => {
    if (needsPrompt(device)) enqueuePrompt(device)
    else void connect(device)
  }

  // Connects several devices: key-based and saved-password ones straight
  // away, the rest through one queue of password prompts.
  const connectMany = (list: Device[]): void => {
    const targets = list.filter((d) => !isLive(d.id))
    if (targets.length === 0) return
    setActiveId(targets[0].id)
    for (const d of targets) {
      if (needsPrompt(d)) enqueuePrompt(d, undefined, targets.length > 1)
      else void connect(d, undefined, false)
    }
    setRevealId(targets[0].id)
  }

  const connectAll = (): void => connectMany(devices)

  const disconnectAll = (): void => {
    for (const d of devices) if (isLive(d.id)) void bridge?.session.close(d.id)
  }

  const closeTile = (device: Device): void => {
    if (isLive(device.id)) void bridge?.session.close(device.id)
    setOpenIds((ids) => ids.filter((id) => id !== device.id))
    disposeTerminal(device.id)
    if (activeId === device.id) setActiveId(null)
    if (focusId === device.id) {
      if (!mirrorOn) setMirrorOn(mirrorBeforeFocus.current)
      setFocusId(null)
    }
  }

  const toggleChecked = (device: Device): void => {
    setChecked((set) => {
      const next = new Set(set)
      if (next.has(device.id)) next.delete(device.id)
      else next.add(device.id)
      return next
    })
  }
  const checkAll = (): void => setChecked(new Set(devices.map((d) => d.id)))
  const checkNone = (): void => setChecked(new Set())
  const checkInvert = (): void => setChecked((set) => new Set(devices.filter((d) => !set.has(d.id)).map((d) => d.id)))

  const broadcastTargets = devices.filter((d) => checked.has(d.id) && isConnected(d.id))
  const driver = activeId && openSet.has(activeId) ? devices.find((d) => d.id === activeId) ?? null : null
  const liveMirrorTargets = mirrorOn && driver ? mirrorTargets(driver.id, checked, isConnected) : []
  const mirrorRole = (id: string): 'driver' | 'target' | null => {
    if (liveMirrorTargets.length === 0) return null
    if (id === driver?.id) return 'driver'
    return liveMirrorTargets.includes(id) ? 'target' : null
  }

  // Runs the command on every target in parallel; each row fills in as its
  // device answers, so one slow or failing device never holds up the rest.
  const runBroadcast = (command: string): void => {
    const reasons = dangerReasons(command)
    if (reasons.length === 0) return startBroadcast(command)
    setConfirmation({
      kind: 'broadcast',
      command,
      reasons,
      targets: broadcastTargets.map((d) => ({ number: numberOf(d.id), name: d.name })),
      run: () => startBroadcast(command)
    })
  }

  const startBroadcast = (command: string): void => {
    if (!bridge) return
    const id = ++broadcastId.current
    setBroadcast({
      id,
      command,
      rows: broadcastTargets.map((d) => ({ deviceId: d.id, number: numberOf(d.id), name: d.name }))
    })
    for (const d of broadcastTargets) {
      bridge.session
        .exec(d.id, command)
        .catch((err: unknown): ExecResult => ({ ok: false, message: String(err), durationMs: 0 }))
        .then((result) =>
          setBroadcast((run) =>
            run && run.id === id
              ? { ...run, rows: run.rows.map((r) => (r.deviceId === d.id ? { ...r, result } : r)) }
              : run
          )
        )
    }
  }

  const onSelect = (device: Device): void => {
    setActiveId(device.id)
    if (openSet.has(device.id)) setRevealId(device.id)
  }

  const onDelete = async (device: Device): Promise<void> => {
    if (!bridge || !window.confirm(`Delete "${device.name}"? This cannot be undone.`)) return
    await bridge.devices.remove(device.id)
    forgetDevices([device])
  }

  // Deletes the devices selected in "Edit list" mode (after confirmation).
  const deleteSelected = async (): Promise<void> => {
    if (!bridge) return
    const doomed = devices.filter((d) => selected.has(d.id))
    setConfirmDelete(false)
    await bridge.devices.removeMany(doomed.map((d) => d.id))
    forgetDevices(doomed)
    setSelected(new Set())
    if (doomed.length === devices.length) setSelecting(false)
  }

  // Drops deleted devices from every piece of UI state. (The main process
  // has already disconnected them and forgotten their saved secrets.)
  const forgetDevices = (gone: Device[]): void => {
    const ids = new Set(gone.map((d) => d.id))
    for (const d of gone) {
      closeTile(d)
      trackers.current.delete(d.id)
    }
    const keep = (id: string): boolean => !ids.has(id)
    setPrompts((q) => q.filter((p) => keep(p.device.id)))
    setChecked((set) => new Set([...set].filter(keep)))
    setSelected((set) => new Set([...set].filter(keep)))
    setDevices((ds) => ds.filter((d) => keep(d.id)))
    void refreshCredentials()
  }

  const toggleSelected = (device: Device): void => {
    setSelected((set) => {
      const next = new Set(set)
      if (next.has(device.id)) next.delete(device.id)
      else next.add(device.id)
      return next
    })
  }

  const stopSelecting = (): void => {
    setSelecting(false)
    setSelected(new Set())
  }

  const onSaved = ({ devices: saved, connect: connectNow }: DeviceFormResult): void => {
    setDevices((ds) => {
      const next = ds.map((d) => saved.find((s) => s.id === d.id) ?? d)
      return [...next, ...saved.filter((s) => !ds.some((d) => d.id === s.id))]
    })
    setEditing(null)
    if (saved.length > 0) setActiveId(saved[0].id)
    if (connectNow) connectMany(saved)
  }

  // Password prompts are handled one at a time, in the order requested.
  const prompt = prompts[0]
  const otherPasswordPrompts = prompt?.device.auth.type === 'password'
    ? prompts.slice(1).filter((p) => p.device.auth.type === 'password')
    : []

  const submitPrompt = (secret: string, useForOthers: boolean, remember: boolean): void => {
    const reuse = useForOthers ? otherPasswordPrompts : []
    setPrompts((q) => q.filter((p) => p !== prompt && !reuse.includes(p)))
    void connect(prompt.device, secret, true, remember)
    for (const p of reuse) void connect(p.device, secret, false, remember)
  }

  const liveCount = devices.filter((d) => isLive(d.id)).length

  const exportTerminal = async (d: Device): Promise<void> => {
    if (!bridge || !hasTerminal(d.id)) return
    await bridge.files.saveText(`${fileSafe(d.name)}-${timestamp()}.txt`, bufferText(d.id))
  }

  const exportBroadcast = async (run: BroadcastRun): Promise<void> => {
    await bridge?.files.saveText(`broadcast-${timestamp()}.txt`, formatResults(run))
  }

  const renderTile = (d: Device, focused: boolean): React.JSX.Element => (
    <Tile
      key={d.id}
      device={d}
      number={numberOf(d.id)}
      status={statusOf(d.id)}
      active={d.id === activeId}
      focused={focused}
      mirror={mirrorRole(d.id)}
      onActivate={() => setActiveId(d.id)}
      onToggleFocus={() => (focused ? exitFocus() : enterFocus(d.id))}
      onConnect={() => onConnect(d)}
      onDisconnect={() => void bridge?.session.close(d.id)}
      onClose={() => closeTile(d)}
      onExport={() => void exportTerminal(d)}
    />
  )

  return (
    <div className="shell">
      <aside className="devices">
        {selecting ? (
          <>
            <div className="devices-header">
              <h2>Edit list</h2>
              <button className="primary" onClick={stopSelecting}>
                Done
              </button>
            </div>
            <div className="send-to-actions">
              <span className="muted">{selected.size} selected:</span>
              <button onClick={() => setSelected(new Set(devices.map((d) => d.id)))} disabled={devices.length === 0}>
                All
              </button>
              <button onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
                None
              </button>
              <button
                onClick={() => setSelected((set) => new Set(devices.filter((d) => !set.has(d.id)).map((d) => d.id)))}
                disabled={devices.length === 0}
              >
                Invert
              </button>
            </div>
            <div className="bulk-actions">
              <button className="danger-button" onClick={() => setConfirmDelete(true)} disabled={selected.size === 0}>
                Delete {selected.size > 0 ? `${selected.size} ` : ''}selected
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="devices-header">
              <h2>Devices</h2>
              <span className="header-buttons">
                <button
                  onClick={() => setSelecting(true)}
                  disabled={devices.length === 0}
                  title="Select several devices to delete them at once"
                >
                  Edit list
                </button>
                <button className="primary" onClick={() => setEditing({ device: null })} disabled={!bridge}>
                  + Add
                </button>
              </span>
            </div>
            <div className="bulk-actions">
              <button onClick={connectAll} disabled={!bridge || liveCount === devices.length}>
                Connect all
              </button>
              <button onClick={disconnectAll} disabled={liveCount === 0}>
                Disconnect all
              </button>
            </div>
            <div className="send-to-actions">
              <span className="muted">Send to {checked.size}:</span>
              <button onClick={checkAll} disabled={devices.length === 0}>
                All
              </button>
              <button onClick={checkNone} disabled={checked.size === 0}>
                None
              </button>
              <button onClick={checkInvert} disabled={devices.length === 0}>
                Invert
              </button>
            </div>
          </>
        )}
        <DeviceList
          devices={devices}
          activeId={activeId}
          openIds={openSet}
          checked={checked}
          onToggleChecked={toggleChecked}
          savedSecrets={savedSecrets}
          selecting={selecting}
          selected={selected}
          onToggleSelected={toggleSelected}
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
        {focusDevice ? (
          <>
            <div className="toolbar">
              <button onClick={exitFocus} title="Back to the grid (Ctrl+Shift+F)">
                ← Grid
              </button>
              <span className="muted">
                Focus: {openDevices.findIndex((d) => d.id === focusDevice.id) + 1} of {openDevices.length} open
                devices · Ctrl+PageUp/PageDown for the previous/next one
              </span>
              <span className="grow" />
              <span className="muted">{liveCount} connected</span>
            </div>
            <div className="focus-view">{renderTile(focusDevice, true)}</div>
          </>
        ) : (
          <>
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
                {pageDevices.map((d) => renderTile(d, false))}
              </div>
            ) : (
              <div className="empty">
                <p>{devices.length === 0 ? 'Add a device to get started.' : 'Connect a device to open it here.'}</p>
              </div>
            )}
          </>
        )}
        {broadcast && (
          <BroadcastResults run={broadcast} onClose={() => setBroadcast(null)} onExport={() => void exportBroadcast(broadcast)} />
        )}
        <BroadcastBar
          mirrorOn={mirrorOn}
          onToggleMirror={() => setMirrorOn((on) => !on)}
          driverName={driver?.name ?? null}
          mirrorCount={driver ? liveMirrorTargets.length : mirrorTargets('', checked, isConnected).length}
          targetCount={broadcastTargets.length}
          running={!!broadcast?.rows.some((r) => !r.result)}
          onRun={runBroadcast}
        />
      </main>

      {editing && (
        <DeviceForm
          device={editing.device}
          existing={devices}
          hasSavedSecret={!!editing.device && savedSecrets.has(editing.device.id)}
          onForgetSecret={async (id) => {
            await bridge?.credentials.forget(id)
            await refreshCredentials()
          }}
          onSaved={onSaved}
          onClose={() => setEditing(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmDelete
          devices={devices
            .filter((d) => selected.has(d.id))
            .map((d) => ({ device: d, number: numberOf(d.id), live: isLive(d.id), savedSecret: savedSecrets.has(d.id) }))}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void deleteSelected()}
        />
      )}
      {confirmation && (
        <ConfirmDanger
          confirmation={confirmation}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            setConfirmation(null)
            confirmation.run()
          }}
        />
      )}
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
          defaultUseForOthers={!!prompt.bulk}
          onClose={() => setPrompts((q) => q.filter((p) => p !== prompt))}
          onSubmit={submitPrompt}
          canRemember={canRemember}
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
    case 'reconnecting':
      term.write(`\r\n\x1b[33m${event.message ?? 'Reconnecting…'}\x1b[0m\r\n`)
      break
    case 'closed':
      term.write(`\r\n\x1b[90m[Disconnected${event.message ? `: ${event.message}` : ''}]\x1b[0m\r\n`)
      break
  }
}

function timestamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
}

function fileSafe(name: string): string {
  return name.replace(/[^\w.-]+/g, '_') || 'device'
}
