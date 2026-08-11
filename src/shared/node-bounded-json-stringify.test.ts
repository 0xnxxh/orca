import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import {
  JsonStringifyByteLimitError,
  stringifyJsonWithinByteLimit
} from './node-bounded-json-stringify'

describe('stringifyJsonWithinByteLimit', () => {
  it('matches native JSON for nested values, escaping, and omitted fields', () => {
    const shared = { label: 'same object' }
    const value = {
      text: 'quote " slash \\ control\n emoji 🐋 lone \ud800',
      nested: [1, undefined, Number.NaN, { omitted: undefined, kept: true }],
      repeated: [shared, shared]
    }
    const native = JSON.stringify(value)

    const result = stringifyJsonWithinByteLimit(value, Buffer.byteLength(native))

    expect(result.serialized).toBe(native)
    expect(result.byteLength).toBe(Buffer.byteLength(native, 'utf8'))
    expect(() => stringifyJsonWithinByteLimit(value, result.byteLength - 1)).toThrow(
      JsonStringifyByteLimitError
    )
  })

  it('matches native indented JSON and counts whitespace before materializing it', () => {
    const value = { nested: [{ quote: '"', unicode: '🐋' }], empty: {} }
    const native = JSON.stringify(value, null, 2)

    expect(stringifyJsonWithinByteLimit(value, Buffer.byteLength(native), 2)).toEqual({
      byteLength: Buffer.byteLength(native),
      serialized: native
    })
    expect(() => stringifyJsonWithinByteLimit(value, Buffer.byteLength(native) - 1, 2)).toThrow(
      JsonStringifyByteLimitError
    )
  })

  it('matches native numeric and string indentation normalization', () => {
    const value = { nested: { value: true } }
    for (const space of [Number.NaN, -1, 20, '🐋'.repeat(6)]) {
      const native = JSON.stringify(value, null, space)
      expect(stringifyJsonWithinByteLimit(value, Buffer.byteLength(native), space)).toEqual({
        byteLength: Buffer.byteLength(native),
        serialized: native
      })
    }
  })

  it('stops visiting indented collections when whitespace crosses the limit', () => {
    let visits = 0
    const value = Array.from({ length: 10_000 }, () => ({
      toJSON() {
        visits += 1
        return 1
      }
    }))

    expect(() => stringifyJsonWithinByteLimit(value, 64, 2)).toThrow(JsonStringifyByteLimitError)
    expect(visits).toBeLessThan(value.length)
  })

  it('measures values after toJSON without invoking it twice', () => {
    let calls = 0
    const value = {
      toJSON() {
        calls += 1
        return { rendered: 'value' }
      }
    }

    expect(stringifyJsonWithinByteLimit(value, 100).serialized).toBe('{"rendered":"value"}')
    expect(calls).toBe(1)
  })

  it('matches native coercion for boxed primitives with overridden hooks', () => {
    const booleanValue = new Boolean(true)
    booleanValue.valueOf = () => {
      throw new Error('native JSON ignores this hook')
    }
    const numberValue = new Number(1)
    numberValue[Symbol.toPrimitive] = () => 2
    const stringValue = new String('a')
    stringValue[Symbol.toPrimitive] = () => 'b'

    for (const value of [booleanValue, numberValue, stringValue]) {
      const native = JSON.stringify(value)

      expect(stringifyJsonWithinByteLimit(value, Buffer.byteLength(native)).serialized).toBe(native)
    }
  })

  it('recognizes cross-realm boxed primitives but not proxies around them', () => {
    const crossRealmValues = runInNewContext(
      '[new Number(7), new String("cross-realm"), new Boolean(false)]'
    ) as unknown[]
    const proxiedNumber = new Proxy(new Number(7), {})

    for (const value of [...crossRealmValues, proxiedNumber]) {
      const native = JSON.stringify(value)

      expect(stringifyJsonWithinByteLimit(value, Buffer.byteLength(native)).serialized).toBe(native)
    }
  })

  it('preserves proxy key order and invokes array accessors once', () => {
    const target = { 1: 'one', 2: 'two' }
    const proxy = new Proxy(target, {
      ownKeys: () => ['2', '1']
    })
    const array = [0]
    const read = vi.fn(() => proxy)
    Object.defineProperty(array, 0, { enumerable: true, get: read })
    const native = JSON.stringify(array)
    read.mockClear()

    expect(stringifyJsonWithinByteLimit(array, Buffer.byteLength(native)).serialized).toBe(native)
    expect(read).toHaveBeenCalledOnce()
  })

  it('counts custom boxed-string coercion before materializing JSON output', () => {
    const value = new String('small')
    value[Symbol.toPrimitive] = () => 'x'.repeat(1024 * 1024)
    const charCodeAt = vi.spyOn(String.prototype, 'charCodeAt')
    try {
      expect(() => stringifyJsonWithinByteLimit(value, 64)).toThrow(JsonStringifyByteLimitError)
      expect(charCodeAt.mock.calls.length).toBeLessThan(128)
    } finally {
      charCodeAt.mockRestore()
    }
  })

  it('rejects a large root string before materializing escaped JSON', () => {
    const value = '\n'.repeat(1024 * 1024)

    expect(() => stringifyJsonWithinByteLimit(value, 1024)).toThrow(JsonStringifyByteLimitError)
  })

  it('stops measuring a primitive string as soon as it crosses the limit', () => {
    const charCodeAt = vi.spyOn(String.prototype, 'charCodeAt')
    try {
      let observed: unknown
      try {
        stringifyJsonWithinByteLimit('x'.repeat(1024 * 1024), 64)
      } catch (error) {
        observed = error
      }
      expect(observed).toBeInstanceOf(JsonStringifyByteLimitError)
      expect((observed as JsonStringifyByteLimitError).observedBytes).toBe(65)
      expect(charCodeAt.mock.calls.length).toBeLessThan(128)
    } finally {
      charCodeAt.mockRestore()
    }
  })

  it('stops measuring a property key as soon as it crosses the limit', () => {
    let observed: unknown
    try {
      stringifyJsonWithinByteLimit({ ['x'.repeat(1024 * 1024)]: true }, 64)
    } catch (error) {
      observed = error
    }

    expect(observed).toBeInstanceOf(JsonStringifyByteLimitError)
    expect((observed as JsonStringifyByteLimitError).observedBytes).toBe(65)
  })

  it('stops visiting a large collection as soon as it crosses the limit', () => {
    let visits = 0
    const value = Array.from({ length: 10_000 }, () => ({
      toJSON() {
        visits += 1
        return 1
      }
    }))

    expect(() => stringifyJsonWithinByteLimit(value, 64)).toThrow(JsonStringifyByteLimitError)
    expect(visits).toBeLessThan(value.length)
  })

  it('measures raw JSON values before native serialization materializes them', () => {
    const createRawJson = (JSON as { rawJSON?: (value: string) => unknown }).rawJSON
    if (!createRawJson) {
      return
    }
    const value = createRawJson(JSON.stringify('x'.repeat(1024 * 1024)))

    let observed: unknown
    try {
      stringifyJsonWithinByteLimit(value, 64)
    } catch (error) {
      observed = error
    }
    expect(observed).toBeInstanceOf(JsonStringifyByteLimitError)
    expect((observed as JsonStringifyByteLimitError).observedBytes).toBe(65)
  })

  it('rejects invalid limits and unserializable roots like native JSON', () => {
    expect(() => stringifyJsonWithinByteLimit('value', -1)).toThrow(RangeError)
    expect(() => stringifyJsonWithinByteLimit(undefined, 100)).toThrow(TypeError)
  })
})
