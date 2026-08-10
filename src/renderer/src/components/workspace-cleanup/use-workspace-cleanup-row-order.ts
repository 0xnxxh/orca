import { useEffect, useEffectEvent, useMemo, useRef } from 'react'
import type { WorkspaceCleanupSortState } from '../../../../shared/workspace-cleanup-filter-model'

type OrderedRow = { worktreeId: string }

export type WorkspaceCleanupFrozenRowOrder = {
  sortSignature: string
  positions: Map<string, number>
}

const UNCOMMITTED_ROW_ORDER: WorkspaceCleanupFrozenRowOrder = {
  sortSignature: '',
  positions: new Map()
}

export function createWorkspaceCleanupFrozenRowOrder(
  rows: readonly OrderedRow[],
  sortSignature: string
): WorkspaceCleanupFrozenRowOrder {
  return {
    sortSignature,
    positions: new Map(rows.map((row, index) => [row.worktreeId, index]))
  }
}

/**
 * Rows already on screen keep their slot while a refresh streams updated
 * values in; rows the order has not seen yet append after them (in the live
 * sort among themselves) and claim the next slots, so later ticks cannot
 * reshuffle them either.
 */
export function arrangeWorkspaceCleanupRowsByFrozenOrder<Row extends OrderedRow>(
  sortedRows: readonly Row[],
  order: WorkspaceCleanupFrozenRowOrder
): Row[] {
  const known: Row[] = []
  const fresh: Row[] = []
  for (const row of sortedRows) {
    if (order.positions.has(row.worktreeId)) {
      known.push(row)
    } else {
      fresh.push(row)
    }
  }
  known.sort(
    (left, right) =>
      (order.positions.get(left.worktreeId) ?? 0) - (order.positions.get(right.worktreeId) ?? 0)
  )
  return [...known, ...fresh]
}

export function extendWorkspaceCleanupFrozenRowOrder(
  rows: readonly OrderedRow[],
  order: WorkspaceCleanupFrozenRowOrder
): WorkspaceCleanupFrozenRowOrder {
  let positions: Map<string, number> | null = null
  for (const row of rows) {
    if (order.positions.has(row.worktreeId)) {
      continue
    }
    positions ??= new Map(order.positions)
    if (!positions.has(row.worktreeId)) {
      positions.set(row.worktreeId, positions.size)
    }
  }
  return positions === null ? order : { ...order, positions }
}

/**
 * Streaming-order stability for the flat list: while a scan streams, existing
 * rows must not reshuffle on every progress tick. The user's sort applies to
 * the snapshot immediately; streamed value changes land in place; one calm
 * re-sort happens when the scan settles — or at once if the user explicitly
 * changes the sort mid-scan.
 */
export function useWorkspaceCleanupRowOrder<Row extends OrderedRow>({
  rows,
  streaming,
  sort
}: {
  rows: readonly Row[]
  streaming: boolean
  sort: WorkspaceCleanupSortState
}): readonly Row[] {
  const frozenOrderRef = useRef<WorkspaceCleanupFrozenRowOrder>(UNCOMMITTED_ROW_ORDER)
  const sortSignature = `${sort.field}:${sort.direction}`
  const frozenOrder = frozenOrderRef.current
  const orderedRows = useMemo(
    () =>
      !streaming || frozenOrder.sortSignature !== sortSignature
        ? rows
        : arrangeWorkspaceCleanupRowsByFrozenOrder(rows, frozenOrder),
    [frozenOrder, rows, sortSignature, streaming]
  )
  const commitFrozenOrder = useEffectEvent(() => {
    const current = frozenOrderRef.current
    // Why: only committed renders may advance the order a later stream holds.
    frozenOrderRef.current =
      !streaming || current.sortSignature !== sortSignature
        ? createWorkspaceCleanupFrozenRowOrder(rows, sortSignature)
        : extendWorkspaceCleanupFrozenRowOrder(rows, current)
  })
  useEffect(() => {
    commitFrozenOrder()
  }, [rows, sortSignature, streaming])
  return orderedRows
}
