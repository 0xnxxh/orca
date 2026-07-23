import { beforeEach, describe, expect, it } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import {
  MOBILE_NATIVE_CHAT_IMAGE_SCOPE_CACHE_MAX,
  mobileNativeChatImageScopeCacheSizeForTests,
  readMobileNativeChatImageScope,
  resetMobileNativeChatImageScopeCacheForTests,
  updateMobileNativeChatImageScopeEntries,
  writeMobileNativeChatImageScope
} from './mobile-native-chat-image-scope-cache'

const client = {} as RpcClient
const readyImage = {
  id: 'image-1',
  thumbnailUri: 'file:///image.png',
  status: 'ready' as const,
  hostPath: '/tmp/image.png'
}

describe('mobile native chat image scope cache', () => {
  beforeEach(resetMobileNativeChatImageScopeCacheForTests)

  it('retains completed images by client and chat scope without retaining uploads', () => {
    const scope = { client, key: 'scope-1' }
    writeMobileNativeChatImageScope(scope, [
      readyImage,
      { ...readyImage, id: 'uploading', status: 'uploading', hostPath: null }
    ])

    expect(readMobileNativeChatImageScope(scope)).toEqual([readyImage])
    expect(readMobileNativeChatImageScope({ client: {} as RpcClient, key: scope.key })).toEqual([])
  })

  it('updates a cached image when its paste acknowledgement arrives after a scope switch', () => {
    const scope = { client, key: 'scope-1' }
    writeMobileNativeChatImageScope(scope, [readyImage])
    updateMobileNativeChatImageScopeEntries(new Set([readyImage.id]), (entry) => ({
      ...entry,
      status: 'pasted',
      hostPath: null
    }))

    expect(readMobileNativeChatImageScope(scope)).toEqual([
      { ...readyImage, status: 'pasted', hostPath: null }
    ])
  })

  it('bounds inactive scope metadata by evicting the oldest written scope', () => {
    for (let index = 0; index <= MOBILE_NATIVE_CHAT_IMAGE_SCOPE_CACHE_MAX; index += 1) {
      writeMobileNativeChatImageScope({ client, key: `scope-${index}` }, [
        { ...readyImage, id: `image-${index}` }
      ])
    }

    expect(mobileNativeChatImageScopeCacheSizeForTests()).toBe(
      MOBILE_NATIVE_CHAT_IMAGE_SCOPE_CACHE_MAX
    )
    expect(readMobileNativeChatImageScope({ client, key: 'scope-0' })).toEqual([])
    expect(readMobileNativeChatImageScope({ client, key: 'scope-128' })).toHaveLength(1)
  })
})
