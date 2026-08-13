import type { WorkspaceCleanupScanResult } from '../../../../shared/workspace-cleanup'

type BroadScanEntry = {
  scanId: string
  promise: Promise<WorkspaceCleanupScanResult>
}

const inFlightScans = new Map<string, BroadScanEntry>()
const supersededScanIds = new Set<string>()

export class WorkspaceCleanupScanSupersededError extends Error {
  constructor() {
    super('Workspace cleanup scan superseded')
    this.name = 'WorkspaceCleanupScanSupersededError'
  }
}

export function isWorkspaceCleanupScanSupersededError(
  error: unknown
): error is WorkspaceCleanupScanSupersededError {
  return error instanceof WorkspaceCleanupScanSupersededError
}

export function getInFlightWorkspaceCleanupScan(
  key: string
): Promise<WorkspaceCleanupScanResult> | undefined {
  return inFlightScans.get(key)?.promise
}

export function hasInFlightWorkspaceCleanupScan(key: string): boolean {
  return inFlightScans.has(key)
}

export function registerInFlightWorkspaceCleanupScan(
  key: string,
  scanId: string,
  promise: Promise<WorkspaceCleanupScanResult>
): void {
  inFlightScans.set(key, { scanId, promise })
}

export function releaseInFlightWorkspaceCleanupScan(
  key: string,
  scanId: string,
  promise: Promise<WorkspaceCleanupScanResult>
): void {
  if (inFlightScans.get(key)?.promise === promise) {
    inFlightScans.delete(key)
  }
  supersededScanIds.delete(scanId)
}

export function supersedeInFlightWorkspaceCleanupScans(
  cancelScan: ((scanId: string) => Promise<boolean>) | undefined
): void {
  for (const { scanId } of inFlightScans.values()) {
    supersededScanIds.add(scanId)
    void cancelScan?.(scanId).catch((error: unknown) => {
      console.warn('Failed to cancel superseded workspace cleanup scan:', error)
    })
  }
  inFlightScans.clear()
}

export function throwIfWorkspaceCleanupScanSuperseded(scanId: string): void {
  if (supersededScanIds.has(scanId)) {
    throw new WorkspaceCleanupScanSupersededError()
  }
}

export function normalizeWorkspaceCleanupScanError(scanId: string, error: unknown): unknown {
  return supersededScanIds.has(scanId) ? new WorkspaceCleanupScanSupersededError() : error
}
