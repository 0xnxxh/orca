/**
 * Parked terminal side-effect watcher.
 * Why: parking unmounts TerminalPane, so this replays its bell/title/agent-completion/PR-link side effects while parked.
 */
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { useAppStore } from '@/store'
import {
  mode2031SequenceFor,
  resolveTerminalColorSchemeMode
} from '../../../../shared/terminal-color-scheme-protocol'
import { createTerminalGitHubPRLinkDetector } from '../../../../shared/terminal-github-pr-link-detector'
import { getSystemPrefersDark } from '@/lib/terminal-theme'
import { createCommandCodeOutputStatusDetector } from '../../../../shared/command-code-output-status'
import { createOsc133CommandFinishedScanner } from '../../../../shared/terminal-osc133-command-finished'
import {
  createParkedTerminalCommandStatusPolicy,
  readInFlightCommandCodeTurn
} from './parked-terminal-command-status'
import { startParkedTerminalMode2031Responder } from './parked-terminal-mode2031-responder'
import { hasPrimaryPtyDataHandler, subscribeToPtyData } from './pty-data-sidecar-subscriptions'
import { createPtyOutputProcessor } from './pty-transport'
import { isRendererHiddenPtyDeliveryGateEnabled } from './terminal-hidden-delivery-gate'
import {
  isMainTerminalSideEffectAuthorityForPty,
  prepareTerminalSideEffectFactConsumer
} from './terminal-side-effect-facts-handler'
import { acquireHiddenRendererPtyDeliveryClaim } from './pty-renderer-delivery-claims'
import { isRemoteRuntimePtyId } from '@/runtime/runtime-terminal-inspection'
import type { PtyMutationIdentity } from '../../../../shared/pty-mutation-identity'
import type { ParkedTerminalSideEffectIdentity } from './terminal-parked-side-effect-identity'
import { createParkedTerminalSideEffectPolicy } from './parked-terminal-side-effect-policy'

export type ParkedTerminalByteWatcherOptions = {
  ptyId: string
  mutationIdentity?: PtyMutationIdentity
  sideEffectIdentity?: ParkedTerminalSideEffectIdentity
  tabId: string
  worktreeId: string
  /** Stable terminal-layout leaf UUID; combined with tabId into the paneKey for cache-timer, unread, and notification attribution. */
  leafId: string
  /** PaneManager pane id the unmounted pane used; the watcher must write this same slot or a stale "working" title strands. */
  paneId: number
  /** Whether this PTY's pane was the tab's active split — only the focused split drives the tab title. */
  drivesTabTitle?: boolean
  /** Last runtime title at park time; seeds the agent tracker so an agent working at unmount still fires completion when it goes idle. */
  initialTitle?: string
  /** Pull main's title-only snapshot when a watcher starts before its pane ever mounted (ordinary park cycles already have a title). */
  restoreTitleOnRegister?: boolean
  /** Out-of-band reply channel to the PTY (mode-2031 color-scheme answers). */
  sendInput: (data: string) => void
}

export type ParkedTerminalByteWatcherHandle = {
  activateParked: () => boolean
  dispose: (options?: { preserveRuntimeTitle?: boolean }) => void
}

const parkedWatcherDisposersByPtyId = new Map<
  string,
  (options?: { preserveRuntimeTitle?: boolean }) => void
>()

function runParkedWatcherCleanups(cleanups: readonly ((() => void) | null | undefined)[]): void {
  for (const cleanup of cleanups) {
    try {
      cleanup?.()
    } catch (error) {
      console.error('[terminal] parked watcher cleanup failed', error)
    }
  }
}

export function startParkedTerminalByteWatcher(
  options: ParkedTerminalByteWatcherOptions
): ParkedTerminalByteWatcherHandle {
  const { ptyId, tabId, worktreeId, paneId, sendInput } = options
  const remoteRuntimePty = isRemoteRuntimePtyId(ptyId)
  const drivesTabTitle = options.drivesTabTitle ?? true
  const paneKey = makePaneKey(tabId, options.leafId)

  let disposed = false
  const sideEffectPolicy = createParkedTerminalSideEffectPolicy({
    tabId,
    worktreeId,
    paneId,
    paneKey,
    drivesTabTitle
  })
  const sideEffectCallbacks = sideEffectPolicy.callbacks

  // Why: command-lifecycle signals drive store-level policy only (git nudge, SSH same-turn
  // status drop, Command Code seed/settle); the pane-coupled parts stay with the mounted pane.
  const commandStatusPolicy = createParkedTerminalCommandStatusPolicy({
    ptyId,
    worktreeId,
    tabId,
    paneId,
    paneKey
  })

  // Why: with the authority switch on, the fact consumer is the single policy consumer — registering byte parsers too would double-fire bells.
  const mainSideEffectAuthority =
    !remoteRuntimePty &&
    isMainTerminalSideEffectAuthorityForPty({
      settings: useAppStore.getState().settings,
      runtimeEnvironmentId: null
    })
  const factSideEffectAuthority = mainSideEffectAuthority || remoteRuntimePty
  // Why: decided once at watcher start — it picks which 2031 responder (byte sidecar vs fact reply) exists, so it must never flip per chunk.
  const hiddenDeliveryGateActive =
    mainSideEffectAuthority &&
    isRendererHiddenPtyDeliveryGateEnabled(useAppStore.getState().settings)
  const factOwnsMode2031 = hiddenDeliveryGateActive || remoteRuntimePty

  const sendMode2031Reply = (): void => {
    const settings = useAppStore.getState().settings
    sendInput(mode2031SequenceFor(resolveTerminalColorSchemeMode(settings, getSystemPrefersDark())))
  }

  // Why (byte-parser mode only): reuse the transport's output processor to keep exact live-path parsing semantics.
  // initialAgentTitle: an agent already working at park time still produces a working→idle transition.
  let processor: ReturnType<typeof createPtyOutputProcessor> | null = null
  // Why (byte-parser mode only): under main authority, byte-scanning PR links too would observe every link twice (facts already carry them).
  let observeTerminalGitHubPRLink: ReturnType<typeof createTerminalGitHubPRLinkDetector> | null =
    null
  // Why (byte-parser mode only): mode parity — main's tracker emits these as facts; the byte
  // path scans the same shared parsers the mounted kill-switch-off pane uses.
  let commandFinishedScanner: ReturnType<typeof createOsc133CommandFinishedScanner> | null = null
  // Why the seed: this detector is recreated per park cycle with no startup command
  // to fast-arm it, and a Command Code TUI parked mid-turn is long past its banner —
  // unseeded it would never scrape the turn's return to the idle composer.
  let commandCodeOutputStatusDetector: ReturnType<
    typeof createCommandCodeOutputStatusDetector
  > | null = null
  // Why: no xterm answers DECSET 2031 while parked; with the gate ON, the responder's sidecar would force-feed bytes to the gated PTY, so skip it.
  let stopMode2031Responder: (() => void) | null = null

  // Why: parked tabs are the canonical hidden view — mark the PTY gated so main stops renderer byte delivery.
  let activated = false
  let releaseHiddenDeliveryClaim: (() => void) | null = null

  const processLiveData = (data: string): void => {
    if (!activated || !processor || hasPrimaryPtyDataHandler(ptyId)) {
      return
    }
    processor.processData(data, {})
    commandFinishedScanner?.scan(data)
    commandCodeOutputStatusDetector?.observe(data)
    if (observeTerminalGitHubPRLink) {
      for (const link of observeTerminalGitHubPRLink(data)) {
        useAppStore.getState().observeTerminalGitHubPullRequestLink(worktreeId, link)
      }
    }
  }
  // Why: paired hosts forward derived facts over the one environment event
  // stream; parked PTYs never consume terminal multiplex slots or raw bytes.
  let unsubscribeByteParsers: (() => void) | null = null
  let preparedFactConsumer: ReturnType<typeof prepareTerminalSideEffectFactConsumer> | null = null
  try {
    if (!factSideEffectAuthority) {
      processor = createPtyOutputProcessor({
        ...(options.initialTitle !== undefined ? { initialAgentTitle: options.initialTitle } : {}),
        ...sideEffectCallbacks
      })
      observeTerminalGitHubPRLink = createTerminalGitHubPRLinkDetector()
      commandFinishedScanner = createOsc133CommandFinishedScanner(
        commandStatusPolicy.onCommandFinished
      )
      commandCodeOutputStatusDetector = createCommandCodeOutputStatusDetector({
        inFlightTurn: readInFlightCommandCodeTurn(paneKey),
        onWorking: commandStatusPolicy.onCommandCodeWorking,
        onDone: commandStatusPolicy.onCommandCodeDone
      })
      unsubscribeByteParsers = subscribeToPtyData(ptyId, processLiveData)
    } else {
      preparedFactConsumer = prepareTerminalSideEffectFactConsumer({
        ptyId,
        ...(options.sideEffectIdentity
          ? { incarnationId: options.sideEffectIdentity.incarnationId }
          : {}),
        callbacks: {
          ...sideEffectCallbacks,
          onCommandFinished: commandStatusPolicy.onCommandFinished,
          onCommandCodeWorking: commandStatusPolicy.onCommandCodeWorking,
          onCommandCodeDone: commandStatusPolicy.onCommandCodeDone,
          onPrLink: (link) =>
            useAppStore.getState().observeTerminalGitHubPullRequestLink(worktreeId, link),
          ...(factOwnsMode2031 ? { onMode2031Subscribe: sendMode2031Reply } : {})
        },
        restoreTitleOnRegister: options.restoreTitleOnRegister === true,
        activateOnPredecessorRelease: true
      })
    }
  } catch (error) {
    runParkedWatcherCleanups([
      () => preparedFactConsumer?.cancel(),
      unsubscribeByteParsers,
      () => processor?.disposePendingSideEffectGauge(),
      () => processor?.clearAccumulatedState(),
      () => commandFinishedScanner?.reset(),
      commandStatusPolicy.dispose,
      () => sideEffectPolicy.dispose()
    ])
    throw error
  }

  const activateParked = (): boolean => {
    if (disposed || activated) {
      return activated && !disposed
    }
    let nextHiddenDeliveryClaim: (() => void) | null = null
    let nextMode2031Responder: (() => void) | null = null
    try {
      if (hiddenDeliveryGateActive) {
        nextHiddenDeliveryClaim = acquireHiddenRendererPtyDeliveryClaim(ptyId)
      }
      if (!factOwnsMode2031) {
        nextMode2031Responder = startParkedTerminalMode2031Responder({ ptyId, sendInput })
      }
    } catch {
      runParkedWatcherCleanups([
        nextHiddenDeliveryClaim,
        nextMode2031Responder,
        () => preparedFactConsumer?.cancel(),
        dispose
      ])
      return false
    }
    try {
      if (preparedFactConsumer && !preparedFactConsumer.activate()) {
        runParkedWatcherCleanups([
          nextHiddenDeliveryClaim,
          nextMode2031Responder,
          () => preparedFactConsumer?.cancel(),
          dispose
        ])
        return false
      }
    } catch {
      runParkedWatcherCleanups([
        nextHiddenDeliveryClaim,
        nextMode2031Responder,
        () => preparedFactConsumer?.cancel(),
        dispose
      ])
      return false
    }
    activated = true
    releaseHiddenDeliveryClaim = nextHiddenDeliveryClaim
    stopMode2031Responder = nextMode2031Responder
    const predecessor = parkedWatcherDisposersByPtyId.get(ptyId)
    parkedWatcherDisposersByPtyId.set(ptyId, dispose)
    runParkedWatcherCleanups([
      predecessor ? () => predecessor({ preserveRuntimeTitle: true }) : null
    ])
    return true
  }

  const dispose = (disposeOptions?: { preserveRuntimeTitle?: boolean }): void => {
    if (disposed) {
      return
    }
    disposed = true
    // Why first: each park/reveal cycle owns a distinct processor gauge, and the store/IPC
    // teardown below must not be able to throw its way past the census drop.
    const hiddenDeliveryClaim = releaseHiddenDeliveryClaim
    releaseHiddenDeliveryClaim = null
    const mode2031Responder = stopMode2031Responder
    stopMode2031Responder = null
    runParkedWatcherCleanups([
      // Why: unhide before a reveal successor registers so main emits its restore marker to the live pane.
      hiddenDeliveryClaim,
      mode2031Responder,
      unsubscribeByteParsers,
      () => preparedFactConsumer?.unregister(),
      () => processor?.disposePendingSideEffectGauge(),
      () => processor?.clearAccumulatedState(),
      () => commandFinishedScanner?.reset(),
      commandStatusPolicy.dispose
    ])
    sideEffectPolicy.dispose(disposeOptions)
    if (parkedWatcherDisposersByPtyId.get(ptyId) === dispose) {
      parkedWatcherDisposersByPtyId.delete(ptyId)
    }
  }
  return { activateParked, dispose }
}
