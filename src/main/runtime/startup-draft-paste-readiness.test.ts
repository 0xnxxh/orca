/**
 * Why: the main-runtime startup draft paste (worktree-create / CLI / remote host
 * delivery) had no coverage, and resolved `null` on budget expiry — silently
 * dropping the prompt where both renderer paths fall back to process ownership
 * (STA-3367). Drives the real prototype methods through a stub host so the
 * scanner, the shared budget, and the fallback are all exercised.
 */
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { DRAFT_PASTE_READY_TIMEOUT_MS } from '../../shared/draft-paste-ready-scanner'
import { OrcaRuntimeService } from './orca-runtime'

const DECSET_BRACKETED_PASTE = '\x1b[?2004h'
const CODEX_COMPOSER_PROMPT_RENDER = '\x1b[1m›\x1b[0m Ask Codex to do anything'
const PTY_ID = 'pty-1'
const HANDLE = 'term-1'
// Why: the old budget that dropped the prompt, kept only to prove the waiter now
// outlasts it. The current value is pinned in draft-paste-ready-scanner.test.ts.
const OLD_DROPPED_AT_MS = 8000

type RuntimeHost = {
  getLivePtyForHandle: (handle: string) => { pty: { ptyId: string } } | null
  ptyController: { getForegroundProcess: (ptyId: string) => Promise<string | null> } | null
  recentPtyOutputById: Map<string, { read: () => string }>
  subscribeToTerminalData: (ptyId: string, observe: (data: string) => void) => () => void
  resolveDraftPastePtyIfAgentOwns: unknown
}

// Bracket access is the sanctioned escape hatch for private members; calling the
// real prototype keeps this from degrading into a re-implementation test.
const waitForStartupDraftReady = OrcaRuntimeService.prototype['waitForStartupDraftReady'] as (
  this: RuntimeHost,
  handle: string,
  agent: string
) => Promise<string | null>

describe('waitForStartupDraftReady', () => {
  let observer: ((data: string) => void) | null
  let unsubscribe: Mock<() => void>
  let getForegroundProcess: Mock<(ptyId: string) => Promise<string | null>>
  let host: RuntimeHost

  beforeEach(() => {
    vi.useFakeTimers()
    observer = null
    unsubscribe = vi.fn<() => void>()
    getForegroundProcess = vi
      .fn<(ptyId: string) => Promise<string | null>>()
      .mockResolvedValue('bash')
    host = {
      getLivePtyForHandle: () => ({ pty: { ptyId: PTY_ID } }),
      ptyController: {
        getForegroundProcess: (ptyId: string) => getForegroundProcess(ptyId)
      },
      recentPtyOutputById: new Map(),
      subscribeToTerminalData: (_ptyId, observe) => {
        observer = observe
        return unsubscribe
      },
      resolveDraftPastePtyIfAgentOwns:
        OrcaRuntimeService.prototype['resolveDraftPastePtyIfAgentOwns']
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves as soon as the codex composer glyph renders', async () => {
    const promise = waitForStartupDraftReady.call(host, HANDLE, 'codex')
    await Promise.resolve()

    observer?.(DECSET_BRACKETED_PASTE)
    observer?.(CODEX_COMPOSER_PROMPT_RENDER)

    await expect(promise).resolves.toBe(PTY_ID)
    expect(getForegroundProcess).not.toHaveBeenCalled()
    expect(unsubscribe).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('waits the full budget before giving up on a cold codex composer', async () => {
    const promise = waitForStartupDraftReady.call(host, HANDLE, 'codex')
    await Promise.resolve()
    observer?.(DECSET_BRACKETED_PASTE)

    // The old budget would already have resolved (to null) here.
    await vi.advanceTimersByTimeAsync(OLD_DROPPED_AT_MS)
    expect(getForegroundProcess).not.toHaveBeenCalled()

    // Still inside the budget: a late glyph is the real ready proof, and must
    // win over the ownership fallback.
    await vi.advanceTimersByTimeAsync(DRAFT_PASTE_READY_TIMEOUT_MS - OLD_DROPPED_AT_MS - 1)
    observer?.(CODEX_COMPOSER_PROMPT_RENDER)
    await expect(promise).resolves.toBe(PTY_ID)
    expect(getForegroundProcess).not.toHaveBeenCalled()
  })

  it('delivers best-effort when the marker never renders but codex owns the PTY (STA-3367)', async () => {
    // Why: the sidecar can attach after a fast TUI's handshake, and a cold boot
    // can outlast the budget. Neither is proof the agent is absent, so a missing
    // marker must fall back to ownership instead of dropping the prompt.
    getForegroundProcess.mockResolvedValue('codex')
    const promise = waitForStartupDraftReady.call(host, HANDLE, 'codex')
    await Promise.resolve()

    await vi.advanceTimersByTimeAsync(DRAFT_PASTE_READY_TIMEOUT_MS)

    await expect(promise).resolves.toBe(PTY_ID)
    expect(getForegroundProcess).toHaveBeenCalledWith(PTY_ID)
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('does not paste blind when the PTY fell back to the shell', async () => {
    getForegroundProcess.mockResolvedValue('bash')
    const promise = waitForStartupDraftReady.call(host, HANDLE, 'codex')
    await Promise.resolve()

    await vi.advanceTimersByTimeAsync(DRAFT_PASTE_READY_TIMEOUT_MS)

    await expect(promise).resolves.toBeNull()
  })

  it('treats a failed foreground inspection as not-ready rather than throwing', async () => {
    getForegroundProcess.mockRejectedValue(new Error('pty gone'))
    const promise = waitForStartupDraftReady.call(host, HANDLE, 'codex')
    await Promise.resolve()

    await vi.advanceTimersByTimeAsync(DRAFT_PASTE_READY_TIMEOUT_MS)

    await expect(promise).resolves.toBeNull()
  })

  it('returns null without subscribing when the handle has no live PTY', async () => {
    host.getLivePtyForHandle = () => null
    await expect(waitForStartupDraftReady.call(host, HANDLE, 'codex')).resolves.toBeNull()
    expect(observer).toBeNull()
  })
})
