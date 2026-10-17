import { useState, type FormEvent } from 'react'
import type { Device } from '@shared/device'
import { Modal } from './Modal'

interface Props {
  device: Device
  message?: string
  // Other devices waiting for a password; offers to reuse this one for them.
  othersWaiting: number
  onSubmit: (secret: string, useForOthers: boolean) => void
  onClose: () => void
}

// Asks for a password or key passphrase. The value goes straight to the
// connect call and is not kept anywhere in the UI state afterwards.
export function SecretPrompt({ device, message, othersWaiting, onSubmit, onClose }: Props): React.JSX.Element {
  const [secret, setSecret] = useState('')
  const [useForOthers, setUseForOthers] = useState(false)
  const isKey = device.auth.type === 'key'

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    onSubmit(secret, useForOthers)
  }

  return (
    <Modal title={isKey ? 'Key passphrase' : 'Password'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="muted">
          {isKey ? 'Passphrase for the key used by ' : 'Password for '}
          <strong>
            {device.username}@{device.host}
          </strong>{' '}
          ({device.name})
        </p>
        {message && <p className="errors">{message}</p>}
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          aria-label={isKey ? 'Passphrase' : 'Password'}
          autoFocus
        />
        {!isKey && othersWaiting > 0 && (
          <label className="inline">
            <input type="checkbox" checked={useForOthers} onChange={(e) => setUseForOthers(e.target.checked)} />
            Also use for the other {othersWaiting} device{othersWaiting === 1 ? '' : 's'} waiting for a password
          </label>
        )}
        <div className="actions">
          <button type="button" onClick={onClose}>
            {othersWaiting > 0 ? 'Skip' : 'Cancel'}
          </button>
          <button type="submit" className="primary">
            Connect
          </button>
        </div>
      </form>
    </Modal>
  )
}
