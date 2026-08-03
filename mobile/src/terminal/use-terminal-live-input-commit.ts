import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { TextInput } from 'react-native'
import { getTerminalLiveSpecialKeyDecision } from './terminal-live-text-commit'
import { sendTerminalLiveControlAfterPendingFlush } from './terminal-live-control-send-order'
import type { TerminalLiveAccessoryInput } from './terminal-live-accessory-input'
import {
  createTerminalLiveComposition,
  type TerminalLiveComposition,
  type TerminalLiveCompositionChangeEvent
} from './terminal-live-ime-composition'
import type { TerminalLiveInputSender } from './terminal-live-input-sender'
import { normalizeTerminalTextInput } from './terminal-text-input-normalization'
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
  readonly flushPendingLiveInputBeforeExternalSend: (handle: string) => Promise<boolean>
  readonly handleLiveInputAccessoryBytes: (
    input: TerminalLiveAccessoryInput
  ) => Promise<TerminalLiveAccessoryInputCommitResult>
  readonly handleLiveInputChange: (event: TerminalLiveCompositionChangeEvent) => void
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
  const liveInputCompositionEpochRef = useRef(0)
  const liveInputCompositionRef = useRef<TerminalLiveComposition | null>(null)
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
    const composition = liveInputCompositionRef.current
    liveInputCompositionRef.current = null
    composition?.resolve(false)
    liveInputCompositionEpochRef.current += 1
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
    const inputOwnerHandle = liveInputCompositionRef.current?.handle ?? pendingHandle
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

  const flushPendingLiveInputBeforeExternalSend = useCallback(
    async (handle: string): Promise<boolean> => {
      const generation = liveInputGenerationRef.current
      while (generation === liveInputGenerationRef.current) {
        while (liveInputCompositionRef.current?.handle === handle) {
          const composition = liveInputCompositionRef.current
          if (!(await composition.completion)) {
            return false
          }
        }
        if (
          generation !== liveInputGenerationRef.current ||
          handle !== activeHandleRef.current ||
          (activeSessionTabTypeRef.current != null &&
            activeSessionTabTypeRef.current !== 'terminal') ||
          !liveInputTerminalHandlesRef.current.has(handle) ||
          liveInputCompositionRef.current
        ) {
          return false
        }
        const compositionEpoch = liveInputCompositionEpochRef.current
        const ownsPendingState = (): boolean =>
          generation === liveInputGenerationRef.current &&
          compositionEpoch === liveInputCompositionEpochRef.current &&
          handle === activeHandleRef.current &&
          (activeSessionTabTypeRef.current == null ||
            activeSessionTabTypeRef.current === 'terminal') &&
          liveInputTerminalHandlesRef.current.has(handle) &&
          liveInputCompositionRef.current == null
        const pendingHandle = pendingLiveInputHandleRef.current
        if (pendingHandle && pendingHandle !== handle) {
          return false
        }
        // Why: external bytes follow the field echo; a composition that starts
        // during the await must retain the field and take the next flush turn.
        const flushed = pendingHandle
          ? await flushPendingLiveInputText(handle, ownsPendingState)
          : await waitForPendingLiveInputFlush()
        if (!flushed) {
          return false
        }
        if (ownsPendingState()) {
          return true
        }
      }
      return false
    },
    [
      activeHandleRef,
      activeSessionTabTypeRef,
      flushPendingLiveInputText,
      liveInputTerminalHandlesRef,
      waitForPendingLiveInputFlush
    ]
  )

  const handleLiveInputChange = useCallback(
    ({ nativeEvent: { isComposing, text } }: TerminalLiveCompositionChangeEvent) => {
      if (liveInputGeneration !== liveInputGenerationRef.current) {
        return
      }
      if (!activeHandle || !liveInputTerminalHandles.has(activeHandle)) {
        clearPendingLiveInputCommit()
        return
      }
      // Why: iOS kills an active dictation/IME session when JS writes a value
      // that differs from the native field text, so the controlled capture must
      // echo the field verbatim; only the PTY mirror sees normalized text.
      setLiveInputCapture(text)
      if (isComposing === true) {
        const composition = liveInputCompositionRef.current
        if (!composition || composition.handle !== activeHandle) {
          composition?.resolve(false)
          liveInputCompositionEpochRef.current += 1
          liveInputCompositionRef.current = createTerminalLiveComposition(activeHandle)
        }
        return
      }
      const composition = liveInputCompositionRef.current
      if (composition && composition.handle !== activeHandle) {
        return
      }
      applyLiveInputMirror(activeHandle, normalizeTerminalTextInput(text))
      liveInputCompositionRef.current = null
      composition?.resolve(true)
    },
    [
      activeHandle,
      applyLiveInputMirror,
      clearPendingLiveInputCommit,
      liveInputGeneration,
      liveInputTerminalHandles,
      setLiveInputCapture
    ]
  )

  const handleLiveInputKeyPress = useCallback(
    (event: TerminalLiveInputKeyPressEvent) => {
      if (
        !activeHandle ||
        liveInputGeneration !== liveInputGenerationRef.current ||
        liveInputCompositionRef.current?.handle === activeHandle ||
        !liveInputTerminalHandles.has(activeHandle)
      ) {
        return
      }
      const ownsPendingState = pendingLiveInputHandleRef.current === activeHandle
      if (pendingLiveInputHandleRef.current && !ownsPendingState) {
        clearPendingLiveInputCommit()
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
      clearPendingLiveInputCommit,
      flushPendingLiveInputText,
      liveInputGeneration,
      liveInputTerminalHandles,
      sendLiveTerminalInputRef,
      waitForPendingLiveInputFlush
    ]
  )

  const commitLiveInputAccessoryBytes = useTerminalLiveAccessoryInputCommit({
    activeHandle,
    applyLiveInputMirror,
    clearPendingLiveInputCommit,
    flushPendingLiveInputText,
    heldLiveInputTextRef,
    liveInputRef,
    liveInputTerminalHandles,
    pendingLiveInputHandleRef,
    sentLiveInputTextRef,
    sendLiveTerminalInputRef,
    setLiveInputCapture,
    waitForPendingLiveInputFlush
  })

  const handleLiveInputAccessoryBytes = useCallback(
    async (input: TerminalLiveAccessoryInput): Promise<TerminalLiveAccessoryInputCommitResult> => {
      if (activeHandle && liveInputCompositionRef.current?.handle === activeHandle) {
        return { kind: 'suppress-raw' }
      }
      return commitLiveInputAccessoryBytes(input)
    },
    [activeHandle, commitLiveInputAccessoryBytes]
  )

  const handleLiveInputSubmit = useCallback(() => {
    if (
      !activeHandle ||
      liveInputGeneration !== liveInputGenerationRef.current ||
      liveInputCompositionRef.current?.handle === activeHandle ||
      !liveInputTerminalHandles.has(activeHandle)
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
    liveInputGeneration,
    liveInputTerminalHandles,
    sendLiveTerminalInputRef
  ])

  useEffect(() => () => liveInputCompositionRef.current?.resolve(false), [])

  return {
    clearPendingLiveInputCommit,
    flushPendingLiveInputBeforeExternalSend,
    handleLiveInputAccessoryBytes,
    handleLiveInputChange,
    handleLiveInputKeyPress,
    handleLiveInputSubmit,
    liveInputKey: `${activeHandle ?? 'none'}:${liveInputGeneration}`
  }
}
