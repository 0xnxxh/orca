import {
  markRestoredStaleCodexSessionsForRestart,
  type CodexPaneScanResult
} from './codex-session-restart'

// Why: the first delay coalesces the startup burst of binds and lets
// updateTabPtyId (written just after the layout binding) land, since the scan
// walks tabs. The later two cover a reattached daemon shell that answers
// `inspectProcess` with terminal_gone for a beat. Bounded on purpose — this is
// a hint, and a pane that never resolves must not become a polling loop.
const SWEEP_ATTEMPT_DELAYS_MS = [300, 1500, 4000] as const

const queuedPtyIds = new Set<string>()
const attemptsByPtyId = new Map<string, number>()
const notifiedPtyIds = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Queues a stale-account check for a PTY that has just bound to a pane.
 *
 * Why a bind signal rather than a startup call: nothing is attached while the
 * session hydrates, so a one-shot sweep inspects zero PTYs and never retries.
 * Every real bind rewrites the pane→PTY layout binding, which is the earliest
 * point the daemon shell can be inspected at all.
 */
export function notifyCodexPaneBoundForStaleSweep(ptyId: string): void {
  if (notifiedPtyIds.has(ptyId)) {
    return
  }
  queuedPtyIds.add(ptyId)
  arm(SWEEP_ATTEMPT_DELAYS_MS[0])
}

export function resetCodexStalePaneSweepForTests(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  queuedPtyIds.clear()
  attemptsByPtyId.clear()
  notifiedPtyIds.clear()
}

function arm(delayMs: number): void {
  if (flushTimer !== null) {
    return
  }
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flush()
  }, delayMs)
}

function shouldRetry(scan: CodexPaneScanResult): boolean {
  // Why: an eligible-but-unlisted pane got an authoritative "not stale" from the
  // registry, so only an unusable read or a Codex tab still showing its shell
  // (mid-reattach) can change answer on a later attempt.
  return !scan.eligible && (scan.inconclusive || scan.launchedCodex)
}

async function flush(): Promise<void> {
  const ptyIds = [...queuedPtyIds]
  queuedPtyIds.clear()
  if (ptyIds.length === 0) {
    return
  }

  let scans: CodexPaneScanResult[]
  try {
    scans = await markRestoredStaleCodexSessionsForRestart({ ptyIds })
  } catch (err) {
    console.warn('Codex stale-pane restart sweep failed:', err)
    return
  }

  const scanByPtyId = new Map(scans.map((scan) => [scan.ptyId, scan]))
  let nextDelayMs: number | null = null
  for (const ptyId of ptyIds) {
    const scan = scanByPtyId.get(ptyId)
    if (scan?.notified === true) {
      notifiedPtyIds.add(ptyId)
      attemptsByPtyId.delete(ptyId)
      continue
    }
    // Why: a PTY the scan never saw is not yet listed against its tab, which is
    // the same "ask again shortly" case as an unusable process read.
    if (scan !== undefined && !shouldRetry(scan)) {
      attemptsByPtyId.delete(ptyId)
      continue
    }
    const attempt = (attemptsByPtyId.get(ptyId) ?? 0) + 1
    const delayMs = SWEEP_ATTEMPT_DELAYS_MS[attempt]
    if (delayMs === undefined) {
      attemptsByPtyId.delete(ptyId)
      continue
    }
    attemptsByPtyId.set(ptyId, attempt)
    queuedPtyIds.add(ptyId)
    nextDelayMs = nextDelayMs === null ? delayMs : Math.min(nextDelayMs, delayMs)
  }

  if (nextDelayMs !== null) {
    arm(nextDelayMs)
  }
}
