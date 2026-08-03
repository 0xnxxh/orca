import { packAgentMapWorktrees } from './agent-map-worktree-packing'

const LINEAGE_VERTICAL_GAP = 42

type LineageWorktree = {
  id: string
  parentId?: string
  x: number
  y: number
  radius: number
}

type WorktreeFamily<T extends LineageWorktree> = {
  id: string
  x: number
  y: number
  radius: number
  worktrees: T[]
}

function compareStable(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function encloseFamily<T extends LineageWorktree>(id: string, worktrees: T[]): WorktreeFamily<T> {
  const left = Math.min(...worktrees.map((worktree) => worktree.x - worktree.radius))
  const right = Math.max(...worktrees.map((worktree) => worktree.x + worktree.radius))
  const top = Math.min(...worktrees.map((worktree) => worktree.y - worktree.radius))
  const bottom = Math.max(...worktrees.map((worktree) => worktree.y + worktree.radius))
  const centerX = (left + right) / 2
  const centerY = (top + bottom) / 2
  for (const worktree of worktrees) {
    worktree.x -= centerX
    worktree.y -= centerY
  }
  return {
    id,
    x: 0,
    y: 0,
    radius: Math.max(
      ...worktrees.map((worktree) => Math.hypot(worktree.x, worktree.y) + worktree.radius)
    ),
    worktrees
  }
}

function buildFamily<T extends LineageWorktree>(
  root: T,
  childrenByParent: ReadonlyMap<string, T[]>,
  emitted: Set<string>,
  ancestors: ReadonlySet<string>
): WorktreeFamily<T> {
  emitted.add(root.id)
  const nextAncestors = new Set(ancestors)
  nextAncestors.add(root.id)
  const children = (childrenByParent.get(root.id) ?? []).filter(
    (child) => !nextAncestors.has(child.id) && !emitted.has(child.id)
  )
  if (children.length === 0) {
    return {
      id: root.id,
      x: 0,
      y: 0,
      radius: root.radius,
      worktrees: [{ ...root, x: 0, y: 0 }]
    }
  }

  const childFamilies = packAgentMapWorktrees(
    children.map((child) => buildExactFamily(child, childrenByParent, emitted))
  )
  const childLeft = Math.min(...childFamilies.map((family) => family.x - family.radius))
  const childRight = Math.max(...childFamilies.map((family) => family.x + family.radius))
  const childTop = Math.min(...childFamilies.map((family) => family.y - family.radius))
  const childOffsetX = -(childLeft + childRight) / 2
  const childOffsetY = root.radius + LINEAGE_VERTICAL_GAP - childTop
  const worktrees = [{ ...root, x: 0, y: 0 }]
  for (const family of childFamilies) {
    for (const worktree of family.worktrees) {
      worktrees.push({
        ...worktree,
        x: worktree.x + family.x + childOffsetX,
        y: worktree.y + family.y + childOffsetY
      })
    }
  }
  return encloseFamily(root.id, worktrees)
}

function collectLinearFamily<T extends LineageWorktree>(
  root: T,
  childrenByParent: ReadonlyMap<string, T[]>,
  emitted: ReadonlySet<string>
): T[] | null {
  const worktrees: T[] = []
  const ancestors = new Set<string>()
  let current: T | undefined = root
  while (current) {
    worktrees.push(current)
    ancestors.add(current.id)
    const children = (childrenByParent.get(current.id) ?? []).filter(
      (child) => !ancestors.has(child.id) && !emitted.has(child.id)
    )
    if (children.length > 1) {
      return null
    }
    current = children[0]
  }
  return worktrees
}

function buildLinearFamily<T extends LineageWorktree>(worktrees: T[]): WorktreeFamily<T> {
  const positioned = worktrees.map((worktree) => ({ ...worktree, x: 0, y: 0 }))
  let radius = worktrees.at(-1)?.radius ?? 0
  for (let index = worktrees.length - 2; index >= 0; index -= 1) {
    positioned[index].y = -(radius + LINEAGE_VERTICAL_GAP / 2)
    radius += worktrees[index].radius + LINEAGE_VERTICAL_GAP / 2
  }
  let familyCenterY = 0
  for (let index = 0; index < positioned.length; index += 1) {
    positioned[index].y += familyCenterY
    familyCenterY += worktrees[index].radius + LINEAGE_VERTICAL_GAP / 2
  }
  return { id: worktrees[0].id, x: 0, y: 0, radius, worktrees: positioned }
}

function buildExactFamily<T extends LineageWorktree>(
  root: T,
  childrenByParent: ReadonlyMap<string, T[]>,
  emitted: Set<string>
): WorktreeFamily<T> {
  const linearFamily = collectLinearFamily(root, childrenByParent, emitted)
  if (!linearFamily) {
    return buildFamily(root, childrenByParent, emitted, new Set())
  }
  for (const worktree of linearFamily) {
    emitted.add(worktree.id)
  }
  return buildLinearFamily(linearFamily)
}

export function layoutAgentMapWorktreeLineage<T extends LineageWorktree>(worktrees: T[]): T[] {
  const sorted = [...worktrees].sort((a, b) => compareStable(a.id, b.id))
  const worktreesById = new Map(sorted.map((worktree) => [worktree.id, worktree]))
  const childrenByParent = new Map<string, T[]>()
  const childIds = new Set<string>()
  for (const worktree of sorted) {
    const parentId = worktree.parentId
    if (!parentId || parentId === worktree.id || !worktreesById.has(parentId)) {
      continue
    }
    childIds.add(worktree.id)
    const siblings = childrenByParent.get(parentId)
    if (siblings) {
      siblings.push(worktree)
    } else {
      childrenByParent.set(parentId, [worktree])
    }
  }

  const emitted = new Set<string>()
  const families: WorktreeFamily<T>[] = []
  for (const root of sorted.filter((worktree) => !childIds.has(worktree.id))) {
    if (!emitted.has(root.id)) {
      families.push(buildExactFamily(root, childrenByParent, emitted))
    }
  }
  for (const worktree of sorted) {
    if (!emitted.has(worktree.id)) {
      families.push(buildExactFamily(worktree, childrenByParent, emitted))
    }
  }

  return packAgentMapWorktrees(families)
    .flatMap((family) =>
      family.worktrees.map((worktree) => ({
        ...worktree,
        x: worktree.x + family.x,
        y: worktree.y + family.y
      }))
    )
    .sort((a, b) => compareStable(a.id, b.id))
}
