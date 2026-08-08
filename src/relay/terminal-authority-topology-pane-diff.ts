import {
  sameTerminalBinding,
  terminalPaneGenerationKey,
  terminalPtyIncarnationKey
} from '../shared/terminal-session-authority-identity'
import type { TerminalPaneAuthorityProjection } from '../shared/terminal-session-authority-mutation'
import type { TerminalAuthorityTopologyPaneChange } from '../shared/terminal-authority-topology-stream-contract'

type PaneRecord = TerminalPaneAuthorityProjection

function samePaneRecord(left: PaneRecord, right: PaneRecord): boolean {
  return (
    left.paneKey === right.paneKey &&
    left.paneGenerationId === right.paneGenerationId &&
    left.status === right.status &&
    sameTerminalBinding(left.binding, right.binding) &&
    sameTerminalBinding(left.lastBinding, right.lastBinding) &&
    left.revision === right.revision &&
    left.ownerStatus === right.ownerStatus
  )
}

function changeKey(change: TerminalAuthorityTopologyPaneChange): string {
  return terminalPaneGenerationKey(change.pane)
}

export function diffTerminalAuthorityTopologyPanes(
  previous: readonly PaneRecord[],
  next: readonly PaneRecord[]
): readonly TerminalAuthorityTopologyPaneChange[] {
  const previousByKey = new Map(previous.map((pane) => [terminalPaneGenerationKey(pane), pane]))
  const nextByKey = new Map(next.map((pane) => [terminalPaneGenerationKey(pane), pane]))
  const changes: TerminalAuthorityTopologyPaneChange[] = []
  for (const [key, pane] of previousByKey) {
    if (!nextByKey.has(key)) {
      changes.push(
        Object.freeze({
          kind: 'remove',
          pane: Object.freeze({ paneKey: pane.paneKey, paneGenerationId: pane.paneGenerationId })
        })
      )
    }
  }
  for (const [key, pane] of nextByKey) {
    const current = previousByKey.get(key)
    if (!current || !samePaneRecord(current, pane)) {
      changes.push(Object.freeze({ kind: 'upsert', pane }))
    }
  }
  return Object.freeze(
    changes.sort((left, right) => changeKey(left).localeCompare(changeKey(right)))
  )
}

class ChangeSets {
  private readonly parents: number[]

  constructor(size: number) {
    this.parents = Array.from({ length: size }, (_, index) => index)
  }

  find(index: number): number {
    const parent = this.parents[index]
    if (parent === index) {
      return index
    }
    const root = this.find(parent)
    this.parents[index] = root
    return root
  }

  union(left: number, right: number): void {
    const leftRoot = this.find(left)
    const rightRoot = this.find(right)
    if (leftRoot !== rightRoot) {
      this.parents[rightRoot] = leftRoot
    }
  }
}

function connectByKey(
  changes: readonly TerminalAuthorityTopologyPaneChange[],
  sets: ChangeSets,
  keyFor: (change: TerminalAuthorityTopologyPaneChange) => string | null
): void {
  const firstByKey = new Map<string, number>()
  changes.forEach((change, index) => {
    const key = keyFor(change)
    if (key === null) {
      return
    }
    const first = firstByKey.get(key)
    if (first === undefined) {
      firstByKey.set(key, index)
    } else {
      sets.union(first, index)
    }
  })
}

function connectBindingTransfers(
  previous: readonly PaneRecord[],
  next: readonly PaneRecord[],
  changes: readonly TerminalAuthorityTopologyPaneChange[],
  sets: ChangeSets
): void {
  const changeByPane = new Map(changes.map((change, index) => [changeKey(change), index]))
  const previousHolder = new Map<string, number>()
  const nextHolder = new Map<string, number>()
  for (const pane of previous) {
    const index = changeByPane.get(terminalPaneGenerationKey(pane))
    if (index !== undefined && pane.binding) {
      previousHolder.set(terminalPtyIncarnationKey(pane.binding), index)
    }
  }
  for (const pane of next) {
    const index = changeByPane.get(terminalPaneGenerationKey(pane))
    if (index !== undefined && pane.binding) {
      nextHolder.set(terminalPtyIncarnationKey(pane.binding), index)
    }
  }
  for (const [binding, previousIndex] of previousHolder) {
    const nextIndex = nextHolder.get(binding)
    if (nextIndex !== undefined) {
      sets.union(previousIndex, nextIndex)
    }
  }
}

export function groupAtomicTerminalAuthorityTopologyPaneChanges(
  previous: readonly PaneRecord[],
  next: readonly PaneRecord[]
): readonly (readonly TerminalAuthorityTopologyPaneChange[])[] {
  const changes = diffTerminalAuthorityTopologyPanes(previous, next)
  const sets = new ChangeSets(changes.length)
  connectByKey(changes, sets, (change) => change.pane.paneKey)
  connectBindingTransfers(previous, next, changes, sets)
  const groups = new Map<number, TerminalAuthorityTopologyPaneChange[]>()
  changes.forEach((change, index) => {
    const root = sets.find(index)
    const group = groups.get(root) ?? []
    group.push(change)
    groups.set(root, group)
  })
  return Object.freeze(
    [...groups.values()]
      .map((group) => Object.freeze(group))
      .sort((left, right) => changeKey(left[0]).localeCompare(changeKey(right[0])))
  )
}
