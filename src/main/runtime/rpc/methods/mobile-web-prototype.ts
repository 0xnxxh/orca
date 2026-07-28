import { z } from 'zod'
import { defineMethod, InvalidArgumentError, type RpcMethod } from '../core'
import {
  getMobileWebPrototypeChunk,
  getMobileWebPrototypeManifest
} from '../mobile-web-prototype-assets'

const MobileWebPrototypeChunkParams = z.object({
  buildId: z.string().regex(/^[a-f0-9]{64}$/),
  offset: z.number().int().nonnegative()
})

export const MOBILE_WEB_PROTOTYPE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'mobileWeb.prototype.manifest',
    params: null,
    handler: () => getMobileWebPrototypeManifest()
  }),
  defineMethod({
    name: 'mobileWeb.prototype.chunk',
    params: MobileWebPrototypeChunkParams,
    handler: ({ buildId, offset }) => {
      try {
        return getMobileWebPrototypeChunk(buildId, offset)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'mobile_web_prototype_unavailable'
        throw new InvalidArgumentError(message)
      }
    }
  })
]
