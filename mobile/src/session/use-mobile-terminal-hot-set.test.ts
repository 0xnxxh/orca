import { StrictMode, Suspense, createElement, useLayoutEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MOBILE_TERMINAL_COLD_REVEAL_TIMEOUT_MS,
  isAdmissibleMobileTerminalColdScrollback,
  useMobileTerminalHotSet
} from './use-mobile-terminal-hot-set'

type HarnessProps = {
  activeHandle: string | null
  connectionAdmissible?: boolean
  enabled?: boolean
  handles: readonly string[]
  onEvict: (handle: string) => void
  onValue: (value: ReturnType<typeof useMobileTerminalHotSet>) => void
  scopeKey?: string
}

function Harness(props: HarnessProps) {
  const value = useMobileTerminalHotSet({
    scopeKey: props.scopeKey ?? 'host:worktree',
    featureEnabled: props.enabled ?? true,
    connectionAdmissible: props.connectionAdmissible,
    inadmissibleReason: props.connectionAdmissible === false ? 'connection-uncertain' : null,
    handles: props.handles,
    activeHandle: props.activeHandle,
    onEvict: props.onEvict,
    graceMs: 20
  })
  props.onValue(value)
  return null
}

const NEVER_RESOLVES = new Promise<void>(() => {})

function CommitHarness(props: HarnessProps & { suspend?: boolean }) {
  const value = useMobileTerminalHotSet({
    scopeKey: props.scopeKey ?? 'host:worktree',
    featureEnabled: props.enabled ?? true,
    handles: props.handles,
    activeHandle: props.activeHandle,
    onEvict: props.onEvict,
    graceMs: 20
  })
  useLayoutEffect(() => {
    props.onValue(value)
  }, [props, value])
  if (props.suspend) {
    throw NEVER_RESOLVES
  }
  return null
}

describe('useMobileTerminalHotSet', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    renderer?.unmount()
    renderer = null
    vi.useRealTimers()
  })

  it('admits only complete structurally valid cold scrollback', () => {
    const valid = {
      type: 'scrollback',
      serialized: '',
      cols: 80,
      rows: 24,
      source: 'headless'
    }

    expect(isAdmissibleMobileTerminalColdScrollback(valid)).toBe(true)
    expect(isAdmissibleMobileTerminalColdScrollback({ ...valid, source: undefined })).toBe(false)
    expect(isAdmissibleMobileTerminalColdScrollback({ ...valid, source: 'fallback' })).toBe(false)
    expect(isAdmissibleMobileTerminalColdScrollback({ ...valid, serialized: undefined })).toBe(
      false
    )
    expect(isAdmissibleMobileTerminalColdScrollback({ ...valid, cols: 0 })).toBe(false)
    expect(isAdmissibleMobileTerminalColdScrollback({ ...valid, truncated: true })).toBe(false)
    expect(
      isAdmissibleMobileTerminalColdScrollback({ ...valid, truncatedByByteBudget: true })
    ).toBe(false)
    for (const malformed of ['true', 0, null, {}, []]) {
      expect(isAdmissibleMobileTerminalColdScrollback({ ...valid, truncated: malformed })).toBe(
        false
      )
      expect(
        isAdmissibleMobileTerminalColdScrollback({
          ...valid,
          truncatedByByteBudget: malformed
        })
      ).toBe(false)
    }
    expect(isAdmissibleMobileTerminalColdScrollback({ ...valid, truncated: false })).toBe(true)
  })

  it('evicts after grace and cancels a stale timer on rapid return', async () => {
    vi.useFakeTimers()
    const onEvict = vi.fn()
    let value!: ReturnType<typeof useMobileTerminalHotSet>
    const render = (activeHandle: string) =>
      createElement(Harness, {
        activeHandle,
        handles: ['a', 'b', 'c', 'd', 'e'],
        onEvict,
        onValue: (next) => {
          value = next
        }
      })

    await act(() => {
      renderer = create(render('a'))
    })
    for (const handle of ['b', 'c', 'd']) {
      await act(() => {
        renderer?.update(render(handle))
      })
    }
    expect(value.mountedHandles.size).toBe(4)
    onEvict.mockClear()

    await act(() => {
      renderer?.update(render('a'))
      vi.advanceTimersByTime(25)
    })

    expect(value.mountedHandles.has('a')).toBe(true)
    expect(onEvict).not.toHaveBeenCalledWith('a')
  })

  it('fails open and stays behavior-identical while disabled', async () => {
    const onEvict = vi.fn()
    let value!: ReturnType<typeof useMobileTerminalHotSet>
    const onValue = (next: ReturnType<typeof useMobileTerminalHotSet>) => {
      value = next
    }

    await act(() => {
      renderer = create(
        createElement(Harness, {
          activeHandle: 'a',
          handles: ['a', 'b', 'c', 'd'],
          onEvict,
          onValue
        })
      )
    })
    await act(() => value.failOpen('invalid-scrollback'))
    expect(value.mountedHandles).toEqual(new Set(['a', 'b', 'c', 'd']))
    expect(value.failOpenReason).toBe('invalid-scrollback')

    await act(() => {
      renderer?.update(
        createElement(Harness, {
          activeHandle: 'b',
          enabled: false,
          handles: ['a', 'b', 'c', 'd'],
          onEvict,
          onValue
        })
      )
    })
    expect(value.mountedHandles).toEqual(new Set(['a', 'b', 'c', 'd']))
  })

  it('permanently fails open across disconnect and reconnect', async () => {
    let value!: ReturnType<typeof useMobileTerminalHotSet>
    const onValue = (next: ReturnType<typeof useMobileTerminalHotSet>) => {
      value = next
    }
    const render = (connectionAdmissible: boolean, activeHandle: string) =>
      createElement(Harness, {
        activeHandle,
        connectionAdmissible,
        handles: ['a', 'b', 'c', 'd', 'e'],
        onEvict: vi.fn(),
        onValue
      })

    await act(() => {
      renderer = create(render(true, 'a'))
    })
    for (const handle of ['b', 'c', 'd', 'e']) {
      await act(() => renderer?.update(render(true, handle)))
    }
    expect(value.mountedHandles.size).toBe(4)

    await act(() => renderer?.update(render(false, 'e')))
    expect(value.mountedHandles).toEqual(new Set(['a', 'b', 'c', 'd', 'e']))
    expect(value.failOpenReason).toBe('connection-uncertain')

    await act(() => renderer?.update(render(true, 'e')))
    expect(value.mountedHandles).toEqual(new Set(['a', 'b', 'c', 'd', 'e']))
    expect(value.failOpenReason).toBe('connection-uncertain')
  })

  it('coalesces StrictMode effects and rejects parked stream events', async () => {
    vi.useFakeTimers()
    const onEvict = vi.fn()
    let value!: ReturnType<typeof useMobileTerminalHotSet>
    const render = (activeHandle: string) =>
      createElement(
        StrictMode,
        null,
        createElement(Harness, {
          activeHandle,
          handles: ['a', 'b', 'c', 'd'],
          onEvict,
          onValue: (next) => {
            value = next
          }
        })
      )

    await act(() => {
      renderer = create(render('a'))
    })
    for (const handle of ['b', 'c', 'd']) {
      await act(() => {
        renderer?.update(render(handle))
      })
    }
    await act(() => vi.advanceTimersByTime(25))

    expect(value.acceptsStreamEvent('a')).toBe(false)
    expect(onEvict).toHaveBeenCalledTimes(1)
  })

  it('does not publish authority from an aborted Suspense render', async () => {
    const onEvict = vi.fn()
    let committed!: ReturnType<typeof useMobileTerminalHotSet>
    const render = (suspend: boolean) =>
      createElement(
        Suspense,
        { fallback: null },
        createElement(CommitHarness, {
          activeHandle: suspend ? 'replacement' : 'active',
          handles: suspend ? ['replacement'] : ['active', 'warm-a', 'warm-b'],
          onEvict,
          onValue: (value) => {
            committed = value
          },
          suspend
        })
      )

    await act(() => {
      renderer = create(render(false))
    })
    expect(committed.acceptsStreamEvent('active')).toBe(true)

    await act(() => {
      renderer?.update(render(true))
    })

    expect(committed.acceptsStreamEvent('active')).toBe(true)
    expect(committed.acceptsStreamEvent('replacement')).toBe(false)
    expect(onEvict).not.toHaveBeenCalled()
  })

  it('fails open when a cold reveal never hydrates', async () => {
    vi.useFakeTimers()
    let value!: ReturnType<typeof useMobileTerminalHotSet>

    await act(() => {
      renderer = create(
        createElement(Harness, {
          activeHandle: 'cold',
          handles: ['cold', 'warm-a', 'warm-b', 'warm-c'],
          onEvict: vi.fn(),
          onValue: (next) => {
            value = next
          }
        })
      )
    })
    await act(() => vi.advanceTimersByTime(MOBILE_TERMINAL_COLD_REVEAL_TIMEOUT_MS))

    expect(value.failOpenReason).toBe('cold-reveal-timeout')
    expect(value.mountedHandles).toEqual(new Set(['cold', 'warm-a', 'warm-b', 'warm-c']))
  })
})
