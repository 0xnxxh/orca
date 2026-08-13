import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { MARINE_CREATURES } from '../shared/marine-creatures'

/** Agent CLIs bucket their per-conversation state under a directory derived from the workspace
 *  cwd. A bucket surviving its workspace is exactly the evidence we need: the name was used, the
 *  directory is gone, and reissuing the name would hand the next occupant that conversation. */
const AGENT_TRANSCRIPT_ROOTS = ['.claude/projects', '.codex/sessions'] as const

const POOL_NAMES: ReadonlySet<string> = new Set(MARINE_CREATURES.map((name) => name.toLowerCase()))

/** Why: worktree paths reaching retirement can be native, WSL, or SSH-host paths, so the leaf is
 *  taken separator-agnostically rather than through a platform-bound basename. */
export function retirableLeafName(path: string): string {
  const segments = path.split(/[/\\]/).filter((segment) => segment.trim().length > 0)
  return segments.at(-1) ?? ''
}

/** Bucket names encode a path with separators and dots flattened to dashes, so the workspace leaf
 *  is the trailing segment. A numeric tail is a suffixed variant ("gar-2") and must be kept whole,
 *  otherwise the base name alone gets retired and the variant stays issuable. */
export function extractCandidateLeafNames(encodedPath: string): string[] {
  const segments = encodedPath
    .split(/[-/\\]/)
    .map((segment) => segment.trim().toLowerCase())
    .filter((segment) => segment.length > 0)
  const last = segments.at(-1)
  if (last === undefined) {
    return []
  }
  const previous = segments.at(-2)
  if (previous && /^\d+$/.test(last)) {
    return [`${previous}-${last}`, previous]
  }
  return [last]
}

/** Why: over-retiring costs one name from a 552-entry pool; under-retiring reissues a path whose
 *  agent history is still on disk. So this matches generously and never tries to be exact. */
export function collectRetiredNamesFromPaths(paths: Iterable<string>): Set<string> {
  const retired = new Set<string>()
  for (const path of paths) {
    if (typeof path !== 'string' || path.length === 0) {
      continue
    }
    for (const candidate of extractCandidateLeafNames(path)) {
      const base = candidate.replace(/-\d+$/, '')
      if (POOL_NAMES.has(base)) {
        retired.add(candidate)
      }
    }
  }
  return retired
}

/** Transcript bucket names are the workspace cwd with every non-alphanumeric run flattened to a
 *  dash. Encoding a repo's worktree parent the same way lets us keep retirement per-repo: a name
 *  spent under one repo's root says nothing about the same name under another's. */
export function encodePathForBucketMatch(path: string): string {
  return path.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()
}

function bucketBelongsToParent(bucketName: string, encodedParents: readonly string[]): boolean {
  if (encodedParents.length === 0) {
    return true
  }
  const bucket = bucketName.toLowerCase()
  return encodedParents.some((parent) => parent.length > 0 && bucket.startsWith(parent))
}

async function readDirectoryNames(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    // Missing or unreadable roots are normal: the agent may never have run on this machine.
    return []
  }
}

/** Discovers names already spent for a repo, for the one-time seed of the retirement registry.
 *  Local and best-effort by design — agent state for an SSH workspace lives on the execution host,
 *  so names used only there stay issuable until this host observes them. */
export async function discoverRetiredWorktreeNames(args: {
  workspaceRoots: readonly string[]
  home?: string
}): Promise<Set<string>> {
  const home = args.home ?? homedir()
  const observed: string[] = []
  const encodedParents = args.workspaceRoots.map(encodePathForBucketMatch)

  for (const root of args.workspaceRoots) {
    observed.push(...(await readDirectoryNames(root)))
  }
  for (const relativeRoot of AGENT_TRANSCRIPT_ROOTS) {
    const buckets = await readDirectoryNames(join(home, ...relativeRoot.split('/')))
    observed.push(...buckets.filter((bucket) => bucketBelongsToParent(bucket, encodedParents)))
  }

  return collectRetiredNamesFromPaths(observed)
}
