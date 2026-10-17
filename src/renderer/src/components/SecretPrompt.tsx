import { useState, type FormEvent } from 'react'
import type { Device } from '@shared/device'
import { Modal } from './Modal'

interface Props {
  device: Device
  message?: string
  onSubmit: (secret: string) => void
  onClose: () => void
}

// Asks for a password or key passphrase. The value goes straight to the
// connect call and is not kept anywhere in the UI state afterwards.
export function SecretPrompt({ device, message, onSubmit, onClose }: Props): React.JSX.Element {
  const [secret, setSecret] = useState('')
  const isKey = device.auth.type === 'key'

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    onSubmit(secret)
  }

  return (
    <Modal title={isKey ? 'Key passphrase' : 'Password'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="muted">
          {isKey ? 'Passphrase for the key used by ' : 'Password for '}
          <strong>
            {device.username}@{device.host}
          </strong>
        </p>
        {message && <p className="errors">{message}</p>}
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          aria-label={isKey ? 'Passphrase' : 'Password'}
          autoFocus
        />
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Connect
          </button>
        </div>
      </form>
    </Modal>
  )
}
