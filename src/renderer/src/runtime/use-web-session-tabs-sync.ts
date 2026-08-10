import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { SESSION_TABS_ATOMIC_SUBSCRIBE_ALL_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'
import type { RuntimeSessionMirrorTarget } from '@/lib/runtime-session-mirror-targets'
import { toRuntimeSessionMirrorTargetKey } from '@/lib/runtime-session-mirror-targets'
import { getExplicitRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { useAppStore } from '@/store'
import { clearWebSessionCloseIntentsForOwner } from './web-session-close-intent'
import { clearWebSessionFocusIntentsForOwner } from './web-session-focus-intent'
import { clearWebSessionReorderIntentsForOwner } from './web-session-reorder-intent'
import type { ActiveSessionTabsContext } from './web-session-tabs-active-snapshot'
import {
  type GlobalSessionTabsCoverage,
  type GlobalSessionTabsCoverageSignal,
  startGlobalWebSessionTabsSubscription
} from './web-session-tabs-global-subscription'
import {
  clearWebSessionTabsTrackingForEnvironment,
  shouldSyncAllRuntimeSessionTabs
} from './web-session-tabs-sync'
import { useActiveWebSessionTabsTransport } from './use-active-web-session-tabs-transport'
import { useRuntimeSessionMirrorEnvironmentKey } from './use-runtime-session-mirror-environment-key'

type CoverageState = {
  mirrorKey: string
  byTarget: ReadonlyMap<string, GlobalSessionTabsCoverage>
}

type ActiveRuntimeSessionMirrorTarget = RuntimeSessionMirrorTarget & {
  supportsAtomicGlobalSubscription: boolean
}

function parseMirrorTargets(key: string): (RuntimeSessionMirrorTarget & { targetKey: string })[] {
  if (!key) {
    return []
  }
  return key.split('\u0000').flatMap((targetKey) => {
    const [environmentId, runtimeId, rawGeneration, rawRevision] = targetKey.split('\u0001')
    const connectionGeneration = Number(rawGeneration)
    const pairingRevision = Number(rawRevision)
    return environmentId &&
      runtimeId &&
      Number.isFinite(connectionGeneration) &&
      Number.isFinite(pairingRevision)
      ? [{ environmentId, runtimeId, connectionGeneration, pairingRevision, targetKey }]
      : []
  })
}

function makeActiveContext(
  target: ActiveRuntimeSessionMirrorTarget | null,
  worktreeId: string | null
): ActiveSessionTabsContext | null {
  if (!target || !worktreeId) {
    return null
  }
  const targetKey = toRuntimeSessionMirrorTargetKey(target)
  return {
    targetKey,
    environmentId: target.environmentId,
    pairingRevision: target.pairingRevision,
    supportsAtomicGlobalSubscription: target.supportsAtomicGlobalSubscription,
    worktreeId,
    requestedInitialTerminal: false,
    requestedRespawnAfterWake: false
  }
}

export function useWebSessionTabsSync(): void {
  const activeWorktreeId = useAppStore((state) => state.activeWorktreeId)
  const runtimeSessionMirrorEnvironmentKey = useRuntimeSessionMirrorEnvironmentKey()
  const activeTarget = useAppStore(
    useShallow((state): ActiveRuntimeSessionMirrorTarget | null => {
      const environmentId = getExplicitRuntimeEnvironmentIdForWorktree(
        state,
        state.activeWorktreeId
      )
      const runtime = environmentId
        ? state.runtimeStatusByEnvironmentId.get(environmentId)
        : undefined
      const environment = state.runtimeEnvironments.find(({ id }) => id === environmentId)
      return environmentId && runtime?.status && environment
        ? {
            environmentId,
            runtimeId: runtime.status.runtimeId,
            connectionGeneration: runtime.connectionGeneration ?? 0,
            pairingRevision: environment.pairingRevision ?? environment.createdAt,
            supportsAtomicGlobalSubscription:
              runtime.status.capabilities?.includes(
                SESSION_TABS_ATOMIC_SUBSCRIBE_ALL_RUNTIME_CAPABILITY
              ) === true
          }
        : null
    })
  )
  const workspaceSessionReady = useAppStore((state) => state.workspaceSessionReady)
  const targets = useMemo(
    () => parseMirrorTargets(runtimeSessionMirrorEnvironmentKey),
    [runtimeSessionMirrorEnvironmentKey]
  )
  const activeContext = useMemo(
    () => makeActiveContext(activeTarget, activeWorktreeId),
    [activeTarget, activeWorktreeId]
  )
  const activeContextRef = useRef<ActiveSessionTabsContext | null>(activeContext)
  activeContextRef.current = activeContext
  const [coverageState, setCoverageState] = useState<CoverageState>({
    mirrorKey: '',
    byTarget: new Map()
  })
  const updateCoverage = useCallback(
    (mirrorKey: string, targetKey: string, coverage: GlobalSessionTabsCoverageSignal): void => {
      setCoverageState((current) => {
        const byTarget = new Map(current.mirrorKey === mirrorKey ? current.byTarget : [])
        const previous = byTarget.get(targetKey)
        const next: GlobalSessionTabsCoverage =
          coverage.status === 'ready'
            ? {
                ...coverage,
                generation: previous?.status === 'ready' ? previous.generation + 1 : 1
              }
            : coverage
        if (previous?.status === 'unavailable' && next.status === 'unavailable') {
          return current.mirrorKey === mirrorKey ? current : { mirrorKey, byTarget }
        }
        byTarget.set(targetKey, next)
        return { mirrorKey, byTarget }
      })
    },
    []
  )

  useEffect(() => {
    if (!workspaceSessionReady || targets.length === 0) {
      return
    }
    const unsubscribes = targets.flatMap((target) => {
      if (
        !shouldSyncAllRuntimeSessionTabs({
          activeRuntimeEnvironmentId: target.environmentId,
          workspaceSessionReady
        })
      ) {
        return []
      }
      return [
        startGlobalWebSessionTabsSubscription({
          environmentId: target.environmentId,
          targetKey: target.targetKey,
          expectedRuntimeId: target.runtimeId,
          expectedEnvironmentPairingRevision: target.pairingRevision,
          activeContextRef,
          onCoverage: (coverage) =>
            updateCoverage(runtimeSessionMirrorEnvironmentKey, target.targetKey, coverage)
        })
      ]
    })
    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe()
      }
      for (const target of targets) {
        clearWebSessionTabsTrackingForEnvironment(target.environmentId)
        const owner = {
          environmentId: target.environmentId,
          pairingRevision: target.pairingRevision
        }
        clearWebSessionCloseIntentsForOwner(owner)
        clearWebSessionFocusIntentsForOwner(owner)
        clearWebSessionReorderIntentsForOwner(owner)
      }
    }
  }, [runtimeSessionMirrorEnvironmentKey, targets, updateCoverage, workspaceSessionReady])

  const coverage =
    coverageState.mirrorKey === runtimeSessionMirrorEnvironmentKey && activeContext
      ? coverageState.byTarget.get(activeContext.targetKey)
      : undefined
  const canUseGlobalForActive = activeContext?.supportsAtomicGlobalSubscription === true
  const readyCoverage = canUseGlobalForActive && coverage?.status === 'ready' ? coverage : undefined

  useActiveWebSessionTabsTransport({
    context: activeContext,
    activeContextRef,
    coverage: readyCoverage,
    workspaceSessionReady
  })
}
