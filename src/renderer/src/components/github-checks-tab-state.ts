import type { PRCheckDetail, PRCheckRunDetails } from '../../../shared/types'

export type CheckDetailsLoadState = {
  requestId?: number
  loading: boolean
  details: PRCheckRunDetails | null
  error: string | null
}

export type GitHubChecksTabState = {
  contextKey: string
  contextOwner: object
  sourceChecks: GitHubChecksSource
  localChecks: PRCheckDetail[] | null
  expandedCheckKey: string | null
  detailsByCheckKey: Record<string, CheckDetailsLoadState>
}

type GitHubChecksSource = readonly PRCheckDetail[] | null | undefined

export function createGitHubChecksTabState(
  sourceChecks: GitHubChecksSource,
  contextKey: string
): GitHubChecksTabState {
  return {
    contextKey,
    contextOwner: {},
    sourceChecks,
    localChecks: null,
    expandedCheckKey: null,
    detailsByCheckKey: {}
  }
}

export function resolveGitHubChecksTabState(
  state: GitHubChecksTabState,
  sourceChecks: GitHubChecksSource,
  contextKey: string
): GitHubChecksTabState {
  if (state.contextKey !== contextKey) {
    return createGitHubChecksTabState(sourceChecks, contextKey)
  }
  return state.sourceChecks === sourceChecks
    ? state
    : resetGitHubChecksTabForSource(state, sourceChecks)
}

export function resetGitHubChecksTabForSource(
  state: GitHubChecksTabState,
  sourceChecks: GitHubChecksSource = state.sourceChecks
): GitHubChecksTabState {
  return {
    contextKey: state.contextKey,
    contextOwner: state.contextOwner,
    sourceChecks,
    localChecks: null,
    expandedCheckKey: null,
    detailsByCheckKey: {}
  }
}

export function updateGitHubChecksTabLocalChecks(
  state: GitHubChecksTabState,
  localChecks: PRCheckDetail[]
): GitHubChecksTabState {
  return {
    ...state,
    localChecks
  }
}

export function toggleGitHubChecksTabExpandedKey(
  state: GitHubChecksTabState,
  key: string
): GitHubChecksTabState {
  return {
    ...state,
    expandedCheckKey: state.expandedCheckKey === key ? null : key
  }
}

export function updateGitHubChecksTabDetails(
  state: GitHubChecksTabState,
  key: string,
  details: CheckDetailsLoadState
): GitHubChecksTabState {
  return {
    ...state,
    detailsByCheckKey: {
      ...state.detailsByCheckKey,
      [key]: details
    }
  }
}

export function beginGitHubChecksTabDetails(
  state: GitHubChecksTabState,
  key: string,
  requestId: number
): GitHubChecksTabState {
  const current = state.detailsByCheckKey[key]
  return updateGitHubChecksTabDetails(state, key, {
    requestId,
    loading: true,
    details: null,
    error: current?.error ?? null
  })
}

export function settleGitHubChecksTabDetails(
  state: GitHubChecksTabState,
  key: string,
  requestId: number,
  details: Omit<CheckDetailsLoadState, 'requestId'>
): GitHubChecksTabState {
  if (state.detailsByCheckKey[key]?.requestId !== requestId) {
    return state
  }
  return updateGitHubChecksTabDetails(state, key, { ...details, requestId })
}
