import { types as utilTypes } from 'node:util'

const booleanObjectValueOf = Boolean.prototype.valueOf
const bigIntObjectValueOf = BigInt.prototype.valueOf

function utf8StringBytes(value: string, maxBytes: number): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
    if (bytes > maxBytes) {
      return bytes
    }
  }
  return bytes
}

export function jsonStringBytes(value: string, maxBytes: number): number {
  let bytes = 2
  if (bytes > maxBytes) {
    return bytes
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (
      code === 0x22 ||
      code === 0x5c ||
      code === 0x08 ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0c ||
      code === 0x0d
    ) {
      bytes += 2
    } else if (code < 0x20) {
      bytes += 6
    } else if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 6
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6
    } else {
      bytes += 3
    }
    if (bytes > maxBytes) {
      return bytes
    }
  }
  return bytes
}

export function normalizedJsonValue(value: unknown, container: unknown): unknown {
  if (value !== null && typeof value === 'object') {
    if (utilTypes.isNumberObject(value)) {
      return +(value as unknown as number)
    }
    if (utilTypes.isStringObject(value)) {
      return `${value as unknown as string}`
    }
    if (utilTypes.isBooleanObject(value)) {
      return Reflect.apply(booleanObjectValueOf, value, [])
    }
    if (utilTypes.isBigIntObject(value)) {
      return Reflect.apply(bigIntObjectValueOf, value, [])
    }
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return Array.isArray(container) ? null : undefined
  }
  return value
}

export function primitiveJsonBytes(value: unknown, maxBytes: number): number | null {
  if (value === null) {
    return 4
  }
  if (typeof value === 'string') {
    return jsonStringBytes(value, maxBytes)
  }
  if (typeof value === 'boolean') {
    return value ? 4 : 5
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value).length : 4
  }
  return null
}

export function rawJsonBytes(value: unknown, maxBytes: number): number | null {
  const isRawJSON = (JSON as { isRawJSON?: (candidate: unknown) => boolean }).isRawJSON
  if (!isRawJSON?.(value)) {
    return null
  }
  const rawJSON = (value as { rawJSON?: unknown }).rawJSON
  return typeof rawJSON === 'string' ? utf8StringBytes(rawJSON, maxBytes) : null
}

export function normalizedJsonIndent(space: number | string | undefined): string {
  if (typeof space === 'number') {
    const width = Number.isNaN(space) || space <= 0 ? 0 : Math.min(10, Math.trunc(space))
    return ' '.repeat(width)
  }
  return typeof space === 'string' ? space.slice(0, 10) : ''
}
