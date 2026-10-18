import { useMemo, useState, type FormEvent } from 'react'
import { validateDevice, type Device, type DeviceInput } from '@shared/device'
import { formatHost, parseHostList, planDevices } from '@shared/hosts'
import { bridge } from '../bridge'
import { Modal } from './Modal'

export interface DeviceFormResult {
  // Every device the form covers: newly saved ones and matching ones that
  // were already saved.
  devices: Device[]
  // Connect them right away.
  connect: boolean
}

interface Props {
  device: Device | null // null = add one or more new devices
  // Saved devices, to spot addresses that are already in the list.
  existing: readonly Device[]
  hasSavedSecret: boolean
  onForgetSecret: (deviceId: string) => Promise<void>
  onSaved: (result: DeviceFormResult) => void
  onClose: () => void
}

const PREVIEW_ROWS = 8

export function DeviceForm(props: Props): React.JSX.Element {
  const { device, existing, hasSavedSecret, onForgetSecret, onSaved, onClose } = props
  const editing = device !== null
  const [name, setName] = useState(device?.name ?? '')
  const [hosts, setHosts] = useState(device ? formatHost(device) : '')
  const [username, setUsername] = useState(device?.username ?? '')
  const [authType, setAuthType] = useState(device?.auth.type ?? 'password')
  const [keyPath, setKeyPath] = useState(device?.auth.type === 'key' ? device.auth.keyPath : '')
  const [connect, setConnect] = useState(true)
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const parsed = useMemo(() => parseHostList(hosts), [hosts])
  const plan = useMemo(
    () => (editing ? [] : planDevices(parsed.entries, name, username, existing)),
    [editing, parsed.entries, name, username, existing]
  )
  const many = parsed.entries.length > 1
  const reused = plan.filter((p) => p.existingId).length
  const toCreate = plan.length - reused
  const auth = (): DeviceInput['auth'] => (authType === 'key' ? { type: 'key', keyPath } : { type: 'password' })

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (parsed.errors.length > 0) return setErrors(parsed.errors)
    if (parsed.entries.length === 0) return setErrors(['Enter at least one host'])
    if (editing && many) return setErrors(['A saved device has one address; add the others as new devices'])
    if (!bridge) return setErrors(['Saving devices only works in the BulkSSH app'])

    const inputs: DeviceInput[] = editing
      ? [{ id: device.id, name, ...parsed.entries[0], username, auth: auth() }]
      : plan.filter((p) => !p.existingId).map((p) => ({ name: p.name, host: p.host, port: p.port, username, auth: auth() }))
    const problems = [...new Set(inputs.flatMap((input) => validateDevice(input)))]
    if (problems.length > 0) return setErrors(problems)

    setSaving(true)
    try {
      const saved: Device[] = []
      for (const input of inputs) saved.push(await bridge.devices.save(input))
      const reusedDevices = plan.flatMap((p) => existing.filter((d) => d.id === p.existingId))
      onSaved({ devices: [...saved, ...reusedDevices], connect: !editing && connect })
    } catch (err) {
      setErrors([errorMessage(err)])
      setSaving(false)
    }
  }

  const browse = async (): Promise<void> => {
    const path = await bridge?.devices.pickKeyFile()
    if (path) setKeyPath(path)
  }

  const submitLabel = editing
    ? 'Save'
    : `${connect ? 'Add & connect' : 'Add'}${plan.length > 1 ? ` ${plan.length} devices` : ''}`

  return (
    <Modal title={editing ? 'Edit device' : 'Add devices'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          {editing ? 'Host' : 'Host(s)'}
          <input
            value={hosts}
            onChange={(e) => {
              setHosts(e.target.value)
              setErrors([])
            }}
            placeholder={editing ? '192.168.1.1 or 192.168.1.1:2222' : '192.168.1.10, 192.168.1.11:2222, switch.local'}
            spellCheck={false}
            autoFocus={!editing}
          />
          {!editing && (
            <span className="hint">
              One or more addresses, separated by commas or spaces. Add <code>:port</code> when it isn't 22; IPv6 as{' '}
              <code>[fe80::1]:2222</code>.
            </span>
          )}
        </label>
        {parsed.errors.length > 0 && (
          <ul className="errors">
            {parsed.errors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        )}
        <label>
          {!editing && many ? 'Name prefix (optional)' : editing ? 'Name' : 'Name (optional)'}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={many ? 'switch → switch-1, switch-2, …' : editing ? 'router-1' : 'Leave empty to use the address'}
            autoFocus={editing}
          />
        </label>
        <label>
          Username{many ? ' (same for every device)' : ''}
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" />
        </label>
        <fieldset>
          <legend>Authentication{many ? ' (same for every device)' : ''}</legend>
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
        {!editing && plan.length > 0 && (many || reused > 0) && (
          <div className="host-preview" aria-label="Devices to add">
            <p className="muted">
              {toCreate > 0 && `${toCreate} new device${toCreate === 1 ? '' : 's'}`}
              {toCreate > 0 && reused > 0 && ', '}
              {reused > 0 && `${reused} already saved`}
            </p>
            <ul>
              {plan.slice(0, PREVIEW_ROWS).map((p) => (
                <li key={`${p.host}:${p.port}`}>
                  <span className="name">{p.name}</span>
                  <span className="addr">
                    {username.trim() || '…'}@{formatHost(p)}
                  </span>
                  {p.existingId && <span className="tag">already saved</span>}
                </li>
              ))}
            </ul>
            {plan.length > PREVIEW_ROWS && <p className="muted">and {plan.length - PREVIEW_ROWS} more</p>}
          </div>
        )}
        {!editing && (
          <label className="inline">
            <input type="checkbox" checked={connect} onChange={(e) => setConnect(e.target.checked)} />
            Connect {plan.length > 1 ? 'them' : 'it'} after adding
          </label>
        )}
        {device && hasSavedSecret && (
          <div className="row saved-row">
            <span className="muted grow">🔑 A {device.auth.type === 'key' ? 'key passphrase' : 'password'} is saved for this device.</span>
            <button type="button" onClick={() => void onForgetSecret(device.id)}>
              Forget it
            </button>
          </div>
        )}
        {errors.length > 0 && errors !== parsed.errors && (
          <ul className="errors">
            {errors
              .filter((err) => !parsed.errors.includes(err))
              .map((err) => (
                <li key={err}>{err}</li>
              ))}
          </ul>
        )}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={saving || parsed.errors.length > 0}>
            {submitLabel}
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
