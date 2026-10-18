import type { ExecResult } from '@shared/session'

// A broadcast run and how its results are described, shared by the results
// panel and the text export.

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

export function succeeded(r: ExecResult): boolean {
  return r.ok && r.code === 0
}

export function describe(r: ExecResult | undefined): string {
  if (!r) return 'running…'
  if (!r.ok) return 'error'
  if (r.code === null) return `killed${r.signal ? ` (${r.signal})` : ''}`
  return `exit ${r.code}`
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

// Plain-text report of a broadcast, for export.
export function formatResults(run: BroadcastRun): string {
  const lines = [`$ ${run.command}`, '']
  for (const row of run.rows) {
    const r = row.result
    lines.push(`=== ${row.number} ${row.name}: ${describe(r)}${r ? ` (${formatMs(r.durationMs)})` : ''} ===`)
    if (r) lines.push(r.ok ? r.output.replace(/\n$/, '') + (r.truncated ? '\n… output truncated at 64 KB' : '') : r.message)
    lines.push('')
  }
  return lines.join('\n')
}
