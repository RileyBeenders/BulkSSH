import { describe, expect, it } from 'vitest'
import { pageCount, pageOf, pageSlice } from '@shared/paging'

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
})
