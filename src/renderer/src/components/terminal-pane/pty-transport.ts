/* oxlint-disable max-lines -- Why: tightly coupled IPC ↔ xterm data pipeline (lifecycle, data, agent-status, titles) with no clean split point. */
import {
  detectAgentStatusFromTitle,
  clearWorkingIndicators,
  createAgentStatusTracker,
  normalizeTerminalTitle,
  extractAllOscTitles
} from '../../../../shared/agent-detection'
import {
  isTerminalInputTooLargeWithDeferredMeasurement,
  iterateTerminalInputChunks
} from '../../../../shared/terminal-input'
import { isRuntimeOwnedSshTargetId } from '../../../../shared/execution-host'
import {
  ptyDataHandlers,
  ptyReplayHandlers,
  drainRolledBackPtyShutdownData,
  ptyExitHandlers,
  ptyTeardownHandlers,
  ptyShutdownLifecycleHandlers,
  ptyWriteUnavailableHandlers,
  ensurePtyDispatcher,
  getEagerPtyBufferHandle,
  isPtyDataHandlerShutdownPending
} from './pty-dispatcher'
import {
  clearConsumedPreHandlerPtyExit,
  drainPreHandlerPtyData,
  drainPreHandlerPtyExit,
  hasPreHandlerPtyExit,
  isPreHandlerPtyStateDiscarded
} from './pty-pre-handler-buffer'
import { createPtyInputWriteQueue } from './pty-input-write-queue'
import { killPtyWithMutationIdentity } from './pty-mutation-operation'
import { createPtyMutationAccessController } from './pty-mutation-access-controller'
import {
  samePtyMutationBindingTarget,
  type PtyMutationBindingTarget
} from './pty-mutation-binding-target'
import { normalizePtyMutationAccess } from './pty-mutation-access-claim'
import {
  claimPtyRendererHandlers,
  releasePtyRendererHandlerClaim,
  type PtyRendererHandlerClaim
} from './pty-renderer-handler-claim'
import type { PtyDataMeta } from './pty-dispatcher'
import type {
  IpcPtyTransportOptions,
  PtyConnectResult,
  PtyTransport,
  PtyTransportInputTarget
} from './pty-transport-types'
import { createBellDetector } from '../../../../shared/terminal-bell-detector'
import {
  hasTerminalDisplayContent,
  trimIncompleteTerminalControlTail
} from './terminal-output-visibility'
import {
  createAgentStatusOscProcessor,
  type ProcessedAgentStatusChunk
} from '../../../../shared/agent-status-osc'
import { extractIpcErrorMessage } from '@/lib/ipc-error'
import {
  registerPtySideEffectPendingGauge,
  type PtySideEffectGauge
} from './pty-side-effect-pending-census'
import { isTuiAgent } from '../../../../shared/tui-agent-config'

// Re-export public API so existing consumers keep working.
export {
  ensurePtyDispatcher,
  getEagerPtyBufferHandle,
  registerEagerPtyBuffer,
  restorePtyDataHandlersAfterFailedShutdown,
  subscribeToPtyExit,
  unregisterPtyDataHandlers
} from './pty-dispatcher'
export type { EagerPtyHandle } from './pty-dispatcher'
export type {
  IpcPtyTransportOptions,
  LocalPtySessionMetadata,
  PtyBufferSnapshot,
  PtyConnectResult,
  PtyTransport,
  PtyTransportInputTarget
} from './pty-transport-types'
export { extractLastOscTitle } from '../../../../shared/agent-detection'

const SSH_SESSION_EXPIRED_ERROR = 'SSH_SESSION_EXPIRED'
// Why: main rejects a session reattached under a different SSH connection with this phrase; treat as stale (spawn fresh), not a crash.
const SSH_PTY_CONNECTION_MISMATCH_MARKER = 'belongs to SSH connection'
const STALE_TITLE_TIMEOUT = 3000 // ms before stale working title is cleared
const MAX_PTY_SIDE_EFFECTS_PER_DRAIN = 64
// Why: background timer throttling clamps the drain to ~64 effects/s while an agent CLI can queue
// hundreds/s, so an overnight minimized window otherwise grows this queue without bound (C1/H2).
// 512 ≈ 8 drain ticks of catch-up latency once visible; entries are compact facts (≤1 title/payload).
export const MAX_PENDING_PTY_SIDE_EFFECTS = 512
// Why: agent status is last-wins store state, but payloads can carry KB-scale prompt/tool strings;
// carry only the newest few through eviction so a status flood cannot re-grow what it evicted.
export const MAX_EVICTED_AGENT_STATUS_PAYLOAD_CARRY = 16

type PtyOutputCallbacks = Parameters<PtyTransport['connect']>[0]['callbacks']

type PtyOutputProcessorOptions = Pick<
  IpcPtyTransportOptions,
  | 'onTitleChange'
  | 'onBell'
  | 'onAgentBecameIdle'
  | 'onAgentBecameWorking'
  | 'onAgentExited'
  | 'onAgentStatus'
> & {
  /** Seed for mid-session processors (parked-tab watchers): pane's last title, so an agent finishing mid-stream still yields a working→idle transition. */
  initialAgentTitle?: string
}

type ProcessPtyOutputOptions = {
  replayingBufferedData?: boolean
  suppressAttentionEvents?: boolean
  clearBeforeReplay?: boolean
  // Why: a mid-escape tail; the replay consumer writes it LAST (after the post-replay reset) so the next live chunk completes it, not renders it literally (#7329).
  pendingEscapeTailAnsi?: string
}

type PendingPtySideEffect = {
  payloads: ProcessedAgentStatusChunk['payloads']
  titles: string[]
  titleScanEffect: 'none' | 'stale-probe' | 'ignored-cursor-native'
  containsBell: boolean
  suppressAttentionEvents: boolean
}

function isIgnoredCursorNativeTitle(title: string): boolean {
  return title.trim().toLowerCase() === 'cursor agent'
}

function removeIgnoredCursorNativeTitles(titles: string[]): boolean {
  let writeIndex = 0
  let removed = false
  for (let readIndex = 0; readIndex < titles.length; readIndex += 1) {
    const title = titles[readIndex]
    if (isIgnoredCursorNativeTitle(title)) {
      removed = true
      continue
    }
    if (writeIndex !== readIndex) {
      titles[writeIndex] = title
    }
    writeIndex += 1
  }
  if (removed) {
    titles.length = writeIndex
  }
  return removed
}

export function createPtyOutputProcessor({
  onTitleChange,
  onBell,
  onAgentBecameIdle,
  onAgentBecameWorking,
  onAgentExited,
  onAgentStatus,
  initialAgentTitle
}: PtyOutputProcessorOptions): {
  processData: (
    data: string,
    callbacks: PtyOutputCallbacks,
    options?: ProcessPtyOutputOptions,
    meta?: PtyDataMeta
  ) => void
  clearAccumulatedState: () => void
  pausePendingSideEffects: () => void
  clearStaleTitleTimer: () => void
  flushPendingSideEffects: () => void
  resetBellDetector: () => void
  resetAgentStatusCarry: () => void
  disposePendingSideEffectGauge: () => void
} {
  const bellDetector = createBellDetector()
  // Why let: a model-restore marker drops bytes; recreating the parser stops a partial OSC-9999 carry from swallowing the next chunk's head.
  let processAgentStatusChunk = createAgentStatusOscProcessor()
  // Why: seed emitted-title memory and the agent tracker so a mid-session processor behaves as if it had observed the pane's last live title.
  let lastEmittedTitle: string | null =
    initialAgentTitle !== undefined ? normalizeTerminalTitle(initialAgentTitle) : null
  let staleTitleTimer: ReturnType<typeof setTimeout> | null = null
  let sideEffectDrainTimer: ReturnType<typeof setTimeout> | null = null
  let pendingSideEffects: PendingPtySideEffect[] = []
  let pendingSideEffectIndex = 0
  let pendingWorkingTitleSideEffects = 0
  // Why both counts: drained entries survive until compaction, so depth alone understates what the array retains.
  const pendingSideEffectGauge: PtySideEffectGauge = {
    pending: () => pendingSideEffects.length - pendingSideEffectIndex,
    retained: () => pendingSideEffects.length
  }
  const disposePendingSideEffectGauge = registerPtySideEffectPendingGauge(pendingSideEffectGauge)
  const agentTracker =
    onAgentBecameIdle || onAgentBecameWorking || onAgentExited
      ? createAgentStatusTracker(
          (title) => {
            onAgentBecameIdle?.(title)
          },
          onAgentBecameWorking,
          onAgentExited,
          initialAgentTitle
        )
      : null

  function isWorkingTitle(title: string | null): boolean {
    return title !== null && detectAgentStatusFromTitle(title) === 'working'
  }

  function countWorkingTitles(titles: string[]): number {
    let count = 0
    for (const title of titles) {
      if (isWorkingTitle(normalizeTerminalTitle(title))) {
        count += 1
      }
    }
    return count
  }

  function applyObservedTerminalTitle(title: string, suppressAgentTracker = false): void {
    lastEmittedTitle = normalizeTerminalTitle(title)
    onTitleChange?.(lastEmittedTitle, title)
    if (!suppressAgentTracker) {
      agentTracker?.handleTitle(title)
    }
  }

  function clearStaleTitleTimer(): void {
    if (staleTitleTimer) {
      clearTimeout(staleTitleTimer)
      staleTitleTimer = null
    }
  }

  function scheduleSideEffectDrain(): void {
    if (sideEffectDrainTimer !== null) {
      return
    }
    // Why: defer title/status/BEL store work so xterm.write()'s own parse timer and live rendering get the next turn.
    sideEffectDrainTimer = setTimeout(drainPtySideEffects, 0)
  }

  // Why: oldest-first eviction at the cap. Evicted titles are safe to drop (titles are last-wins);
  // bells and agent-status payloads collapse onto the next-oldest survivor so a pending bell latch
  // and the newest statuses still apply on drain instead of vanishing.
  function evictOldestPendingSideEffectsIfFull(): void {
    while (pendingSideEffects.length - pendingSideEffectIndex >= MAX_PENDING_PTY_SIDE_EFFECTS) {
      const evicted = pendingSideEffects[pendingSideEffectIndex]
      if (!evicted) {
        return
      }
      pendingSideEffectIndex += 1
      // Why: mirror applyPtySideEffect's accounting so stale-probe arming doesn't stick past eviction.
      pendingWorkingTitleSideEffects -= countWorkingTitles(evicted.titles)
      if (pendingWorkingTitleSideEffects < 0) {
        pendingWorkingTitleSideEffects = 0
      }
      const survivor = pendingSideEffects[pendingSideEffectIndex]
      if (survivor) {
        if (evicted.containsBell) {
          survivor.containsBell = true
        }
        if (evicted.payloads.length > 0) {
          const merged = evicted.payloads.concat(survivor.payloads)
          survivor.payloads =
            merged.length > MAX_EVICTED_AGENT_STATUS_PAYLOAD_CARRY
              ? merged.slice(-MAX_EVICTED_AGENT_STATUS_PAYLOAD_CARRY)
              : merged
        }
      }
      compactPendingSideEffectsIfNeeded()
    }
  }

  function enqueuePtySideEffect(next: PendingPtySideEffect): void {
    const workingTitleCount = countWorkingTitles(next.titles)
    const prior = pendingSideEffects.at(-1)
    if (
      prior &&
      prior.titles.length === 0 &&
      prior.payloads.length === 0 &&
      !prior.containsBell &&
      prior.suppressAttentionEvents === next.suppressAttentionEvents &&
      next.titles.length === 0 &&
      next.payloads.length === 0 &&
      !next.containsBell
    ) {
      // Why: for adjacent no-op scans, only the latest event decides whether stale-title detection stays cleared or re-arms.
      prior.titleScanEffect = next.titleScanEffect
      pendingWorkingTitleSideEffects += workingTitleCount
      return
    }
    evictOldestPendingSideEffectsIfFull()
    pendingSideEffects.push(next)
    pendingWorkingTitleSideEffects += workingTitleCount
  }

  function schedulePtySideEffects(
    data: string,
    payloads: ReturnType<typeof processAgentStatusChunk>['payloads'],
    suppressAttentionEvents: boolean
  ): void {
    const scannedForTitles = Boolean(onTitleChange && data.includes('\x1b]'))
    const titles = scannedForTitles ? extractAllOscTitles(data) : []
    // Why: Cursor emits this ignored title every redraw; keep one queue fact instead of an allocation and drain slot per frame.
    const ignoredCursorNativeTitle = removeIgnoredCursorNativeTitles(titles)
    const deliveredPayloads =
      onAgentStatus && !suppressAttentionEvents && payloads.length > 0 ? payloads : []
    const containsBell = Boolean(
      onBell && !suppressAttentionEvents && bellDetector.chunkContainsBell(data)
    )
    const needsStaleTitleProbe = Boolean(
      onTitleChange &&
      data.length > 0 &&
      titles.length === 0 &&
      !suppressAttentionEvents &&
      (isWorkingTitle(lastEmittedTitle) || pendingWorkingTitleSideEffects > 0)
    )
    const shouldEmitEmptyTitleScan = scannedForTitles || needsStaleTitleProbe
    const emptyTitleScanEffect: PendingPtySideEffect['titleScanEffect'] = ignoredCursorNativeTitle
      ? 'ignored-cursor-native'
      : shouldEmitEmptyTitleScan
        ? 'stale-probe'
        : 'none'
    if (!shouldEmitEmptyTitleScan && deliveredPayloads.length === 0 && !containsBell) {
      return
    }

    // Why: queue compact derived facts, not raw PTY chunks, which would duplicate the terminal scheduler backlog while timers are throttled.
    if (deliveredPayloads.length === 0 && titles.length === 0) {
      enqueuePtySideEffect({
        payloads: [],
        titles: [],
        titleScanEffect: emptyTitleScanEffect,
        containsBell,
        suppressAttentionEvents
      })
    } else {
      for (const payload of deliveredPayloads) {
        enqueuePtySideEffect({
          payloads: [payload],
          titles: [],
          titleScanEffect: 'none',
          containsBell: false,
          suppressAttentionEvents
        })
      }
      if (titles.length === 0 && shouldEmitEmptyTitleScan) {
        enqueuePtySideEffect({
          payloads: [],
          titles: [],
          titleScanEffect: emptyTitleScanEffect,
          containsBell: false,
          suppressAttentionEvents
        })
      }
      for (const title of titles) {
        enqueuePtySideEffect({
          payloads: [],
          titles: [title],
          titleScanEffect: 'none',
          containsBell: false,
          suppressAttentionEvents
        })
      }
      if (containsBell) {
        enqueuePtySideEffect({
          payloads: [],
          titles: [],
          titleScanEffect: 'none',
          containsBell: true,
          suppressAttentionEvents
        })
      }
    }
    scheduleSideEffectDrain()
  }

  function clearSideEffectDrainTimer(): void {
    if (sideEffectDrainTimer) {
      clearTimeout(sideEffectDrainTimer)
      sideEffectDrainTimer = null
    }
  }

  function compactPendingSideEffectsIfNeeded(force = false): void {
    if (pendingSideEffectIndex === 0) {
      return
    }
    if (pendingSideEffectIndex >= pendingSideEffects.length) {
      pendingSideEffects = []
      pendingSideEffectIndex = 0
      return
    }
    if (force || pendingSideEffectIndex >= MAX_PTY_SIDE_EFFECTS_PER_DRAIN * 4) {
      pendingSideEffects = pendingSideEffects.slice(pendingSideEffectIndex)
      pendingSideEffectIndex = 0
    }
  }

  function applyPtySideEffect(next: PendingPtySideEffect): void {
    pendingWorkingTitleSideEffects -= countWorkingTitles(next.titles)
    if (pendingWorkingTitleSideEffects < 0) {
      pendingWorkingTitleSideEffects = 0
    }
    if (onAgentStatus) {
      for (const payload of next.payloads) {
        onAgentStatus(payload)
      }
    }
    processObservedTitles(next.titles, next.titleScanEffect, next.suppressAttentionEvents)
    if (onBell && next.containsBell) {
      onBell()
    }
  }

  function drainPtySideEffects(options: { flushAll?: boolean } = {}): void {
    sideEffectDrainTimer = null
    const maxEffects = options.flushAll ? Number.POSITIVE_INFINITY : MAX_PTY_SIDE_EFFECTS_PER_DRAIN
    let processed = 0
    while (pendingSideEffectIndex < pendingSideEffects.length && processed < maxEffects) {
      const next = pendingSideEffects[pendingSideEffectIndex]
      if (!next) {
        break
      }
      pendingSideEffectIndex += 1
      processed += 1
      applyPtySideEffect(next)
    }
    compactPendingSideEffectsIfNeeded(options.flushAll === true)
    if (pendingSideEffectIndex < pendingSideEffects.length) {
      // Why: thousands of queued OSC facts can pile up under timer throttling; bound each drain so paint and terminal input run between batches.
      scheduleSideEffectDrain()
    }
  }

  function flushPendingSideEffects(): void {
    clearSideEffectDrainTimer()
    drainPtySideEffects({ flushAll: true })
  }

  function processObservedTitles(
    titles: string[],
    titleScanEffect: PendingPtySideEffect['titleScanEffect'],
    suppressAgentTracker: boolean
  ): void {
    if (!onTitleChange) {
      return
    }
    // Why: process every OSC title in order, not just the last; batching coalesces titles into one payload and order preserves working→idle transitions.
    if (titles.length > 0) {
      clearStaleTitleTimer()
      for (const title of titles) {
        applyObservedTerminalTitle(title, suppressAgentTracker)
      }
    } else if (titleScanEffect === 'ignored-cursor-native') {
      clearStaleTitleTimer()
    } else if (
      titleScanEffect === 'stale-probe' &&
      !suppressAgentTracker &&
      lastEmittedTitle &&
      detectAgentStatusFromTitle(lastEmittedTitle) === 'working'
    ) {
      clearStaleTitleTimer()
      staleTitleTimer = setTimeout(() => {
        staleTitleTimer = null
        if (lastEmittedTitle && detectAgentStatusFromTitle(lastEmittedTitle) === 'working') {
          const cleared = clearWorkingIndicators(lastEmittedTitle)
          lastEmittedTitle = cleared
          onTitleChange(cleared, cleared)
          agentTracker?.handleTitle(cleared)
        }
      }, STALE_TITLE_TIMEOUT)
    }
  }

  function processData(
    data: string,
    callbacks: PtyOutputCallbacks,
    options: ProcessPtyOutputOptions = {},
    meta?: PtyDataMeta
  ): void {
    const rawLength = meta?.rawLength ?? data.length
    const suppressAttentionEvents = options.suppressAttentionEvents === true
    // Why: parse Orca's OSC 9999 before xterm; carry parser state across chunks so partial reads don't drop status or print escape garbage.
    const processed = processAgentStatusChunk(data)
    data = processed.cleanData
    // Why: during eager-buffer replay, suppress stale agent-status callbacks from a prior session (bytes still consumed so nothing leaks into xterm).
    if (options.replayingBufferedData && callbacks.onReplayData) {
      const replayMeta = {
        ...(options.clearBeforeReplay === false ? { clearBeforeReplay: false } : {}),
        ...(options.pendingEscapeTailAnsi
          ? { pendingEscapeTailAnsi: options.pendingEscapeTailAnsi }
          : {})
      }
      // Why: preserve the bare-data call shape when there's no replay metadata, so eager-buffer replay (which passes none) is unchanged.
      if (Object.keys(replayMeta).length > 0) {
        callbacks.onReplayData(data, replayMeta)
      } else {
        callbacks.onReplayData(data)
      }
    } else {
      if (meta) {
        callbacks.onData?.(data, { ...meta, rawLength })
      } else {
        callbacks.onData?.(data)
      }
    }
    schedulePtySideEffects(data, processed.payloads, suppressAttentionEvents)
  }

  function clearAccumulatedState(): void {
    clearSideEffectDrainTimer()
    pendingSideEffects.length = 0
    pendingSideEffectIndex = 0
    pendingWorkingTitleSideEffects = 0
    clearStaleTitleTimer()
    agentTracker?.reset()
    bellDetector.reset()
  }

  function pausePendingSideEffects(): void {
    clearSideEffectDrainTimer()
    clearStaleTitleTimer()
  }

  return {
    processData,
    clearAccumulatedState,
    pausePendingSideEffects,
    clearStaleTitleTimer,
    flushPendingSideEffects,
    resetBellDetector: () => bellDetector.reset(),
    resetAgentStatusCarry: () => {
      processAgentStatusChunk = createAgentStatusOscProcessor()
    },
    disposePendingSideEffectGauge
  }
}

export function createIpcPtyTransport(opts: IpcPtyTransportOptions = {}): PtyTransport {
  const {
    cwd,
    cwdFallback,
    env,
    envToDelete,
    command,
    launchConfig,
    resumeProviderSession,
    launchToken,
    launchAgent,
    startupCommandDelivery,
    connectionId,
    worktreeId,
    tabId,
    leafId,
    paneGeneration,
    shellOverride,
    projectRuntime,
    terminalColorQueryReplies,
    telemetry,
    onPtyExit,
    onTitleChange,
    onPtySpawn,
    onBell,
    onAgentBecameIdle,
    onAgentBecameWorking,
    onAgentExited,
    onAgentStatus
  } = opts
  let connected = false
  let destroyed = false
  let ptyId: string | null = null
  let connectionAttemptGeneration = 0
  let pendingIdentityExits: {
    id: string
    code: number
    incarnationId?: string
    handler: (code: number, incarnationId?: string) => void
  }[] = []
  const inputTargetOwner = Object.freeze({})
  let storedCallbacks: Parameters<PtyTransport['connect']>[0]['callbacks'] = {}
  const mutationAccess = createPtyMutationAccessController({
    tabId,
    leafId,
    paneGeneration,
    onUnavailable: () => storedCallbacks.onWriteUnavailable?.(),
    onAccessAvailable: (id) => {
      deliverPendingIdentityExits(id)
      if (connected && ptyId === id) {
        storedCallbacks.onMutationAccessAvailable?.()
      }
    }
  })
  // Why: replayed eager-buffer data (often from a prior app session) must not fire fresh bells, unread marks, or notifications on reconnect.
  let suppressAttentionEvents = false
  const inputWriteQueue = createPtyInputWriteQueue<PtyMutationBindingTarget>({
    isWritable: (target) =>
      connected && ptyId === target.id && mutationAccess.isCurrentTarget(target),
    write: (target, data) => mutationAccess.writeTarget(target, data),
    sameTarget: samePtyMutationBindingTarget
  })
  const captureInputTarget = (): PtyTransportInputTarget | null => {
    const binding = ptyId ? mutationAccess.captureTarget(ptyId) : null
    return connected && binding ? { owner: inputTargetOwner, binding } : null
  }
  const inputBindingForTarget = (
    target: PtyTransportInputTarget
  ): PtyMutationBindingTarget | null => {
    if (target.owner !== inputTargetOwner) {
      return null
    }
    const binding = target.binding as PtyMutationBindingTarget
    return connected && ptyId === binding.id && mutationAccess.isCurrentTarget(binding)
      ? binding
      : null
  }
  const outputProcessor = createPtyOutputProcessor({
    onTitleChange,
    onBell,
    onAgentBecameIdle: (title) => {
      if (!suppressAttentionEvents) {
        onAgentBecameIdle?.(title)
      }
    },
    onAgentBecameWorking,
    onAgentExited,
    onAgentStatus
  })
  // Why: a new pane can attach to the same ptyId before the old instance's detach() runs; track owned handlers so unregister never deletes the live one.
  const ownedDataAndReplayHandlers = new Map<
    string,
    {
      data: (data: string, meta?: PtyDataMeta) => void
      replay: (data: string) => void
      writeUnavailable: () => void
      claim?: PtyRendererHandlerClaim
    }
  >()
  const ownedExitHandlers = new Map<string, (code: number, incarnationId?: string) => void>()
  const pendingRendererBindingCancellations = new Map<string, Set<() => void>>()

  function trackPendingRendererBinding(id: string, cancel: () => void): void {
    const pending = pendingRendererBindingCancellations.get(id) ?? new Set()
    pending.add(cancel)
    pendingRendererBindingCancellations.set(id, pending)
  }

  function untrackPendingRendererBinding(id: string, cancel: () => void): void {
    const pending = pendingRendererBindingCancellations.get(id)
    pending?.delete(cancel)
    if (pending?.size === 0) {
      pendingRendererBindingCancellations.delete(id)
    }
  }

  function cancelPendingRendererBindings(id?: string): void {
    const pending = id
      ? [...(pendingRendererBindingCancellations.get(id) ?? [])]
      : [...pendingRendererBindingCancellations.values()].flatMap((entries) => [...entries])
    for (const cancel of pending) {
      cancel()
    }
  }

  function unregisterPtyHandlers(id: string): void {
    unregisterPtyDataAndStatusHandlers(id)
    const ownedExit = ownedExitHandlers.get(id)
    if (ownedExit && ptyExitHandlers.get(id) === ownedExit) {
      ptyExitHandlers.delete(id)
    }
    ownedExitHandlers.delete(id)
    pendingIdentityExits = pendingIdentityExits.filter((exit) => exit.id !== id)
    if (ptyTeardownHandlers.get(id) === clearAccumulatedState) {
      ptyTeardownHandlers.delete(id)
    }
    if (ptyShutdownLifecycleHandlers.get(id) === shutdownLifecycle) {
      ptyShutdownLifecycleHandlers.delete(id)
    }
  }

  function unregisterPtyDataAndStatusHandlers(id: string): void {
    const owned = ownedDataAndReplayHandlers.get(id)
    if (owned) {
      if (ptyDataHandlers.get(id) === owned.data) {
        ptyDataHandlers.delete(id)
      }
      if (ptyReplayHandlers.get(id) === owned.replay) {
        ptyReplayHandlers.delete(id)
      }
      if (ptyWriteUnavailableHandlers.get(id) === owned.writeUnavailable) {
        ptyWriteUnavailableHandlers.delete(id)
      }
    }
    releasePtyRendererHandlerClaim(id, owned?.claim)
    ownedDataAndReplayHandlers.delete(id)
  }

  function registerPtyDataHandler(id: string, rendererClaim?: PtyRendererHandlerClaim): boolean {
    // Why: route relay replay data through onReplayData so the replay guard stops xterm auto-replies from leaking into the shell.
    const replayHandler = (data: string): void => {
      if (ptyId !== id) {
        return
      }
      if (storedCallbacks.onReplayData) {
        storedCallbacks.onReplayData(data)
      } else {
        storedCallbacks.onData?.(data)
      }
    }
    const dataHandler = (data: string, meta?: PtyDataMeta): void => {
      if (ptyId !== id) {
        return
      }
      outputProcessor.processData(
        data,
        storedCallbacks,
        {
          suppressAttentionEvents
        },
        meta
      )
    }
    if (!claimPtyRendererHandlers(id, rendererClaim)) {
      return false
    }
    ptyReplayHandlers.set(id, replayHandler)
    ptyDataHandlers.set(id, dataHandler)
    // Guard like the data/replay handlers: a transport that rebinds to a new id without
    // detaching leaves this entry behind, and a fan-out for the stale id would otherwise
    // remount a healthy pane.
    const writeUnavailable = (): void => {
      if (ptyId === id) {
        storedCallbacks.onWriteUnavailable?.()
      }
    }
    ptyWriteUnavailableHandlers.set(id, writeUnavailable)
    ownedDataAndReplayHandlers.set(id, {
      data: dataHandler,
      replay: replayHandler,
      writeUnavailable,
      ...(rendererClaim ? { claim: rendererClaim } : {})
    })
    if (!isPtyDataHandlerShutdownPending(id)) {
      drainPreHandlerPtyData(id, dataHandler)
      drainRolledBackPtyShutdownData(id)
    }
    return true
  }

  function clearAccumulatedState(): void {
    outputProcessor.clearAccumulatedState()
  }

  const shutdownLifecycle = {
    pause: outputProcessor.pausePendingSideEffects,
    rollback: outputProcessor.flushPendingSideEffects,
    commit: clearAccumulatedState
  }

  function yieldToInputWriteDrain(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }

  async function writeAcceptedPtyInput(
    target: PtyMutationBindingTarget,
    data: string
  ): Promise<boolean> {
    try {
      const tooLarge = isTerminalInputTooLargeWithDeferredMeasurement(data)
      if (typeof tooLarge === 'boolean' ? tooLarge : await tooLarge) {
        return false
      }
      const chunks = iterateTerminalInputChunks(data)
      let chunk = chunks.next()
      while (!chunk.done) {
        if (!connected || ptyId !== target.id || !mutationAccess.isCurrentTarget(target)) {
          return false
        }
        const accepted = await mutationAccess.writeAcceptedTarget(target, chunk.value)
        if (!accepted) {
          return false
        }
        chunk = chunks.next()
        if (!chunk.done) {
          await yieldToInputWriteDrain()
        }
      }
      return true
    } catch {
      return false
    }
  }

  function deliverPendingIdentityExits(id: string): void {
    const pending = pendingIdentityExits.filter((exit) => exit.id === id)
    pendingIdentityExits = pendingIdentityExits.filter((exit) => exit.id !== id)
    for (const exit of pending) {
      if (
        ptyId !== id ||
        ownedExitHandlers.get(id) !== exit.handler ||
        ptyExitHandlers.get(id) !== exit.handler
      ) {
        continue
      }
      exit.handler(exit.code, exit.incarnationId)
      if (ptyId !== id) {
        return
      }
    }
  }

  function registerPtyExitHandler(id: string): boolean {
    const hadBufferedExit = hasPreHandlerPtyExit(id)
    let exitDelivered = false
    let expectedIncarnationId = mutationAccess.currentIdentity(id)?.incarnationId
    let acceptsLegacyExit = mutationAccess.isLegacyBinding(id)
    const exitHandler = (code: number, incarnationId?: string): void => {
      if (ptyId !== null && ptyId !== id) {
        // Why: a preserved sleep/reconnect session can report its old exit after this transport already rebound to a replacement PTY.
        unregisterPtyHandlers(id)
        return
      }
      if (!expectedIncarnationId && !acceptsLegacyExit) {
        expectedIncarnationId = mutationAccess.currentIdentity(id)?.incarnationId
        acceptsLegacyExit = mutationAccess.isLegacyBinding(id)
      }
      if (expectedIncarnationId) {
        if (!incarnationId || incarnationId !== expectedIncarnationId) {
          if (ownedExitHandlers.get(id) === exitHandler && ptyId === id) {
            ptyExitHandlers.set(id, exitHandler)
          }
          return
        }
      } else if (!acceptsLegacyExit) {
        if (pendingIdentityExits.length < 8) {
          pendingIdentityExits.push({
            id,
            code,
            ...(incarnationId ? { incarnationId } : {}),
            handler: exitHandler
          })
        }
        if (ownedExitHandlers.get(id) === exitHandler && ptyId === id) {
          ptyExitHandlers.set(id, exitHandler)
        }
        return
      }
      exitDelivered = true
      cancelPendingRendererBindings(id)
      clearAccumulatedState()
      connected = false
      ptyId = null
      mutationAccess.release()
      unregisterPtyHandlers(id)
      storedCallbacks.onExit?.(code)
      storedCallbacks.onDisconnect?.()
      onPtyExit?.(id)
    }
    ptyExitHandlers.set(id, exitHandler)
    ownedExitHandlers.set(id, exitHandler)
    // Why: shutdownWorktreeTerminals kills PTYs directly, bypassing disconnect/destroy; this cancels timers/tracker state that would fire stale notifications.
    ptyTeardownHandlers.set(id, clearAccumulatedState)
    ptyShutdownLifecycleHandlers.set(id, shutdownLifecycle)
    try {
      drainPreHandlerPtyExit(id, exitHandler)
    } catch (error) {
      if (!hadBufferedExit) {
        throw error
      }
      // Why: a cleanup failure must not turn an already-delivered pre-attach exit into a connect rejection and fallback spawn.
      console.error('[pty] buffered pre-attach exit cleanup failed', error)
    }
    return hadBufferedExit && exitDelivered
  }

  return {
    async connect(options) {
      const attemptGeneration = (connectionAttemptGeneration += 1)
      storedCallbacks = options.callbacks
      ensurePtyDispatcher()

      if (destroyed) {
        return
      }

      if (
        paneGeneration === undefined &&
        options.sessionId &&
        hasPreHandlerPtyExit(options.sessionId)
      ) {
        if (options.admitPtyId && !options.admitPtyId(options.sessionId)) {
          return { id: options.sessionId } satisfies PtyConnectResult
        }
        // Why: deliver the exited parked session's buffered final frame/exit before spawn, so the dead incarnation can't orphan a fresh shell reusing its id.
        ptyId = options.sessionId
        connected = true
        mutationAccess.bind(options.sessionId, { mode: 'legacy' })
        if (!registerPtyDataHandler(options.sessionId)) {
          connected = false
          ptyId = null
          mutationAccess.release()
          storedCallbacks = {}
          return { id: options.sessionId } satisfies PtyConnectResult
        }
        registerPtyExitHandler(options.sessionId)
        return { id: options.sessionId, exitedBeforeAttach: true } satisfies PtyConnectResult
      }

      const admittedSessionId =
        options.sessionId && !isPreHandlerPtyStateDiscarded(options.sessionId)
          ? options.sessionId
          : undefined

      // Why: reconnect may reuse a session id whose prior exit was consumed; re-admit exits without clearing bytes already buffered for the live session.
      if (admittedSessionId) {
        clearConsumedPreHandlerPtyExit(admittedSessionId)
      }

      let cancelPendingRendererBinding: (() => void) | null = null
      try {
        // Why: cwd fallback is only for fresh local spawns — reattach keeps the session's cwd and SSH transports resolve cwd on the remote host.
        const shouldSendLocalCwdFallback =
          cwdFallback === 'worktree' && !connectionId && !admittedSessionId
        const mutationClaimant =
          paneGeneration !== undefined ? mutationAccess.prepareBinding() : undefined
        const result = await window.api.pty.spawn({
          cols: options.cols ?? 80,
          rows: options.rows ?? 24,
          cwd,
          ...(shouldSendLocalCwdFallback ? { cwdFallback } : {}),
          env: options.env ?? env,
          ...((options.envToDelete ?? envToDelete)
            ? { envToDelete: options.envToDelete ?? envToDelete }
            : {}),
          command: options.command ?? command,
          ...((options.launchConfig ?? launchConfig)
            ? { launchConfig: options.launchConfig ?? launchConfig }
            : {}),
          ...((options.resumeProviderSession ?? resumeProviderSession)
            ? {
                resumeProviderSession: options.resumeProviderSession ?? resumeProviderSession
              }
            : {}),
          ...((options.launchToken ?? launchToken)
            ? { launchToken: options.launchToken ?? launchToken }
            : {}),
          ...((options.launchAgent ?? launchAgent)
            ? { launchAgent: options.launchAgent ?? launchAgent }
            : {}),
          ...((options.startupCommandDelivery ?? startupCommandDelivery)
            ? { startupCommandDelivery: options.startupCommandDelivery ?? startupCommandDelivery }
            : {}),
          ...(connectionId ? { connectionId } : {}),
          ...(admittedSessionId ? { sessionId: admittedSessionId } : {}),
          // Why: hidden-at-spawn mark must reach main before the PTY's first byte — ride the spawn IPC, not the visibility sync (terminal-query-authority.md).
          ...(options.initiallyHidden ? { initiallyHidden: true } : {}),
          worktreeId,
          ...(tabId ? { tabId } : {}),
          ...(leafId ? { leafId } : {}),
          ...(paneGeneration !== undefined ? { tabGeneration: paneGeneration } : {}),
          ...(mutationClaimant ? { mutationClaimant } : {}),
          ...(shellOverride ? { shellOverride } : {}),
          ...(projectRuntime ? { projectRuntime } : {}),
          ...(terminalColorQueryReplies ? { terminalColorQueryReplies } : {}),
          ...(telemetry ? { telemetry } : {})
        })
        const spawnResult = result as PtyConnectResult & { isReattach?: boolean }
        const rendererBindingAccess = normalizePtyMutationAccess(
          spawnResult.mutationAccess,
          paneGeneration,
          mutationClaimant
        )
        const rendererHandlerClaim =
          paneGeneration !== undefined && mutationClaimant
            ? {
                paneGeneration,
                claimant: mutationClaimant,
                ...(rendererBindingAccess.mode === 'exact' ? { access: rendererBindingAccess } : {})
              }
            : undefined
        let rendererBindingPending = Boolean(admittedSessionId && rendererHandlerClaim)
        const cancelRendererBinding = (): void => {
          if (!rendererBindingPending || !rendererHandlerClaim) {
            return
          }
          rendererBindingPending = false
          cancelPendingRendererBinding = null
          untrackPendingRendererBinding(spawnResult.id, cancelRendererBinding)
          window.api.pty.cancelRendererBinding?.({
            id: spawnResult.id,
            paneGeneration: rendererHandlerClaim.paneGeneration,
            claimant: rendererHandlerClaim.claimant,
            ...(rendererHandlerClaim.access ? { access: rendererHandlerClaim.access } : {})
          })
        }
        const settleRendererBinding = (): void => {
          if (!rendererBindingPending || !rendererHandlerClaim) {
            return
          }
          rendererBindingPending = false
          cancelPendingRendererBinding = null
          untrackPendingRendererBinding(spawnResult.id, cancelRendererBinding)
          if (rendererHandlerClaim.access) {
            window.api.pty.rendererBindingReady?.({
              id: spawnResult.id,
              access: rendererHandlerClaim.access
            })
          } else {
            window.api.pty.cancelRendererBinding?.({
              id: spawnResult.id,
              paneGeneration: rendererHandlerClaim.paneGeneration,
              claimant: rendererHandlerClaim.claimant
            })
          }
        }
        cancelPendingRendererBinding = cancelRendererBinding
        if (rendererBindingPending) {
          trackPendingRendererBinding(spawnResult.id, cancelRendererBinding)
        }
        // Why: an older SSH attach may resolve last; clean only its result before it can clear the successor's shared binding.
        if (destroyed || attemptGeneration !== connectionAttemptGeneration) {
          cancelRendererBinding()
          if (!spawnResult.isReattach && !spawnResult.coldRestore && spawnResult.id !== ptyId) {
            await killPtyWithMutationIdentity(
              spawnResult.id,
              false,
              rendererBindingAccess.mode === 'exact' ? rendererBindingAccess.identity : undefined
            ).catch(() => {})
          }
          return undefined
        }
        mutationAccess.bind(spawnResult.id, spawnResult.mutationAccess, mutationClaimant)
        const resultLaunchAgent = isTuiAgent(spawnResult.launchAgent)
          ? spawnResult.launchAgent
          : undefined
        const retireFreshSpawn = async (): Promise<void> => {
          try {
            if (!spawnResult.isReattach && !spawnResult.coldRestore) {
              await mutationAccess.kill(spawnResult.id)
            }
          } finally {
            mutationAccess.release()
          }
        }

        // Why: on destroy mid-connect, kill only a fresh spawn — killing a reattached session (owned by the tab lifecycle) loses a live shell.
        if (destroyed) {
          cancelRendererBinding()
          await retireFreshSpawn()
          return
        }

        if (options.admitPtyId && !options.admitPtyId(spawnResult.id)) {
          // Why: a rejected session-expired fallback has no owner to retire its newly created process.
          cancelRendererBinding()
          await retireFreshSpawn()
          return spawnResult
        }

        if (spawnResult.isReattach && !admittedSessionId) {
          storedCallbacks.onReattachDetermined?.()
        }
        ptyId = spawnResult.id
        connected = true

        // Why: skip onPtySpawn for reattach/coldRestore — it would reset lastActivityAt and destroy the recency sort order.
        if (!spawnResult.isReattach && !spawnResult.coldRestore) {
          onPtySpawn?.(spawnResult.id)
        }

        if (!registerPtyDataHandler(spawnResult.id, rendererHandlerClaim)) {
          cancelRendererBinding()
          connected = false
          ptyId = null
          mutationAccess.release()
          return spawnResult
        }
        const exitedBeforeAttach = registerPtyExitHandler(spawnResult.id)
        if (exitedBeforeAttach) {
          cancelRendererBinding()
          return { id: spawnResult.id, exitedBeforeAttach: true } satisfies PtyConnectResult
        }
        if (!connected || ptyId !== spawnResult.id) {
          cancelRendererBinding()
          return undefined
        }

        const rendererBindingSettlement =
          rendererBindingPending && rendererHandlerClaim?.access
            ? Object.freeze({
                id: spawnResult.id,
                paneGeneration: rendererHandlerClaim.paneGeneration,
                ready: settleRendererBinding,
                cancel: cancelRendererBinding
              })
            : undefined
        if (!rendererBindingSettlement) {
          settleRendererBinding()
        }

        storedCallbacks.onConnect?.()
        storedCallbacks.onStatus?.('shell')

        if (spawnResult.isReattach || spawnResult.coldRestore || spawnResult.sessionExpired) {
          return {
            id: spawnResult.id,
            // Why: recovery needs to distinguish an attach that ignored startup intent from a fresh spawn that ran it.
            ...(spawnResult.isReattach ? { isReattach: true } : {}),
            ...(resultLaunchAgent ? { launchAgent: resultLaunchAgent } : {}),
            ...(spawnResult.launchConfig ? { launchConfig: spawnResult.launchConfig } : {}),
            snapshot: spawnResult.snapshot,
            snapshotCols: spawnResult.snapshotCols,
            snapshotRows: spawnResult.snapshotRows,
            isAlternateScreen: spawnResult.isAlternateScreen,
            sessionExpired: spawnResult.sessionExpired,
            coldRestore: spawnResult.coldRestore,
            replay: spawnResult.replay,
            pendingEscapeTailAnsi: spawnResult.pendingEscapeTailAnsi,
            ...(rendererBindingSettlement ? { rendererBindingSettlement } : {}),
            // Why: the cold-restore path re-runs the launch command, so it needs the
            // same "main declined the resume" signal the fresh-spawn path gets.
            ...(spawnResult.agentResumeUnavailable ? { agentResumeUnavailable: true as const } : {})
          } satisfies PtyConnectResult
        }
        if (
          resultLaunchAgent ||
          spawnResult.launchConfig ||
          spawnResult.startupCwdFallback ||
          spawnResult.agentResumeUnavailable
        ) {
          return {
            id: spawnResult.id,
            ...(resultLaunchAgent ? { launchAgent: resultLaunchAgent } : {}),
            ...(spawnResult.launchConfig ? { launchConfig: spawnResult.launchConfig } : {}),
            ...(spawnResult.startupCwdFallback
              ? { startupCwdFallback: spawnResult.startupCwdFallback }
              : {}),
            ...(spawnResult.agentResumeUnavailable
              ? { agentResumeUnavailable: true as const }
              : {}),
            ...(rendererBindingSettlement ? { rendererBindingSettlement } : {})
          } satisfies PtyConnectResult
        }
        if (rendererBindingSettlement) {
          return { id: spawnResult.id, rendererBindingSettlement } satisfies PtyConnectResult
        }
        return spawnResult.id
      } catch (err) {
        cancelPendingRendererBinding?.()
        if (destroyed || attemptGeneration !== connectionAttemptGeneration) {
          return undefined
        }
        const msg = extractIpcErrorMessage(err, err instanceof Error ? err.message : String(err))
        if (
          connectionId &&
          options.sessionId &&
          (msg.includes(SSH_SESSION_EXPIRED_ERROR) ||
            msg.includes(SSH_PTY_CONNECTION_MISMATCH_MARKER))
        ) {
          return {
            id: options.sessionId,
            sessionExpired: true
          } satisfies PtyConnectResult
        }
        // Why: re-spawning a Kill-All'd session throws TerminalKilledError; swallow it (pane still shows "Process exited"), don't toast (src/main/daemon/daemon-pty-adapter.ts).
        if (msg.includes('was explicitly killed')) {
          return undefined
        }
        // Why: on cold start the SSH provider isn't registered yet, so pty:spawn throws a raw IPC error; replace with a friendly message.
        if (connectionId && msg.includes('No PTY provider for connection')) {
          // Why: a disappearing runtime-owned SSH target is expected teardown (e.g. workspace deleted); don't surface a reconnect toast.
          if (!isRuntimeOwnedSshTargetId(connectionId)) {
            storedCallbacks.onError?.(
              'SSH connection is not active. Use the reconnect dialog or Settings to connect.'
            )
          }
        } else {
          storedCallbacks.onError?.(msg)
        }
        return undefined
      }
    },

    attach(options) {
      connectionAttemptGeneration += 1
      storedCallbacks = options.callbacks
      ensurePtyDispatcher()

      if (destroyed) {
        return
      }

      const id = options.existingPtyId
      const mutationClaimant =
        paneGeneration !== undefined ? mutationAccess.prepareBinding() : undefined
      ptyId = id
      connected = true
      // Why: skip onPtySpawn — it would reset lastActivityAt and destroy the recency sort order reconnectPersistedTerminals preserved.
      const rendererHandlerClaim =
        paneGeneration !== undefined && mutationClaimant
          ? { paneGeneration, claimant: mutationClaimant }
          : undefined
      if (!registerPtyDataHandler(id, rendererHandlerClaim)) {
        connected = false
        ptyId = null
        mutationAccess.release()
        storedCallbacks = {}
        return
      }
      mutationAccess.bind(id, undefined, mutationClaimant)
      registerPtyExitHandler(id)
      if (!connected || ptyId !== id) {
        return
      }

      const bufferHandle = getEagerPtyBufferHandle(id)
      if (bufferHandle) {
        const buffered = bufferHandle.flush()
        if (buffered) {
          const replayData = trimIncompleteTerminalControlTail(buffered)
          const shouldClearBeforeReplay =
            !options.isAlternateScreen && hasTerminalDisplayContent(replayData)
          // Why: hidden PTYs may pre-render a TUI into the eager buffer; clear stale contents before replay, keep scrollback for control-only frames.
          if (shouldClearBeforeReplay && !storedCallbacks.onReplayData) {
            const clear = '\x1b[2J\x1b[3J\x1b[H'
            storedCallbacks.onData?.(clear)
          }

          // Why: silence attention events during replay so a historical BEL from a prior session doesn't ring on the freshly mounted pane.
          suppressAttentionEvents = true
          try {
            // Why: replayingBufferedData routes bytes through onReplayData so the replay guard blocks xterm query auto-replies from leaking into shell stdin.
            outputProcessor.processData(replayData, storedCallbacks, {
              replayingBufferedData: true,
              suppressAttentionEvents: true,
              clearBeforeReplay: shouldClearBeforeReplay
            })
          } finally {
            // Why: flush deferred side effects before resetting parser state, else a partial OSC can swallow the next live BEL.
            outputProcessor.flushPendingSideEffects()
            suppressAttentionEvents = false
            // Why: replay may arm a stale-title timer that fires 3s later (outside suppression) and force a spurious working→idle transition.
            outputProcessor.clearStaleTitleTimer()
            // Why: eager-buffered bytes may end mid-OSC (inOsc=true); reset so the next live BEL isn't swallowed as an OSC terminator.
            outputProcessor.resetBellDetector()
          }
        }
        bufferHandle.dispose()
      }

      if (options.cols && options.rows) {
        mutationAccess.resize(id, options.cols, options.rows)
      }

      storedCallbacks.onConnect?.()
      storedCallbacks.onStatus?.('shell')
    },

    disconnect() {
      connectionAttemptGeneration += 1
      cancelPendingRendererBindings()
      clearAccumulatedState()
      inputWriteQueue.clear()
      if (ptyId) {
        const id = ptyId
        void mutationAccess
          .kill(id)
          .catch(() => {})
          .finally(() => mutationAccess.release())
        connected = false
        ptyId = null
        unregisterPtyHandlers(id)
        storedCallbacks.onDisconnect?.()
      }
    },

    detach(options) {
      connectionAttemptGeneration += 1
      // Why first: the successor transport owns the PTY after detach, and nothing below may
      // throw its way past the census drop — a stranded gauge outlives the transport.
      outputProcessor.disposePendingSideEffectGauge()
      cancelPendingRendererBindings()
      clearAccumulatedState()
      inputWriteQueue.clear()
      if (ptyId) {
        // Why: on remount keep the exit observer alive so a shell dying in the gap still clears stale tab/leaf bindings before reattach.
        if (options?.preserveExitObserver === false) {
          unregisterPtyHandlers(ptyId)
        } else {
          unregisterPtyDataAndStatusHandlers(ptyId)
        }
      }
      connected = false
      ptyId = null
      mutationAccess.release()
      storedCallbacks = {}
    },

    sendInput(data: string): boolean {
      const target = ptyId ? mutationAccess.captureTarget(ptyId) : null
      if (!connected || !target) {
        return false
      }
      return inputWriteQueue.enqueue(target, data)
    },

    captureInputTarget,

    isInputTargetCurrent(target): boolean {
      return inputBindingForTarget(target) !== null
    },

    sendInputToTarget(target, data): boolean {
      const binding = inputBindingForTarget(target)
      return binding ? inputWriteQueue.enqueue(binding, data) : false
    },

    // Why: kept distinct from sendInput so the remote transport can override with flush-then-send (#7329); local queue drains same-turn.
    sendInputImmediate(data: string): boolean {
      const target = ptyId ? mutationAccess.captureTarget(ptyId) : null
      if (!connected || !target) {
        return false
      }
      return inputWriteQueue.enqueue(target, data)
    },

    ...(connectionId
      ? {}
      : {
          async sendInputAccepted(data: string): Promise<boolean> {
            const target = ptyId ? mutationAccess.captureTarget(ptyId) : null
            if (!connected || !target) {
              return false
            }
            await inputWriteQueue.waitForDrain()
            if (!connected || ptyId !== target.id || !mutationAccess.isCurrentTarget(target)) {
              return false
            }
            return writeAcceptedPtyInput(target, data)
          },
          async sendInputAcceptedToTarget(
            target: PtyTransportInputTarget,
            data: string
          ): Promise<boolean> {
            const binding = inputBindingForTarget(target)
            if (!binding) {
              return false
            }
            await inputWriteQueue.waitForDrain()
            return inputBindingForTarget(target) ? writeAcceptedPtyInput(binding, data) : false
          }
        }),

    claimViewport(cols: number, rows: number): boolean {
      if (!connected || !ptyId) {
        return false
      }
      return mutationAccess.claimViewport(ptyId, cols, rows)
    },

    resize(cols: number, rows: number, meta): boolean {
      if (!connected || !ptyId) {
        return false
      }
      return meta?.claim
        ? mutationAccess.resize(ptyId, cols, rows, true)
        : mutationAccess.resize(ptyId, cols, rows)
    },

    signal(signal: string): boolean {
      if (!connected || !ptyId) {
        return false
      }
      return mutationAccess.signal(ptyId, signal)
    },

    clearBuffer(): boolean {
      if (!connected || !ptyId) {
        return false
      }
      return mutationAccess.clearBuffer(ptyId)
    },

    isConnected() {
      return connected
    },

    getPtyId() {
      return ptyId
    },

    getMutationIdentity() {
      return ptyId ? (mutationAccess.currentIdentity(ptyId) ?? null) : null
    },

    hasMutationAccess() {
      return ptyId !== null && mutationAccess.hasAccess(ptyId)
    },

    getConnectionId() {
      return connectionId ?? null
    },

    getLocalSessionMetadata() {
      if (connectionId) {
        return null
      }
      // Why: input routing/diagnostics must follow the launched PTY session, not later project setting changes.
      return {
        ...(cwd ? { cwd } : {}),
        ...(shellOverride ? { shellOverride } : {})
      }
    },

    resetCrossChunkParserState() {
      // Why: only the OSC-9999 carry spans the model-restore dropped-byte gap; title/bell re-sync from the snapshot replay.
      outputProcessor.resetAgentStatusCarry()
    },

    destroy() {
      destroyed = true
      // Why finally: disconnect runs pty.kill IPC and consumer onDisconnect callbacks; a throw
      // there must not strand the gauge in the very path where teardown already went wrong.
      try {
        this.disconnect()
      } finally {
        outputProcessor.disposePendingSideEffectGauge()
      }
    }
  }
}
