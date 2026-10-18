import type { Device } from '@shared/device'
import { Modal } from './Modal'

interface Props {
  devices: { device: Device; number: number; live: boolean; savedSecret: boolean }[]
  onConfirm: () => void
  onCancel: () => void
}

const LISTED = 12

// Confirms deleting several devices at once. Cancel has the focus.
export function ConfirmDelete({ devices, onConfirm, onCancel }: Props): React.JSX.Element {
  const n = devices.length
  const live = devices.filter((d) => d.live).length
  const saved = devices.filter((d) => d.savedSecret).length

  return (
    <Modal title={`Delete ${n} device${n === 1 ? '' : 's'}?`} onClose={onCancel}>
      <div className="form">
        <ul className="delete-list">
          {devices.slice(0, LISTED).map(({ device, number }) => (
            <li key={device.id}>
              <span className="num">{number}</span>
              <span className="name">{device.name}</span>
              <span className="addr">
                {device.username}@{device.host}
                {device.port !== 22 && `:${device.port}`}
              </span>
            </li>
          ))}
        </ul>
        {n > LISTED && <p className="muted">and {n - LISTED} more</p>}
        {live > 0 && (
          <p className="muted">
            {live} of them {live === 1 ? 'is' : 'are'} connected and will be disconnected.
          </p>
        )}
        {saved > 0 && (
          <p className="muted">
            Saved passwords for {saved === n ? (n === 1 ? 'it' : 'them') : `${saved} of them`} will be forgotten.
          </p>
        )}
        <p className="muted">This can't be undone.</p>
        <div className="actions">
          <button type="button" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button type="button" className="danger-button" onClick={onConfirm}>
            Delete {n} device{n === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
