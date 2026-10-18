import type { ExecResult } from '@shared/session'
import { describe, formatMs, succeeded, type BroadcastRun } from '../broadcast'

interface Props {
  run: BroadcastRun
  onClose: () => void
  onExport: () => void
}

export function BroadcastResults({ run, onClose, onExport }: Props): React.JSX.Element {
  const done = run.rows.filter((r) => r.result).length
  const failed = run.rows.filter((r) => r.result && !succeeded(r.result)).length

  return (
    <section className="broadcast-results" aria-label="Broadcast results">
      <header>
        <code className="command">$ {run.command}</code>
        <span className="muted">
          {done}/{run.rows.length} done
          {failed > 0 && <span className="failed"> · {failed} failed</span>}
        </span>
        <span className="grow" />
        <button onClick={onExport} disabled={done < run.rows.length} title="Export results to a text file">
          Export
        </button>
        <button onClick={onClose} aria-label="Close results" title="Close results">
          ✕
        </button>
      </header>
      <ul>
        {run.rows.map((row) => (
          <li key={row.deviceId} className={rowClass(row.result)}>
            <details>
              <summary>
                <span className="num">{row.number}</span>
                <span className="name">{row.name}</span>
                <span className="outcome">{describe(row.result)}</span>
                <span className="preview">{preview(row.result)}</span>
                {row.result && <span className="muted duration">{formatMs(row.result.durationMs)}</span>}
              </summary>
              {row.result?.ok ? (
                <pre>
                  {row.result.output || '(no output)'}
                  {row.result.truncated && '\n… output truncated at 64 KB'}
                </pre>
              ) : (
                <pre>{row.result ? row.result.message : 'Running…'}</pre>
              )}
            </details>
          </li>
        ))}
      </ul>
    </section>
  )
}

function rowClass(r: ExecResult | undefined): string {
  if (!r) return 'pending'
  return succeeded(r) ? 'success' : 'failure'
}

function preview(r: ExecResult | undefined): string {
  if (!r) return ''
  const text = r.ok ? r.output : r.message
  return text.trim().split('\n')[0] ?? ''
}
