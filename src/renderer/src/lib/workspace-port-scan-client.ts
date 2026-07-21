import {
  callRuntimeRpc,
  RuntimeRpcCallError,
  type RuntimeClientTarget
} from '@/runtime/runtime-rpc-client'
import type { WorkspacePortScanResult } from '../../../shared/workspace-ports'

function requireWorkspacePortScanResult(value: unknown): WorkspacePortScanResult {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as WorkspacePortScanResult).ports) ||
    typeof (value as WorkspacePortScanResult).platform !== 'string' ||
    !Number.isFinite((value as WorkspacePortScanResult).scannedAt) ||
    ('unavailableReason' in value &&
      (value as WorkspacePortScanResult).unavailableReason !== undefined &&
      typeof (value as WorkspacePortScanResult).unavailableReason !== 'string')
  ) {
    throw new Error('Workspace port scan returned an invalid response.')
  }
  return value as WorkspacePortScanResult
}

export async function runWorkspacePortScanForTarget(
  target: RuntimeClientTarget,
  repoId?: string
): Promise<WorkspacePortScanResult> {
  const params = repoId ? { repoId } : {}
  if (target.kind === 'local') {
    return requireWorkspacePortScanResult(await window.api.workspacePorts.scan(params))
  }
  try {
    const result = await callRuntimeRpc<WorkspacePortScanResult>(
      target,
      'workspacePorts.scan',
      params,
      {
        timeoutMs: 15_000
      }
    )
    return requireWorkspacePortScanResult(result)
  } catch (error) {
    if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
      return {
        platform: 'unknown',
        scannedAt: Date.now(),
        ports: [],
        unavailableReason: 'The connected runtime does not support workspace port management yet.'
      }
    }
    throw error
  }
}
