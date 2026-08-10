type CatalogRow = { id: string }

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function catalogValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false
    }
    return left.every((value, index) => catalogValuesEqual(value, right[index]))
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) {
    return false
  }
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (!catalogValuesEqual(left[key], right[key])) {
      return false
    }
  }
  return true
}

export function reuseEqualCatalogRows<T extends CatalogRow>(
  current: readonly T[] | undefined,
  incoming: readonly T[]
): T[] {
  if (!current) {
    return [...incoming]
  }
  const currentById = new Map(current.map((row) => [row.id, row]))
  const reconciled = incoming.map((row) => {
    const previous = currentById.get(row.id)
    return previous && catalogValuesEqual(previous, row) ? previous : row
  })
  return current.length === reconciled.length &&
    current.every((row, index) => row === reconciled[index])
    ? (current as T[])
    : reconciled
}

export function catalogRowsEqual<T extends CatalogRow>(
  current: readonly T[] | undefined,
  incoming: readonly T[]
): boolean {
  return reuseEqualCatalogRows(current, incoming) === current
}
