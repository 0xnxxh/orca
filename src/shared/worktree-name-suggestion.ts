import { MARINE_CREATURES } from './marine-creatures'

/** Shared selection core for generated workspace names.
 *
 *  Why this lives in shared: desktop and mobile each need to suggest a name before creating a
 *  workspace, and they previously hand-duplicated this algorithm. The two copies had to agree —
 *  both dedupe on the on-disk directory basename, both lowercase to match branch convention, and
 *  both degrade to suffixed tiers rather than recycling — so they are one implementation now.
 *
 *  Callers assemble the used set themselves because they source it differently (a by-repo map on
 *  desktop, a flat path list on mobile) and because retired names arrive from different places. */

export function normalizeSuggestedName(name: string): string {
  return name.trim().toLowerCase()
}

function stripTrailingSeparators(path: string): string {
  return path.replace(/[\\/]+$/, '')
}

/** Cross-platform basename: worktree paths can be POSIX, Windows, or SSH-host paths, and the
 *  collision that matters is on the directory name rather than the user-facing display name. */
export function suggestionPathBasename(path: string): string {
  const normalized = stripTrailingSeparators(path)
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  return index === -1 ? normalized : normalized.slice(index + 1)
}

function pickRandom<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]
}

/** Picks a name no one has taken, at random rather than in list order so fresh workspaces don't
 *  all start at the same creature and march down the list together.
 *
 *  `usedNames` must include retired names as well as live ones. A name whose workspace was deleted
 *  still owns its old directory path in any agent CLI that keys conversation state by cwd, so
 *  reissuing it hands the next occupant someone else's history. Once every base name is spent the
 *  pool degrades to `name-2`, `name-3`, and those variants are equally subject to retirement. */
export function selectSuggestedCreatureName(
  usedNames: Iterable<string>,
  random: () => number = Math.random
): string {
  const used = new Set<string>()
  for (const name of usedNames) {
    used.add(normalizeSuggestedName(name))
  }

  const available = MARINE_CREATURES.map(normalizeSuggestedName).filter((name) => !used.has(name))
  if (available.length > 0) {
    return pickRandom(available, random)
  }

  let suffix = 2
  while (true) {
    const numbered = MARINE_CREATURES.map(
      (name) => `${normalizeSuggestedName(name)}-${suffix}`
    ).filter((name) => !used.has(name))
    if (numbered.length > 0) {
      return pickRandom(numbered, random)
    }
    suffix += 1
  }
}
