import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { TextInput } from 'react-native'
import { getTerminalLiveSpecialKeyDecision } from './terminal-live-text-commit'
import { sendTerminalLiveControlAfterPendingFlush } from './terminal-live-control-send-order'
import type { TerminalLiveAccessoryInput } from './terminal-live-accessory-input'
import { flushTerminalLiveExternalInput } from './terminal-live-external-input-flush'
import type {
  TerminalLiveExternalInputRunner,
  TerminalLiveInputSender
} from './terminal-live-input-sender'
import { normalizeTerminalTextInput } from './terminal-text-input-normalization'
import {
  beginTerminalLiveImeComposition,
  createTerminalLiveImeState,
  finishTerminalLiveImeComposition,
  invalidateTerminalLiveImeComposition,
  isSameTerminalLiveImeBoundary
} from './terminal-live-ime-state'
import { useTerminalLivePendingInputFlush } from './use-terminal-live-pending-input-flush'
import {
  useTerminalLiveAccessoryInputCommit,
  type TerminalLiveAccessoryInputCommitResult
} from './use-terminal-live-accessory-input-commit'

type TerminalLiveInputKeyPressEvent = {
  readonly nativeEvent: {
    readonly key: string
  }
}

type TerminalLiveInputChangeEvent = {
  readonly nativeEvent: {
    readonly isComposing?: boolean
    readonly text: string
  }
}

type TerminalLiveInputCommitOptions<TTabType extends string> = {
  readonly activeHandle: string | null
  readonly activeHandleRef: RefObject<string | null>
  readonly activeSessionTabType: TTabType | null | undefined
  readonly activeSessionTabTypeRef: RefObject<TTabType | null>
  readonly connected: boolean
  readonly liveInputRef: RefObject<TextInput | null>
  readonly liveInputTerminalHandles: ReadonlySet<string>
  readonly liveInputTerminalHandlesRef: RefObject<Set<string>>
  readonly sendLiveTerminalInputRef: RefObject<TerminalLiveInputSender>
  readonly setLiveInputCapture: (text: string) => void
}

type TerminalLiveInputCommitHandlers = {
  readonly clearPendingLiveInputCommit: () => void
  readonly runTerminalLiveExternalInput: TerminalLiveExternalInputRunner
  readonly handleLiveInputAccessoryBytes: (
    input: TerminalLiveAccessoryInput
  ) => Promise<TerminalLiveAccessoryInputCommitResult>
  readonly handleLiveInputChange: (event: TerminalLiveInputChangeEvent) => void
  readonly handleLiveInputKeyPress: (event: TerminalLiveInputKeyPressEvent) => void
  readonly handleLiveInputSubmit: () => void
  readonly liveInputKey: string
}

export function useTerminalLiveInputCommit<TTabType extends string>({
  activeHandle,
  activeHandleRef,
  activeSessionTabType,
  activeSessionTabTypeRef,
  connected,
  liveInputRef,
  liveInputTerminalHandles,
  liveInputTerminalHandlesRef,
  sendLiveTerminalInputRef,
  setLiveInputCapture
}: TerminalLiveInputCommitOptions<TTabType>): TerminalLiveInputCommitHandlers {
  const [liveInputGeneration, setLiveInputGeneration] = useState(0)
  const liveInputGenerationRef = useRef(0)
  const externalFlushTailRef = useRef(Promise.resolve(true))
  const liveInputImeStateRef = useRef(createTerminalLiveImeState())
  const {
    applyLiveInputMirror,
    clearPendingLiveInputCommit: clearPendingLiveInputMirror,
    flushPendingLiveInputText,
    heldLiveInputTextRef,
    pendingLiveInputHandleRef,
    sentLiveInputTextRef,
    waitForPendingLiveInputFlush
  } = useTerminalLivePendingInputFlush({
    activeHandleRef,
    activeSessionTabTypeRef,
    liveInputRef,
    liveInputTerminalHandlesRef,
    sendLiveTerminalInputRef,
    setLiveInputCapture
  })

  const clearPendingLiveInputCommit = useCallback(() => {
    invalidateTerminalLiveImeComposition(liveInputImeStateRef.current)
    const nextGeneration = liveInputGenerationRef.current + 1
    liveInputGenerationRef.current = nextGeneration
    setLiveInputGeneration(nextGeneration)
    clearPendingLiveInputMirror()
  }, [clearPendingLiveInputMirror])

  useLayoutEffect(() => {
    // Why: what reached the PTY is unknowable across an outage — stale mirror state corrupts the first post-reconnect send.
    if (!connected) {
      clearPendingLiveInputCommit()
    }
  }, [connected, clearPendingLiveInputCommit])

  useLayoutEffect(() => {
    const pendingHandle = pendingLiveInputHandleRef.current
    const compositionHandle = liveInputImeStateRef.current.owner?.handle ?? null
    const inputOwnerHandle = compositionHandle ?? pendingHandle
    if (!inputOwnerHandle) {
      return
    }
    // Why: a lagging mobile tab list briefly yields no active tab object; a
    // null/undefined type is "unknown", not "left the terminal" — flush guards
    // still block sends if the tab truly changed.
    if (
      !activeHandle ||
      inputOwnerHandle !== activeHandle ||
      (activeSessionTabType != null && activeSessionTabType !== 'terminal') ||
      !liveInputTerminalHandles.has(activeHandle)
    ) {
      clearPendingLiveInputCommit()
    }
  }, [activeHandle, activeSessionTabType, clearPendingLiveInputCommit, liveInputTerminalHandles])

  const isLiveInputTargetActive = useCallback(
    (handle: string): boolean =>
      activeHandleRef.current === handle &&
      (activeSessionTabTypeRef.current == null || activeSessionTabTypeRef.current === 'terminal') &&
      liveInputTerminalHandlesRef.current.has(handle),
    []
  )

  const runTerminalLiveExternalInput = useCallback<TerminalLiveExternalInputRunner>(
    (handle, operation) => {
      const queuedOperation = externalFlushTailRef.current.then(async () => {
        const flushed = await flushTerminalLiveExternalInput({
          boundary: { generation: liveInputGenerationRef.current, handle },
          clearPendingInput: clearPendingLiveInputMirror,
          flushPendingText: flushPendingLiveInputText,
          generationRef: liveInputGenerationRef,
          imeState: liveInputImeStateRef.current,
          isTargetActive: isLiveInputTargetActive,
          pendingHandleRef: pendingLiveInputHandleRef,
          waitForPendingFlush: waitForPendingLiveInputFlush
        })
        return flushed ? operation() : false
      })
      externalFlushTailRef.current = queuedOperation.catch(() => false)
      return queuedOperation
    },
    [
      clearPendingLiveInputMirror,
      flushPendingLiveInputText,
      isLiveInputTargetActive,
      waitForPendingLiveInputFlush
    ]
  )

  const handleLiveInputChange = useCallback(
    ({ nativeEvent: { isComposing, text } }: TerminalLiveInputChangeEvent) => {
      if (!activeHandle) {
        return
      }
      const boundary = { generation: liveInputGeneration, handle: activeHandle }
      if (
        boundary.generation !== liveInputGenerationRef.current ||
        !isLiveInputTargetActive(boundary.handle)
      ) {
        return
      }
      if (isComposing === true) {
        beginTerminalLiveImeComposition(liveInputImeStateRef.current, boundary)
        setLiveInputCapture(text)
        return
      }

      const compositionOwner = liveInputImeStateRef.current.owner
      if (compositionOwner && !isSameTerminalLiveImeBoundary(compositionOwner, boundary)) {
        return
      }
      // Why: iOS kills an active dictation/IME session when JS writes a value
      // that differs from the native field text, so the controlled capture must
      // echo the field verbatim; only the PTY mirror sees normalized text.
      setLiveInputCapture(text)
      applyLiveInputMirror(boundary.handle, normalizeTerminalTextInput(text))
      if (compositionOwner) {
        finishTerminalLiveImeComposition(liveInputImeStateRef.current, boundary)
      }
    },
    [
      activeHandle,
      applyLiveInputMirror,
      isLiveInputTargetActive,
      liveInputGeneration,
      setLiveInputCapture
    ]
  )

  const isLiveInputCompositionActive = useCallback(
    (handle: string): boolean => liveInputImeStateRef.current.owner?.handle === handle,
    []
  )

  const handleLiveInputKeyPress = useCallback(
    (event: TerminalLiveInputKeyPressEvent) => {
      if (
        !activeHandle ||
        liveInputGeneration !== liveInputGenerationRef.current ||
        !isLiveInputTargetActive(activeHandle) ||
        isLiveInputCompositionActive(activeHandle)
      ) {
        return
      }
      const ownsPendingState = pendingLiveInputHandleRef.current === activeHandle
      if (pendingLiveInputHandleRef.current && !ownsPendingState) {
        clearPendingLiveInputMirror()
      }
      const decision = getTerminalLiveSpecialKeyDecision({
        key: event.nativeEvent.key,
        heldText: ownsPendingState ? heldLiveInputTextRef.current : '',
        sentText: ownsPendingState ? sentLiveInputTextRef.current : ''
      })
      switch (decision.kind) {
        case 'ignore':
        case 'local-edit':
          return
        case 'send-now':
          void sendTerminalLiveControlAfterPendingFlush(waitForPendingLiveInputFlush, () =>
            sendLiveTerminalInputRef.current(activeHandle, decision.bytes)
          )
          return
        case 'commit-held-then-send':
          void sendTerminalLiveControlAfterPendingFlush(
            () => flushPendingLiveInputText(activeHandle),
            () => sendLiveTerminalInputRef.current(activeHandle, decision.bytes)
          )
          return
        default:
          decision satisfies never
      }
    },
    [
      activeHandle,
      clearPendingLiveInputMirror,
      flushPendingLiveInputText,
      isLiveInputCompositionActive,
      isLiveInputTargetActive,
      liveInputGeneration,
      sendLiveTerminalInputRef,
      waitForPendingLiveInputFlush
    ]
  )

  const handleLiveInputAccessoryBytes = useTerminalLiveAccessoryInputCommit({
    activeHandle,
    applyLiveInputMirror,
    clearPendingLiveInputCommit: clearPendingLiveInputMirror,
    flushPendingLiveInputText,
    heldLiveInputTextRef,
    liveInputRef,
    liveInputTerminalHandles,
    isLiveInputCompositionActive,
    pendingLiveInputHandleRef,
    sentLiveInputTextRef,
    sendLiveTerminalInputRef,
    setLiveInputCapture,
    waitForPendingLiveInputFlush
  })

  const handleLiveInputSubmit = useCallback(() => {
    if (
      !activeHandle ||
      liveInputGeneration !== liveInputGenerationRef.current ||
      !isLiveInputTargetActive(activeHandle) ||
      isLiveInputCompositionActive(activeHandle)
    ) {
      return
    }
    void sendTerminalLiveControlAfterPendingFlush(
      () => flushPendingLiveInputText(activeHandle),
      () => sendLiveTerminalInputRef.current(activeHandle, '\r')
    )
  }, [
    activeHandle,
    flushPendingLiveInputText,
    isLiveInputCompositionActive,
    isLiveInputTargetActive,
    liveInputGeneration,
    sendLiveTerminalInputRef
  ])

  useEffect(() => {
    return () => invalidateTerminalLiveImeComposition(liveInputImeStateRef.current)
  }, [])

  return {
    clearPendingLiveInputCommit,
    runTerminalLiveExternalInput,
    handleLiveInputAccessoryBytes,
    handleLiveInputChange,
    handleLiveInputKeyPress,
    handleLiveInputSubmit,
    liveInputKey: `${activeHandle ?? 'none'}:${liveInputGeneration}`
  }
}
