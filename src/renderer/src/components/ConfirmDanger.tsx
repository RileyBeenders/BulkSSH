import { Modal } from './Modal'

export interface DangerConfirmation {
  // 'broadcast': a command run over exec; 'mirror': Enter typed while mirroring.
  kind: 'broadcast' | 'mirror'
  command: string
  reasons: string[]
  // The line was edited with arrow keys, history or tab completion, so the
  // device may run something slightly different.
  uncertain?: boolean
  targets: { number: number; name: string }[]
}

interface Props {
  confirmation: DangerConfirmation
  onConfirm: () => void
  onCancel: () => void
}

const LISTED = 12

// Extra confirmation before a risky command reaches several devices.
// Cancel has the focus, so pressing Enter again does not run it.
export function ConfirmDanger({ confirmation: c, onConfirm, onCancel }: Props): React.JSX.Element {
  const n = c.targets.length
  const devices = `${n} device${n === 1 ? '' : 's'}`

  return (
    <Modal title={c.kind === 'broadcast' ? `Run on ${devices}?` : `Send Enter to ${devices}?`} onClose={onCancel}>
      <div className="form danger">
        <pre className="danger-command">{c.command || '(empty line)'}</pre>
        <p>This command looks risky:</p>
        <ul className="danger-reasons">
          {c.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {c.uncertain && (
          <p className="muted">
            The line was edited with arrow keys, history or tab completion, so the devices may run something different
            from what is shown.
          </p>
        )}
        <p className="muted">
          {c.kind === 'broadcast' ? 'It will run on: ' : 'Typed into: '}
          {c.targets
            .slice(0, LISTED)
            .map((t) => `${t.number} ${t.name}`)
            .join(', ')}
          {n > LISTED && ` and ${n - LISTED} more`}
        </p>
        <div className="actions">
          <button type="button" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button type="button" className="danger-button" onClick={onConfirm}>
            {c.kind === 'broadcast' ? `Run on ${devices}` : `Send to ${devices}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
