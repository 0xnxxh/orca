import { lstat } from 'node:fs/promises'
import {
  isAiVaultSessionQuiescent,
  type AiVaultSessionLiveness
} from '../../shared/ai-vault-session-deletion'

// What the transcript looked like at one instant. Size joins mtime because a
// coarse filesystem timestamp (FAT, some 9P mounts) can repeat within a second.
export type AiVaultTranscriptFingerprint = { mtimeMs: number; sizeBytes: number }

/** null for anything that is not a readable regular file — including ENOENT. */
export async function readAiVaultTranscriptFingerprint(
  filePath: string
): Promise<AiVaultTranscriptFingerprint | null> {
  try {
    const stats = await lstat(filePath)
    return stats.isFile() ? { mtimeMs: stats.mtimeMs, sizeBytes: stats.size } : null
  } catch {
    return null
  }
}

/**
 * Corroborates a `not-live` inventory verdict against the transcript itself, or
 * downgrades it to `unknown`.
 *
 * The PTY inventory and the agent-status snapshot only ever describe
 * Orca-managed processes. A local agent launched from an external terminal, one
 * running inside a WSL distro Orca did not spawn, and a paired-runtime owner are
 * all absent from both while writing to this very file — which is how a live
 * session reads as "no owning process found". Two things have to hold before
 * that absence counts as proof: the file did not change while liveness was being
 * inspected, and it has been quiet for the whole quiescence window.
 *
 * `live` and `unknown` pass through untouched — this only ever removes
 * permission to delete, never grants it.
 */
export async function qualifyAiVaultSessionLiveness(args: {
  liveness: AiVaultSessionLiveness
  filePath: string
  observedBefore: AiVaultTranscriptFingerprint | null
  nowMs: number
  quiescenceWindowMs?: number
}): Promise<AiVaultSessionLiveness> {
  if (args.liveness !== 'not-live') {
    return args.liveness
  }
  if (!args.observedBefore) {
    return 'unknown'
  }
  const observedAfter = await readAiVaultTranscriptFingerprint(args.filePath)
  // Unreadable now though it was readable a moment ago: something is moving it.
  if (!observedAfter) {
    return 'unknown'
  }
  // Appended to while the inventory was being walked — an owner exists whatever
  // the inventory reported.
  if (
    observedAfter.mtimeMs !== args.observedBefore.mtimeMs ||
    observedAfter.sizeBytes !== args.observedBefore.sizeBytes
  ) {
    return 'unknown'
  }
  return isAiVaultSessionQuiescent(observedAfter.mtimeMs, args.nowMs, args.quiescenceWindowMs)
    ? 'not-live'
    : 'unknown'
}
