import type { RpcClient } from '../transport/rpc-client'
import type { RpcSuccess } from '../transport/types'
import type { Worktree } from './workspace-list-sections'

export type WorktreeCatalogAdmission<T> =
  | { kind: 'full'; snapshotId: string | null; worktrees: T[] }
  | { kind: 'unchanged'; snapshotId: string }
  | { kind: 'invalid' }

type PendingWorktreeCatalog = {
  admission: WorktreeCatalogAdmission<Worktree>
  client: RpcClient
  hostId: string
}

export type AdmittedWorktreeCatalog = {
  changed: boolean
  worktrees: Worktree[]
}

function validSnapshotId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : null
}

export function admitWorktreeCatalogResponse<T>(
  result: unknown,
  requestedSnapshotId: string | null
): WorktreeCatalogAdmission<T> {
  if (!result || typeof result !== 'object') {
    return { kind: 'invalid' }
  }
  const response = result as {
    snapshotId?: unknown
    unchanged?: unknown
    worktrees?: unknown
  }
  if ('unchanged' in response) {
    const snapshotId = validSnapshotId(response.snapshotId)
    if (response.unchanged === true && snapshotId && snapshotId === requestedSnapshotId) {
      return { kind: 'unchanged', snapshotId }
    }
    return { kind: 'invalid' }
  }

  if (!Array.isArray(response.worktrees)) {
    return { kind: 'invalid' }
  }
  return {
    kind: 'full',
    snapshotId: validSnapshotId(response.snapshotId),
    worktrees: response.worktrees as T[]
  }
}

export class WorktreeCatalogSnapshotClient {
  private client: RpcClient | null = null
  private hostId: string | null = null
  private snapshotId: string | null = null
  private confirmedWorktrees: Worktree[] | null = null

  async fetch(client: RpcClient, hostId: string): Promise<PendingWorktreeCatalog | null> {
    if (this.client !== client || this.hostId !== hostId) {
      this.client = client
      this.hostId = hostId
      this.snapshotId = null
      this.confirmedWorktrees = null
    }
    const requestedSnapshotId = this.snapshotId
    const response = await client.sendRequest('worktree.ps', {
      limit: 10_000,
      afterSnapshotId: requestedSnapshotId
    })
    if (!response.ok) {
      return null
    }
    return {
      admission: admitWorktreeCatalogResponse<Worktree>(
        (response as RpcSuccess).result,
        requestedSnapshotId
      ),
      client,
      hostId
    }
  }

  admit(pending: PendingWorktreeCatalog | null): AdmittedWorktreeCatalog | null {
    if (!pending) {
      return null
    }
    if (
      pending.client !== this.client ||
      pending.hostId !== this.hostId ||
      pending.admission.kind === 'invalid'
    ) {
      this.snapshotId = null
      return null
    }

    const admission = pending.admission
    this.snapshotId = admission.snapshotId
    if (admission.kind === 'full') {
      this.confirmedWorktrees = admission.worktrees
    }
    return this.confirmedWorktrees
      ? { changed: admission.kind === 'full', worktrees: this.confirmedWorktrees }
      : null
  }
}
