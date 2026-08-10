import { isTerminalOscLinkRanges } from '../../../src/shared/terminal-osc-link-ranges'
import type { TerminalWebViewHandle } from '../terminal/terminal-webview-contract'
import type {
  HostSessionTerminalOperations,
  HostSessionTerminalStreamEvent
} from './host-session-terminal-operations'
import {
  hostSessionTerminalAcknowledgement,
  hostSessionTerminalData
} from './host-session-terminal-event-presentation'
import { updateTerminalCwdFromStreamEvent } from './mobile-session-route-helpers'
import type { MobileDisplayMode } from './mobile-session-route-types'
import type { MobileTerminalDiagnostics } from './mobile-terminal-diagnostics'

type MutableRef<T> = { current: T }

type HostSessionTerminalStreamPresentation = {
  event: HostSessionTerminalStreamEvent
  handle: string
  subscribeSequence: number
  currentSubscribeSequence: () => number | undefined
  isCovered: () => boolean
  unsubscribe: (handle: string) => void
  markInputLeaseReady: (handle: string) => void
  layoutSequences: Map<string, number>
  initializedHandles: Set<string>
  terminalCwds: Map<string, string>
  getTerminalRef: (handle: string) => TerminalWebViewHandle | undefined
  operations: HostSessionTerminalOperations
  setDisplayMode: (handle: string, mode: MobileDisplayMode) => void
  diagnostics: MobileTerminalDiagnostics
  scheduleDelayedAction: (action: () => void, delayMs: number) => void
  viewportRef: MutableRef<{ cols: number; rows: number } | null>
  viewportMeasuredRef: MutableRef<boolean>
  terminalFrameHeightRef: MutableRef<number>
  subscribe: (handle: string) => void
}

export function presentHostSessionTerminalStreamEvent(
  context: HostSessionTerminalStreamPresentation
): void {
  if (context.currentSubscribeSequence() !== context.subscribeSequence) {
    return
  }
  const data = context.event as unknown as Record<string, unknown>
  context.diagnostics.firstStreamEvent(context.handle, context.subscribeSequence, data.type)
  if (data.type === 'end' || data.type === 'error') {
    context.unsubscribe(context.handle)
    return
  }
  if (data.type === 'subscribed') {
    context.markInputLeaseReady(context.handle)
    return
  }
  // Why: a covered terminal keeps only its input lease; returning resubscribes its visible xterm.
  if (context.isCovered()) {
    return
  }

  const eventSequence = typeof data.seq === 'number' ? data.seq : null
  if (dropStaleResize(context, data, eventSequence)) {
    return
  }
  if (data.type === 'scrollback') {
    presentScrollback(context, data, eventSequence)
  } else if (data.type === 'metadata') {
    updateTerminalCwdFromStreamEvent(context.handle, data, context.terminalCwds)
    setDisplayMode(context, data)
  } else if (data.type === 'data') {
    presentOutput(context, data)
  } else if (data.type === 'resized') {
    presentResize(context, data, eventSequence)
  }
}

function dropStaleResize(
  context: HostSessionTerminalStreamPresentation,
  data: Record<string, unknown>,
  eventSequence: number | null
): boolean {
  if (eventSequence != null && data.type === 'resized') {
    const last = context.layoutSequences.get(context.handle)
    if (last != null && eventSequence < last && last - eventSequence <= 20) {
      console.log('[fit][session] DROP-stale-seq', {
        type: data.type,
        eventSeq: eventSequence,
        lastSeq: last,
        cols: data.cols,
        rows: data.rows,
        displayMode: data.displayMode
      })
      return true
    }
    context.layoutSequences.set(context.handle, eventSequence)
  } else if (eventSequence != null && data.type === 'scrollback') {
    context.layoutSequences.set(context.handle, eventSequence)
  }
  return false
}

function presentScrollback(
  context: HostSessionTerminalStreamPresentation,
  data: Record<string, unknown>,
  eventSequence: number | null
): void {
  context.diagnostics.streamScrollback(
    context.handle,
    context.subscribeSequence,
    eventSequence,
    data
  )
  if (context.initializedHandles.has(context.handle)) {
    return
  }
  updateTerminalCwdFromStreamEvent(context.handle, data, context.terminalCwds)
  const cols = (data.cols as number) || 80
  const rows = (data.rows as number) || 24
  const serialized = hostSessionTerminalData(data.serialized)
  const ref = context.getTerminalRef(context.handle)
  if (!ref) {
    console.log('[fit][session] scrollback DROPPED — no terminal ref', {
      cols,
      rows
    })
    return
  }
  ref.init(
    cols,
    rows,
    serialized,
    false,
    isTerminalOscLinkRanges(data.oscLinks) ? data.oscLinks : undefined,
    hostSessionTerminalAcknowledgement(context.operations, context.handle, data.throughSequence)
  )
  context.initializedHandles.add(context.handle)
  setDisplayMode(context, data)
  context.scheduleDelayedAction(() => context.getTerminalRef(context.handle)?.resetZoom(), 200)
  scheduleInitialViewportCorrection(context, cols, rows, data.displayMode)
}

function scheduleInitialViewportCorrection(
  context: HostSessionTerminalStreamPresentation,
  scrollbackCols: number,
  scrollbackRows: number,
  displayMode: unknown
): void {
  if (displayMode === 'desktop') {
    return
  }
  const viewport = context.viewportRef.current
  if (
    context.viewportMeasuredRef.current &&
    (!viewport || (scrollbackCols === viewport.cols && scrollbackRows === viewport.rows))
  ) {
    return
  }
  void (async () => {
    await context.getTerminalRef(context.handle)?.awaitReady()
    if (context.currentSubscribeSequence() !== context.subscribeSequence) {
      return
    }
    const dims = await context
      .getTerminalRef(context.handle)
      ?.measureFitDimensions(context.terminalFrameHeightRef.current || undefined)
    if (
      context.currentSubscribeSequence() !== context.subscribeSequence ||
      !context.getTerminalRef(context.handle) ||
      !dims
    ) {
      return
    }
    context.diagnostics.streamResubscribing(context.handle, context.subscribeSequence, dims)
    context.viewportRef.current = dims
    context.viewportMeasuredRef.current = true
    context.unsubscribe(context.handle)
    context.initializedHandles.delete(context.handle)
    context.subscribe(context.handle)
  })()
}

function presentOutput(
  context: HostSessionTerminalStreamPresentation,
  data: Record<string, unknown>
): void {
  updateTerminalCwdFromStreamEvent(context.handle, data, context.terminalCwds)
  const ref = context.getTerminalRef(context.handle)
  if (!ref) {
    console.log('[fit][session] data DROPPED — no terminal ref', {
      chunkLen: hostSessionTerminalData(data.chunk).length,
      initialized: context.initializedHandles.has(context.handle)
    })
    return
  }
  if (!context.initializedHandles.has(context.handle)) {
    console.log('[fit][session] data RECEIVED before scrollback', {
      chunkLen: hostSessionTerminalData(data.chunk).length
    })
  }
  ref.write(
    hostSessionTerminalData(data.chunk),
    hostSessionTerminalAcknowledgement(context.operations, context.handle, data.throughSequence)
  )
}

function presentResize(
  context: HostSessionTerminalStreamPresentation,
  data: Record<string, unknown>,
  eventSequence: number | null
): void {
  updateTerminalCwdFromStreamEvent(context.handle, data, context.terminalCwds)
  const cols = (data.cols as number) || 80
  const rows = (data.rows as number) || 24
  const serialized = hostSessionTerminalData(data.serialized)
  context.diagnostics.streamResized(
    context.handle,
    context.subscribeSequence,
    eventSequence,
    data,
    context.getTerminalRef(context.handle) != null
  )
  const ref = context.getTerminalRef(context.handle)
  if (serialized.length > 0) {
    ref?.init(
      cols,
      rows,
      serialized,
      true,
      isTerminalOscLinkRanges(data.oscLinks) ? data.oscLinks : undefined,
      hostSessionTerminalAcknowledgement(context.operations, context.handle, data.throughSequence)
    )
  } else {
    ref?.resize(cols, rows)
  }
  setDisplayMode(context, data)
  context.scheduleDelayedAction(() => context.getTerminalRef(context.handle)?.resetZoom(), 200)
}

function setDisplayMode(
  context: HostSessionTerminalStreamPresentation,
  data: Record<string, unknown>
): void {
  if (
    data.displayMode === 'auto' ||
    data.displayMode === 'desktop' ||
    data.displayMode === 'phone'
  ) {
    context.setDisplayMode(context.handle, data.displayMode)
  }
}
