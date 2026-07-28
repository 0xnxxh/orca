import { describe, expect, it } from 'vitest'
import {
  MOBILE_WEB_BRIDGE_PROTOCOL_VERSION,
  type MobileWebBridgePageMessage,
  type MobileWebBridgeShellMessage
} from '../../shared/mobile-web/bridge-contract'
import { MobileWebBridgeClient } from './mobile-web-bridge-client'

const CONTEXT = {
  shellSessionId: 'S'.repeat(43),
  buildId: 'a'.repeat(64)
}
const REQUEST_ID = 'R'.repeat(22)
const TARGET = {
  workspaceId: 'workspace-page',
  tabId: 'tab-1',
  relativePath: 'notes.md'
}

describe('mobile web markdown request client', () => {
  it('encodes saves and decodes exact-identity results', async () => {
    const harness = createHarness('markdownSave')
    const saving = harness.client.markdown.save({
      ...TARGET,
      content: 'phone edit',
      baseVersion: 'v1'
    })
    expect(harness.messages[0]).toMatchObject({
      capability: 'file',
      operation: 'markdownSave',
      payload: {
        ...TARGET,
        contentBase64: btoa('phone edit'),
        baseVersion: 'v1'
      }
    })
    harness.client.receive(
      response({
        ...TARGET,
        contentBase64: btoa('saved'),
        baseVersion: 'v2'
      })
    )
    await expect(saving).resolves.toEqual({
      ...TARGET,
      content: 'saved',
      baseVersion: 'v2'
    })
  })

  it('rejects a response bound to another path', async () => {
    const harness = createHarness('markdownRead')
    const reading = harness.client.markdown.read({ ...TARGET, tabIsDirty: false })
    harness.client.receive(
      response({
        ...TARGET,
        relativePath: 'other.md',
        contentBase64: btoa('secret'),
        baseVersion: 'v1',
        editable: true,
        stale: false
      })
    )

    await expect(reading).rejects.toMatchObject({
      code: 'invalid_message',
      retryable: false
    })
  })
})

function createHarness(operation: 'markdownRead' | 'markdownSave') {
  const messages: MobileWebBridgePageMessage[] = []
  const client = new MobileWebBridgeClient({
    context: CONTEXT,
    grants: [
      {
        capability: 'file',
        operation,
        limits: {
          maxRequestBytes: 512 * 1024,
          maxResponseBytes: 512 * 1024,
          maxConcurrent: 1,
          rateCapacity: 4,
          rateRefillPerSecond: 1
        }
      }
    ],
    postMessage: (message) => {
      messages.push(message)
      return true
    },
    createRequestId: () => REQUEST_ID
  })
  return { client, messages }
}

function response(payload: unknown): MobileWebBridgeShellMessage {
  return {
    version: MOBILE_WEB_BRIDGE_PROTOCOL_VERSION,
    type: 'response',
    shellSessionId: CONTEXT.shellSessionId,
    buildId: CONTEXT.buildId,
    requestId: REQUEST_ID,
    status: 'success',
    payload
  }
}
