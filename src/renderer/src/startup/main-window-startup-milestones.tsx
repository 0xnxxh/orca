import { useLayoutEffect } from 'react'
import { logRendererStartupDiagnostic } from './startup-diagnostics'

type FrameCallback = (timestamp: number) => void

type MainWindowStartupMilestoneDependencies = {
  log: (event: string) => void
  requestFrame: (callback: FrameCallback) => number
  cancelFrame: (id: number) => void
}

export function createMainWindowStartupMilestoneScheduler({
  log,
  requestFrame,
  cancelFrame
}: MainWindowStartupMilestoneDependencies): () => () => void {
  let commitLogged = false
  let paintLogged = false

  return () => {
    let firstFrame: number | null = null
    let secondFrame: number | null = null
    let canceled = false

    if (!commitLogged) {
      commitLogged = true
      try {
        log('first-react-commit')
      } catch {
        // Diagnostics must never affect the committed tree.
      }
    }

    if (!paintLogged) {
      try {
        firstFrame = requestFrame(() => {
          if (canceled) {
            return
          }
          try {
            secondFrame = requestFrame(() => {
              if (canceled || paintLogged) {
                return
              }
              paintLogged = true
              try {
                log('shell-painted')
              } catch {
                // Diagnostics must never affect frame delivery.
              }
            })
          } catch {
            // Diagnostics must never affect frame delivery.
          }
        })
      } catch {
        // Diagnostics must never affect the committed tree.
      }
    }

    return () => {
      canceled = true
      for (const frame of [firstFrame, secondFrame]) {
        if (frame === null) {
          continue
        }
        try {
          cancelFrame(frame)
        } catch {
          // Diagnostics cleanup is best-effort.
        }
      }
    }
  }
}

const scheduleMainWindowStartupMilestones = createMainWindowStartupMilestoneScheduler({
  log: logRendererStartupDiagnostic,
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (id) => window.cancelAnimationFrame(id)
})

export function MainWindowStartupMilestones(): null {
  useLayoutEffect(() => scheduleMainWindowStartupMilestones(), [])
  return null
}
