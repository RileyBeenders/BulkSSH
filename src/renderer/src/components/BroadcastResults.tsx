import type { ExecResult } from '@shared/session'

export interface BroadcastRow {
  deviceId: string
  number: number
  name: string
  result?: ExecResult
}

export interface BroadcastRun {
  id: number
  command: string
  rows: BroadcastRow[]
}

interface Props {
  run: BroadcastRun
  onClose: () => void
}

export function BroadcastResults({ run, onClose }: Props): React.JSX.Element {
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

function succeeded(r: ExecResult): boolean {
  return r.ok && r.code === 0
}

function rowClass(r: ExecResult | undefined): string {
  if (!r) return 'pending'
  return succeeded(r) ? 'success' : 'failure'
}

function describe(r: ExecResult | undefined): string {
  if (!r) return 'running…'
  if (!r.ok) return 'error'
  if (r.code === null) return `killed${r.signal ? ` (${r.signal})` : ''}`
  return `exit ${r.code}`
}

function preview(r: ExecResult | undefined): string {
  if (!r) return ''
  const text = r.ok ? r.output : r.message
  return text.trim().split('\n')[0] ?? ''
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}
