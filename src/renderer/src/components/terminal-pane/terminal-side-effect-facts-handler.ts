/**
 * Renderer consumer registry for the `pty:sideEffect` channel.
 *
 * Why: with main as the side-effect parser for local-daemon/SSH PTYs, the
 * renderer no longer
 * derives title/bell/agent facts from bytes for those PTYs. This module is
 * the single channel subscriber; mounted panes and parked-tab watchers
 * register exactly one fact consumer per PTY (their existing policy
 * callbacks), so every fact has exactly one policy consumer regardless of
 * whether the tab is mounted, hidden, or parked. The legacy push channel drops
 * missing consumers; durable authority policy returns unavailable without ACK.
 */
import type { GlobalSettings } from '../../../../shared/types'
import type { ParsedAgentStatusPayload } from '../../../../shared/agent-status-types'
import type { TerminalGitHubPRLink } from '../../../../shared/terminal-github-pr-link-detector'
import type {
  TerminalSideEffectBatch,
  TerminalSideEffectFact
} from '../../../../shared/terminal-side-effect-facts'
import type {
  TerminalAuthorityAppOutcomeIdentity,
  TerminalAuthorityOutcomeProjectionKind
} from '@/lib/terminal-authority-app-projection-controller'

// Why: cached once per session — the blocking read should only ever run on
// the pre-hydration startup path, never per pane bind.
let persistedAuthorityFlagCache: boolean | null | undefined

function readPersistedSideEffectAuthorityFlagSync(): boolean | null {
  if (persistedAuthorityFlagCache === undefined) {
    try {
      const getSync = (globalThis as { window?: Window }).window?.api?.settings?.getSync
      persistedAuthorityFlagCache =
        typeof getSync === 'function' ? (getSync()?.terminalMainSideEffectAuthority ?? null) : null
    } catch {
      persistedAuthorityFlagCache = null
    }
  }
  return persistedAuthorityFlagCache
}

/**
 * Structural authority predicate: main owns side effects for a PTY when its
 * bytes transit local main (everything except remote-runtime PTYs) and the
 * kill switch is on. Decided at transport/watcher creation — never per chunk —
 * so each fact has one consumer with no race.
 */
export function isMainTerminalSideEffectAuthorityForPty(args: {
  settings: Pick<GlobalSettings, 'terminalMainSideEffectAuthority'> | null
  /** Remote-runtime owner environment; null means bytes transit local main. */
  runtimeEnvironmentId: string | null
}): boolean {
  if (args.runtimeEnvironmentId !== null) {
    return false
  }
  if (args.settings !== null) {
    return args.settings.terminalMainSideEffectAuthority !== false
  }
  // Why: settings hydrate asynchronously, and the authority decision made
  // here at transport/watcher creation is never revisited. A pane bound
  // before hydration must honor the persisted kill switch — otherwise a user
  // who turned main authority off gets startup panes with no byte parsers
  // and a fact consumer they disabled. Surfaces without the sync read (web
  // remote clients, tests) keep the default-on behavior.
  return readPersistedSideEffectAuthorityFlagSync() !== false
}

type TerminalAuthorityAwareHandler<Args extends unknown[]> = (
  ...args: [...Args, TerminalAuthorityAppOutcomeIdentity?]
) => unknown

export type TerminalSideEffectFactConsumerCallbacks = {
  onAgentStatus?: TerminalAuthorityAwareHandler<[payload: ParsedAgentStatusPayload]>
  /** `meta.staleWorkingTitleClear` marks facts derived from main's 3s
   *  stale-title timer — policy must clear title/cache state without
   *  scheduling task-complete notifications or unread attention. */
  onTitleChange?: TerminalAuthorityAwareHandler<
    [normalizedTitle: string, rawTitle: string, meta?: { staleWorkingTitleClear?: boolean }]
  >
  onBell?: TerminalAuthorityAwareHandler<[]>
  onAgentBecameIdle?: TerminalAuthorityAwareHandler<
    [title: string, meta?: { staleWorkingTitleClear?: boolean }]
  >
  onAgentBecameWorking?: TerminalAuthorityAwareHandler<[]>
  onAgentExited?: TerminalAuthorityAwareHandler<[]>
  /** OSC 133;D — same policy hook the byte-mode commandLifecycle drove
   *  (stale agent-status row drop + interrupt-inference coordination). */
  onCommandFinished?: TerminalAuthorityAwareHandler<[bestEffortExitCode: number | null]>
  onPrLink?: TerminalAuthorityAwareHandler<[link: TerminalGitHubPRLink]>
  /** Command Code output scrape (no hooks): working seeds the status row;
   *  done is settle-checked by the pane policy before completing the turn. */
  onCommandCodeWorking?: TerminalAuthorityAwareHandler<[prompt: string]>
  onCommandCodeDone?: TerminalAuthorityAwareHandler<[prompt: string]>
  /** DECSET 2031 subscribe observed by main's tracker. Registered only by
   *  hidden-delivery-gated consumers (their bytes never arrive); the theme
   *  reply is sent renderer-side — query authority stays with the view. */
  onMode2031Subscribe?: TerminalAuthorityAwareHandler<[]>
  /** DECSET 2031 withdrawal observed by main's tracker. Clears the pane's
   *  subscription registry so later theme flips stop pushing CSI 997. */
  onMode2031Unsubscribe?: TerminalAuthorityAwareHandler<[]>
}

type ConsumerEntry = {
  callbacks: TerminalSideEffectFactConsumerCallbacks
  activateOnPredecessorRelease: boolean
  authorityOutcomeProjection: boolean
  incarnationId?: string
  restoreTitleOnRegister: boolean
  /** Output sequence of the last live title fact applied. Replay snapshots at
   *  or before this point are stale and must not regress the title state. */
  lastLiveTitleSeq: number | null
}

const consumersByPtyId = new Map<string, ConsumerEntry>()
const preparedConsumersByPtyId = new Map<string, ConsumerEntry>()
const consumerAvailableListeners = new Set<(ptyId: string) => void>()
let channelUnsubscribe: (() => void) | null = null

function applyLiveFact(
  entry: ConsumerEntry,
  fact: TerminalSideEffectFact,
  seq: number,
  authorityOutcome?: TerminalAuthorityAppOutcomeIdentity
): unknown {
  switch (fact.kind) {
    case 'agent-status':
      return entry.callbacks.onAgentStatus?.(fact.payload, authorityOutcome)
    case 'title':
      entry.lastLiveTitleSeq = seq
      return entry.callbacks.onTitleChange?.(
        fact.normalizedTitle,
        fact.rawTitle,
        fact.staleWorkingTitleClear ? { staleWorkingTitleClear: true } : undefined,
        authorityOutcome
      )
    case 'bell':
      return entry.callbacks.onBell?.(authorityOutcome)
    case 'agent-working':
      return entry.callbacks.onAgentBecameWorking?.(authorityOutcome)
    case 'agent-idle':
      return entry.callbacks.onAgentBecameIdle?.(
        fact.title,
        fact.staleWorkingTitleClear ? { staleWorkingTitleClear: true } : undefined,
        authorityOutcome
      )
    case 'agent-exited':
      return entry.callbacks.onAgentExited?.(authorityOutcome)
    case 'command-finished':
      return entry.callbacks.onCommandFinished?.(fact.exitCode, authorityOutcome)
    case 'pr-link':
      return entry.callbacks.onPrLink?.(fact.link, authorityOutcome)
    case 'command-code-working':
      return entry.callbacks.onCommandCodeWorking?.(fact.prompt, authorityOutcome)
    case 'command-code-done':
      return entry.callbacks.onCommandCodeDone?.(fact.prompt, authorityOutcome)
    case '2031-subscribe':
      return entry.callbacks.onMode2031Subscribe?.(authorityOutcome)
    case '2031-unsubscribe':
      return entry.callbacks.onMode2031Unsubscribe?.(authorityOutcome)
  }
}

function applyBatchToConsumer(
  entry: ConsumerEntry,
  batch: TerminalSideEffectBatch,
  authorityOutcome?: TerminalAuthorityAppOutcomeIdentity
): boolean {
  if (!consumerMatchesBatch(entry, batch)) {
    return false
  }
  if (batch.replay) {
    // Why: the no-attention-replay rule — (re)attach snapshots restore title
    // state only; historical bells/completions must never fire again. A replay
    // older (by output sequence) than the last live title fact is stale.
    if (entry.lastLiveTitleSeq !== null && batch.seq <= entry.lastLiveTitleSeq) {
      return false
    }
    for (const fact of batch.facts) {
      if (fact.kind === 'title') {
        entry.callbacks.onTitleChange?.(fact.normalizedTitle, fact.rawTitle)
      }
    }
    return true
  }
  for (const fact of batch.facts) {
    applyLiveFact(entry, fact, batch.seq, authorityOutcome)
  }
  return true
}

function consumerMatchesBatch(entry: ConsumerEntry, batch: TerminalSideEffectBatch): boolean {
  const batchIncarnationId = batch.ptyIncarnationId
  return (
    (entry.incarnationId === undefined && batchIncarnationId === undefined) ||
    entry.incarnationId === batchIncarnationId
  )
}

export function dispatchTerminalSideEffectBatch(
  batch: TerminalSideEffectBatch,
  authorityOutcome?: TerminalAuthorityAppOutcomeIdentity
): boolean {
  const entry = consumersByPtyId.get(batch.ptyId)
  if (!entry) {
    return false
  }
  return applyBatchToConsumer(entry, batch, authorityOutcome)
}

export async function settleTerminalAuthoritySideEffectBatch(
  batch: TerminalSideEffectBatch,
  authorityOutcome: TerminalAuthorityAppOutcomeIdentity
): Promise<boolean> {
  const entry = consumersByPtyId.get(batch.ptyId)
  if (!entry?.authorityOutcomeProjection || !consumerMatchesBatch(entry, batch)) {
    return false
  }
  for (const fact of batch.facts) {
    await applyLiveFact(entry, fact, batch.seq, authorityOutcome)
  }
  return true
}

export function onTerminalSideEffectFactConsumerAvailable(
  listener: (ptyId: string) => void
): () => void {
  consumerAvailableListeners.add(listener)
  return () => consumerAvailableListeners.delete(listener)
}

function ensureSideEffectChannelSubscription(): void {
  if (channelUnsubscribe !== null) {
    return
  }
  // Why: optional-chained from globalThis so unit tests (and any non-preload
  // surface) without window.api degrade to "no channel" instead of throwing.
  const onSideEffect = (globalThis as { window?: Window }).window?.api?.pty?.onSideEffect
  if (typeof onSideEffect !== 'function') {
    return
  }
  channelUnsubscribe = onSideEffect(dispatchTerminalSideEffectBatch)
}

export type TerminalSideEffectFactConsumerOptions = {
  ptyId: string
  /** Exact local/SSH PTY incarnation; absent legacy/remote consumers never inherit cursors. */
  incarnationId?: string
  callbacks: TerminalSideEffectFactConsumerCallbacks
  /** Declared only by projections that stay idempotent across process restart. */
  authorityOutcomeProjection?: TerminalAuthorityOutcomeProjectionKind
  /** Pull main's title-only replay snapshot on registration. Pane transports
   *  use this in place of deriving titles from eager-buffer byte replay.
   *  Ordinary parked watchers already have a current pane title; cold-started
   *  watchers request it because no pane populated their slot. */
  restoreTitleOnRegister?: boolean
}

export type PreparedTerminalSideEffectFactConsumer = {
  /** Atomically replace the active consumer, carrying its live-title cursor. */
  activate: (incarnationId?: string) => boolean
  /** Cancel only this unactivated successor. */
  cancel: () => void
  /** Release this consumer; an auto-activate successor takes over synchronously. */
  unregister: () => void
}

function requestTitleSnapshot(ptyId: string, entry: ConsumerEntry): void {
  if (!entry.restoreTitleOnRegister) {
    return
  }
  const getSnapshot = (globalThis as { window?: Window }).window?.api?.pty?.getSideEffectSnapshot
  if (typeof getSnapshot !== 'function') {
    return
  }
  void getSnapshot(ptyId)
    .then((batch) => {
      if (batch && consumersByPtyId.get(ptyId) === entry) {
        applyBatchToConsumer(entry, { ...batch, replay: true })
      }
    })
    .catch(() => {})
}

function activatePreparedConsumer(
  ptyId: string,
  entry: ConsumerEntry,
  incarnationId?: string
): boolean {
  if (consumersByPtyId.get(ptyId) === entry) {
    return true
  }
  if (preparedConsumersByPtyId.get(ptyId) !== entry) {
    return false
  }
  entry.incarnationId = incarnationId ?? entry.incarnationId
  const predecessor = consumersByPtyId.get(ptyId)
  if (
    entry.incarnationId !== undefined &&
    predecessor?.incarnationId === entry.incarnationId &&
    predecessor.lastLiveTitleSeq !== null
  ) {
    entry.lastLiveTitleSeq = predecessor.lastLiveTitleSeq
  }
  preparedConsumersByPtyId.delete(ptyId)
  consumersByPtyId.set(ptyId, entry)
  for (const listener of consumerAvailableListeners) {
    listener(ptyId)
  }
  requestTitleSnapshot(ptyId, entry)
  return true
}

export function prepareTerminalSideEffectFactConsumer(
  options: TerminalSideEffectFactConsumerOptions & {
    activateOnPredecessorRelease?: boolean
  }
): PreparedTerminalSideEffectFactConsumer {
  ensureSideEffectChannelSubscription()
  const entry: ConsumerEntry = {
    callbacks: options.callbacks,
    activateOnPredecessorRelease: options.activateOnPredecessorRelease === true,
    authorityOutcomeProjection: options.authorityOutcomeProjection === 'event-keyed-idempotent',
    ...(options.incarnationId ? { incarnationId: options.incarnationId } : {}),
    restoreTitleOnRegister: options.restoreTitleOnRegister === true,
    lastLiveTitleSeq: null
  }
  preparedConsumersByPtyId.set(options.ptyId, entry)

  const activate = (incarnationId?: string): boolean =>
    activatePreparedConsumer(options.ptyId, entry, incarnationId)

  return {
    activate,
    cancel(): void {
      if (preparedConsumersByPtyId.get(options.ptyId) === entry) {
        preparedConsumersByPtyId.delete(options.ptyId)
      }
    },
    unregister(): void {
      if (preparedConsumersByPtyId.get(options.ptyId) === entry) {
        preparedConsumersByPtyId.delete(options.ptyId)
        return
      }
      if (consumersByPtyId.get(options.ptyId) !== entry) {
        return
      }
      const successor = preparedConsumersByPtyId.get(options.ptyId)
      if (successor?.activateOnPredecessorRelease) {
        activatePreparedConsumer(options.ptyId, successor, successor.incarnationId)
        return
      }
      consumersByPtyId.delete(options.ptyId)
    }
  }
}

/**
 * Register the single fact consumer for a PTY. A new registration replaces a
 * stale one for the same PTY (same semantics as the parked watcher registry):
 * two consumers would double-fire bell/completion policy for the same bytes.
 */
export function registerTerminalSideEffectFactConsumer(
  options: TerminalSideEffectFactConsumerOptions
): () => void {
  const prepared = prepareTerminalSideEffectFactConsumer(options)
  prepared.activate()
  return prepared.unregister
}

/** Test seam: deliver a batch as if it arrived on the channel. */
export function _dispatchTerminalSideEffectBatchForTest(batch: TerminalSideEffectBatch): void {
  dispatchTerminalSideEffectBatch(batch)
}

/** Test seam: reset module state between tests. */
export function _resetTerminalSideEffectFactConsumersForTest(): void {
  consumersByPtyId.clear()
  preparedConsumersByPtyId.clear()
  consumerAvailableListeners.clear()
  channelUnsubscribe?.()
  channelUnsubscribe = null
  persistedAuthorityFlagCache = undefined
}
