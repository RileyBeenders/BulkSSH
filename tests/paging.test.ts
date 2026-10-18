import { describe, expect, it } from 'vitest'
import { clampPage, gridShape, pageCount, pageOf, pageSlice } from '@shared/paging'
import { DEFAULT_SETTINGS, normalizeSettings, validateSettings } from '@shared/settings'

describe('paging', () => {
  it('always has at least one page', () => {
    expect(pageCount(0, 6)).toBe(1)
  })

  it('rounds partial pages up', () => {
    expect(pageCount(6, 6)).toBe(1)
    expect(pageCount(7, 6)).toBe(2)
  })

  it('finds the page a device is on', () => {
    expect(pageOf(5, 6)).toBe(0)
    expect(pageOf(6, 6)).toBe(1)
  })

  it('slices a page of items', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8]
    expect(pageSlice(items, 1, 6)).toEqual([7, 8])
  })

  it('rejects a page size below 1', () => {
    expect(() => pageCount(3, 0)).toThrow(RangeError)
  })

  it('clamps the page after devices close or the page size grows', () => {
    expect(clampPage(2, 7, 6)).toBe(1)
    expect(clampPage(1, 7, 12)).toBe(0)
    expect(clampPage(-1, 7, 6)).toBe(0)
    expect(clampPage(1, 0, 6)).toBe(0)
  })
})

describe('gridShape', () => {
  it.each([
    [1, 1, 1],
    [2, 2, 1],
    [3, 2, 2],
    [4, 2, 2],
    [6, 3, 2],
    [9, 3, 3],
    [10, 4, 3],
    [36, 6, 6]
  ])('%i slots -> %ix%i', (slots, cols, rows) => {
    expect(gridShape(slots)).toEqual({ cols, rows })
  })

  it('always fits every slot and treats 0 as 1', () => {
    for (let n = 1; n <= 36; n++) {
      const { cols, rows } = gridShape(n)
      expect(cols * rows).toBeGreaterThanOrEqual(n)
      expect(cols).toBeGreaterThanOrEqual(rows)
    }
    expect(gridShape(0)).toEqual({ cols: 1, rows: 1 })
  })
})

describe('settings', () => {
  it('validates the page size range', () => {
    const ok = { pageSize: 6, broadcastTimeoutSec: 30 }
    expect(validateSettings(ok)).toEqual([])
    expect(validateSettings({ ...ok, pageSize: 0 })).toHaveLength(1)
    expect(validateSettings({ ...ok, pageSize: 37 })).toHaveLength(1)
    expect(validateSettings({ ...ok, pageSize: 2.5 })).toHaveLength(1)
    expect(validateSettings({ ...ok, broadcastTimeoutSec: 0 })).toHaveLength(1)
    expect(validateSettings({ ...ok, broadcastTimeoutSec: 3601 })).toHaveLength(1)
    expect(validateSettings(null)).toEqual(['Settings must be an object'])
  })

  it('normalizes missing or bad values to defaults and drops extra fields', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ pageSize: 'lots', extra: true })).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ pageSize: 9, extra: true })).toEqual({ pageSize: 9, broadcastTimeoutSec: 30 })
    expect(normalizeSettings({ pageSize: 9, broadcastTimeoutSec: 5 })).toEqual({ pageSize: 9, broadcastTimeoutSec: 5 })
  })
})
