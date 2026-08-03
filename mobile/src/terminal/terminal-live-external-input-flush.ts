import type { RefObject } from 'react'
import {
  isSameTerminalLiveImeBoundary,
  waitForTerminalLiveImeComposition,
  type TerminalLiveImeBoundary,
  type TerminalLiveImeState
} from './terminal-live-ime-state'

type FlushTerminalLiveExternalInputOptions = {
  readonly boundary: TerminalLiveImeBoundary
  readonly clearPendingInput: () => void
  readonly flushPendingText: (
    handle: string,
    canClearPendingState: () => boolean
  ) => Promise<boolean>
  readonly generationRef: RefObject<number>
  readonly imeState: TerminalLiveImeState
  readonly isTargetActive: (handle: string) => boolean
  readonly pendingHandleRef: RefObject<string | null>
  readonly waitForPendingFlush: () => Promise<boolean>
}

export async function flushTerminalLiveExternalInput({
  boundary,
  clearPendingInput,
  flushPendingText,
  generationRef,
  imeState,
  isTargetActive,
  pendingHandleRef,
  waitForPendingFlush
}: FlushTerminalLiveExternalInputOptions): Promise<boolean> {
  while (boundary.generation === generationRef.current) {
    if (!isTargetActive(boundary.handle)) {
      return false
    }
    const compositionWait = waitForTerminalLiveImeComposition(imeState, boundary)
    if (compositionWait && !(await compositionWait)) {
      return false
    }
    if (boundary.generation !== generationRef.current) {
      return false
    }
    const compositionOwner = imeState.owner
    if (compositionOwner) {
      if (!isSameTerminalLiveImeBoundary(compositionOwner, boundary)) {
        return false
      }
      continue
    }
    const compositionEpoch = imeState.epoch
    const ownsPendingState = (): boolean =>
      boundary.generation === generationRef.current &&
      isTargetActive(boundary.handle) &&
      imeState.epoch === compositionEpoch
    const pendingHandle = pendingHandleRef.current
    if (pendingHandle && pendingHandle !== boundary.handle) {
      clearPendingInput()
      return waitForPendingFlush()
    }
    // Why: older cleanup must not erase a composition that began while its send was pending.
    const flushed = pendingHandle
      ? await flushPendingText(boundary.handle, ownsPendingState)
      : await waitForPendingFlush()
    if (!flushed) {
      return false
    }
    if (ownsPendingState()) {
      return true
    }
  }
  return false
}
