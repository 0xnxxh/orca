import { describe, expect, it } from 'vitest'
import {
  MOBILE_TERMINAL_HOT_SET_GRACE_MS,
  createMobileTerminalHotSetState,
  failOpenMobileTerminalHotSet,
  reconcileMobileTerminalHotSet
} from './mobile-terminal-hot-set'

function reconcile(
  state: ReturnType<typeof createMobileTerminalHotSetState>,
  handles: readonly string[],
  activeHandle: string | null,
  now: number,
  enabled = true
) {
  return reconcileMobileTerminalHotSet(state, {
    scopeKey: 'host:worktree',
    enabled,
    handles,
    activeHandle,
    now
  })
}

describe('mobile terminal hot set', () => {
  it.each([10, 50])('bounds %i terminals to three after grace', (count) => {
    const handles = Array.from({ length: count }, (_, index) => `terminal-${index}`)
    let state = createMobileTerminalHotSetState('host:worktree')
    const disabled = reconcile(state, handles, handles[0]!, 0, false).state
    expect(disabled.mountedHandles.size).toBe(count)

    for (let index = 0; index < 4; index += 1) {
      state = reconcile(state, handles, handles[index]!, index).state
    }

    expect(state.mountedHandles.size).toBe(4)
    state = reconcile(state, handles, handles[3]!, MOBILE_TERMINAL_HOT_SET_GRACE_MS + 4).state

    expect(state.mountedHandles.size).toBe(3)
    expect(state.mountedHandles).toEqual(new Set(['terminal-3', 'terminal-2', 'terminal-1']))
  })

  it('keeps no more than one grace pane during rapid switching', () => {
    const handles = ['a', 'b', 'c', 'd', 'e']
    let state = createMobileTerminalHotSetState('host:worktree')
    for (const [index, handle] of handles.entries()) {
      state = reconcile(state, handles, handle, index).state
      expect(state.mountedHandles.size).toBeLessThanOrEqual(4)
    }

    expect(state.mountedHandles).toEqual(new Set(['e', 'd', 'c', 'b']))
  })

  it('cancels grace when a handle rapidly returns', () => {
    const handles = ['a', 'b', 'c', 'd']
    let state = createMobileTerminalHotSetState('host:worktree')
    for (const [index, handle] of handles.entries()) {
      state = reconcile(state, handles, handle, index).state
    }

    state = reconcile(state, handles, 'a', 10).state
    state = reconcile(state, handles, 'a', MOBILE_TERMINAL_HOT_SET_GRACE_MS + 20).state

    expect(state.mountedHandles.has('a')).toBe(true)
    expect(state.graceDeadlines.has('a')).toBe(false)
  })

  it('prunes removed handles and treats replacements as new identities', () => {
    const handles = ['a', 'b', 'c']
    let state = createMobileTerminalHotSetState('host:worktree')
    state = reconcile(state, handles, 'a', 0).state
    state = reconcile(state, handles, 'b', 1).state
    const result = reconcile(state, ['replacement', 'b', 'c'], 'replacement', 2)

    expect(result.state.mountedHandles.has('a')).toBe(false)
    expect(result.state.mountedHandles.has('replacement')).toBe(true)
    expect(result.evictedHandles).toContain('a')
  })

  it('renders every record while disabled or failed open', () => {
    const handles = ['a', 'b', 'c', 'd']
    let state = reconcile(createMobileTerminalHotSetState('host:worktree'), handles, 'a', 0).state

    state = reconcile(state, handles, 'b', 1, false).state
    expect(state.mountedHandles).toEqual(new Set(handles))

    state = failOpenMobileTerminalHotSet(state, handles).state
    expect(state.failOpen).toBe(true)
    expect(state.mountedHandles).toEqual(new Set(handles))
  })

  it('resets state for a reused route scope', () => {
    const first = reconcile(createMobileTerminalHotSetState('host:first'), ['a', 'b'], 'a', 0).state
    const next = reconcileMobileTerminalHotSet(first, {
      scopeKey: 'host:second',
      enabled: true,
      handles: ['replacement'],
      activeHandle: 'replacement',
      now: 1
    })

    expect(next.state.failOpen).toBe(false)
    expect(next.state.mountedHandles).toEqual(new Set(['replacement']))
    expect(next.state.recentHandles).toEqual([])
  })
})
