import { describe, expect, it } from 'vitest'
import { isTerminalReport, mirrorTargets } from '@shared/mirror'

describe('mirrorTargets', () => {
  const live = new Set(['a', 'b', 'c'])
  const isLive = (id: string): boolean => live.has(id)

  it('sends to checked, live devices other than the driver', () => {
    expect(mirrorTargets('a', new Set(['a', 'b', 'c']), isLive)).toEqual(['b', 'c'])
  })

  it('skips unchecked and disconnected devices', () => {
    expect(mirrorTargets('a', new Set(['b', 'd']), isLive)).toEqual(['b'])
  })

  it('works when the driver itself is not checked', () => {
    expect(mirrorTargets('a', new Set(['c']), isLive)).toEqual(['c'])
  })

  it('returns nothing when nothing else is checked', () => {
    expect(mirrorTargets('a', new Set(['a']), isLive)).toEqual([])
  })
})

describe('isTerminalReport', () => {
  it.each([
    ['cursor position', '\x1b[12;40R'],
    ['private cursor position', '\x1b[?12;40R'],
    ['primary device attributes', '\x1b[?1;2c'],
    ['secondary device attributes', '\x1b[>0;276;0c'],
    ['mode report', '\x1b[?2004;2$y'],
    ['focus in', '\x1b[I'],
    ['focus out', '\x1b[O'],
    ['SGR mouse press', '\x1b[<0;10;5M'],
    ['SGR mouse release', '\x1b[<0;10;5m'],
    ['X10 mouse', '\x1b[M !!'],
    ['window size', '\x1b[8;24;80t'],
    ['OSC colour reply (BEL)', '\x1b]11;rgb:0f0f/1111/1515\x07'],
    ['OSC colour reply (ST)', '\x1b]10;rgb:ffff/ffff/ffff\x1b\\'],
    ['DCS reply', '\x1bP1$r0m\x1b\\']
  ])('treats %s as a report', (_name, data) => {
    expect(isTerminalReport(data)).toBe(true)
  })

  it.each([
    ['letters', 'ls -la'],
    ['enter', '\r'],
    ['ctrl+c', '\x03'],
    ['escape', '\x1b'],
    ['arrow up', '\x1b[A'],
    ['arrow up (application mode)', '\x1bOA'],
    ['page up', '\x1b[5~'],
    ['F5', '\x1b[15~'],
    ['delete', '\x1b[3~'],
    ['bracketed paste', '\x1b[200~echo hi\x1b[201~'],
    ['typed text containing R', 'R'],
    ['typed text containing c', 'c']
  ])('treats %s as user input', (_name, data) => {
    expect(isTerminalReport(data)).toBe(false)
  })
})
