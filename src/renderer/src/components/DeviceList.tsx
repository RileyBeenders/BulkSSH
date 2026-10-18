import type { Device } from '@shared/device'
import type { SessionStatus } from '@shared/session'

interface Props {
  devices: Device[]
  activeId: string | null
  openIds: ReadonlySet<string>
  checked: ReadonlySet<string>
  onToggleChecked: (device: Device) => void
  savedSecrets: ReadonlySet<string>
  // "Edit list" mode: rows show a selection checkbox instead of the send-to
  // checkbox and buttons, and clicking a row toggles its selection.
  selecting: boolean
  selected: ReadonlySet<string>
  onToggleSelected: (device: Device) => void
  statusOf: (id: string) => SessionStatus | undefined
  onSelect: (device: Device) => void
  onConnect: (device: Device) => void
  onDisconnect: (device: Device) => void
  onEdit: (device: Device) => void
  onDelete: (device: Device) => void
}

export function DeviceList(props: Props): React.JSX.Element {
  const { devices, activeId, openIds, checked, statusOf, selecting, selected } = props
  if (devices.length === 0) return <p className="muted">No devices yet.</p>

  return (
    <ul className="device-list">
      {devices.map((d, i) => {
        const status = statusOf(d.id)
        const live = status === 'connecting' || status === 'connected' || status === 'reconnecting'
        const classes = [
          !selecting && d.id === activeId && 'selected',
          openIds.has(d.id) && 'open',
          selecting && selected.has(d.id) && 'marked'
        ]
          .filter(Boolean)
          .join(' ')
        return (
          <li
            key={d.id}
            className={classes || undefined}
            onClick={() => (selecting ? props.onToggleSelected(d) : props.onSelect(d))}
          >
            {selecting ? (
              <input
                type="checkbox"
                className="select"
                checked={selected.has(d.id)}
                onChange={() => props.onToggleSelected(d)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Select ${d.name}`}
              />
            ) : (
              <input
                type="checkbox"
                className="send-to"
                checked={checked.has(d.id)}
                onChange={() => props.onToggleChecked(d)}
                onClick={(e) => e.stopPropagation()}
                title="Send mirrored keystrokes and broadcasts to this device"
                aria-label={`Send to ${d.name}`}
              />
            )}
            <span className="num">{i + 1}</span>
            <span className={`dot ${status ?? 'idle'}`} title={status ?? 'not connected'} />
            <span className="label">
              <span className="name">
                {d.name}
                {props.savedSecrets.has(d.id) && (
                  <span className="saved-secret" title="Password or passphrase saved (encrypted by Windows)">
                    {' '}
                    🔑
                  </span>
                )}
              </span>
              <span className="addr">
                {d.username}@{d.host}
                {d.port !== 22 && `:${d.port}`}
              </span>
            </span>
            {!selecting && (
              <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                {live ? (
                  <button onClick={() => props.onDisconnect(d)} title="Disconnect" aria-label={`Disconnect ${d.name}`}>
                    ■
                  </button>
                ) : (
                  <button className="primary" onClick={() => props.onConnect(d)} title="Connect" aria-label={`Connect ${d.name}`}>
                    ▶
                  </button>
                )}
                <button onClick={() => props.onEdit(d)} title="Edit" aria-label={`Edit ${d.name}`}>
                  ✎
                </button>
                <button onClick={() => props.onDelete(d)} title="Delete" aria-label={`Delete ${d.name}`}>
                  ✕
                </button>
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
