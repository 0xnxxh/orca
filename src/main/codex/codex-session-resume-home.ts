import { existsSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import {
  getRuntimePathBasename,
  normalizeRuntimePathForComparison,
  relativePathInsideRoot
} from '../../shared/cross-platform-path'
import { listCodexSessionRolloutFilesIncrementally } from './codex-session-file-listing'

// Why: only Codex's dated rollout layout may establish account-home provenance; nested/misplaced JSONL must not select credentials.
const DATED_ROLLOUT_TAIL = String.raw`\d{4}/\d{2}/\d{2}/rollout-[^/]+\.jsonl(?:\.zst)?`
const ROLLOUT_RELATIVE_PATH = new RegExp(`^${DATED_ROLLOUT_TAIL}$`)
// Why: case-insensitive because trusted-home matching folds Windows path case too.
const CODEX_ROLLOUT_LAYOUT_PATH = new RegExp(`(?:^|/)sessions/${DATED_ROLLOUT_TAIL}$`, 'i')

function isCodexRolloutInsideSessionsRoot(sessionsRoot: string, filePath: string): boolean {
  const relativePath = relativePathInsideRoot(sessionsRoot, filePath)
  return Boolean(relativePath && ROLLOUT_RELATIVE_PATH.test(relativePath.replace(/\\/g, '/')))
}

function isRegularFile(filePath: string): boolean {
  try {
    return lstatSync(filePath).isFile()
  } catch {
    return false
  }
}

function resolveExistingRolloutPath(
  transcriptPath: string,
  fileIsRegular: (filePath: string) => boolean
): string | null {
  const plainPath = transcriptPath.endsWith('.jsonl.zst')
    ? transcriptPath.slice(0, -'.zst'.length)
    : transcriptPath.endsWith('.jsonl')
      ? transcriptPath
      : null
  if (!plainPath) {
    return fileIsRegular(transcriptPath) ? transcriptPath : null
  }
  if (fileIsRegular(plainPath)) {
    return plainPath
  }
  const compressedPath = `${plainPath}.zst`
  return fileIsRegular(compressedPath) ? compressedPath : null
}

function resolveTrustedCodexSessionResume(args: {
  transcriptPath: string | undefined
  trustedCodexHomes: readonly string[]
  fileIsRegular?: (filePath: string) => boolean
}): { homePath: string; transcriptPath: string } | null {
  const persistedPath = args.transcriptPath?.trim()
  if (!persistedPath) {
    return null
  }

  for (const homePath of args.trustedCodexHomes) {
    const sessionsRoot = join(homePath, 'sessions')
    if (!isCodexRolloutInsideSessionsRoot(sessionsRoot, persistedPath)) {
      continue
    }
    const transcriptPath = resolveExistingRolloutPath(
      persistedPath,
      args.fileIsRegular ?? isRegularFile
    )
    if (transcriptPath) {
      return { homePath, transcriptPath }
    }
  }
  return null
}

export function resolveTrustedCodexSessionResumeHome(args: {
  transcriptPath: string | undefined
  trustedCodexHomes: readonly string[]
  fileIsRegular?: (filePath: string) => boolean
}): string | null {
  return resolveTrustedCodexSessionResume(args)?.homePath ?? null
}

/**
 * True when transcriptPath claims Codex's dated rollout layout, under any home and without
 * checking existence — separating rejected Codex provenance from cross-agent/stale metadata.
 * Not scoped to trusted homes: a rollout under a removed home is still rejected provenance,
 * and admitting it would resume that session under whichever account is selected now.
 */
export function claimsCodexRolloutLayout(transcriptPath: string | undefined): boolean {
  const persistedPath = transcriptPath?.trim()
  if (!persistedPath) {
    return false
  }
  return CODEX_ROLLOUT_LAYOUT_PATH.test(persistedPath.replace(/\\/g, '/'))
}

/**
 * Orders trusted homes for the legacy id rescan, lowest wins.
 *
 * The winning home becomes the resumed pane's CODEX_HOME, so it picks the
 * account. Rank the currently selected account's own home first — once a
 * rollout is hardlinked into every managed home the id alone no longer names
 * an account, and resuming under the account the user has selected is what
 * they asked for. The real system home ranks next because codex refreshes it
 * directly. Everything else is ordered by normalized path so no winner ever
 * depends on the order accounts happen to sit in settings.
 */
function rankTrustedCodexHomesForRescan(args: {
  trustedCodexHomes: readonly string[]
  selectedAccountCodexHome?: string | null
  systemCodexHomePath?: string | null
}): string[] {
  const selected = args.selectedAccountCodexHome?.trim()
  const system = args.systemCodexHomePath?.trim()
  const selectedComparison = selected ? normalizeRuntimePathForComparison(selected) : null
  const systemComparison = system ? normalizeRuntimePathForComparison(system) : null
  const rankOf = (comparisonHome: string): number => {
    if (selectedComparison && comparisonHome === selectedComparison) {
      return 0
    }
    return systemComparison && comparisonHome === systemComparison ? 1 : 2
  }
  return args.trustedCodexHomes
    .map((homePath) => ({ homePath, comparisonHome: normalizeRuntimePathForComparison(homePath) }))
    .sort((left, right) => {
      const rankDelta = rankOf(left.comparisonHome) - rankOf(right.comparisonHome)
      if (rankDelta !== 0) {
        return rankDelta
      }
      return left.comparisonHome < right.comparisonHome
        ? -1
        : left.comparisonHome > right.comparisonHome
          ? 1
          : 0
    })
    .map((entry) => entry.homePath)
}

export async function findTrustedCodexSessionResume(args: {
  sessionId: string
  transcriptPath: string | undefined
  trustedCodexHomes: readonly string[]
  selectedAccountCodexHome?: string | null
  systemCodexHomePath?: string | null
  fileIsRegular?: (filePath: string) => boolean
  listSessionFiles?: (sessionsRoot: string) => AsyncIterable<string>
}): Promise<{ homePath: string; transcriptPath: string } | null> {
  const directSession = resolveTrustedCodexSessionResume(args)
  if (directSession) {
    return directSession
  }
  if (args.transcriptPath?.trim()) {
    // Why: stale/rejected provenance must not select a same-id rollout under different account credentials; scanning is legacy-only.
    return null
  }
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(args.sessionId)) {
    return null
  }

  const listSessionFiles =
    args.listSessionFiles ??
    ((sessionsRoot: string) =>
      listCodexSessionRolloutFilesIncrementally(sessionsRoot, { batchSize: 64, yieldMs: 0 }))
  const expectedSuffix = `-${args.sessionId}.jsonl`.toLowerCase()
  const seenHomes = new Set<string>()
  for (const homePath of rankTrustedCodexHomesForRescan(args)) {
    const comparisonHome = normalizeRuntimePathForComparison(homePath)
    if (seenHomes.has(comparisonHome)) {
      continue
    }
    seenHomes.add(comparisonHome)
    const sessionsRoot = join(homePath, 'sessions')
    if (!args.listSessionFiles && !existsSync(sessionsRoot)) {
      continue
    }
    for await (const filePath of listSessionFiles(sessionsRoot)) {
      const plainFilePath = filePath.endsWith('.jsonl.zst')
        ? filePath.slice(0, -'.zst'.length)
        : filePath
      // Why: the directory entry already proves the compressed file exists; only probe its preferred plain sibling.
      const preferredFilePath =
        plainFilePath !== filePath && (args.fileIsRegular ?? isRegularFile)(plainFilePath)
          ? plainFilePath
          : filePath
      const plainFileName = getRuntimePathBasename(preferredFilePath)
        .toLowerCase()
        .replace(/\.zst$/, '')
      if (
        isCodexRolloutInsideSessionsRoot(sessionsRoot, preferredFilePath) &&
        plainFileName.endsWith(expectedSuffix)
      ) {
        return { homePath, transcriptPath: preferredFilePath }
      }
    }
  }
  return null
}
