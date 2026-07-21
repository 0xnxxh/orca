import { useAppStore } from '@/store'
import { renameRuntimePath, type RuntimeFileOperationArgs } from '@/runtime/runtime-file-client'
import { requestEditorSaveQuiesce } from '@/components/editor/editor-autosave'
import {
  beginEditorPathMove,
  settleEditorPathMove
} from '@/components/editor/editor-path-move-inflight'
import {
  isPathInsideOrEqual,
  remapOpenEditorTabsForPathChange
} from '@/lib/remap-open-editor-tabs-for-path-change'
import { verifyLatchedMoveDestinations } from '@/hooks/useEditorExternalWatch'
import { normalizeAbsolutePathForComparison } from '@/components/right-sidebar/file-explorer-paths'
import { notifyHostOfMirroredEditorClose } from '@/runtime/close-mirrored-editor-tab'

let moveOperationCounter = 0

/**
 * Coordinates an Orca-owned move as one editor transaction: quiesce affected
 * saves, register in-flight source suppression, run the on-disk rename, then
 * atomically rekey the open sessions in place (installing the content-verify
 * gate) and re-verify any destination echo that was latched before the rekey.
 * On failure the store is untouched — only the suppression scope is released.
 *
 * Replaces the old renameOpenTabsPathOnDisk (self-move TTL) + separate remap.
 */
export async function executeOpenEditorPathMove(args: {
  context: RuntimeFileOperationArgs
  fromPath: string
  toPath: string
  worktreeId: string
  worktreePath: string
}): Promise<void> {
  const { context, fromPath, toPath, worktreeId, worktreePath } = args
  const operationId = `editor-move-${(moveOperationCounter += 1)}`

  const affected = useAppStore
    .getState()
    .openFiles.filter(
      (f) => f.worktreeId === worktreeId && isPathInsideOrEqual(fromPath, f.filePath)
    )
  const newPathOf = (filePath: string): string => toPath + filePath.slice(fromPath.length)

  // In-flight source suppression is scoped per runtime owner, since the same
  // path can be open (and watched) under more than one owner.
  const ownerSubOps: string[] = []
  const owners = new Set(affected.map((f) => f.runtimeEnvironmentId?.trim() || null))
  for (const owner of owners) {
    const ownerFiles = affected.filter((f) => (f.runtimeEnvironmentId?.trim() || null) === owner)
    const subOperationId = `${operationId}::${owner ?? 'local'}`
    ownerSubOps.push(subOperationId)
    beginEditorPathMove({
      operationId: subOperationId,
      worktreeId,
      runtimeEnvironmentId: owner,
      sourcePaths: ownerFiles.map((f) => f.filePath),
      targetPaths: ownerFiles.map((f) => newPathOf(f.filePath))
    })
  }

  // Let any in-flight autosave settle so a trailing write can't recreate the old
  // path after the rename.
  await Promise.all(affected.map((f) => requestEditorSaveQuiesce({ fileId: f.id })))

  // Close the host's old-path tab for any mirrored file: the rekey detaches it
  // to a local tab, so without this the host snapshot would resurrect the old
  // path. The close intent recorded by the RPC suppresses re-mirroring.
  const mirrorState = useAppStore.getState()
  for (const file of affected) {
    if (file.mirroredFromRuntimeSession) {
      notifyHostOfMirroredEditorClose(mirrorState, file.worktreeId, file.id)
    }
  }

  try {
    await renameRuntimePath(context, fromPath, toPath)
  } catch (err) {
    for (const subOperationId of ownerSubOps) {
      settleEditorPathMove(subOperationId)
    }
    throw err
  }

  // Commit: retarget the live sessions in place (the rekey installs the gate +
  // provenance on dirty destinations), then settle the transaction.
  remapOpenEditorTabsForPathChange({
    fromPath,
    toPath,
    worktreePath,
    worktreeId,
    moveOperationId: operationId
  })

  const latchedTargets = new Set<string>()
  for (const subOperationId of ownerSubOps) {
    for (const target of settleEditorPathMove(subOperationId)) {
      latchedTargets.add(target)
    }
  }
  if (latchedTargets.size > 0) {
    const latchedTabIds = useAppStore
      .getState()
      .openFiles.filter(
        (f) =>
          f.pendingSelfMoveEcho &&
          latchedTargets.has(normalizeAbsolutePathForComparison(f.pendingSelfMoveEcho.targetPath))
      )
      .map((f) => f.id)
    verifyLatchedMoveDestinations(worktreePath, context.connectionId, latchedTabIds)
  }
}
