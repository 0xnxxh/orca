import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserScreencastOpcode,
  encodeBrowserScreencastFrame
} from '../../../src/shared/browser-screencast-protocol'
import { encodeTerminalStreamFrame, TerminalStreamOpcode } from './terminal-stream-protocol'
import { verifyForceReconnectRpcHealth } from './force-reconnect-rpc-health'
import { MobileE2EEAuthenticationError } from './mobile-e2ee-v2-physical-channel'
import { isRpcDeliveryUnknown } from './rpc-delivery-ambiguity'

const fakes = vi.hoisted(() => ({
  linkOptions: null as null | {
    endpoint: { cellUrl: string; relayHostId: string }
    credential: string
    expectedCredentialKind: string
    onHello(value: unknown): void
    onAuthenticated(): void
    onText(value: string): void
    onBinary(value: Uint8Array): void
    onError(error: Error): void
  },
  sendText: vi.fn(() => true),
  close: vi.fn()
}))

vi.mock('./mobile-relay-e2ee-link', () => ({
  MobileRelayE2eeLink: class {
    constructor(options: NonNullable<typeof fakes.linkOptions>) {
      fakes.linkOptions = options
    }
    sendText = fakes.sendText
    close = fakes.close
  }
}))

import { connectMobileRelayRpcSession } from './mobile-relay-rpc-session'

const relay = {
  v: 1 as const,
  directorUrl: 'https://relay.onorca.dev',
  cellUrl: 'https://relay-c1.onorca.dev',
  assignmentEpoch: 7,
  relayHostId: 'AbCdEf0123_-xyZ9',
  e2eeFraming: 2 as const
}

function openSession() {
  return connectMobileRelayRpcSession({
    relay,
    resumeToken: 'resume-secret',
    resumeCredentialVersion: 3,
    resumeConfirmReqId: 'confirm-1',
    deviceToken: 'device-token',
    desktopPublicKeyB64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    requestTimeoutMs: 1000
  })
}

async function authenticateSession() {
  const session = openSession()
  fakes.linkOptions!.onHello({
    type: 'relay-hello',
    ok: true,
    credentialKind: 'resume',
    leaseExpiresAt: Date.now() + 60_000,
    acceptedCredentialVersion: 3,
    acceptedAs: 'current',
    resumeExpiresAt: Date.now() + 300_000
  })
  expect(session.getState()).toBe('handshaking')
  fakes.linkOptions!.onAuthenticated()
  await vi.waitFor(() => expect(fakes.sendText).toHaveBeenCalledOnce())
  const request = JSON.parse(fakes.sendText.mock.calls[0]![0] as string) as {
    id: string
    method: string
    params: unknown
  }
  fakes.linkOptions!.onText(
    JSON.stringify({
      id: request.id,
      ok: true,
      result: {
        v: 1,
        relay,
        resumeConfirmation: {
          v: 1,
          reqId: 'confirm-1',
          currentVersion: 3,
          acceptedAs: 'current',
          renewed: true,
          resumeExpiresAt: Date.now() + 300_000
        }
      },
      _meta: { runtimeId: 'runtime-1' }
    })
  )
  await vi.waitFor(() => expect(session.getState()).toBe('connected'))
  fakes.sendText.mockClear()
  return { session, confirmationRequest: request }
}

describe('mobile relay RPC session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakes.linkOptions = null
    fakes.sendText.mockReturnValue(true)
  })

  it('requires exact resume observations and confirms by request ID before becoming connected', async () => {
    const { session, confirmationRequest } = await authenticateSession()

    expect(fakes.linkOptions).toMatchObject({
      endpoint: relay,
      credential: 'resume-secret',
      expectedCredentialKind: 'resume'
    })
    expect(confirmationRequest).toMatchObject({
      method: 'pairing.getEndpoints',
      params: { resumeConfirmReqId: 'confirm-1' },
      deviceToken: 'device-token'
    })
    expect(confirmationRequest.params).not.toHaveProperty('relayDeviceId')
    expect(confirmationRequest.params).not.toHaveProperty('acceptedCredentialVersion')
    expect(session.getLeaseExpiresAt()).toEqual(expect.any(Number))
  })

  it('rejects a mismatched outer credential version and closes the physical link', () => {
    const session = openSession()
    fakes.linkOptions!.onHello({
      type: 'relay-hello',
      ok: true,
      credentialKind: 'resume',
      leaseExpiresAt: Date.now() + 60_000,
      acceptedCredentialVersion: 2,
      acceptedAs: 'grace',
      resumeExpiresAt: Date.now() + 300_000
    })

    expect(session.getState()).toBe('disconnected')
    expect(fakes.close).toHaveBeenCalledOnce()
    expect(fakes.sendText).not.toHaveBeenCalled()
  })

  it('routes terminal and browser binary streams after confirmation', async () => {
    const { session } = await authenticateSession()
    const terminalListener = vi.fn()
    session.subscribe('terminal.subscribe', { terminal: 'term-1' }, terminalListener)
    await vi.waitFor(() => expect(fakes.sendText).toHaveBeenCalledOnce())
    const terminalRequest = JSON.parse(fakes.sendText.mock.calls[0]![0] as string) as {
      id: string
    }
    fakes.linkOptions!.onText(
      JSON.stringify({
        id: terminalRequest.id,
        ok: true,
        result: { streamId: 42 },
        _meta: { runtimeId: 'runtime-1' }
      })
    )
    fakes.linkOptions!.onBinary(
      encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Output,
        streamId: 42,
        seq: 1,
        payload: new TextEncoder().encode('hello')
      })
    )
    expect(terminalListener).toHaveBeenLastCalledWith({
      type: 'data',
      streamId: 42,
      chunk: 'hello'
    })

    fakes.sendText.mockClear()
    const onBinaryFrame = vi.fn()
    session.subscribe('browser.screencast', {}, vi.fn(), { onBinaryFrame })
    await vi.waitFor(() => expect(fakes.sendText).toHaveBeenCalledOnce())
    const browserRequest = JSON.parse(fakes.sendText.mock.calls[0]![0] as string) as { id: string }
    fakes.linkOptions!.onText(
      JSON.stringify({
        id: browserRequest.id,
        ok: true,
        result: { subscriptionId: 'browser-1' },
        _meta: { runtimeId: 'runtime-1' }
      })
    )
    fakes.linkOptions!.onBinary(
      encodeBrowserScreencastFrame({
        opcode: BrowserScreencastOpcode.Frame,
        seq: 9,
        format: 'jpeg',
        metadata: { imageWidth: 800 },
        image: new Uint8Array([1, 2, 3])
      })
    )
    expect(onBinaryFrame).toHaveBeenCalledWith(
      expect.objectContaining({ seq: 9, format: 'jpeg', image: new Uint8Array([1, 2, 3]) })
    )
  })

  it('rejects pending RPC work when the physical link fails', async () => {
    const { session } = await authenticateSession()
    const pending = session.sendRequest('status.get')
    await vi.waitFor(() => expect(fakes.sendText).toHaveBeenCalledOnce())
    fakes.linkOptions!.onError(new Error('relay transport error'))

    await expect(pending).rejects.toThrow('relay transport error')
    // The frame reached the wire, so the failure must read as delivery-unknown.
    await expect(pending.catch((error: unknown) => isRpcDeliveryUnknown(error))).resolves.toBe(true)
    expect(session.getState()).toBe('disconnected')
  })

  it('marks in-flight requests delivery-unknown when the session closes', async () => {
    const { session } = await authenticateSession()
    const pending = session.sendRequest('terminal.send', { terminal: 'term', text: 'hi' })
    await vi.waitFor(() => expect(fakes.sendText).toHaveBeenCalledOnce())
    session.close()

    await expect(pending).rejects.toThrow('Client closed')
    await expect(pending.catch((error: unknown) => isRpcDeliveryUnknown(error))).resolves.toBe(true)
  })

  it('probes before demoting a timed-out relay RPC', async () => {
    const { session } = await authenticateSession()
    vi.useFakeTimers()
    try {
      const pending = session.sendRequest('terminal.send', { terminal: 'term', text: 'hi' })
      const outcome = pending.catch((error: unknown) => ({
        message: (error as Error).message,
        unknown: isRpcDeliveryUnknown(error)
      }))
      // Let sendRequest pass its connected-check microtask and register the timer.
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(1_000)
      await expect(outcome).resolves.toEqual({
        message: 'relay RPC timed out: terminal.send',
        unknown: true
      })
      expect(session.getState()).toBe('connected')
      expect(fakes.close).not.toHaveBeenCalled()
      expect(
        fakes.sendText.mock.calls.map(([payload]) => JSON.parse(payload as string)).at(-1)
      ).toMatchObject({ method: 'status.get' })

      await vi.advanceTimersByTimeAsync(8_000)
      expect(session.getFailure()).toMatchObject({ message: 'relay RPC timed out: status.get' })
      expect(session.getState()).toBe('disconnected')
      expect(fakes.close).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a relay session when its post-timeout probe answers', async () => {
    const { session } = await authenticateSession()
    vi.useFakeTimers()
    try {
      const request = session.sendRequest('browser.screenshot', {}, { timeoutMs: 100 })
      const outcome = request.catch((error: unknown) => error)

      await vi.advanceTimersByTimeAsync(100)
      await expect(outcome).resolves.toMatchObject({
        message: 'relay RPC timed out: browser.screenshot'
      })
      const probe = fakes.sendText.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as { id: string; method: string })
        .find(({ method }) => method === 'status.get')!
      fakes.linkOptions!.onText(
        JSON.stringify({ id: probe.id, ok: true, result: {}, _meta: { runtimeId: 'runtime-1' } })
      )

      await vi.advanceTimersByTimeAsync(8_000)
      expect(session.getState()).toBe('connected')
      expect(fakes.close).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('counts a late timed-out reply as relay control-plane liveness', async () => {
    const { session } = await authenticateSession()
    vi.useFakeTimers()
    try {
      const request = session.sendRequest('browser.screenshot', {}, { timeoutMs: 100 })
      const outcome = request.catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(0)
      const timedOutRequest = fakes.sendText.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as { id: string; method: string })
        .find(({ method }) => method === 'browser.screenshot')!

      await vi.advanceTimersByTimeAsync(100)
      await expect(outcome).resolves.toMatchObject({
        message: 'relay RPC timed out: browser.screenshot'
      })
      fakes.linkOptions!.onText(
        JSON.stringify({ id: timedOutRequest.id, ok: true, result: {}, _meta: {} })
      )

      await vi.advanceTimersByTimeAsync(8_000)
      expect(session.getState()).toBe('connected')
      expect(fakes.close).not.toHaveBeenCalled()
    } finally {
      session.close()
      vi.useRealTimers()
    }
  })

  it('periodically demotes a silent half-open Relay session', async () => {
    vi.useFakeTimers()
    try {
      const { session } = await authenticateSession()

      await vi.advanceTimersByTimeAsync(20_000)
      expect(
        fakes.sendText.mock.calls.map(([payload]) => JSON.parse(payload as string)).at(-1)
      ).toMatchObject({ method: 'status.get' })
      expect(session.getState()).toBe('connected')

      await vi.advanceTimersByTimeAsync(8_000)
      expect(session.getState()).toBe('disconnected')
      expect(fakes.close).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops periodic Relay probing when the session closes', async () => {
    vi.useFakeTimers()
    try {
      const { session } = await authenticateSession()
      session.close()

      await vi.advanceTimersByTimeAsync(20_000)
      expect(fakes.sendText).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks a Relay session auth-failed when its periodic probe is unauthorized', async () => {
    vi.useFakeTimers()
    try {
      const { session } = await authenticateSession()

      await vi.advanceTimersByTimeAsync(20_000)
      const probe = fakes.sendText.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as { id: string; method: string })
        .findLast(({ method }) => method === 'status.get')!
      fakes.linkOptions!.onText(
        JSON.stringify({
          id: probe.id,
          ok: false,
          error: { code: 'unauthorized', message: 'Invalid device token' },
          _meta: {}
        })
      )

      expect(session.getFailure()).toBeInstanceOf(MobileE2EEAuthenticationError)
      expect(session.getState()).toBe('auth-failed')
      expect(fakes.close).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects Force Reconnect health when Relay authorization was revoked', async () => {
    const { session } = await authenticateSession()
    const verification = verifyForceReconnectRpcHealth(session)
    await vi.waitFor(() => expect(fakes.sendText).toHaveBeenCalledOnce())
    const probe = JSON.parse(fakes.sendText.mock.calls[0]![0] as string) as { id: string }
    fakes.linkOptions!.onText(
      JSON.stringify({
        id: probe.id,
        ok: false,
        error: { code: 'unauthorized', message: 'Invalid device token' },
        _meta: {}
      })
    )

    await expect(verification).rejects.toBeInstanceOf(MobileE2EEAuthenticationError)
    expect(session.getState()).toBe('auth-failed')
  })

  it('keeps a Relay session when a fresh timeout probe proves it live', async () => {
    const { session } = await authenticateSession()
    vi.useFakeTimers()
    try {
      const stalled = session.sendRequest('browser.screenshot', {}, { timeoutMs: 100 })
      const stalledOutcome = stalled.catch((error: unknown) => error)
      const healthy = session.sendRequest('status.get', undefined, { timeoutMs: 100 })
      await vi.advanceTimersByTimeAsync(0)
      const requests = fakes.sendText.mock.calls.map(
        ([payload]) => JSON.parse(payload as string) as { id: string; method: string }
      )
      const healthRequest = requests.find(({ method }) => method === 'status.get')!
      fakes.linkOptions!.onText(
        JSON.stringify({ id: healthRequest.id, ok: true, result: {}, _meta: {} })
      )

      await expect(healthy).resolves.toMatchObject({ ok: true })
      await vi.advanceTimersByTimeAsync(100)
      await expect(stalledOutcome).resolves.toMatchObject({
        message: 'relay RPC timed out: browser.screenshot'
      })
      const probeRequest = fakes.sendText.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as { id: string; method: string })
        .findLast(({ id, method }) => method === 'status.get' && id !== healthRequest.id)!
      fakes.linkOptions!.onText(
        JSON.stringify({ id: probeRequest.id, ok: true, result: {}, _meta: {} })
      )
      expect(session.getState()).toBe('connected')
      expect(fakes.close).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('demotes Relay when an earlier response precedes a later control-plane stall', async () => {
    const { session } = await authenticateSession()
    vi.useFakeTimers()
    try {
      const stalled = session.sendRequest('browser.screenshot', {}, { timeoutMs: 100 })
      const stalledOutcome = stalled.catch((error: unknown) => error)
      const healthy = session.sendRequest('status.get', undefined, { timeoutMs: 100 })
      await vi.advanceTimersByTimeAsync(0)
      const healthRequest = fakes.sendText.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as { id: string; method: string })
        .find(({ method }) => method === 'status.get')!
      fakes.linkOptions!.onText(
        JSON.stringify({ id: healthRequest.id, ok: true, result: {}, _meta: {} })
      )

      await expect(healthy).resolves.toMatchObject({ ok: true })
      await vi.advanceTimersByTimeAsync(100)
      await expect(stalledOutcome).resolves.toMatchObject({
        message: 'relay RPC timed out: browser.screenshot'
      })
      expect(session.getState()).toBe('connected')

      await vi.advanceTimersByTimeAsync(8_000)
      expect(session.getFailure()).toMatchObject({
        message: 'relay RPC timed out: status.get'
      })
      expect(session.getState()).toBe('disconnected')
      expect(fakes.close).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
