// Paging for the device grid. Page numbers are 0-based.

export const DEFAULT_PAGE_SIZE = 6

export function pageCount(totalDevices: number, pageSize: number): number {
  if (pageSize < 1) throw new RangeError('pageSize must be at least 1')
  return Math.max(1, Math.ceil(totalDevices / pageSize))
}

export function pageOf(deviceIndex: number, pageSize: number): number {
  if (pageSize < 1) throw new RangeError('pageSize must be at least 1')
  return Math.floor(deviceIndex / pageSize)
}

export function pageSlice<T>(items: readonly T[], page: number, pageSize: number): T[] {
  const start = page * pageSize
  return items.slice(start, start + pageSize)
}

// Keeps a page index valid after the item count or page size changes.
export function clampPage(page: number, totalDevices: number, pageSize: number): number {
  return Math.min(Math.max(0, page), pageCount(totalDevices, pageSize) - 1)
}

// Columns x rows for a grid holding `slots` tiles, wider than tall
// (6 -> 3x2, 4 -> 2x2, 2 -> 2x1). The grid is sized from
// min(pageSize, open devices) so every page has the same tile size and
// terminals do not resize when switching pages.
export function gridShape(slots: number): { cols: number; rows: number } {
  const n = Math.max(1, Math.floor(slots))
  const cols = Math.ceil(Math.sqrt(n))
  return { cols, rows: Math.ceil(n / cols) }
}
