import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { HostProtocolGate } from './HostProtocolGate'

vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  StyleSheet: { create: <T>(styles: T) => styles },
  Text: 'Text',
  View: 'View'
}))

vi.mock('expo-router', () => ({
  router: { replace: vi.fn() }
}))

// Why: mock only client acquisition; the gate must exercise the real
// useHostStatusGates → evaluateCompat → ProtocolBlockScreen wiring.
const hostClient = vi.hoisted(() => ({
  current: { client: null as RpcClient | null, state: 'disconnected' as string }
}))
vi.mock('../transport/client-context', () => ({
  useHostClient: () => hostClient.current
}))

function clientWithStatus(result: Record<string, unknown>): RpcClient {
  return { sendRequest: vi.fn().mockResolvedValue({ ok: true, result }) } as unknown as RpcClient
}

async function renderGate(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(
      createElement(HostProtocolGate, { hostId: 'host-1' }, createElement('HostContent'))
    )
    await Promise.resolve()
  })
  return renderer as unknown as ReactTestRenderer
}

function renderedText(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON())
}

describe('HostProtocolGate', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.restoreAllMocks()
  })

  it('replaces the host UI with the block screen when mobile is too old', async () => {
    // Why: blocked warns to console; keep test output clean without hiding other errors.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    hostClient.current = {
      client: clientWithStatus({ protocolVersion: 5, minCompatibleMobileVersion: 999 }),
      state: 'connected'
    }
    renderer = await renderGate()
    const output = renderedText(renderer)
    expect(output).toContain('Update Orca Mobile')
    expect(output).toContain('Open App Store')
    expect(output).not.toContain('HostContent')
  })

  it('replaces the host UI with the block screen when desktop is too old', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    hostClient.current = {
      client: clientWithStatus({ protocolVersion: 0, minCompatibleMobileVersion: 0 }),
      state: 'connected'
    }
    renderer = await renderGate()
    const output = renderedText(renderer)
    expect(output).toContain('Update Orca on your computer')
    expect(output).toContain('Open GitHub Releases')
    expect(output).not.toContain('HostContent')
  })

  it('renders the host UI when the verdict is ok', async () => {
    hostClient.current = {
      client: clientWithStatus({ protocolVersion: 5, minCompatibleMobileVersion: 0 }),
      state: 'connected'
    }
    renderer = await renderGate()
    const output = renderedText(renderer)
    expect(output).toContain('HostContent')
    expect(output).not.toContain('Update Orca')
  })

  it('renders the host UI while the status probe is still pending (fail-open on verdict, gates fail closed)', async () => {
    hostClient.current = { client: null, state: 'connecting' }
    renderer = await renderGate()
    expect(renderedText(renderer)).toContain('HostContent')
  })
})
