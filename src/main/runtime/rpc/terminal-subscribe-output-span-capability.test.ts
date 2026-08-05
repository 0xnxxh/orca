import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { RuntimeTerminalWait } from '../../../shared/runtime-types'
import {
  TerminalStreamOpcode,
  decodeTerminalStreamFrame,
  decodeTerminalStreamText,
  encodeTerminalStreamFrame,
  encodeTerminalStreamJson
} from '../../../shared/terminal-stream-protocol'
import type { OrcaRuntimeService } from '../orca-runtime'
import type { RpcRequest } from './core'
import { RpcDispatcher } from './dispatcher'
import { TERMINAL_METHODS } from './methods/terminal'

type TerminalDataMeta = {
  seq?: number
  rawLength?: number
  transformed?: boolean
  cwd?: string
}

type LegacyStreamHarness = {
  binaryFrames: Uint8Array<ArrayBufferLike>[]
  emit: (data: string, meta?: TerminalDataMeta) => void
  dispatchPromise: Promise<unknown>
  cleanup: () => void
}

// Why parsed from mobile's source instead of hard-coded: mobile vendors its own
// copy of the opcode table (separate pnpm workspace, so it cannot be imported).
// Reading the real file is what makes this test fail when the two drift.
function mobileDecodableOpcodes(): Set<number> {
  const source = readFileSync(
    join(process.cwd(), 'mobile/src/transport/terminal-stream-protocol.ts'),
    'utf8'
  )
  const body = /enum TerminalStreamOpcode \{([\s\S]*?)\}/.exec(source)?.[1]
  if (!body) {
    throw new Error('mobile vendored TerminalStreamOpcode enum not found')
  }
  const opcodes = new Set<number>()
  for (const match of body.matchAll(/^\s*\w+\s*=\s*(\d+)/gm)) {
    opcodes.add(Number(match[1]))
  }
  if (opcodes.size === 0) {
    throw new Error('mobile vendored TerminalStreamOpcode enum parsed empty')
  }
  return opcodes
}

async function subscribeLegacyBinaryStream(
  client: { id: string; type: 'mobile' | 'desktop' },
  capabilities: Record<string, 1>
): Promise<LegacyStreamHarness> {
  const binaryFrames: Uint8Array<ArrayBufferLike>[] = []
  const messages: string[] = []
  const cleanups = new Map<string, () => void>()
  let onData: ((data: string, meta?: TerminalDataMeta) => void) | undefined
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    resolveLeafForHandle: vi.fn().mockReturnValue({ ptyId: 'pty-span' }),
    hasHeadlessTerminalState: vi.fn(() => true),
    getRendererTerminalSerializerGeneration: vi.fn(() => 1),
    getPtyOutputSequence: vi.fn(() => 0),
    handleMobileSubscribe: vi.fn().mockResolvedValue(true),
    handleMobileUnsubscribe: vi.fn(),
    updateMobileViewport: vi.fn().mockResolvedValue(true),
    updateDesktopViewport: vi.fn().mockResolvedValue(true),
    subscribeToTerminalData: vi.fn((_ptyId: string, listener: typeof onData) => {
      onData = listener
      return vi.fn()
    }),
    registerRemoteTerminalViewSubscriber: vi.fn(() => vi.fn()),
    unregisterRemoteDesktopViewer: vi.fn(),
    readTerminal: vi.fn().mockResolvedValue({ tail: [], truncated: false }),
    serializeTerminalBuffer: vi.fn().mockResolvedValue(null),
    getTerminalSize: vi.fn().mockReturnValue({ cols: 80, rows: 24 }),
    getMobileDisplayMode: vi.fn().mockReturnValue('auto'),
    getLayout: vi.fn().mockReturnValue({ seq: 1 }),
    getDriver: vi.fn().mockReturnValue({ kind: 'idle' }),
    isTerminalAlternateScreen: vi.fn().mockReturnValue(false),
    subscribeToTerminalResize: vi.fn().mockReturnValue(vi.fn()),
    subscribeToFitOverrideChanges: vi.fn().mockReturnValue(vi.fn()),
    registerSubscriptionCleanup: vi.fn((id: string, cleanup: () => void) => {
      cleanups.set(id, cleanup)
    }),
    cleanupSubscription: vi.fn((id: string) => {
      cleanups.get(id)?.()
      cleanups.delete(id)
    }),
    waitForTerminal: vi.fn(() => new Promise<RuntimeTerminalWait>(() => {}))
  } as unknown as OrcaRuntimeService
  const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })
  const request: RpcRequest = {
    id: `req-${client.id}`,
    authToken: 'tok',
    method: 'terminal.subscribe',
    params: { terminal: 'terminal-span', client, capabilities }
  }
  const dispatchPromise = dispatcher.dispatchStreaming(
    request,
    (message) => messages.push(message),
    {
      connectionId: `conn-${client.id}`,
      sendBinary: (bytes) => {
        binaryFrames.push(bytes)
      },
      registerBinaryStreamHandler: vi.fn(() => vi.fn())
    }
  )
  await vi.waitFor(() =>
    expect(messages.some((message) => JSON.parse(message).result?.type === 'subscribed')).toBe(true)
  )
  await vi.waitFor(() => expect(onData).toBeTypeOf('function'))
  binaryFrames.splice(0)
  return {
    binaryFrames,
    dispatchPromise,
    emit: (data, meta) => onData?.(data, meta),
    cleanup: () => runtime.cleanupSubscription(`terminal-span:${client.id}`)
  }
}

function outputTextIn(frames: readonly Uint8Array<ArrayBufferLike>[]): string {
  return frames
    .map((bytes) => decodeTerminalStreamFrame(bytes))
    .filter((frame) => frame?.opcode === TerminalStreamOpcode.Output)
    .map((frame) => decodeTerminalStreamText(frame!.payload))
    .join('')
}

// A transformed emission (SSH relay / OSC-stripping): display text is shorter
// than the raw byte run it came from, which is what routes to OutputSpan.
const TRANSFORMED_META: TerminalDataMeta = { seq: 40, rawLength: 26, transformed: true }

describe('terminal.subscribe OutputSpan capability gate', () => {
  it('sends a legacy mobile client only opcodes its vendored decoder knows', async () => {
    const legacy = await subscribeLegacyBinaryStream(
      { id: 'mobile-span', type: 'mobile' },
      { terminalBinaryStream: 1 }
    )

    legacy.emit('visible output', TRANSFORMED_META)
    await vi.waitFor(() => expect(legacy.binaryFrames.length).toBeGreaterThan(0))

    const decodable = mobileDecodableOpcodes()
    const sent = legacy.binaryFrames.map((bytes) => decodeTerminalStreamFrame(bytes)!.opcode)
    expect(sent.filter((opcode) => !decodable.has(opcode))).toEqual([])

    legacy.cleanup()
    await legacy.dispatchPromise
  })

  it('preserves the transformed text for a legacy mobile client', async () => {
    const legacy = await subscribeLegacyBinaryStream(
      { id: 'mobile-text', type: 'mobile' },
      { terminalBinaryStream: 1 }
    )

    legacy.emit('visible output', TRANSFORMED_META)
    await vi.waitFor(() => expect(legacy.binaryFrames.length).toBeGreaterThan(0))

    expect(outputTextIn(legacy.binaryFrames)).toBe('visible output')

    legacy.cleanup()
    await legacy.dispatchPromise
  })

  it('still sends OutputSpan to a client that negotiated the capability', async () => {
    const capable = await subscribeLegacyBinaryStream(
      { id: 'desktop-span', type: 'desktop' },
      { terminalBinaryStream: 1, outputSpan: 1 }
    )

    capable.emit('visible output', TRANSFORMED_META)
    await vi.waitFor(() => expect(capable.binaryFrames.length).toBeGreaterThan(0))

    const spans = capable.binaryFrames
      .map((bytes) => decodeTerminalStreamFrame(bytes))
      .filter((frame) => frame?.opcode === TerminalStreamOpcode.OutputSpan)
    expect(spans).toHaveLength(1)
    expect(JSON.parse(decodeTerminalStreamText(spans[0]!.payload))).toMatchObject({
      data: 'visible output',
      rawLength: 26,
      transformed: true
    })

    capable.cleanup()
    await capable.dispatchPromise
  })
})

async function multiplexStream(capabilities: Record<string, 1>): Promise<{
  binaryFrames: Uint8Array<ArrayBufferLike>[]
  emit: (data: string, meta?: TerminalDataMeta) => void
  cleanup: () => void
  dispatchPromise: Promise<unknown>
}> {
  const binaryFrames: Uint8Array<ArrayBufferLike>[] = []
  const cleanups = new Map<string, () => void>()
  const handlers = new Map<
    number,
    (frame: NonNullable<ReturnType<typeof decodeTerminalStreamFrame>>) => void
  >()
  let onData: ((data: string, meta?: TerminalDataMeta) => void) | undefined
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    // The multiplex subscribe path resolves handles via resolveLiveLeafForHandle.
    resolveLiveLeafForHandle: vi.fn().mockReturnValue({ ptyId: 'pty-mux-span' }),
    resolveLeafForHandle: vi.fn().mockReturnValue({ ptyId: 'pty-mux-span' }),
    requestRendererTerminalTabMount: vi.fn().mockReturnValue(true),
    updateRemoteDesktopViewer: vi.fn().mockResolvedValue(true),
    unregisterRemoteDesktopViewers: vi.fn().mockResolvedValue(true),
    isPtyResizeDrivenRemotely: vi.fn().mockReturnValue(false),
    getRemoteDesktopFitHold: vi.fn().mockReturnValue({ mode: 'desktop-fit', cols: 120, rows: 40 }),
    isRemoteDesktopViewerOwner: vi.fn().mockReturnValue(false),
    readTerminal: vi.fn().mockResolvedValue({ tail: [], truncated: false }),
    serializeAuthoritativeTerminalBuffer: vi
      .fn()
      .mockResolvedValue({ data: 'snap', cols: 120, rows: 40 }),
    serializeTerminalBuffer: vi.fn().mockResolvedValue({ data: 'snap', cols: 120, rows: 40 }),
    getTerminalSize: vi.fn().mockReturnValue({ cols: 120, rows: 40 }),
    getMobileDisplayMode: vi.fn().mockReturnValue('auto'),
    getLayout: vi.fn().mockReturnValue({ seq: 1 }),
    getDriver: vi.fn().mockReturnValue({ kind: 'idle' }),
    getTerminalFitOverride: vi.fn().mockReturnValue(null),
    getPtyOutputSequence: vi.fn(() => 0),
    subscribeToTerminalData: vi.fn((_ptyId: string, listener: typeof onData) => {
      onData = listener
      return vi.fn()
    }),
    registerRemoteTerminalViewSubscriber: vi.fn(() => vi.fn()),
    unregisterRemoteDesktopViewer: vi.fn(),
    subscribeToTerminalResize: vi.fn().mockReturnValue(vi.fn()),
    subscribeToFitOverrideChanges: vi.fn().mockReturnValue(vi.fn()),
    subscribeToDriverChanges: vi.fn().mockReturnValue(vi.fn()),
    updateDesktopViewport: vi.fn().mockResolvedValue(true),
    registerSubscriptionCleanup: vi.fn((id: string, cleanup: () => void) => {
      cleanups.set(id, cleanup)
    }),
    cleanupSubscription: vi.fn((id: string) => cleanups.get(id)?.()),
    waitForTerminal: vi.fn(() => new Promise<RuntimeTerminalWait>(() => {}))
  } as unknown as OrcaRuntimeService
  const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })
  const request: RpcRequest = {
    id: 'req-mux-span',
    authToken: 'tok',
    method: 'terminal.multiplex',
    params: {}
  }
  const dispatchPromise = dispatcher.dispatchStreaming(request, vi.fn(), {
    connectionId: 'conn-mux-span',
    sendBinary: (bytes) => {
      binaryFrames.push(bytes)
    },
    registerBinaryStreamHandler: (streamId, handler) => {
      handlers.set(streamId, handler)
      return () => handlers.delete(streamId)
    }
  })
  await vi.waitFor(() => expect(handlers.has(0)).toBe(true))
  handlers.get(0)!(
    decodeTerminalStreamFrame(
      encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Subscribe,
        streamId: 0,
        seq: 1,
        payload: encodeTerminalStreamJson({
          streamId: 7,
          terminal: 'terminal-span',
          client: { id: 'desktop-mux', type: 'desktop' },
          capabilities,
          viewport: { cols: 120, rows: 40 }
        })
      })
    )!
  )
  await vi.waitFor(() => expect(onData).toBeTypeOf('function'))
  binaryFrames.splice(0)
  return {
    binaryFrames,
    emit: (data, meta) => onData?.(data, meta),
    cleanup: () => runtime.cleanupSubscription('terminal-multiplex:conn-mux-span'),
    dispatchPromise
  }
}

describe('terminal.multiplex OutputSpan capability gate', () => {
  it('downgrades to Output for a desktop build that predates the capability', async () => {
    const old = await multiplexStream({ ackOutput: 1, desktopViewportClaims: 1 })

    old.emit('visible output', TRANSFORMED_META)
    await vi.waitFor(() => expect(outputTextIn(old.binaryFrames)).toBe('visible output'))

    const opcodes = old.binaryFrames.map((bytes) => decodeTerminalStreamFrame(bytes)!.opcode)
    expect(opcodes).not.toContain(TerminalStreamOpcode.OutputSpan)

    old.cleanup()
    await old.dispatchPromise
  })

  it('keeps sending OutputSpan to a desktop build that negotiates it', async () => {
    const current = await multiplexStream({
      ackOutput: 1,
      desktopViewportClaims: 1,
      outputSpan: 1
    })

    current.emit('visible output', TRANSFORMED_META)
    await vi.waitFor(() =>
      expect(
        current.binaryFrames.some(
          (bytes) => decodeTerminalStreamFrame(bytes)?.opcode === TerminalStreamOpcode.OutputSpan
        )
      ).toBe(true)
    )

    current.cleanup()
    await current.dispatchPromise
  })

  it('has the shipping desktop multiplexer declare the capability', () => {
    // Guards the other half of the gate: if the renderer stops advertising
    // outputSpan, the host silently downgrades every desktop stream.
    const source = readFileSync(
      join(process.cwd(), 'src/renderer/src/runtime/remote-runtime-terminal-multiplexer.ts'),
      'utf8'
    )
    const capabilities = /capabilities: \{([\s\S]*?)\}/.exec(source)?.[1]
    expect(capabilities).toContain('outputSpan: 1')
  })
})
