type BrowserPlacement = { groupId: string; seen: boolean }

const placementsByPage = new Map<string, BrowserPlacement>()
const reservedGroups = new Set<string>()
const MAX_PENDING_PLACEMENTS = 128

function evictOldest(entries: Map<string, unknown> | Set<string>): void {
  const oldest = entries.keys().next().value
  if (oldest !== undefined) {
    entries.delete(oldest)
  }
}

function pageKey(environmentId: string, worktreeId: string, remotePageId: string): string {
  return `${environmentId}\0${worktreeId}\0${remotePageId}`
}

function groupKey(environmentId: string, worktreeId: string, groupId: string): string {
  return `${environmentId}\0${worktreeId}\0${groupId}`
}

function worktreePrefix(environmentId: string, worktreeId: string): string {
  return `${environmentId}\0${worktreeId}\0`
}

export function reserveWebSessionBrowserPlacementGroup(args: {
  environmentId: string
  worktreeId: string
  groupId: string
}): void {
  const key = groupKey(args.environmentId, args.worktreeId, args.groupId)
  reservedGroups.delete(key)
  while (reservedGroups.size >= MAX_PENDING_PLACEMENTS) {
    evictOldest(reservedGroups)
  }
  reservedGroups.add(key)
}

export function releaseWebSessionBrowserPlacementGroup(args: {
  environmentId: string
  worktreeId: string
  groupId: string
}): void {
  reservedGroups.delete(groupKey(args.environmentId, args.worktreeId, args.groupId))
}

export function isWebSessionBrowserPlacementGroupReserved(args: {
  environmentId: string
  worktreeId: string
  groupId: string
}): boolean {
  return reservedGroups.has(groupKey(args.environmentId, args.worktreeId, args.groupId))
}

export function recordWebSessionBrowserPlacement(args: {
  environmentId: string
  worktreeId: string
  remotePageId: string
  groupId: string
}): void {
  const key = pageKey(args.environmentId, args.worktreeId, args.remotePageId)
  placementsByPage.delete(key)
  while (placementsByPage.size >= MAX_PENDING_PLACEMENTS) {
    evictOldest(placementsByPage)
  }
  placementsByPage.set(key, {
    groupId: args.groupId,
    seen: false
  })
}

export function getWebSessionBrowserPlacementGroup(args: {
  environmentId: string
  worktreeId: string
  remotePageId: string
}): string | undefined {
  const placement = placementsByPage.get(
    pageKey(args.environmentId, args.worktreeId, args.remotePageId)
  )
  if (placement) {
    placement.seen = true
    releaseWebSessionBrowserPlacementGroup({ ...args, groupId: placement.groupId })
  }
  return placement?.groupId
}

export function pruneWebSessionBrowserPlacements(
  environmentId: string,
  worktreeId: string,
  liveRemotePageIds: ReadonlySet<string>
): void {
  const prefix = worktreePrefix(environmentId, worktreeId)
  for (const [key, placement] of placementsByPage) {
    const remotePageId = key.startsWith(prefix) ? key.slice(prefix.length) : null
    if (remotePageId && placement.seen && !liveRemotePageIds.has(remotePageId)) {
      placementsByPage.delete(key)
    }
  }
}

export function clearWebSessionBrowserPlacementsForWorktree(
  environmentId: string,
  worktreeId: string
): void {
  const prefix = worktreePrefix(environmentId, worktreeId)
  for (const key of placementsByPage.keys()) {
    if (key.startsWith(prefix)) {
      placementsByPage.delete(key)
    }
  }
  for (const key of reservedGroups) {
    if (key.startsWith(prefix)) {
      reservedGroups.delete(key)
    }
  }
}

export function clearWebSessionBrowserPlacementsForEnvironment(environmentId: string): void {
  const prefix = `${environmentId}\0`
  for (const key of placementsByPage.keys()) {
    if (key.startsWith(prefix)) {
      placementsByPage.delete(key)
    }
  }
  for (const key of reservedGroups) {
    if (key.startsWith(prefix)) {
      reservedGroups.delete(key)
    }
  }
}

export function resetWebSessionBrowserPlacementsForTests(): void {
  placementsByPage.clear()
  reservedGroups.clear()
}
