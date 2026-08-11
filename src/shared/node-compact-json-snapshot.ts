import {
  jsonStringBytes,
  normalizedJsonValue,
  primitiveJsonBytes,
  rawJsonBytes
} from './node-json-byte-measurement'

const OMITTED_JSON_VALUE = Symbol('omitted-json-value')

type CompactSnapshotContext = {
  readonly stack: Set<object>
  readonly addBytes: (count: number) => void
  readonly remainingBytes: () => number
}

function prepareJsonValue(holder: object, key: string): unknown | typeof OMITTED_JSON_VALUE {
  let value = Reflect.get(holder, key, holder)
  const valueType = typeof value
  if (
    valueType === 'bigint' ||
    (value !== null && (valueType === 'object' || valueType === 'function'))
  ) {
    const toJSON = (value as unknown as { toJSON?: unknown }).toJSON
    if (typeof toJSON === 'function') {
      value = Reflect.apply(toJSON, value, [key])
    }
  }

  const normalized = normalizedJsonValue(value, holder)
  if (normalized === undefined) {
    return OMITTED_JSON_VALUE
  }
  if (typeof normalized === 'bigint') {
    throw new TypeError('Do not know how to serialize a BigInt')
  }
  return normalized
}

function compactArrayLength(value: unknown[]): number {
  const numericLength = +(value.length as unknown as number)
  if (Number.isNaN(numericLength) || numericLength <= 0) {
    return 0
  }
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(numericLength))
}

function preserveSnapshotKeyOrder(
  snapshot: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> {
  const canonicalKeys = Object.keys(snapshot)
  if (
    canonicalKeys.length === keys.length &&
    canonicalKeys.every((key, index) => key === keys[index])
  ) {
    return snapshot
  }
  return new Proxy(snapshot, { ownKeys: () => [...keys] })
}

function compactJsonSnapshot(value: unknown, context: CompactSnapshotContext): unknown {
  const rawBytes = rawJsonBytes(value, context.remainingBytes())
  if (rawBytes !== null) {
    context.addBytes(rawBytes)
    return value
  }
  const primitiveBytes = primitiveJsonBytes(value, context.remainingBytes())
  if (primitiveBytes !== null) {
    context.addBytes(primitiveBytes)
    return value
  }
  if (value === null || typeof value !== 'object') {
    throw new TypeError('JSON value is not serializable')
  }
  if (context.stack.has(value)) {
    throw new TypeError('Converting circular structure to JSON')
  }

  context.stack.add(value)
  context.addBytes(1)
  try {
    if (Array.isArray(value)) {
      const snapshot: unknown[] = []
      Object.setPrototypeOf(snapshot, null)
      const length = compactArrayLength(value)
      for (let index = 0; index < length; index += 1) {
        const prepared = prepareJsonValue(value, String(index))
        if (index > 0) {
          context.addBytes(1)
        }
        snapshot[index] = compactJsonSnapshot(
          prepared === OMITTED_JSON_VALUE ? null : prepared,
          context
        )
      }
      context.addBytes(1)
      return snapshot
    }

    const snapshot: Record<string, unknown> = Object.create(null)
    const emittedKeys: string[] = []
    for (const key of Object.keys(value)) {
      const prepared = prepareJsonValue(value, key)
      if (prepared === OMITTED_JSON_VALUE) {
        continue
      }
      if (emittedKeys.length > 0) {
        context.addBytes(1)
      }
      context.addBytes(jsonStringBytes(key, context.remainingBytes()))
      context.addBytes(1)
      snapshot[key] = compactJsonSnapshot(prepared, context)
      emittedKeys.push(key)
    }
    context.addBytes(1)
    return preserveSnapshotKeyOrder(snapshot, emittedKeys)
  } finally {
    context.stack.delete(value)
  }
}

export function stringifyCompactJsonWithinLimit(
  value: unknown,
  maxBytes: number,
  fail: (observedBytes: number) => never
): { serialized: string; byteLength: number } {
  let bytes = 0
  const context: CompactSnapshotContext = {
    stack: new Set(),
    addBytes: (count) => {
      bytes += count
      if (bytes > maxBytes) {
        fail(bytes)
      }
    },
    remainingBytes: () => maxBytes - bytes
  }
  const rootHolder = Object.create(null) as Record<string, unknown>
  rootHolder[''] = value
  const prepared = prepareJsonValue(rootHolder, '')
  if (prepared === OMITTED_JSON_VALUE) {
    throw new TypeError('JSON value is not serializable')
  }
  const snapshot = compactJsonSnapshot(prepared, context)
  const serialized = JSON.stringify(snapshot)
  const actualBytes = Buffer.byteLength(serialized, 'utf8')
  if (actualBytes > maxBytes) {
    fail(actualBytes)
  }
  return { serialized, byteLength: actualBytes }
}
