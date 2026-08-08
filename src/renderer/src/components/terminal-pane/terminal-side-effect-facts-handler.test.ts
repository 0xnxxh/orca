import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalSideEffectBatch } from '../../../../shared/terminal-side-effect-facts'
import {
  _dispatchTerminalSideEffectBatchForTest,
  _resetTerminalSideEffectFactConsumersForTest,
  isMainTerminalSideEffectAuthorityForPty,
  prepareTerminalSideEffectFactConsumer,
  registerTerminalSideEffectFactConsumer,
  type TerminalSideEffectFactConsumerCallbacks
} from './terminal-side-effect-facts-handler'

const PTY_ID = 'wt-1#1'

function createCallbackRecorder(): {
  callbacks: TerminalSideEffectFactConsumerCallbacks
  events: unknown[][]
} {
  const events: unknown[][] = []
  return {
    events,
    callbacks: {
      onTitleChange: (normalizedTitle, rawTitle) =>
        events.push(['title', normalizedTitle, rawTitle]),
      onBell: () => events.push(['bell']),
      onAgentBecameIdle: (title) => events.push(['idle', title]),
      onAgentBecameWorking: () => events.push(['working']),
      onAgentExited: () => events.push(['exited'])
    }
  }
}

function batch(
  facts: TerminalSideEffectBatch['facts'],
  options: Partial<TerminalSideEffectBatch> = {}
): TerminalSideEffectBatch {
  return { ptyId: PTY_ID, seq: 0, facts, ...options }
}

describe('isMainTerminalSideEffectAuthorityForPty', () => {
  const originalWindow = (globalThis as { window?: typeof window }).window

  beforeEach(() => {
    _resetTerminalSideEffectFactConsumersForTest()
    delete (globalThis as { window?: unknown }).window
  })

  afterEach(() => {
    _resetTerminalSideEffectFactConsumersForTest()
    if (originalWindow) {
      ;(globalThis as { window: typeof window }).window = originalWindow
    } else {
      delete (globalThis as { window?: typeof window }).window
    }
  })

  function setPersistedSettingsSync(settings: unknown): void {
    ;(globalThis as { window: unknown }).window = {
      api: { settings: { getSync: () => settings } }
    }
  }

  it('is on by default for PTYs whose bytes transit local main', () => {
    expect(
      isMainTerminalSideEffectAuthorityForPty({ settings: {}, runtimeEnvironmentId: null })
    ).toBe(true)
    // Why: settings hydrate asynchronously; the default-on switch must not
    // flip authority off during the null-settings startup window.
    expect(
      isMainTerminalSideEffectAuthorityForPty({ settings: null, runtimeEnvironmentId: null })
    ).toBe(true)
  })

  it('is off for remote-runtime PTYs regardless of the setting', () => {
    expect(
      isMainTerminalSideEffectAuthorityForPty({
        settings: { terminalMainSideEffectAuthority: true },
        runtimeEnvironmentId: 'env-1'
      })
    ).toBe(false)
  })

  it('is off when the kill switch is disabled', () => {
    expect(
      isMainTerminalSideEffectAuthorityForPty({
        settings: { terminalMainSideEffectAuthority: false },
        runtimeEnvironmentId: null
      })
    ).toBe(false)
  })

  it('honors the persisted kill switch before settings hydrate', () => {
    // Why: the authority decision is made once at transport creation; a pane
    // bound during startup must not pick main authority when the user
    // persisted the switch off.
    setPersistedSettingsSync({ terminalMainSideEffectAuthority: false })

    expect(
      isMainTerminalSideEffectAuthorityForPty({ settings: null, runtimeEnvironmentId: null })
    ).toBe(false)
  })

  it('stays on pre-hydration when the persisted switch is on or unset', () => {
    setPersistedSettingsSync({ terminalMainSideEffectAuthority: true })
    expect(
      isMainTerminalSideEffectAuthorityForPty({ settings: null, runtimeEnvironmentId: null })
    ).toBe(true)

    _resetTerminalSideEffectFactConsumersForTest()
    setPersistedSettingsSync({})
    expect(
      isMainTerminalSideEffectAuthorityForPty({ settings: null, runtimeEnvironmentId: null })
    ).toBe(true)
  })

  it('prefers hydrated settings over the persisted sync read', () => {
    setPersistedSettingsSync({ terminalMainSideEffectAuthority: false })

    expect(
      isMainTerminalSideEffectAuthorityForPty({
        settings: { terminalMainSideEffectAuthority: true },
        runtimeEnvironmentId: null
      })
    ).toBe(true)
  })

  it('caches the sync read so panes do not re-block per bind', () => {
    const getSync = vi.fn(() => ({ terminalMainSideEffectAuthority: false }))
    ;(globalThis as { window: unknown }).window = { api: { settings: { getSync } } }

    isMainTerminalSideEffectAuthorityForPty({ settings: null, runtimeEnvironmentId: null })
    isMainTerminalSideEffectAuthorityForPty({ settings: null, runtimeEnvironmentId: null })

    expect(getSync).toHaveBeenCalledTimes(1)
  })
})

describe('registerTerminalSideEffectFactConsumer', () => {
  const originalWindow = (globalThis as { window?: typeof window }).window

  beforeEach(() => {
    _resetTerminalSideEffectFactConsumersForTest()
    delete (globalThis as { window?: unknown }).window
  })

  afterEach(() => {
    _resetTerminalSideEffectFactConsumersForTest()
    if (originalWindow) {
      ;(globalThis as { window: typeof window }).window = originalWindow
    } else {
      delete (globalThis as { window?: typeof window }).window
    }
  })

  it('routes live facts to the registered consumer in batch order', () => {
    const { callbacks, events } = createCallbackRecorder()
    registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: {
        ...callbacks,
        onAgentStatus: (payload) => events.push(['status', payload.state, payload.agentType])
      }
    })

    _dispatchTerminalSideEffectBatchForTest(
      batch([
        {
          kind: 'agent-status',
          payload: { state: 'working', prompt: 'fix it', agentType: 'codex' }
        },
        { kind: 'title', normalizedTitle: '⠋ Claude', rawTitle: '⠋ Claude' },
        { kind: 'agent-working' },
        { kind: 'title', normalizedTitle: '✳ Claude', rawTitle: '✳ Claude' },
        { kind: 'agent-idle', title: '✳ Claude' },
        { kind: 'bell' }
      ])
    )

    expect(events).toEqual([
      ['status', 'working', 'codex'],
      ['title', '⠋ Claude', '⠋ Claude'],
      ['working'],
      ['title', '✳ Claude', '✳ Claude'],
      ['idle', '✳ Claude'],
      ['bell']
    ])
  })

  it('routes command-finished and pr-link facts to the registered consumer', () => {
    const events: unknown[][] = []
    registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: {
        onCommandFinished: (exitCode) => events.push(['finished', exitCode]),
        onPrLink: (link) => events.push(['pr', link.url, link.number])
      }
    })

    _dispatchTerminalSideEffectBatchForTest(
      batch([
        { kind: 'command-finished', exitCode: 130 },
        {
          kind: 'pr-link',
          link: {
            url: 'https://github.com/acme/orca/pull/42',
            slug: { owner: 'acme', repo: 'orca' },
            number: 42
          }
        },
        { kind: 'command-finished', exitCode: null }
      ])
    )

    expect(events).toEqual([
      ['finished', 130],
      ['pr', 'https://github.com/acme/orca/pull/42', 42],
      ['finished', null]
    ])
  })

  it('routes command-code scrape facts to the registered consumer', () => {
    const events: unknown[][] = []
    registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: {
        onCommandCodeWorking: (prompt) => events.push(['cc-working', prompt]),
        onCommandCodeDone: (prompt) => events.push(['cc-done', prompt])
      }
    })

    _dispatchTerminalSideEffectBatchForTest(
      batch([
        { kind: 'command-code-working', prompt: 'Fix the spinner' },
        { kind: 'command-code-done', prompt: 'Fix the spinner' }
      ])
    )

    expect(events).toEqual([
      ['cc-working', 'Fix the spinner'],
      ['cc-done', 'Fix the spinner']
    ])
  })

  it('never replays command-code scrape facts', () => {
    // Why: a replayed working/done seed would resurrect a finished turn's
    // status row — replay batches restore title state only.
    const events: unknown[][] = []
    registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: {
        onTitleChange: (normalizedTitle) => events.push(['title', normalizedTitle]),
        onCommandCodeWorking: (prompt) => events.push(['cc-working', prompt]),
        onCommandCodeDone: (prompt) => events.push(['cc-done', prompt])
      }
    })

    _dispatchTerminalSideEffectBatchForTest(
      batch(
        [
          { kind: 'title', normalizedTitle: 'restored', rawTitle: 'restored' },
          { kind: 'command-code-working', prompt: 'Fix the spinner' },
          { kind: 'command-code-done', prompt: 'Fix the spinner' }
        ],
        { replay: true, seq: 5 }
      )
    )

    expect(events).toEqual([['title', 'restored']])
  })

  it('routes 2031-subscribe facts to the registered consumer but never replays them', () => {
    // Why: the fact lets hidden-delivery-gated views answer the color-scheme
    // query without byte access; a replayed subscribe would re-answer a query
    // the snapshot already satisfied.
    const events: unknown[][] = []
    registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: {
        onTitleChange: (normalizedTitle) => events.push(['title', normalizedTitle]),
        onMode2031Subscribe: () => events.push(['2031-subscribe'])
      }
    })

    _dispatchTerminalSideEffectBatchForTest(batch([{ kind: '2031-subscribe' }]))
    expect(events).toEqual([['2031-subscribe']])

    _dispatchTerminalSideEffectBatchForTest(
      batch(
        [
          { kind: 'title', normalizedTitle: 'restored', rawTitle: 'restored' },
          { kind: '2031-subscribe' }
        ],
        { replay: true, seq: 5 }
      )
    )
    expect(events).toEqual([['2031-subscribe'], ['title', 'restored']])
  })

  it('never replays command-finished or pr-link facts', () => {
    // Why: like bells and agent transitions, command/PR facts are attention
    // signals — replay snapshots restore title state only.
    const events: unknown[][] = []
    registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: {
        onTitleChange: (normalizedTitle) => events.push(['title', normalizedTitle]),
        onCommandFinished: (exitCode) => events.push(['finished', exitCode]),
        onPrLink: (link) => events.push(['pr', link.url])
      }
    })

    _dispatchTerminalSideEffectBatchForTest(
      batch(
        [
          { kind: 'title', normalizedTitle: 'restored', rawTitle: 'restored' },
          { kind: 'command-finished', exitCode: 0 },
          {
            kind: 'pr-link',
            link: {
              url: 'https://github.com/acme/orca/pull/42',
              slug: { owner: 'acme', repo: 'orca' },
              number: 42
            }
          }
        ],
        { replay: true, seq: 5 }
      )
    )

    expect(events).toEqual([['title', 'restored']])
  })

  it('passes stale-clear provenance through to the title and idle callbacks', () => {
    const events: unknown[][] = []
    registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: {
        onTitleChange: (normalizedTitle, _rawTitle, meta) =>
          events.push(['title', normalizedTitle, meta]),
        onAgentBecameIdle: (title, meta) => events.push(['idle', title, meta])
      }
    })

    _dispatchTerminalSideEffectBatchForTest(
      batch([
        { kind: 'agent-idle', title: 'Codex done' },
        {
          kind: 'title',
          normalizedTitle: 'Codex',
          rawTitle: 'Codex',
          staleWorkingTitleClear: true
        },
        { kind: 'agent-idle', title: 'Codex', staleWorkingTitleClear: true }
      ])
    )

    expect(events).toEqual([
      ['idle', 'Codex done', undefined],
      ['title', 'Codex', { staleWorkingTitleClear: true }],
      ['idle', 'Codex', { staleWorkingTitleClear: true }]
    ])
  })

  it('drops batches for PTYs without a registered consumer', () => {
    const { callbacks, events } = createCallbackRecorder()
    registerTerminalSideEffectFactConsumer({ ptyId: PTY_ID, callbacks })

    _dispatchTerminalSideEffectBatchForTest(batch([{ kind: 'bell' }], { ptyId: 'other-pty' }))

    expect(events).toEqual([])
  })

  it('applies only title facts from replay batches — no attention replay', () => {
    const { callbacks, events } = createCallbackRecorder()
    registerTerminalSideEffectFactConsumer({ ptyId: PTY_ID, callbacks })

    _dispatchTerminalSideEffectBatchForTest(
      batch(
        [
          { kind: 'title', normalizedTitle: '✳ Claude', rawTitle: '✳ Claude' },
          { kind: 'bell' },
          { kind: 'agent-idle', title: '✳ Claude' }
        ],
        { replay: true, seq: 10 }
      )
    )

    expect(events).toEqual([['title', '✳ Claude', '✳ Claude']])
  })

  it('drops a replay title not newer than the last applied live title', () => {
    const { callbacks, events } = createCallbackRecorder()
    registerTerminalSideEffectFactConsumer({ ptyId: PTY_ID, callbacks })

    _dispatchTerminalSideEffectBatchForTest(
      batch([{ kind: 'title', normalizedTitle: 'live', rawTitle: 'live' }], { seq: 20 })
    )
    _dispatchTerminalSideEffectBatchForTest(
      batch([{ kind: 'title', normalizedTitle: 'stale', rawTitle: 'stale' }], {
        replay: true,
        seq: 20
      })
    )
    _dispatchTerminalSideEffectBatchForTest(
      batch([{ kind: 'title', normalizedTitle: 'newer', rawTitle: 'newer' }], {
        replay: true,
        seq: 21
      })
    )

    expect(events).toEqual([
      ['title', 'live', 'live'],
      ['title', 'newer', 'newer']
    ])
  })

  it('keeps exactly one consumer per PTY: a new registration replaces the old', () => {
    const first = createCallbackRecorder()
    const second = createCallbackRecorder()
    const disposeFirst = registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: first.callbacks
    })
    registerTerminalSideEffectFactConsumer({ ptyId: PTY_ID, callbacks: second.callbacks })

    _dispatchTerminalSideEffectBatchForTest(batch([{ kind: 'bell' }]))
    // A stale registration's dispose must not evict the live consumer.
    disposeFirst()
    _dispatchTerminalSideEffectBatchForTest(batch([{ kind: 'bell' }]))

    expect(first.events).toEqual([])
    expect(second.events).toEqual([['bell'], ['bell']])
  })

  it('stops routing after the consumer unregisters', () => {
    const { callbacks, events } = createCallbackRecorder()
    const dispose = registerTerminalSideEffectFactConsumer({ ptyId: PTY_ID, callbacks })

    dispose()
    _dispatchTerminalSideEffectBatchForTest(batch([{ kind: 'bell' }]))

    expect(events).toEqual([])
  })

  it('keeps the predecessor live across an arbitrarily slow prepared replacement', () => {
    vi.useFakeTimers()
    const predecessor = createCallbackRecorder()
    registerTerminalSideEffectFactConsumer({ ptyId: PTY_ID, callbacks: predecessor.callbacks })
    const successor = createCallbackRecorder()
    const prepared = prepareTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: successor.callbacks
    })

    vi.advanceTimersByTime(75_000)
    for (let seq = 1; seq <= 100; seq += 1) {
      _dispatchTerminalSideEffectBatchForTest(batch([{ kind: 'bell' }], { seq }))
    }

    expect(predecessor.events).toHaveLength(100)
    expect(successor.events).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
    expect(prepared.activate()).toBe(true)
    _dispatchTerminalSideEffectBatchForTest(batch([{ kind: 'bell' }], { seq: 101 }))
    expect(successor.events).toEqual([['bell']])
    vi.useRealTimers()
  })

  it('does not buffer replay batches across a handoff', () => {
    // Why: the next consumer requests its own snapshot; a held replay would
    // regress the title it just restored.
    const dispose = registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: createCallbackRecorder().callbacks
    })
    dispose()

    _dispatchTerminalSideEffectBatchForTest(
      batch([{ kind: 'title', normalizedTitle: 'stale', rawTitle: 'stale' }], {
        replay: true,
        seq: 5
      })
    )

    const { callbacks, events } = createCallbackRecorder()
    registerTerminalSideEffectFactConsumer({ ptyId: PTY_ID, callbacks })

    expect(events).toEqual([])
  })

  it('auto-activates a prepared parked owner when its predecessor releases', async () => {
    const snapshot = batch([{ kind: 'title', normalizedTitle: 'snapshot', rawTitle: 'snapshot' }], {
      replay: true,
      seq: 20,
      ptyIncarnationId: 'incarnation-1'
    })
    ;(globalThis as { window: unknown }).window = {
      api: { pty: { getSideEffectSnapshot: vi.fn(async () => snapshot) } }
    }

    const predecessor = createCallbackRecorder()
    const dispose = registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      incarnationId: 'incarnation-1',
      callbacks: predecessor.callbacks
    })
    _dispatchTerminalSideEffectBatchForTest(
      batch([{ kind: 'title', normalizedTitle: 'live', rawTitle: 'live' }], {
        seq: 20,
        ptyIncarnationId: 'incarnation-1'
      })
    )

    const successor = createCallbackRecorder()
    prepareTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      incarnationId: 'incarnation-1',
      callbacks: successor.callbacks,
      restoreTitleOnRegister: true,
      activateOnPredecessorRelease: true
    })
    dispose()
    _dispatchTerminalSideEffectBatchForTest(
      batch([{ kind: 'bell' }], { seq: 21, ptyIncarnationId: 'incarnation-1' })
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(predecessor.events).toEqual([['title', 'live', 'live']])
    expect(successor.events).toEqual([['bell']])
  })

  it('leaves the predecessor active when a prepared successor is cancelled', () => {
    const predecessor = createCallbackRecorder()
    registerTerminalSideEffectFactConsumer({ ptyId: PTY_ID, callbacks: predecessor.callbacks })
    const successor = createCallbackRecorder()
    const prepared = prepareTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: successor.callbacks
    })

    prepared.cancel()
    _dispatchTerminalSideEffectBatchForTest(batch([{ kind: 'bell' }]))

    expect(predecessor.events).toEqual([['bell']])
    expect(successor.events).toEqual([])
    expect(prepared.activate()).toBe(false)
  })

  it('allows only the latest prepared successor to activate', () => {
    const predecessor = createCallbackRecorder()
    registerTerminalSideEffectFactConsumer({ ptyId: PTY_ID, callbacks: predecessor.callbacks })
    const stale = createCallbackRecorder()
    const stalePrepared = prepareTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: stale.callbacks
    })
    const current = createCallbackRecorder()
    const currentPrepared = prepareTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: current.callbacks
    })

    expect(stalePrepared.activate()).toBe(false)
    expect(currentPrepared.activate()).toBe(true)
    _dispatchTerminalSideEffectBatchForTest(batch([{ kind: 'bell' }]))

    expect(predecessor.events).toEqual([])
    expect(stale.events).toEqual([])
    expect(current.events).toEqual([['bell']])
  })

  it('does not inherit the title cursor across exact PTY incarnations', async () => {
    const snapshot = batch([{ kind: 'title', normalizedTitle: 'new', rawTitle: 'new' }], {
      replay: true,
      seq: 5,
      ptyIncarnationId: 'incarnation-new'
    })
    ;(globalThis as { window: unknown }).window = {
      api: { pty: { getSideEffectSnapshot: vi.fn(async () => snapshot) } }
    }
    registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      incarnationId: 'incarnation-old',
      callbacks: createCallbackRecorder().callbacks
    })
    _dispatchTerminalSideEffectBatchForTest(
      batch([{ kind: 'title', normalizedTitle: 'old', rawTitle: 'old' }], {
        seq: 50,
        ptyIncarnationId: 'incarnation-old'
      })
    )
    const successor = createCallbackRecorder()
    const prepared = prepareTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      incarnationId: 'incarnation-new',
      callbacks: successor.callbacks,
      restoreTitleOnRegister: true
    })

    expect(prepared.activate('incarnation-new')).toBe(true)
    await Promise.resolve()
    await Promise.resolve()

    expect(successor.events).toEqual([['title', 'new', 'new']])
  })

  it('fences same-id facts by exact incarnation before and after commit', () => {
    const predecessor = createCallbackRecorder()
    registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      incarnationId: 'incarnation-old',
      callbacks: predecessor.callbacks
    })
    const successor = createCallbackRecorder()
    const prepared = prepareTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      incarnationId: 'incarnation-new',
      callbacks: successor.callbacks
    })

    _dispatchTerminalSideEffectBatchForTest(
      batch([{ kind: 'bell' }], { seq: 1, ptyIncarnationId: 'incarnation-new' })
    )
    _dispatchTerminalSideEffectBatchForTest(
      batch([{ kind: 'bell' }], { seq: 2, ptyIncarnationId: 'incarnation-old' })
    )
    expect(predecessor.events).toEqual([['bell']])
    expect(successor.events).toEqual([])

    expect(prepared.activate('incarnation-new')).toBe(true)
    _dispatchTerminalSideEffectBatchForTest(batch([{ kind: 'bell' }], { seq: 3 }))
    _dispatchTerminalSideEffectBatchForTest(
      batch([{ kind: 'bell' }], { seq: 4, ptyIncarnationId: 'incarnation-old' })
    )
    _dispatchTerminalSideEffectBatchForTest(
      batch([{ kind: 'bell' }], { seq: 5, ptyIncarnationId: 'incarnation-new' })
    )

    expect(predecessor.events).toEqual([['bell']])
    expect(successor.events).toEqual([['bell']])
  })

  it('subscribes to the channel once and routes IPC batches', () => {
    let channelCallback: ((batch: TerminalSideEffectBatch) => void) | null = null
    const onSideEffect = vi.fn((callback: (batch: TerminalSideEffectBatch) => void) => {
      channelCallback = callback
      return () => {
        channelCallback = null
      }
    })
    ;(globalThis as { window: unknown }).window = {
      api: { pty: { onSideEffect } }
    }
    const first = createCallbackRecorder()
    const second = createCallbackRecorder()
    registerTerminalSideEffectFactConsumer({ ptyId: PTY_ID, callbacks: first.callbacks })
    registerTerminalSideEffectFactConsumer({ ptyId: 'pty-2', callbacks: second.callbacks })

    expect(onSideEffect).toHaveBeenCalledTimes(1)
    channelCallback!(batch([{ kind: 'bell' }], { ptyId: 'pty-2' }))
    expect(second.events).toEqual([['bell']])
  })

  it('applies the title snapshot on register unless the registration was replaced', async () => {
    let resolveSnapshot: (value: TerminalSideEffectBatch | null) => void = () => {}
    const getSideEffectSnapshot = vi.fn(
      () =>
        new Promise<TerminalSideEffectBatch | null>((resolve) => {
          resolveSnapshot = resolve
        })
    )
    ;(globalThis as { window: unknown }).window = {
      api: { pty: { getSideEffectSnapshot } }
    }

    const first = createCallbackRecorder()
    registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks: first.callbacks,
      restoreTitleOnRegister: true
    })
    expect(getSideEffectSnapshot).toHaveBeenCalledWith(PTY_ID)

    // Replace before the snapshot resolves: the slow snapshot must not fire
    // into the superseded registration.
    const second = createCallbackRecorder()
    registerTerminalSideEffectFactConsumer({ ptyId: PTY_ID, callbacks: second.callbacks })
    resolveSnapshot(
      batch([{ kind: 'title', normalizedTitle: 'restored', rawTitle: 'restored' }], {
        replay: true,
        seq: 5
      })
    )
    await Promise.resolve()

    expect(first.events).toEqual([])
    expect(second.events).toEqual([])
  })

  it('restores the snapshot title for a live registration', async () => {
    const snapshot = batch([{ kind: 'title', normalizedTitle: 'restored', rawTitle: 'restored' }], {
      replay: true,
      seq: 5
    })
    ;(globalThis as { window: unknown }).window = {
      api: { pty: { getSideEffectSnapshot: vi.fn(async () => snapshot) } }
    }
    const { callbacks, events } = createCallbackRecorder()
    registerTerminalSideEffectFactConsumer({
      ptyId: PTY_ID,
      callbacks,
      restoreTitleOnRegister: true
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(events).toEqual([['title', 'restored', 'restored']])
  })
})
