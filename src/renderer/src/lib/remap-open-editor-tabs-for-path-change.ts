import { useAppStore } from '@/store'
import { detectLanguage } from '@/lib/language-detect'
import { basename } from '@/lib/path'
import {
  buildOwnedEditorFileId,
  resolveEditorFileIdForOwner,
  type OpenFilePathRekey
} from '@/store/slices/editor'
import {
  normalizeRuntimePathSeparators,
  relativePathInsideRoot
} from '../../../shared/cross-platform-path'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'

export function isPathInsideOrEqual(rootPath: string, candidatePath: string): boolean {
  if (candidatePath === rootPath) {
    return true
  }
  return candidatePath.startsWith(`${rootPath}/`) || candidatePath.startsWith(`${rootPath}\\`)
}

function isAbsolutePathLike(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')
}

function stripTrailingSeparators(path: string): string {
  if (path === '/' || /^[A-Za-z]:[\\/]?$/.test(path)) {
    return normalizeRuntimePathSeparators(path)
  }
  return normalizeRuntimePathSeparators(path).replace(/\/+$/, '')
}

function deriveRelativeRootFromOpenFile(filePath: string, relativePath: string): string {
  const normalizedFilePath = stripTrailingSeparators(filePath)
  const normalizedRelativePath = normalizeRuntimePathSeparators(relativePath).replace(/^\/+/, '')
  if (!normalizedRelativePath || isAbsolutePathLike(relativePath)) {
    const separatorIndex = normalizedFilePath.lastIndexOf('/')
    return separatorIndex <= 0 ? '/' : normalizedFilePath.slice(0, separatorIndex)
  }
  const suffix = `/${normalizedRelativePath}`
  if (normalizedFilePath.endsWith(suffix)) {
    return stripTrailingSeparators(normalizedFilePath.slice(0, -suffix.length) || '/')
  }
  const base = basename(normalizedFilePath)
  if (base && normalizedRelativePath === base) {
    const separatorIndex = normalizedFilePath.lastIndexOf('/')
    return separatorIndex <= 0 ? '/' : normalizedFilePath.slice(0, separatorIndex)
  }
  const separatorIndex = normalizedFilePath.lastIndexOf('/')
  return separatorIndex <= 0 ? '/' : normalizedFilePath.slice(0, separatorIndex)
}

function splitAbsolutePath(path: string): { prefix: string; segments: string[] } {
  const normalized = stripTrailingSeparators(path)
  const driveMatch = /^([A-Za-z]:)(?:\/(.*))?$/.exec(normalized)
  if (driveMatch) {
    return {
      prefix: driveMatch[1].toLowerCase(),
      segments: (driveMatch[2] ?? '').split('/').filter(Boolean)
    }
  }
  if (normalized.startsWith('//')) {
    const segments = normalized.slice(2).split('/').filter(Boolean)
    return {
      prefix: `//${segments.slice(0, 2).join('/').toLowerCase()}`,
      segments: segments.slice(2)
    }
  }
  if (normalized.startsWith('/')) {
    return { prefix: '/', segments: normalized.slice(1).split('/').filter(Boolean) }
  }
  return { prefix: '', segments: normalized.split('/').filter(Boolean) }
}

function getRelativePathFromRoot(rootPath: string, candidatePath: string): string {
  const insideRoot = relativePathInsideRoot(rootPath, candidatePath)
  if (insideRoot !== null) {
    return insideRoot
  }

  const root = splitAbsolutePath(rootPath)
  const candidate = splitAbsolutePath(candidatePath)
  if (root.prefix !== candidate.prefix) {
    return normalizeRuntimePathSeparators(candidatePath)
  }

  let commonSegmentCount = 0
  while (
    commonSegmentCount < root.segments.length &&
    commonSegmentCount < candidate.segments.length &&
    root.segments[commonSegmentCount] === candidate.segments[commonSegmentCount]
  ) {
    commonSegmentCount += 1
  }

  return [
    ...Array.from({ length: root.segments.length - commonSegmentCount }, () => '..'),
    ...candidate.segments.slice(commonSegmentCount)
  ].join('/')
}

function getUpdatedRelativePath({
  filePath,
  relativePath,
  worktreeId,
  updatedPath,
  initiatingWorktreeId,
  initiatingWorktreePath
}: {
  filePath: string
  relativePath: string
  worktreeId: string
  updatedPath: string
  initiatingWorktreeId: string | undefined
  initiatingWorktreePath: string
}): string {
  const worktreeRelative = relativePathInsideRoot(initiatingWorktreePath, filePath)
  const normalizedRelativePath = normalizeRuntimePathSeparators(relativePath).replace(/^\/+/, '')
  const usesInitiatingWorktreeRoot =
    initiatingWorktreeId !== undefined
      ? worktreeId === initiatingWorktreeId
      : worktreeId !== FLOATING_TERMINAL_WORKTREE_ID &&
        worktreeRelative !== null &&
        normalizeRuntimePathSeparators(worktreeRelative) === normalizedRelativePath
  const relativeRoot = usesInitiatingWorktreeRoot
    ? initiatingWorktreePath
    : deriveRelativeRootFromOpenFile(filePath, relativePath)

  return getRelativePathFromRoot(relativeRoot, updatedPath)
}

export function remapOpenEditorTabsForPathChange({
  fromPath,
  toPath,
  worktreePath,
  worktreeId,
  moveOperationId
}: {
  fromPath: string
  toPath: string
  worktreePath: string
  worktreeId?: string
  /** Passed by the move coordinator so dirty destinations get a content-verify
   * gate + provenance installed atomically with the re-home. */
  moveOperationId?: string
}): void {
  const state = useAppStore.getState()
  const filesToMove = state.openFiles.filter((file) => isPathInsideOrEqual(fromPath, file.filePath))
  if (filesToMove.length === 0) {
    return
  }
  const scopedWorktreeId = worktreeId ?? filesToMove[0]!.worktreeId

  // Retarget the live edit session in place (atomic store rekey) instead of
  // close+reopen: preserves the full OpenFile + all id-keyed state and closes
  // the watcher-race window that close/reopen opened.
  const updatedPathOf = (file: { filePath: string }): string =>
    toPath + file.filePath.slice(fromPath.length)
  const relativeOf = (file: {
    filePath: string
    relativePath: string
    worktreeId: string
  }): string =>
    getUpdatedRelativePath({
      filePath: file.filePath,
      relativePath: file.relativePath,
      worktreeId: file.worktreeId,
      updatedPath: updatedPathOf(file),
      initiatingWorktreeId: worktreeId,
      initiatingWorktreePath: worktreePath
    })

  // The plain-path id goes to the first owner claiming a destination; other
  // owners of the same path get an owner-qualified id (mirrors what sequential
  // openFile did). An existing unaffected tab at the destination is honoured via
  // resolveEditorFileIdForOwner; a same-owner conflict is a real collision the
  // rekey action rejects.
  const ownerKeyOf = (file: { worktreeId: string; runtimeEnvironmentId?: string | null }): string =>
    `${file.worktreeId}::${file.runtimeEnvironmentId?.trim() || ''}`
  const plainPathOwner = new Map<string, string>()
  const reservedSourceId = (file: {
    filePath: string
    worktreeId: string
    runtimeEnvironmentId?: string | null
  }): string => {
    const updatedPath = updatedPathOf(file)
    const ownerKey = ownerKeyOf(file)
    const claimed = plainPathOwner.get(updatedPath)
    if (claimed === ownerKey) {
      return updatedPath
    }
    if (claimed !== undefined) {
      return buildOwnedEditorFileId(updatedPath, file.worktreeId, file.runtimeEnvironmentId)
    }
    const id = resolveEditorFileIdForOwner(
      state,
      updatedPath,
      file.worktreeId,
      file.runtimeEnvironmentId,
      ['edit']
    )
    if (id === updatedPath) {
      plainPathOwner.set(updatedPath, ownerKey)
    }
    return id
  }

  const rekeys: OpenFilePathRekey[] = []
  // Edits first so a preview can point its source id at the moved edit's new id.
  const newEditIdByOldId = new Map<string, string>()
  for (const file of filesToMove) {
    if (file.mode !== 'edit') {
      continue
    }
    const newId = reservedSourceId(file)
    newEditIdByOldId.set(file.id, newId)
    rekeys.push({
      oldFileId: file.id,
      newFileId: newId,
      oldFilePath: file.filePath,
      newFilePath: updatedPathOf(file),
      newRelativePath: relativeOf(file),
      newLanguage: detectLanguage(basename(updatedPathOf(file))),
      // Only an explicit rename of the file itself consumes untitled status; a
      // containing-directory move keeps it.
      consumeUntitled: file.isUntitled === true && file.filePath === fromPath
    })
  }
  for (const file of filesToMove) {
    if (file.mode !== 'markdown-preview') {
      continue
    }
    const newSourceFileId =
      (file.markdownPreviewSourceFileId
        ? newEditIdByOldId.get(file.markdownPreviewSourceFileId)
        : undefined) ?? reservedSourceId(file)
    rekeys.push({
      oldFileId: file.id,
      newFileId: `markdown-preview::${newSourceFileId}`,
      oldFilePath: file.filePath,
      newFilePath: updatedPathOf(file),
      newRelativePath: relativeOf(file),
      newMarkdownPreviewSourceFileId: newSourceFileId
    })
  }
  if (rekeys.length === 0) {
    return
  }
  useAppStore
    .getState()
    .rekeyOpenFilesForPathChange({ worktreeId: scopedWorktreeId, rekeys, moveOperationId })
}
