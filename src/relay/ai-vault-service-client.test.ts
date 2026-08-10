import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRemoteHostPlatform } from '../main/ssh/ssh-remote-platform'
import {
  AiVaultServiceTestChild,
  readyAiVaultServiceChild
} from '../main/ai-vault/session-scanner-service-test-child'
import { RelayAiVaultServiceClient } from './ai-vault-service-client'
import { relayAiVaultServiceEntryPath } from './ai-vault-service-spawn'

function createClient(
  children: AiVaultServiceTestChild[],
  idleTimeoutMs?: number
): RelayAiVaultServiceClient {
  return new RelayAiVaultServiceClient({
    init: {
      remoteHome: '/home/ada',
      hostPlatform: getRemoteHostPlatform('linux-x64')
    },
    processFactory: () => {
      const child = new AiVaultServiceTestChild(20_000 + children.length)
      children.push(child)
      return child.asChildProcess()
    },
    idleTimeoutMs
  })
}

afterEach(() => vi.useRealTimers())

describe('RelayAiVaultServiceClient', () => {
  it('serializes list and title calls behind the ready handshake', async () => {
    const children: AiVaultServiceTestChild[] = []
    const client = createClient(children)
    const list = client.listSessions({ limit: 20 })
    const titles = client.resolveSessionTitles([])
    const child = children[0]!

    expect(child.sent).toEqual([expect.objectContaining({ type: 'init', protocol: 1 })])
    readyAiVaultServiceChild(child)
    await Promise.resolve()
    const listRequest = child.sent.find(
      (message) => (message as { operation?: string }).operation === 'list'
    ) as { id: number }
    child.emit('message', {
      type: 'result',
      id: listRequest.id,
      operation: 'list',
      value: { sessions: [], issues: [], scannedAt: '2026-08-09T00:00:00.000Z' }
    })
    await expect(list).resolves.toMatchObject({ sessions: [] })
    const titleRequest = child.sent.find(
      (message) => (message as { operation?: string }).operation === 'titles'
    ) as { id: number }
    child.emit('message', {
      type: 'result',
      id: titleRequest.id,
      operation: 'titles',
      value: { titles: [] }
    })
    await expect(titles).resolves.toEqual({ titles: [] })
    const disposing = client.dispose()
    child.emit('exit', 0)
    await disposing
  })

  it('does not start queued cache work until cancelled work acknowledges', async () => {
    vi.useFakeTimers()
    const children: AiVaultServiceTestChild[] = []
    const client = createClient(children)
    const controller = new AbortController()
    const first = client.listSessions({}, controller.signal)
    const second = client.resolveSessionTitles([])
    const child = children[0]!
    readyAiVaultServiceChild(child)
    await Promise.resolve()
    const firstRequest = child.sent.find(
      (message) => (message as { operation?: string }).operation === 'list'
    ) as { id: number }

    controller.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(child.sent).not.toContainEqual(expect.objectContaining({ operation: 'titles' }))
    child.emit('message', {
      type: 'error',
      id: firstRequest.id,
      message: 'aborted'
    })
    await Promise.resolve()
    expect(
      child.sent.some((message) => (message as { operation?: string }).operation === 'titles')
    ).toBe(true)
    void second.catch(() => undefined)
    const disposing = client.dispose()
    child.emit('exit', 0)
    await disposing
  })

  it('restarts queued work after a sidecar crash with bounded backoff', async () => {
    vi.useFakeTimers()
    const children: AiVaultServiceTestChild[] = []
    const client = createClient(children)
    const first = client.listSessions({})
    const second = client.resolveSessionTitles([])
    readyAiVaultServiceChild(children[0]!)
    await Promise.resolve()

    children[0]!.emit('exit', 1)
    await expect(first).rejects.toThrow('exited')
    expect(children).toHaveLength(1)
    vi.advanceTimersByTime(250)
    expect(children).toHaveLength(2)
    readyAiVaultServiceChild(children[1]!)
    await Promise.resolve()
    const request = children[1]!.sent.find(
      (message) => (message as { operation?: string }).operation === 'titles'
    ) as { id: number }
    children[1]!.emit('message', {
      type: 'result',
      id: request.id,
      operation: 'titles',
      value: { titles: [] }
    })
    await expect(second).resolves.toEqual({ titles: [] })
    const disposing = client.dispose()
    children[1]!.emit('exit', 0)
    await disposing
  })

  it('retires the sidecar after the idle bound', async () => {
    vi.useFakeTimers()
    const children: AiVaultServiceTestChild[] = []
    const client = createClient(children, 100)
    const list = client.listSessions({})
    const child = children[0]!
    readyAiVaultServiceChild(child)
    await Promise.resolve()
    const request = child.sent.find(
      (message) => (message as { operation?: string }).operation === 'list'
    ) as { id: number }
    child.emit('message', {
      type: 'result',
      id: request.id,
      operation: 'list',
      value: { sessions: [], issues: [], scannedAt: '2026-08-09T00:00:00.000Z' }
    })
    await list

    vi.advanceTimersByTime(99)
    expect(child.sent).not.toContainEqual({ type: 'shutdown' })
    vi.advanceTimersByTime(1)
    expect(child.sent).toContainEqual({ type: 'shutdown' })
    vi.advanceTimersByTime(2_000)
    expect(child.killed).toBe(true)
    await client.dispose()
  })

  it('resolves the sidecar beside each bundled relay', () => {
    expect(relayAiVaultServiceEntryPath('/opt/orca/relay')).toBe(
      '/opt/orca/relay/relay-ai-vault-service.js'
    )
  })
})
