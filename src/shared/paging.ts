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
