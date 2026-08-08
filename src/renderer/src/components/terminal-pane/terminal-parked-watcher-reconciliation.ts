import type { TerminalTab } from '../../../../shared/types'
import type { useAppStore } from '@/store'
import { isTerminalLeafId, makePaneKey } from '../../../../shared/stable-pane-id'
import {
  collectLeafIdsInOrder,
  resolveRootlessTerminalLayoutLeafId
} from './terminal-layout-leaf-ids'
import {
  capturedPanesByTabId,
  type ParkedTerminalPaneCapture
} from './terminal-parked-watcher-registry'

export type ParkableTerminalTabModel = Pick<TerminalTab, 'id' | 'ptyId' | 'generation'>

type ParkedPaneLayoutState = {
  terminalLayoutsByTabId: ReturnType<typeof useAppStore.getState>['terminalLayoutsByTabId']
}

type ParkedPaneFallbackState = ParkedPaneLayoutState & {
  runtimePaneTitlesByTabId: ReturnType<typeof useAppStore.getState>['runtimePaneTitlesByTabId']
  hostTerminalSideEffectIdentityByPaneKey?: ReturnType<
    typeof useAppStore.getState
  >['hostTerminalSideEffectIdentityByPaneKey']
}

export function selectParkedTerminalPaneCandidateKey(
  state: ParkedPaneLayoutState,
  tabs: readonly ParkableTerminalTabModel[]
): string {
  return tabs
    .map((tab) => {
      const layout = state.terminalLayoutsByTabId[tab.id]
      const rootLeafIds = collectLeafIdsInOrder(layout?.root)
      const rootlessLeafId = layout ? resolveRootlessTerminalLayoutLeafId(layout) : null
      const leafIds =
        rootLeafIds.length > 0 ? rootLeafIds : rootlessLeafId !== null ? [rootlessLeafId] : []
      const ptyIdsByLeafId = layout?.ptyIdsByLeafId ?? {}
      return `${tab.id}:${layout?.activeLeafId ?? ''}:${leafIds
        .map((leafId) => `${leafId}=${ptyIdsByLeafId[leafId] ?? ''}`)
        .join(',')}`
    })
    .join('|')
}

export function fallbackParkedPaneCandidates(
  tab: ParkableTerminalTabModel,
  state: ParkedPaneFallbackState
): ParkedTerminalPaneCapture[] {
  const layout = state.terminalLayoutsByTabId[tab.id]
  const rootLeafIds = collectLeafIdsInOrder(layout?.root)
  const rootlessLeafId = layout ? resolveRootlessTerminalLayoutLeafId(layout) : null
  const leafIds =
    rootLeafIds.length > 0 ? rootLeafIds : rootlessLeafId !== null ? [rootlessLeafId] : []
  if (leafIds.length === 0) {
    return []
  }
  const ptyIdsByLeafId = layout?.ptyIdsByLeafId ?? {}
  const titleSlots = Object.keys(state.runtimePaneTitlesByTabId[tab.id] ?? {})
  const reusableSlot =
    leafIds.length === 1 && titleSlots.length === 1 ? Number(titleSlots[0]) : null
  const paneGeneration = tab.generation ?? 0
  return leafIds.map((leafId, index) => {
    const paneKey =
      tab.id.length > 0 && !tab.id.includes(':') && isTerminalLeafId(leafId)
        ? makePaneKey(tab.id, leafId)
        : null
    const sideEffectIdentity =
      paneKey !== null ? state.hostTerminalSideEffectIdentityByPaneKey?.[paneKey] : undefined
    return {
      ptyId: ptyIdsByLeafId[leafId] ?? (leafIds.length === 1 ? tab.ptyId : null),
      paneId: reusableSlot ?? -(index + 1),
      leafId,
      drivesTabTitle: layout?.activeLeafId ? leafId === layout.activeLeafId : index === 0,
      ...(sideEffectIdentity?.paneGeneration === paneGeneration ? { sideEffectIdentity } : {})
    }
  })
}

export function resolveParkedTerminalPaneCandidates(
  tab: ParkableTerminalTabModel,
  state: ParkedPaneFallbackState
): ParkedTerminalPaneCapture[] {
  const captured = capturedPanesByTabId.get(tab.id)
  const fallback = fallbackParkedPaneCandidates(tab, state)
  const capturedIsCurrent =
    captured !== undefined &&
    captured.panes.length > 0 &&
    (tab.ptyId === null || captured.panes.some((pane) => pane.ptyId === tab.ptyId)) &&
    (fallback.length === 0 ||
      (captured.panes.length === fallback.length &&
        fallback.every((pane) =>
          captured.panes.some(
            (candidate) =>
              candidate.leafId === pane.leafId &&
              candidate.ptyId === pane.ptyId &&
              candidate.drivesTabTitle === pane.drivesTabTitle
          )
        )))
  if (capturedIsCurrent) {
    return captured.panes
  }
  return fallback.map((pane) => {
    const prior = captured?.panes.find((candidate) => candidate.leafId === pane.leafId)
    return prior
      ? {
          ...pane,
          paneId: prior.paneId,
          ...(prior.ptyId === pane.ptyId && prior.mutationIdentity
            ? { mutationIdentity: prior.mutationIdentity }
            : {}),
          ...(prior.ptyId === pane.ptyId && prior.sideEffectIdentity
            ? { sideEffectIdentity: prior.sideEffectIdentity }
            : {})
        }
      : pane
  })
}
