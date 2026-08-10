import { useMemo, useRef } from 'react'
import type { WorkspaceCleanupSortState } from '../../../../shared/workspace-cleanup-filter-model'

type OrderedRow = { worktreeId: string }

export type WorkspaceCleanupFrozenRowOrder = {
  sortSignature: string
  positions: Map<string, number>
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
  for (const row of fresh) {
    order.positions.set(row.worktreeId, order.positions.size)
  }
  return [...known, ...fresh]
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
  const frozenOrderRef = useRef<WorkspaceCleanupFrozenRowOrder | null>(null)
  return useMemo(() => {
    const sortSignature = `${sort.field}:${sort.direction}`
    const frozen = frozenOrderRef.current
    if (!streaming || frozen === null || frozen.sortSignature !== sortSignature) {
      // Why: settled renders (and an explicit mid-scan sort change) present the
      // live sort and freeze it as the order the next stream must hold steady.
      frozenOrderRef.current = createWorkspaceCleanupFrozenRowOrder(rows, sortSignature)
      return rows
    }
    return arrangeWorkspaceCleanupRowsByFrozenOrder(rows, frozen)
  }, [rows, sort.direction, sort.field, streaming])
}
