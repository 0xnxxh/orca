import { stringifyCompactJsonWithinLimit } from './node-compact-json-snapshot'
import {
  jsonStringBytes,
  normalizedJsonIndent,
  normalizedJsonValue,
  primitiveJsonBytes,
  rawJsonBytes
} from './node-json-byte-measurement'

export class JsonStringifyByteLimitError extends Error {
  constructor(
    readonly observedBytes: number,
    readonly maxBytes: number
  ) {
    super(`JSON output exceeds ${maxBytes} bytes`)
    this.name = 'JsonStringifyByteLimitError'
  }
}

const byteLimitErrorInvocations = new WeakMap<JsonStringifyByteLimitError, object>()

export type JsonStringifyWithinByteLimitResult =
  | { ok: true; serialized: string; byteLength: number }
  | { ok: false; error: JsonStringifyByteLimitError }

function stringifyJsonForByteLimitInvocation(
  value: unknown,
  maxBytes: number,
  space: number | string | undefined,
  fail: (observedBytes: number) => never
): { serialized: string; byteLength: number } {
  const indent = normalizedJsonIndent(space)
  if (indent === '') {
    return stringifyCompactJsonWithinLimit(value, maxBytes, fail)
  }

  let bytes = 0
  let root = true
  const emittedProperties = new WeakMap<object, number>()
  const containerDepths = new WeakMap<object, number>()
  const indentBytes = Buffer.byteLength(indent, 'utf8')
  const addBytes = (count: number): void => {
    bytes += count
    if (bytes > maxBytes) {
      fail(bytes)
    }
  }

  const serialized = JSON.stringify(
    value,
    function (key, rawValue) {
      const normalized = normalizedJsonValue(rawValue, this)
      const isRoot = root
      root = false
      if (normalized === undefined) {
        return undefined
      }

      if (!isRoot) {
        const emitted = emittedProperties.get(this) ?? 0
        const parentDepth = containerDepths.get(this) ?? 0
        if (emitted === 0) {
          addBytes(2 + indentBytes * (parentDepth * 2 + 1))
        } else {
          addBytes(2 + indentBytes * (parentDepth + 1))
        }
        if (!Array.isArray(this)) {
          addBytes(jsonStringBytes(key, maxBytes - bytes - 2) + 2)
        }
        emittedProperties.set(this, emitted + 1)
      }

      const remainingBytes = maxBytes - bytes
      const encodedBytes =
        rawJsonBytes(normalized, remainingBytes) ?? primitiveJsonBytes(normalized, remainingBytes)
      if (encodedBytes !== null) {
        addBytes(encodedBytes)
      } else if (normalized !== null && typeof normalized === 'object') {
        addBytes(2)
        emittedProperties.set(normalized, 0)
        const parentDepth = isRoot ? -1 : (containerDepths.get(this) ?? 0)
        containerDepths.set(normalized, parentDepth + 1)
      }
      return normalized
    },
    space
  )

  if (serialized === undefined) {
    throw new TypeError('JSON value is not serializable')
  }
  const actualBytes = Buffer.byteLength(serialized, 'utf8')
  if (actualBytes > maxBytes) {
    fail(actualBytes)
  }
  return { serialized, byteLength: actualBytes }
}

export function tryStringifyJsonWithinByteLimit(
  value: unknown,
  maxBytes: number,
  space?: number | string
): JsonStringifyWithinByteLimitResult {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError('JSON byte limit must be a non-negative safe integer')
  }

  const invocation = {}
  const fail = (observedBytes: number): never => {
    const error = new JsonStringifyByteLimitError(observedBytes, maxBytes)
    byteLimitErrorInvocations.set(error, invocation)
    throw error
  }
  try {
    return { ok: true, ...stringifyJsonForByteLimitInvocation(value, maxBytes, space, fail) }
  } catch (error) {
    if (
      error instanceof JsonStringifyByteLimitError &&
      byteLimitErrorInvocations.get(error) === invocation
    ) {
      return { ok: false, error }
    }
    throw error
  }
}

export function stringifyJsonWithinByteLimit(
  value: unknown,
  maxBytes: number,
  space?: number | string
): { serialized: string; byteLength: number } {
  const result = tryStringifyJsonWithinByteLimit(value, maxBytes, space)
  if (!result.ok) {
    throw result.error
  }
  return { serialized: result.serialized, byteLength: result.byteLength }
}
