import { describe, expect, it } from 'vitest'
import { formatResults } from '../src/renderer/src/broadcast'

describe('formatResults', () => {
  it('writes one section per device with outcome, time and output', () => {
    const text = formatResults({
      id: 1,
      command: 'uptime',
      rows: [
        { deviceId: 'a', number: 1, name: 'web-1', result: { ok: true, code: 0, output: 'up 3 days\n', truncated: false, durationMs: 12 } },
        { deviceId: 'b', number: 2, name: 'web-2', result: { ok: true, code: 1, output: 'x'.repeat(3), truncated: true, durationMs: 1500 } },
        { deviceId: 'c', number: 3, name: 'db-1', result: { ok: false, message: 'Timed out after 30 s', durationMs: 30000 } },
        { deviceId: 'd', number: 4, name: 'db-2' }
      ]
    })
    expect(text).toBe(
      [
        '$ uptime',
        '',
        '=== 1 web-1: exit 0 (12 ms) ===',
        'up 3 days',
        '',
        '=== 2 web-2: exit 1 (1.5 s) ===',
        'xxx\n… output truncated at 64 KB',
        '',
        '=== 3 db-1: error (30.0 s) ===',
        'Timed out after 30 s',
        '',
        '=== 4 db-2: running… ===',
        ''
      ].join('\n')
    )
  })
})
