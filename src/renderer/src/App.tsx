import { useCallback, useEffect, useRef, useState } from 'react'
import type { Device } from '@shared/device'
import type { SessionStatusEvent } from '@shared/session'
import { bridge } from './bridge'
import { DeviceForm } from './components/DeviceForm'
import { DeviceList } from './components/DeviceList'
import { SecretPrompt } from './components/SecretPrompt'
import { TerminalView } from './components/TerminalView'
import { disposeTerminal, getTerminal } from './terminals'

type Editing = { device: Device | null } | null
type Prompt = { device: Device; message?: string } | null

const STATUS_TEXT = {
  connecting: 'Connecting…',
  connected: 'Connected',
  closed: 'Disconnected',
  error: 'Error'
} as const

export function App(): React.JSX.Element {
  const [version, setVersion] = useState('')
  const [devices, setDevices] = useState<Device[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [statuses, setStatuses] = useState<Record<string, SessionStatusEvent>>({})
  const [editing, setEditing] = useState<Editing>(null)
  const [prompt, setPrompt] = useState<Prompt>(null)
  const devicesRef = useRef(devices)
  devicesRef.current = devices

  useEffect(() => {
    if (!bridge) return
    void bridge.getVersion().then(setVersion)
    void bridge.devices.list().then(setDevices)
    return bridge.session.onStatus((event) => {
      setStatuses((s) => ({ ...s, [event.deviceId]: event }))
      writeStatusLine(devicesRef.current.find((d) => d.id === event.deviceId), event)
    })
  }, [])

  const connect = useCallback(async (device: Device, secret?: string) => {
    if (!bridge) return
    setSelectedId(device.id)
    const term = getTerminal(device.id)
    const result = await bridge.session.connect({
      deviceId: device.id,
      secret,
      cols: term.cols,
      rows: term.rows
    })
    if (result.ok) {
      // The terminal may have been fitted while connecting; sync the final size.
      bridge.session.resize(device.id, term.cols, term.rows)
      term.focus()
    } else if (result.needsSecret) {
      setPrompt({ device, message: secret === undefined ? undefined : result.message })
    }
  }, [])

  const onConnect = (device: Device): void => {
    if (device.auth.type === 'password') setPrompt({ device })
    else void connect(device)
  }

  const onDelete = async (device: Device): Promise<void> => {
    if (!bridge || !window.confirm(`Delete "${device.name}"? This cannot be undone.`)) return
    await bridge.devices.remove(device.id)
    disposeTerminal(device.id)
    setDevices((ds) => ds.filter((d) => d.id !== device.id))
    if (selectedId === device.id) setSelectedId(null)
  }

  const onSaved = (saved: Device): void => {
    setDevices((ds) =>
      ds.some((d) => d.id === saved.id) ? ds.map((d) => (d.id === saved.id ? saved : d)) : [...ds, saved]
    )
    setEditing(null)
    setSelectedId(saved.id)
  }

  const selected = devices.find((d) => d.id === selectedId) ?? null
  const selectedStatus = selected ? statuses[selected.id] : undefined
  const live = selectedStatus?.status === 'connecting' || selectedStatus?.status === 'connected'

  return (
    <div className="shell">
      <aside className="devices">
        <div className="devices-header">
          <h2>Devices</h2>
          <button className="primary" onClick={() => setEditing({ device: null })} disabled={!bridge}>
            + Add
          </button>
        </div>
        <DeviceList
          devices={devices}
          selectedId={selectedId}
          statusOf={(id) => statuses[id]?.status}
          onSelect={(d) => setSelectedId(d.id)}
          onConnect={onConnect}
          onDisconnect={(d) => void bridge?.session.close(d.id)}
          onEdit={(d) => setEditing({ device: d })}
          onDelete={(d) => void onDelete(d)}
        />
        <p className="muted version">
          {bridge ? `BulkSSH ${version}` : 'Browser preview: SSH is only available in the BulkSSH app'}
        </p>
      </aside>

      <main className="workspace">
        {selected ? (
          <>
            <header className="session-header">
              <span className="name">{selected.name}</span>
              <span className="muted">
                {selected.username}@{selected.host}:{selected.port}
              </span>
              <span className={`status ${selectedStatus?.status ?? 'idle'}`}>
                {selectedStatus ? STATUS_TEXT[selectedStatus.status] : 'Not connected'}
              </span>
              <span className="grow" />
              {live ? (
                <button onClick={() => void bridge?.session.close(selected.id)}>Disconnect</button>
              ) : (
                <button className="primary" onClick={() => onConnect(selected)}>
                  Connect
                </button>
              )}
            </header>
            <TerminalView deviceId={selected.id} />
          </>
        ) : (
          <div className="empty">
            <p>{devices.length === 0 ? 'Add a device to get started.' : 'Select a device.'}</p>
          </div>
        )}
      </main>

      {editing && (
        <DeviceForm device={editing.device} onSaved={onSaved} onClose={() => setEditing(null)} />
      )}
      {prompt && (
        <SecretPrompt
          device={prompt.device}
          message={prompt.message}
          onClose={() => setPrompt(null)}
          onSubmit={(secret) => {
            setPrompt(null)
            void connect(prompt.device, secret)
          }}
        />
      )}
    </div>
  )
}

// Status changes are also written into the device's terminal so the history
// of connects/disconnects stays visible in the scrollback.
function writeStatusLine(device: Device | undefined, event: SessionStatusEvent): void {
  if (!device) return
  const term = getTerminal(device.id)
  const target = `${device.username}@${device.host}:${device.port}`
  switch (event.status) {
    case 'connecting':
      term.write(`\r\n\x1b[90mConnecting to ${target}…\x1b[0m\r\n`)
      break
    case 'error':
      term.write(`\x1b[31m${event.message ?? 'Connection failed'}\x1b[0m\r\n`)
      break
    case 'closed':
      term.write(`\r\n\x1b[90m[Disconnected${event.message ? `: ${event.message}` : ''}]\x1b[0m\r\n`)
      break
  }
}
