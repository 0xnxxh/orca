import { useCallback, useEffect, useRef, useState } from 'react'

export type ClipboardTextCopyStatus = 'idle' | 'copied' | 'failed'

const FEEDBACK_MS = 1500

/**
 * Clipboard write with brief success/failure feedback. Guards setState after
 * unmount (clipboard IPC can resolve after the menu/row is gone).
 */
export function useClipboardTextCopyFeedback(text: string): {
  canCopy: boolean
  copyText: () => Promise<boolean>
  status: ClipboardTextCopyStatus
} {
  const [status, setStatus] = useState<ClipboardTextCopyStatus>('idle')
  const isMountedRef = useRef(true)
  const resetTimerRef = useRef<number | null>(null)
  const canCopy = text.trim().length > 0

  const clearResetTimer = useCallback((): void => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current)
      resetTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      clearResetTimer()
    }
  }, [clearResetTimer])

  // Why: body text can change while feedback is showing (edit in another host /
  // incomplete draft); drop stale "Copied"/"Couldn't copy" labels.
  useEffect(() => {
    clearResetTimer()
    setStatus('idle')
  }, [clearResetTimer, text])

  const scheduleReset = useCallback((): void => {
    clearResetTimer()
    resetTimerRef.current = window.setTimeout(() => {
      resetTimerRef.current = null
      if (isMountedRef.current) {
        setStatus('idle')
      }
    }, FEEDBACK_MS)
  }, [clearResetTimer])

  const copyText = useCallback(async (): Promise<boolean> => {
    if (!canCopy) {
      return false
    }
    try {
      await window.api.ui.writeClipboardText(text)
      if (!isMountedRef.current) {
        return true
      }
      setStatus('copied')
      scheduleReset()
      return true
    } catch {
      if (!isMountedRef.current) {
        return false
      }
      setStatus('failed')
      scheduleReset()
      return false
    }
  }, [canCopy, scheduleReset, text])

  return { canCopy, copyText, status }
}
