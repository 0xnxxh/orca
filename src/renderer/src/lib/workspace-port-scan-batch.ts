import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import {
  scanWorkspacePortsForTarget,
  workspacePortScanKeyForTarget
} from '@/lib/workspace-port-actions'
import { mapWithConcurrency } from '../../../shared/map-with-concurrency'
import type { WorkspacePortScanResult } from '../../../shared/workspace-ports'

// Why: per-host RPC queues do not cap aggregate work across remote hosts.
export const WORKSPACE_PORT_SCAN_CONCURRENCY = 4

export type WorkspacePortScanEntry = {
  key: string
  result: WorkspacePortScanResult
}

type WorkspacePortScanBatchOptions = {
  targets: readonly RuntimeClientTarget[]
  shouldStart: () => boolean
  onStarted: (key: string) => void
  onFailed: (key: string) => void
  onSkipped: (key: string) => void
}

function makeUnavailableScan(reason: string): WorkspacePortScanResult {
  return {
    platform: 'unknown',
    scannedAt: Date.now(),
    ports: [],
    unavailableReason: reason
  }
}

export async function scanWorkspacePortTargets({
  targets,
  shouldStart,
  onStarted,
  onFailed,
  onSkipped
}: WorkspacePortScanBatchOptions): Promise<WorkspacePortScanEntry[]> {
  const results = await mapWithConcurrency(
    targets,
    WORKSPACE_PORT_SCAN_CONCURRENCY,
    async (target) => {
      const key = workspacePortScanKeyForTarget(target)
      if (!shouldStart()) {
        onSkipped(key)
        return null
      }
      onStarted(key)
      try {
        const result = await scanWorkspacePortsForTarget(target)
        return { key, result }
      } catch (error) {
        onFailed(key)
        const message = error instanceof Error ? error.message : String(error)
        return { key, result: makeUnavailableScan(message || 'Workspace port scan failed.') }
      }
    }
  )
  return results.filter((result): result is WorkspacePortScanEntry => result !== null)
}
