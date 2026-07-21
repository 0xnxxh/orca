import { existsSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import {
  getRuntimePathBasename,
  normalizeRuntimePathForComparison,
  relativePathInsideRoot
} from '../../shared/cross-platform-path'
import { listCodexSessionJsonlFilesIncrementally } from './codex-session-file-listing'

const ROLLOUT_RELATIVE_PATH = /^\d{4}\/\d{2}\/\d{2}\/rollout-[^/]+\.jsonl$/

function isRegularFile(filePath: string): boolean {
  try {
    return lstatSync(filePath).isFile()
  } catch {
    return false
  }
}

export function resolveTrustedCodexSessionResumeHome(args: {
  transcriptPath: string | undefined
  trustedCodexHomes: readonly string[]
  fileIsRegular?: (filePath: string) => boolean
}): string | null {
  const transcriptPath = args.transcriptPath?.trim()
  if (!transcriptPath || !(args.fileIsRegular ?? isRegularFile)(transcriptPath)) {
    return null
  }

  for (const homePath of args.trustedCodexHomes) {
    const relativePath = relativePathInsideRoot(join(homePath, 'sessions'), transcriptPath)
    if (relativePath && ROLLOUT_RELATIVE_PATH.test(relativePath.replace(/\\/g, '/'))) {
      return homePath
    }
  }
  return null
}

export async function findTrustedCodexSessionResume(args: {
  sessionId: string
  transcriptPath: string | undefined
  trustedCodexHomes: readonly string[]
  fileIsRegular?: (filePath: string) => boolean
  listSessionFiles?: (sessionsRoot: string) => AsyncIterable<string>
}): Promise<{ homePath: string; transcriptPath: string } | null> {
  const directHome = resolveTrustedCodexSessionResumeHome(args)
  if (directHome && args.transcriptPath) {
    return { homePath: directHome, transcriptPath: args.transcriptPath.trim() }
  }
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(args.sessionId)) {
    return null
  }

  const listSessionFiles =
    args.listSessionFiles ??
    ((sessionsRoot: string) =>
      listCodexSessionJsonlFilesIncrementally(sessionsRoot, { batchSize: 64, yieldMs: 0 }))
  const expectedSuffix = `-${args.sessionId}.jsonl`.toLowerCase()
  const seenHomes = new Set<string>()
  for (const homePath of args.trustedCodexHomes) {
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
      if (getRuntimePathBasename(filePath).toLowerCase().endsWith(expectedSuffix)) {
        return { homePath, transcriptPath: filePath }
      }
    }
  }
  return null
}
