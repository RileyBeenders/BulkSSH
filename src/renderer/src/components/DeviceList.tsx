import type { Device } from '@shared/device'
import type { SessionStatus } from '@shared/session'

interface Props {
  devices: Device[]
  selectedId: string | null
  statusOf: (id: string) => SessionStatus | undefined
  onSelect: (device: Device) => void
  onConnect: (device: Device) => void
  onDisconnect: (device: Device) => void
  onEdit: (device: Device) => void
  onDelete: (device: Device) => void
}

export function DeviceList(props: Props): React.JSX.Element {
  const { devices, selectedId, statusOf } = props
  if (devices.length === 0) return <p className="muted">No devices yet.</p>

  return (
    <ul className="device-list">
      {devices.map((d, i) => {
        const status = statusOf(d.id)
        const live = status === 'connecting' || status === 'connected'
        return (
          <li
            key={d.id}
            className={d.id === selectedId ? 'selected' : undefined}
            onClick={() => props.onSelect(d)}
          >
            <span className="num">{i + 1}</span>
            <span className={`dot ${status ?? 'idle'}`} title={status ?? 'not connected'} />
            <span className="label">
              <span className="name">{d.name}</span>
              <span className="addr">
                {d.username}@{d.host}
                {d.port !== 22 && `:${d.port}`}
              </span>
            </span>
            <span className="row-actions" onClick={(e) => e.stopPropagation()}>
              {live ? (
                <button onClick={() => props.onDisconnect(d)}>Disconnect</button>
              ) : (
                <button className="primary" onClick={() => props.onConnect(d)}>
                  Connect
                </button>
              )}
              <button onClick={() => props.onEdit(d)} aria-label={`Edit ${d.name}`}>
                Edit
              </button>
              <button onClick={() => props.onDelete(d)} aria-label={`Delete ${d.name}`}>
                ✕
              </button>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
