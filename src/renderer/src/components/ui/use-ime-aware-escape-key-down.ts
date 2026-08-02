import * as React from 'react'

import { isImeCompositionKeyDown } from '@/lib/ime-composition-keyboard-event'

type EscapeKeyDownHandler = (event: KeyboardEvent) => void

export function useImeAwareEscapeKeyDown(
  onEscapeKeyDown?: EscapeKeyDownHandler
): EscapeKeyDownHandler {
  return React.useCallback(
    (event) => {
      // Radix observes Escape during document capture, before element keydown handlers.
      if (isImeCompositionKeyDown(event)) {
        event.preventDefault()
        return
      }
      onEscapeKeyDown?.(event)
    },
    [onEscapeKeyDown]
  )
}
