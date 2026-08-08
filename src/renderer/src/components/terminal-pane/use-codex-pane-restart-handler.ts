import { useCallback } from 'react'

export function useCodexPaneRestartHandler(args: {
  paneGeneration: number
  restartPaneAtGeneration: (paneId: number, paneGeneration: number) => void
}): (paneId: number) => void {
  const { paneGeneration, restartPaneAtGeneration } = args
  return useCallback(
    (paneId) => restartPaneAtGeneration(paneId, paneGeneration),
    [paneGeneration, restartPaneAtGeneration]
  )
}
