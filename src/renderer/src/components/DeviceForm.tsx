import { useState, type FormEvent } from 'react'
import { DEFAULT_SSH_PORT, validateDevice, type Device, type DeviceInput } from '@shared/device'
import { bridge } from '../bridge'
import { Modal } from './Modal'

interface Props {
  device: Device | null // null = new device
  hasSavedSecret: boolean
  onForgetSecret: (deviceId: string) => Promise<void>
  onSaved: (device: Device) => void
  onClose: () => void
}

export function DeviceForm({ device, hasSavedSecret, onForgetSecret, onSaved, onClose }: Props): React.JSX.Element {
  const [name, setName] = useState(device?.name ?? '')
  const [host, setHost] = useState(device?.host ?? '')
  const [port, setPort] = useState(String(device?.port ?? DEFAULT_SSH_PORT))
  const [username, setUsername] = useState(device?.username ?? '')
  const [authType, setAuthType] = useState(device?.auth.type ?? 'password')
  const [keyPath, setKeyPath] = useState(device?.auth.type === 'key' ? device.auth.keyPath : '')
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const input: DeviceInput = {
      ...(device ? { id: device.id } : {}),
      name,
      host,
      port: Number(port),
      username,
      auth: authType === 'key' ? { type: 'key', keyPath } : { type: 'password' }
    }
    const problems = validateDevice(input)
    if (problems.length > 0) return setErrors(problems)
    if (!bridge) return setErrors(['Saving devices only works in the BulkSSH app'])

    setSaving(true)
    try {
      onSaved(await bridge.devices.save(input))
    } catch (err) {
      setErrors([errorMessage(err)])
      setSaving(false)
    }
  }

  const browse = async (): Promise<void> => {
    const path = await bridge?.devices.pickKeyFile()
    if (path) setKeyPath(path)
  }

  return (
    <Modal title={device ? 'Edit device' : 'Add device'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="router-1" autoFocus />
        </label>
        <div className="row">
          <label className="grow">
            Host
            <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.1" />
          </label>
          <label className="port">
            Port
            <input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
          </label>
        </div>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" />
        </label>
        <fieldset>
          <legend>Authentication</legend>
          <label className="inline">
            <input type="radio" checked={authType === 'password'} onChange={() => setAuthType('password')} />
            Password (asked when connecting; saved only if you tick “Remember”)
          </label>
          <label className="inline">
            <input type="radio" checked={authType === 'key'} onChange={() => setAuthType('key')} />
            Private key file
          </label>
          {authType === 'key' && (
            <div className="row">
              <input
                className="grow"
                value={keyPath}
                onChange={(e) => setKeyPath(e.target.value)}
                placeholder="C:\Users\you\.ssh\id_ed25519"
                aria-label="Key file path"
              />
              <button type="button" onClick={browse}>
                Browse…
              </button>
            </div>
          )}
        </fieldset>
        {device && hasSavedSecret && (
          <div className="row saved-row">
            <span className="muted grow">🔑 A {device.auth.type === 'key' ? 'key passphrase' : 'password'} is saved for this device.</span>
            <button type="button" onClick={() => void onForgetSecret(device.id)}>
              Forget it
            </button>
          </div>
        )}
        {errors.length > 0 && (
          <ul className="errors">
            {errors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        )}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={saving}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}

function errorMessage(err: unknown): string {
  // Electron prefixes errors thrown in ipcMain handlers; keep only the message.
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
