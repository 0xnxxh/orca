/** Client-side caching rules for retired workspace names, shared by the desktop hook (IPC) and the
 *  mobile hook (RPC). The transports differ, but what a refresh and a failure *mean* must not: the
 *  two hooks drifted, and mobile's copy blanked the list on any error — which un-retires names and
 *  is the one outcome retirement exists to prevent.
 *
 *  Pure by construction: `src/shared` is on the main process's import graph, so no React here. */

export const NO_RETIRED_NAMES: readonly string[] = []

/** The last answer, tagged with the repo it answered for. */
export type RetiredNamesLoad = {
  repoId: string
  names: readonly string[]
}

/** Reads one repo's names out of a `worktree.listRetiredNames` result. A host predating the method
 *  omits the field, and any host can answer with a malformed row that would throw when normalized. */
export function readRetiredNamesForRepo(result: unknown, repoId: string): string[] {
  const names = (result as { retiredNamesByRepo?: Record<string, unknown> } | null | undefined)
    ?.retiredNamesByRepo?.[repoId]
  return Array.isArray(names)
    ? names.filter((name): name is string => typeof name === 'string')
    : []
}

/** Next state once a refresh settles; `names === null` means it failed. Belongs in a `setState`
 *  updater rather than being applied at call time, so overlapping refreshes fold onto whatever
 *  actually landed last.
 *
 *  A failure holds the same repo's previous answer: a transient failure must not un-retire names,
 *  and a refresh fires on every workspace-list mutation, so blanking would suggest a spent name in
 *  exactly the window where the create form is asking for one. */
export function retiredNamesAfterRefresh(
  previous: RetiredNamesLoad | null,
  repoId: string,
  names: readonly string[] | null
): RetiredNamesLoad {
  return {
    repoId,
    names: names ?? (previous?.repoId === repoId ? previous.names : NO_RETIRED_NAMES)
  }
}

/** Stale-while-revalidate view: a load answers only for its own repo, so names never leak across a
 *  repo switch, and a refetch in flight keeps serving the previous answer rather than emptying.
 *
 *  Returns the stored array itself, not a copy, so it stays referentially stable and the suggestion
 *  memo downstream does not rerun on every refetch. */
export function selectRetiredNames(
  loaded: RetiredNamesLoad | null,
  repoId: string | null | undefined
): readonly string[] {
  return loaded && loaded.repoId === repoId ? loaded.names : NO_RETIRED_NAMES
}
