import { useEffect, useRef } from 'react'
import { recordRendererCrashBreadcrumb } from '@/lib/crash-breadcrumb-recorder'

/** Emits final verdict changes; main-process coalescing bounds repeated flips. */
export function recordParkVerdictFlips(args: {
  previousParkedByTabId: Map<string, boolean>
  liveTabIds: ReadonlySet<string>
  nextParkedTabIds: ReadonlySet<string>
}): void {
  for (const tabId of Array.from(args.previousParkedByTabId.keys())) {
    if (!args.liveTabIds.has(tabId)) {
      args.previousParkedByTabId.delete(tabId)
    }
  }

  for (const tabId of args.liveTabIds) {
    const parked = args.nextParkedTabIds.has(tabId)
    const hadPreviousVerdict = args.previousParkedByTabId.has(tabId)
    const previousParked = args.previousParkedByTabId.get(tabId)
    args.previousParkedByTabId.set(tabId, parked)
    if (!hadPreviousVerdict || previousParked === parked) {
      continue
    }
    recordRendererCrashBreadcrumb('terminal_park_verdict_churn', {
      tabId,
      trigger: 'flip',
      parked
    })
  }
}

/** Observes the final prepare/activate handoff verdict without changing it. */
export function useTerminalParkVerdictTelemetry(args: {
  terminalTabs: readonly { id: string }[]
  parkedTabIds: ReadonlySet<string>
}): void {
  const previousParkedByTabIdRef = useRef(new Map<string, boolean>())
  const { parkedTabIds, terminalTabs } = args

  useEffect(() => {
    recordParkVerdictFlips({
      previousParkedByTabId: previousParkedByTabIdRef.current,
      liveTabIds: new Set(terminalTabs.map((terminalTab) => terminalTab.id)),
      nextParkedTabIds: parkedTabIds
    })
  }, [parkedTabIds, terminalTabs])
}
