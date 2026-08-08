import { performance } from 'node:perf_hooks'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPtySpawn } = vi.hoisted(() => ({ mockPtySpawn: vi.fn() }))

vi.mock('node-pty', () => ({ spawn: mockPtySpawn }))
vi.mock('../main/pty/posix-pty-process-groups', () => ({
  forceKillPosixPtyProcessGroups: vi.fn((_pid: number, fallback: () => void) => fallback())
}))

import { terminalSessionAuthorityNamespaceDirectory } from '../main/session-authority/terminal-session-authority-namespace-directory'
import { TERMINAL_AUTHORITY_LOG_FILE } from '../main/session-authority/terminal-session-authority-record-files'
import { TerminalSessionAuthorityRegistry } from '../main/session-authority/terminal-session-authority-registry'
import { terminalAuthorityWorkspaceLocator } from '../main/session-authority/terminal-session-authority-workspace-locator'
import type { RelayDispatcher } from './dispatcher'
import { PtyHandler, REPLAY_BUFFER_MAX } from './pty-handler'
import {
  TerminalSessionAuthorityPtyLifecycle,
  type TerminalAuthorityManagedPty
} from '../main/session-authority/terminal-session-authority-pty-lifecycle'
import { admitAuthenticatedPolicyConsumer } from '../main/session-authority/__tests__/authenticated-policy-consumer-admission'

const HOT_PATH_OPERATIONS = 25_000
const HOT_PATH_CLIENT_ID = 7
const PHASE_BUDGET_MS = 2_000
const HEAP_GROWTH_BUDGET_BYTES = 32 * 1024 * 1024

type RequestHandler = (
  params: Record<string, unknown>,
  context: { clientId: number; isStale: () => boolean }
) => unknown | Promise<unknown>
type NotificationHandler = (params: Record<string, unknown>) => void

type HotPathHandlerState = {
  ptys: Map<
    string,
    {
      authority?: TerminalAuthorityManagedPty
      buffered: { read: () => string }
    }
  >
  pendingOutputByPty: Map<string, unknown[]>
  pendingExitByPty: Map<string, unknown>
  pausedOutputPtys: Set<string>
  outputFlushTimer: ReturnType<typeof setTimeout> | null
  lastInputAtByPty: Map<string, number>
  interactiveOutputCharsByPty: Map<string, number>
}

const directories: string[] = []
const handlers: PtyHandler[] = []
const registries: TerminalSessionAuthorityRegistry[] = []

beforeEach(() => mockPtySpawn.mockReset())

afterEach(async () => {
  await Promise.allSettled(
    handlers.splice(0).map((handler) => handler.dispose({ waitForPhysicalExit: false }))
  )
  await Promise.allSettled(registries.splice(0).map((registry) => registry.close()))
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})

describe('terminal session authority hot paths', () => {
  it('keeps 25k reachability, exact-input, and output operations off topology writes', async () => {
    const root = freshDirectory()
    const registry = await TerminalSessionAuthorityRegistry.open({
      directory: path.join(root, 'authority'),
      authorityHostId: 'host-a',
      ownerToken: 'owner-token-a',
      ownerIncarnationId: 'owner-a',
      writerActorId: 'owner-a'
    })
    registries.push(registry)
    const lifecycle = new TerminalSessionAuthorityPtyLifecycle(registry, 'owner-a')
    lifecycle.installHostEffectApplier({ ensureBindingRetired: async () => {} })
    // Admission goes through the real proof handshake: the hot path is only meaningful for a consumer
    // that actually holds an authenticated grant.
    const admitted = await admitAuthenticatedPolicyConsumer(lifecycle, {
      namespace: await lifecycle.resolvePolicyConsumerNamespace(`repo::${root}`),
      processIncarnationId: 'hot-path-test',
      requestId: 'hot-path-request'
    })
    const connection = admitted.session.policyConsumer
    const terminal = measuredTerminal()
    mockPtySpawn.mockReturnValue(terminal.pty)
    const dispatch = measuredDispatcher()
    const handler = new PtyHandler(dispatch.dispatcher as unknown as RelayDispatcher, undefined, {
      terminalSessionAuthority: lifecycle,
      terminalAuthorityExactPtyAccessResolver: { classify: async () => 'current-owner' }
    })
    handler.setTerminalAuthorityPolicyConsumerForClient((clientId) =>
      clientId === HOT_PATH_CLIENT_ID ? connection : null
    )
    handlers.push(handler)

    const spawned = (await dispatch.request('pty.spawn', spawnParams(root))) as {
      id: string
      incarnationId: string
    }
    const locator = terminalAuthorityWorkspaceLocator(root)
    const namespace = registry.namespaceForLocator(locator)
    if (!namespace) {
      throw new Error('expected authority namespace')
    }
    const service = await registry.openNamespace(namespace)
    const observer = service.observe('hot-path-observer')
    const state = handler as unknown as HotPathHandlerState
    const managed = state.ptys.get(spawned.id)?.authority
    if (!managed) {
      throw new Error('expected managed PTY hot-path bindings')
    }
    const logPath = path.join(
      terminalSessionAuthorityNamespaceDirectory(path.join(root, 'authority'), namespace),
      TERMINAL_AUTHORITY_LOG_FILE
    )
    const revisionBefore = service.snapshotForObserver(observer).revision
    const logBytesBefore = statSync(logPath).size
    const mutationSpy = vi.spyOn(service, 'mutate')
    const heapBefore = process.memoryUsage().heapUsed

    const reachabilityStartedAt = performance.now()
    for (let index = 0; index < HOT_PATH_OPERATIONS; index++) {
      if (!lifecycle.bindingIsReachable(managed)) {
        throw new Error('binding unexpectedly became unreachable')
      }
    }
    const reachabilityMs = performance.now() - reachabilityStartedAt

    const writesBefore = terminal.writeCount
    const inputStartedAt = performance.now()
    for (let index = 0; index < HOT_PATH_OPERATIONS; index++) {
      dispatch.notify('pty.dataExact', {
        id: spawned.id,
        incarnationId: spawned.incarnationId,
        data: 'i'
      })
    }
    const inputMs = performance.now() - inputStartedAt

    const outputStartedAt = performance.now()
    for (let index = 0; index < HOT_PATH_OPERATIONS; index++) {
      terminal.emitData('o')
    }
    const outputMs = performance.now() - outputStartedAt
    const heapGrowthBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore)

    expect(reachabilityMs).toBeLessThan(PHASE_BUDGET_MS)
    expect(inputMs).toBeLessThan(PHASE_BUDGET_MS)
    expect(outputMs).toBeLessThan(PHASE_BUDGET_MS)
    expect(heapGrowthBytes).toBeLessThan(HEAP_GROWTH_BUDGET_BYTES)
    expect(terminal.writeCount - writesBefore).toBe(HOT_PATH_OPERATIONS)
    expect(dispatch.publishedData).toBe(HOT_PATH_OPERATIONS)
    expect(state.pendingOutputByPty.size).toBe(0)
    expect(state.pendingExitByPty.size).toBe(0)
    expect(state.pausedOutputPtys.size).toBe(0)
    expect(state.outputFlushTimer).toBeNull()
    expect(state.lastInputAtByPty.size).toBe(1)
    expect(state.interactiveOutputCharsByPty.size).toBe(1)
    expect(state.ptys.get(spawned.id)?.buffered.read()).toHaveLength(HOT_PATH_OPERATIONS)
    expect(HOT_PATH_OPERATIONS).toBeLessThan(REPLAY_BUFFER_MAX)
    expect(mutationSpy).not.toHaveBeenCalled()
    expect(statSync(logPath).size).toBe(logBytesBefore)
    expect(service.snapshotForObserver(observer).revision).toBe(revisionBefore)

    process.stdout.write(
      `[terminal-authority-hot-path] ${JSON.stringify({
        operationsPerPhase: HOT_PATH_OPERATIONS,
        reachabilityMs: Number(reachabilityMs.toFixed(2)),
        inputMs: Number(inputMs.toFixed(2)),
        outputMs: Number(outputMs.toFixed(2)),
        heapGrowthBytes,
        topologyWrites: 0,
        pendingOutputQueues: state.pendingOutputByPty.size
      })}\n`
    )
  })
})

function measuredDispatcher() {
  const requests = new Map<string, RequestHandler>()
  const notifications = new Map<string, NotificationHandler>()
  const result = {
    publishedData: 0,
    dispatcher: {
      onRequest: (method: string, handler: RequestHandler) => requests.set(method, handler),
      onNotification: (method: string, handler: NotificationHandler) =>
        notifications.set(method, handler),
      notify: () => {},
      tryNotifyPtyData: () => {
        result.publishedData++
        return true
      },
      tryNotifyPtyExit: () => true,
      legacyRetentionBelowLowWater: true
    },
    request: (method: string, params: Record<string, unknown>) =>
      requests.get(method)!(params, {
        clientId: HOT_PATH_CLIENT_ID,
        isStale: () => false
      }),
    notify: (method: string, params: Record<string, unknown>) => notifications.get(method)!(params)
  }
  return result
}

function measuredTerminal() {
  let dataListener: ((data: string) => void) | null = null
  const result = {
    writeCount: 0,
    emitData: (data: string) => dataListener?.(data),
    pty: {
      pid: process.pid,
      process: 'shell',
      cols: 80,
      rows: 24,
      onData: (listener: (data: string) => void) => {
        dataListener = listener
        return {
          dispose: () => {
            if (dataListener === listener) {
              dataListener = null
            }
          }
        }
      },
      onExit: () => ({ dispose: () => {} }),
      write: () => {
        result.writeCount++
      },
      resize: () => {},
      kill: () => {},
      clear: () => {},
      pause: () => {},
      resume: () => {},
      destroy: () => {}
    }
  }
  return result
}

function spawnParams(root: string): Record<string, unknown> {
  return {
    terminalSessionAuthorityVersion: 1,
    paneKey: 'pane-a',
    paneGeneration: 1,
    worktreeId: `repo::${root}`,
    cwd: root,
    cols: 80,
    rows: 24,
    env: { TERM: 'xterm-256color' }
  }
}

function freshDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'orca-authority-hot-path-'))
  directories.push(directory)
  return directory
}
