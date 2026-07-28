import type { Dirent } from 'node:fs'
import { opendir, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'

const MAXIMUM_PLUGIN_SCAN_DEPTH = 9
const MAXIMUM_PLUGIN_SCAN_ENTRIES = 4_096
export const MAXIMUM_PLUGIN_SKILL_CANDIDATES = 64
const MAXIMUM_PLUGIN_UNVERIFIED_PATHS = 16
const MAXIMUM_PLUGIN_PRUNED_PATHS = 64

// Why: plugins vendor dependency trees and VCS metadata beside their own content.
// An installed skill package is never inside one, and walking them is what drives
// a plugin cache past the depth budget.
const NON_SKILL_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn'
])

export type KnownPluginSkillCandidate = {
  name: string
  path: string
}

export type KnownPluginSkillScan = {
  candidates: KnownPluginSkillCandidate[]
  /**
   * Paths where the scan cannot rule out an official skill: a directory it could
   * not read, or a global budget it exhausted mid-walk. Only these justify treating
   * a name as possibly hidden, because only these mean the scan does not know.
   */
  unverifiedPaths: string[]
  /**
   * Vendor/VCS paths deliberately not descended into because they cannot hold an
   * installed skill package. They prove nothing was missed and are not faults.
   */
  prunedPaths: string[]
}

function errorCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null
}

export async function scanKnownPluginSkillCandidates(
  rootPath: string,
  knownNames: ReadonlySet<string>,
  maximumCandidates = MAXIMUM_PLUGIN_SKILL_CANDIDATES
): Promise<KnownPluginSkillScan> {
  const candidates: KnownPluginSkillCandidate[] = []
  const unverifiedPaths = new Set<string>()
  const prunedPaths = new Set<string>()
  const visited = new Set<string>()
  let entryCount = 0
  let limitReached = false

  function recordUnverified(path: string): void {
    if (unverifiedPaths.has(path)) {
      return
    }
    if (unverifiedPaths.size >= MAXIMUM_PLUGIN_UNVERIFIED_PATHS) {
      // Why: each unverified path expands to one conservative row per official
      // skill. Collapse a hostile cache into one poison sentinel before IPC/render fanout.
      unverifiedPaths.clear()
      unverifiedPaths.add(rootPath)
      limitReached = true
      return
    }
    unverifiedPaths.add(path)
  }

  function recordPruned(path: string): void {
    // Why: expected vendor/VCS trees are not faults, so recording one must never
    // abort the scan the way an unverified path does.
    if (prunedPaths.size < MAXIMUM_PLUGIN_PRUNED_PATHS) {
      prunedPaths.add(path)
    }
  }

  async function visit(directory: string, depth: number): Promise<void> {
    if (limitReached) {
      return
    }
    if (depth > MAXIMUM_PLUGIN_SCAN_DEPTH) {
      // Why: unlike a named vendor/VCS directory, arbitrary deep ground can
      // still contain a valid skill placement.
      recordUnverified(directory)
      return
    }
    let resolved: string
    try {
      resolved = await realpath(directory)
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        recordUnverified(directory)
      }
      return
    }
    if (visited.has(resolved)) {
      return
    }
    visited.add(resolved)

    let handle: Awaited<ReturnType<typeof opendir>>
    try {
      handle = await opendir(directory)
    } catch {
      recordUnverified(directory)
      return
    }
    const entries: Dirent[] = []
    try {
      for (;;) {
        const entry = await handle.read()
        if (!entry) {
          break
        }
        entryCount += 1
        if (entryCount > MAXIMUM_PLUGIN_SCAN_ENTRIES) {
          // Why: unlike a depth stop, this aborts mid-directory at any level, so
          // the untouched remainder could still hold an official name.
          limitReached = true
          recordUnverified(rootPath)
          break
        }
        entries.push(entry)
      }
    } catch {
      recordUnverified(directory)
    } finally {
      await handle.close().catch(() => undefined)
    }

    entries.sort((left, right) => (left.name === right.name ? 0 : left.name < right.name ? -1 : 1))
    for (const entry of entries) {
      if (limitReached) {
        return
      }
      const entryPath = join(directory, entry.name)
      let directoryEntry = entry.isDirectory()
      if (entry.isSymbolicLink()) {
        try {
          directoryEntry = (await stat(entryPath)).isDirectory()
        } catch {
          if (knownNames.has(entry.name)) {
            if (candidates.length >= maximumCandidates) {
              limitReached = true
              recordUnverified(rootPath)
              return
            }
            candidates.push({ name: entry.name, path: entryPath })
          }
          continue
        }
      }
      if (!directoryEntry) {
        continue
      }
      if (knownNames.has(entry.name)) {
        if (candidates.length >= maximumCandidates) {
          limitReached = true
          recordUnverified(rootPath)
          return
        }
        candidates.push({ name: entry.name, path: entryPath })
        continue
      }
      if (NON_SKILL_DIRECTORY_NAMES.has(entry.name)) {
        recordPruned(entryPath)
        continue
      }
      await visit(entryPath, depth + 1)
    }
  }

  await visit(rootPath, 0)
  return { candidates, unverifiedPaths: [...unverifiedPaths], prunedPaths: [...prunedPaths] }
}
