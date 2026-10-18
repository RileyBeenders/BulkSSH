import { useState, type FormEvent } from 'react'
import { MAX_BROADCAST_TIMEOUT_SEC, MAX_PAGE_SIZE, validateSettings, type Settings } from '@shared/settings'
import { bridge } from '../bridge'
import { Modal } from './Modal'

interface Props {
  settings: Settings
  onSaved: (settings: Settings) => void
  onClose: () => void
}

export function SettingsDialog({ settings, onSaved, onClose }: Props): React.JSX.Element {
  const [pageSize, setPageSize] = useState(String(settings.pageSize))
  const [timeout, setTimeoutSec] = useState(String(settings.broadcastTimeoutSec))
  const [errors, setErrors] = useState<string[]>([])

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const next: Settings = { pageSize: Number(pageSize), broadcastTimeoutSec: Number(timeout) }
    const problems = validateSettings(next)
    if (problems.length > 0) return setErrors(problems)
    try {
      onSaved(bridge ? await bridge.settings.save(next) : next)
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)])
    }
  }

  return (
    <Modal title="Settings" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          Devices per page (1–{MAX_PAGE_SIZE})
          <input value={pageSize} onChange={(e) => setPageSize(e.target.value)} inputMode="numeric" autoFocus />
        </label>
        <p className="muted">When more devices are open than fit on one page, use the pager or Ctrl+PageUp / Ctrl+PageDown.</p>
        <label>
          Broadcast timeout per device, seconds (1–{MAX_BROADCAST_TIMEOUT_SEC})
          <input value={timeout} onChange={(e) => setTimeoutSec(e.target.value)} inputMode="numeric" />
        </label>
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
          <button type="submit" className="primary">
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}
