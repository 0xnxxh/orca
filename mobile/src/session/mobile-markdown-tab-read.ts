import type { RpcClient } from '../transport/rpc-client'
import type { RpcFailure, RpcSuccess } from '../transport/types'
import {
  buildMarkdownDiskFallbackDoc,
  shouldReadMarkdownFromDiskAfterReadTabFailure
} from './mobile-markdown-disk-fallback'
import type { MarkdownDocState, MobileSessionTab } from './mobile-session-route-types'

type MarkdownTab = Extract<MobileSessionTab, { type: 'markdown' }>

export async function readMobileMarkdownTab(
  client: Pick<RpcClient, 'sendRequest'>,
  worktreeId: string,
  tab: MarkdownTab,
  ownsRoute: () => boolean
): Promise<MarkdownDocState | null> {
  const response = await client.sendRequest('markdown.readTab', {
    worktree: `id:${worktreeId}`,
    tabId: tab.id
  })
  if (!ownsRoute()) {
    return null
  }
  if (response.ok) {
    const result = (response as RpcSuccess).result as {
      content: string
      version: string
      isDirty: boolean
      editable?: boolean
      readOnlyReason?: string
    }
    return {
      status: 'ready',
      content: result.content,
      localContent: result.content,
      baseVersion: result.version,
      isDirty: false,
      editable: result.editable === true,
      stale: result.isDirty,
      readOnlyReason: result.readOnlyReason
    }
  }
  if (!shouldReadMarkdownFromDiskAfterReadTabFailure(response as RpcFailure)) {
    throw new Error((response as RpcFailure).error.message)
  }
  // Headless hosts lack a markdown renderer, but can still serve the on-disk file read-only.
  const fallback = await client.sendRequest('files.read', {
    worktree: `id:${worktreeId}`,
    relativePath: tab.relativePath
  })
  if (!ownsRoute()) {
    return null
  }
  if (!fallback.ok) {
    throw new Error('Unable to read markdown')
  }
  const result = (fallback as RpcSuccess).result as {
    content: string
    truncated: boolean
    byteLength: number
  }
  return buildMarkdownDiskFallbackDoc({
    content: result.content,
    truncated: result.truncated,
    tabIsDirty: tab.isDirty
  })
}
