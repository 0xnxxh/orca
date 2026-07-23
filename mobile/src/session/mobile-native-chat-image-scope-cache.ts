import type { RpcClient } from '../transport/rpc-client'

export const MOBILE_NATIVE_CHAT_IMAGE_SCOPE_CACHE_MAX = 128

export type MobileNativeChatCachedImage = {
  readonly id: string
  readonly thumbnailUri: string
  readonly status: 'ready' | 'pasted'
  readonly hostPath: string | null
}

export type MobileNativeChatImageScope = {
  readonly client: RpcClient | null
  readonly key: string
}

const scopeCache = new Map<
  string,
  { clientId: number | null; entries: readonly MobileNativeChatCachedImage[] }
>()
const scopeKeyByImageId = new Map<string, string>()
// Weak identities isolate reconnects without retaining disconnected RPC clients.
let clientIds = new WeakMap<RpcClient, number>()
let clientIdCounter = 0
let imageIdCounter = 0

function getClientId(client: RpcClient | null): number | null {
  if (!client) {
    return null
  }
  const existing = clientIds.get(client)
  if (existing !== undefined) {
    return existing
  }
  clientIdCounter += 1
  clientIds.set(client, clientIdCounter)
  return clientIdCounter
}

function deleteScope(key: string): void {
  const cached = scopeCache.get(key)
  scopeCache.delete(key)
  for (const entry of cached?.entries ?? []) {
    if (scopeKeyByImageId.get(entry.id) === key) {
      scopeKeyByImageId.delete(entry.id)
    }
  }
}

export function nextMobileNativeChatImageId(): string {
  imageIdCounter += 1
  return `chat-image-${imageIdCounter}`
}

export function readMobileNativeChatImageScope(
  scope: MobileNativeChatImageScope
): readonly MobileNativeChatCachedImage[] {
  const cached = scopeCache.get(scope.key)
  if (!cached || cached.clientId !== getClientId(scope.client)) {
    return []
  }
  return cached.entries
}

export function writeMobileNativeChatImageScope(
  scope: MobileNativeChatImageScope,
  entries: readonly {
    id: string
    thumbnailUri: string
    status: 'uploading' | 'ready' | 'pasted'
    hostPath: string | null
  }[]
): void {
  const cacheable = entries.flatMap((entry): MobileNativeChatCachedImage[] => {
    if (entry.status === 'uploading') {
      return []
    }
    return [
      {
        id: entry.id,
        thumbnailUri: entry.thumbnailUri,
        status: entry.status,
        hostPath: entry.hostPath
      }
    ]
  })
  deleteScope(scope.key)
  if (cacheable.length === 0) {
    return
  }
  scopeCache.set(scope.key, { clientId: getClientId(scope.client), entries: cacheable })
  for (const entry of cacheable) {
    scopeKeyByImageId.set(entry.id, scope.key)
  }
  while (scopeCache.size > MOBILE_NATIVE_CHAT_IMAGE_SCOPE_CACHE_MAX) {
    const oldest = scopeCache.keys().next().value
    if (oldest === undefined) {
      break
    }
    deleteScope(oldest)
  }
}

export function updateMobileNativeChatImageScopeEntries(
  ids: ReadonlySet<string>,
  update: (entry: MobileNativeChatCachedImage) => MobileNativeChatCachedImage | null
): void {
  for (const id of ids) {
    const key = scopeKeyByImageId.get(id)
    const cached = key ? scopeCache.get(key) : undefined
    if (!key || !cached) {
      continue
    }
    const index = cached.entries.findIndex((entry) => entry.id === id)
    if (index < 0) {
      scopeKeyByImageId.delete(id)
      continue
    }
    const nextEntry = update(cached.entries[index]!)
    const entries = cached.entries.slice()
    if (nextEntry) {
      entries[index] = nextEntry
    } else {
      entries.splice(index, 1)
      scopeKeyByImageId.delete(id)
    }
    if (entries.length === 0) {
      deleteScope(key)
      continue
    }
    scopeCache.set(key, { ...cached, entries })
  }
}

export function resetMobileNativeChatImageScopeCacheForTests(): void {
  scopeCache.clear()
  scopeKeyByImageId.clear()
  clientIds = new WeakMap()
  clientIdCounter = 0
  imageIdCounter = 0
}

export function mobileNativeChatImageScopeCacheSizeForTests(): number {
  return scopeCache.size
}
