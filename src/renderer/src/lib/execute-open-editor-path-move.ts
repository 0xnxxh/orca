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

  // Every open session under the source path is affected — including one open in
  // a DIFFERENT worktree (e.g. a floating workspace) at the same absolute path,
  // which the in-place rekey also retargets — so quiesce/suppress/notify them all.
  const affected = useAppStore
    .getState()
    .openFiles.filter((f) => isPathInsideOrEqual(fromPath, f.filePath))
  const newPathOf = (filePath: string): string => toPath + filePath.slice(fromPath.length)

  // In-flight source suppression is scoped per (worktree, runtime owner): the
  // same path can be open and watched under more than one worktree/owner.
  const ownerSubOps: string[] = []
  const scopeKey = (f: (typeof affected)[number]): string =>
    `${f.worktreeId}::${f.runtimeEnvironmentId?.trim() || 'local'}`
  const scopes = new Map<string, typeof affected>()
  for (const f of affected) {
    ;(scopes.get(scopeKey(f)) ?? scopes.set(scopeKey(f), []).get(scopeKey(f))!).push(f)
  }
  for (const [, scopeFiles] of scopes) {
    const first = scopeFiles[0]!
    const subOperationId = `${operationId}::${scopeKey(first)}`
    ownerSubOps.push(subOperationId)
    beginEditorPathMove({
      operationId: subOperationId,
      worktreeId: first.worktreeId,
      runtimeEnvironmentId: first.runtimeEnvironmentId?.trim() || null,
      sourcePaths: scopeFiles.map((f) => f.filePath),
      targetPaths: scopeFiles.map((f) => newPathOf(f.filePath))
    })
  }

  // Let any in-flight autosave settle so a trailing write can't recreate the old
  // path after the rename.
  await Promise.all(affected.map((f) => requestEditorSaveQuiesce({ fileId: f.id })))

  try {
    await renameRuntimePath(context, fromPath, toPath)
  } catch (err) {
    for (const subOperationId of ownerSubOps) {
      settleEditorPathMove(subOperationId)
    }
    throw err
  }

  // The rename committed; close the host's old-path tab for any mirrored file
  // (doing this only AFTER success so a failed rename can't desync the host).
  // The rekey detaches the tab to a local one, so without this the host snapshot
  // would resurrect the old path; the close intent suppresses re-mirroring.
  const mirrorState = useAppStore.getState()
  for (const file of affected) {
    if (file.mirroredFromRuntimeSession) {
      notifyHostOfMirroredEditorClose(mirrorState, file.worktreeId, file.id)
    }
  }

  // Commit: retarget the live sessions in place (the rekey installs the gate +
  // provenance on dirty destinations), then settle the transaction.
  const rekeyResult = remapOpenEditorTabsForPathChange({
    fromPath,
    toPath,
    worktreePath,
    worktreeId,
    moveOperationId: operationId
  })
  if (!rekeyResult.ok) {
    // The disk rename succeeded but the editor state couldn't be retargeted
    // (a destination collision or stale plan). Undo the on-disk move so the
    // still-open source session isn't stranded pointing at a vanished path.
    for (const subOperationId of ownerSubOps) {
      settleEditorPathMove(subOperationId)
    }
    await renameRuntimePath(context, toPath, fromPath).catch(() => undefined)
    throw new Error(`Could not retarget open editors for the move (${rekeyResult.reason}).`)
  }

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
