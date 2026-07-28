import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { MobileWebBrokerError } from './mobile-web-broker-error'
import type { MobileWebSpeechAuthority } from './mobile-web-speech-authority'
import { executeMobileWebSpeechOperation } from './mobile-web-speech-operations'

describe('executeMobileWebSpeechOperation', () => {
  it('parses bounded setup metadata without requiring a user gesture', async () => {
    const harness = createHarness()
    harness.sendRequest.mockResolvedValue(success(setup()))

    await expect(harness.execute('setup', {}, () => false)).resolves.toEqual(setup())
    expect(harness.sendRequest).toHaveBeenCalledWith('speech.models.list', null)
  })

  it.each(['downloadModel', 'deleteModel', 'configure', 'start'])(
    'requires a recent native-observed gesture for %s',
    async (operation) => {
      const harness = createHarness()

      await expect(
        harness.execute(
          operation,
          operation === 'configure'
            ? { enabled: true }
            : operation === 'start'
              ? {}
              : { modelId: 'model-1' },
          () => false
        )
      ).rejects.toMatchObject<Partial<MobileWebBrokerError>>({
        code: 'permission_required'
      })
      expect(harness.sendRequest).not.toHaveBeenCalled()
      expect(harness.authority.start).not.toHaveBeenCalled()
    }
  )

  it('returns only parsed setup state after deleting a model', async () => {
    const harness = createHarness()
    harness.sendRequest.mockResolvedValue(success(setup()))

    await expect(
      harness.execute('deleteModel', { modelId: 'model-1' }, () => true)
    ).resolves.toEqual(setup())
    expect(harness.sendRequest).toHaveBeenCalledWith('speech.models.delete', {
      modelId: 'model-1'
    })
  })
})

function createHarness() {
  const sendRequest = vi.fn<RpcClient['sendRequest']>()
  const client = { sendRequest } as unknown as RpcClient
  const authority = {
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn()
  } as unknown as MobileWebSpeechAuthority
  return {
    sendRequest,
    authority,
    execute: (operation: string, payload: unknown, consumeRecentUserGesture: () => boolean) =>
      executeMobileWebSpeechOperation({
        operation,
        payload,
        client,
        authority,
        consumeRecentUserGesture
      })
  }
}

function setup() {
  return {
    enabled: true,
    selectedModelId: 'model-1',
    dictationMode: 'toggle' as const,
    models: [
      {
        id: 'model-1',
        label: 'Model One',
        provider: 'local' as const,
        sizeBytes: 1024,
        recommended: true,
        status: 'ready' as const,
        progress: null
      }
    ]
  }
}

function success(result: unknown): RpcResponse {
  return { id: 'rpc', ok: true, result, _meta: { runtimeId: 'runtime' } }
}
