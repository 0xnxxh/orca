import { translate } from '@/i18n/i18n'
import { createWebRuntimeSessionBrowserTab } from '@/runtime/web-runtime-session'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import {
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../../shared/execution-host'
import { SEARCH_ENGINE_LABELS, type SearchEngine } from '../../../shared/browser-url'
import { resolveWorktreeOperationRoute } from './worktree-operation-route'

export type WorkspaceBrowserTabIntent = { kind: 'url' } | { kind: 'search'; engine: SearchEngine }

export type OpenWorkspaceBrowserTabRequest = {
  workspaceId: string
  targetGroupId?: string
  url: string
  intent: WorkspaceBrowserTabIntent
}

function intentPresentation(intent: WorkspaceBrowserTabIntent): {
  error: string
  title: string
} {
  if (intent.kind === 'url') {
    return {
      error: translate('auto.lib.workspace.browser.tab.open.urlFailed', 'Unable to open URL.'),
      title: translate('auto.components.tab.bar.TabBarCreateEntry.7cdf8ee0c8', 'Open URL')
    }
  }
  const engine = SEARCH_ENGINE_LABELS[intent.engine]
  return {
    error: translate(
      'auto.lib.workspace.browser.tab.open.searchFailed',
      'Unable to search with {{value0}}.',
      { value0: engine }
    ),
    title: translate(
      'auto.components.tab.bar.TabBarCreateEntry.searchProvider',
      'Search {{value0}}',
      { value0: engine }
    )
  }
}

function validateTarget(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.hostname
  } catch {
    return false
  }
}

function createClientBrowserTab(
  state: AppState,
  request: OpenWorkspaceBrowserTabRequest,
  hostId: ExecutionHostId,
  presentation: { error: string; title: string }
): void {
  try {
    state.createBrowserTab(request.workspaceId, request.url, {
      activate: true,
      browserRuntimeEnvironmentId: null,
      focusAddressBar: false,
      sessionProfileId:
        state.defaultBrowserSessionProfileIdByHostId[hostId] ??
        state.defaultBrowserSessionProfileId,
      targetGroupId: request.targetGroupId,
      title: presentation.title
    })
  } catch {
    throw new Error(presentation.error)
  }
}

export async function openWorkspaceBrowserTab(
  request: OpenWorkspaceBrowserTabRequest
): Promise<void> {
  const presentation = intentPresentation(request.intent)
  if (!validateTarget(request.url)) {
    throw new Error(presentation.error)
  }
  const state = useAppStore.getState()
  const route = resolveWorktreeOperationRoute(state, request.workspaceId)
  if (!route) {
    throw new Error(presentation.error)
  }
  const environmentId = route.runtimeEnvironmentId?.trim() || null
  const host = parseExecutionHostId(route.executionHostId)
  if (!environmentId) {
    if (!host || host.kind === 'runtime') {
      throw new Error(presentation.error)
    }
    createClientBrowserTab(state, request, host.id, presentation)
    return
  }
  if (
    route.executionHostId &&
    (!host || (host.kind === 'runtime' && host.environmentId !== environmentId))
  ) {
    throw new Error(presentation.error)
  }
  let created = false
  try {
    created = await createWebRuntimeSessionBrowserTab({
      worktreeId: request.workspaceId,
      environmentId,
      url: request.url,
      targetGroupId: request.targetGroupId,
      selectWorktree: false,
      stagedTitle: presentation.title,
      stagedFocusAddressBar: false,
      failureLogMode: 'operation-only'
    })
  } catch {
    throw new Error(presentation.error)
  }
  if (!created) {
    createClientBrowserTab(state, request, LOCAL_EXECUTION_HOST_ID, presentation)
  }
}
