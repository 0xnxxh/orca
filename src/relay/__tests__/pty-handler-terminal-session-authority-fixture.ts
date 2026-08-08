import type { IPty } from 'node-pty'
import { vi, type Mock } from 'vitest'
import type { TerminalAuthorityPolicyConsumerConnection } from '../../main/session-authority/terminal-session-authority-policy-consumers'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'

export const authorityNamespace = { authorityHostId: 'host-a', namespaceId: 'namespace-a' }

export function authorityPolicyConsumer(): TerminalAuthorityPolicyConsumerConnection {
  return Object.freeze({
    identity: Object.freeze({
      consumerId: 'app-profile:fixture',
      consumerIncarnationId: 'app-process:fixture'
    }),
    activate: async () => {},
    ensureNamespace: async () => {},
    assertInstalled: () => {},
    acknowledge: async (ack) => ack.sequence,
    retire: async () => 0,
    isInstalled: () => true,
    disconnect: () => {}
  })
}

type RequestContext = {
  clientId?: number
  isStale: () => boolean
  signal?: AbortSignal
}

type RequestHandler = (
  params: Record<string, unknown>,
  context?: RequestContext
) => Promise<unknown>

type NotificationHandler = (params: Record<string, unknown>, context?: RequestContext) => void

type AuthorityDispatcherFixture = {
  onRequest: (method: string, handler: RequestHandler) => void
  onNotification: (method: string, handler: NotificationHandler) => void
  notify: Mock<(method: string, params?: Record<string, unknown>) => void>
  activeClientIds: () => number[]
  callRequest: (
    method: string,
    params: Record<string, unknown>,
    context?: RequestContext
  ) => Promise<unknown>
  callNotification: (
    method: string,
    params: Record<string, unknown>,
    context?: RequestContext
  ) => void
}

type AuthorityTermFixture = Pick<IPty, 'pid' | 'process' | 'cols' | 'rows'> & {
  onData: Mock<IPty['onData']>
  onExit: Mock<IPty['onExit']>
  write: Mock<IPty['write']>
  resize: Mock<IPty['resize']>
  kill: Mock<IPty['kill']>
  clear: Mock<IPty['clear']>
  pause: Mock<() => number>
  resume: Mock<() => number>
}

type AuthorityRuntimeFixture = { service: { namespace: typeof authorityNamespace } }
type AuthorityPaneFixture = { paneKey: string; paneGenerationId: string }
type AuthorityBindingFixture = {
  ownerIncarnationId: string
  physicalPtyId: string
  ptyIncarnationId: string
}
type AuthorityPreparedSpawnFixture = {
  kind: 'spawn'
  runtime: AuthorityRuntimeFixture
  pane: Record<string, never>
  allocation: Record<string, never>
}
type AuthorityAdoptedSpawnFixture = {
  kind: 'adopt'
  runtime: AuthorityRuntimeFixture
  pane: AuthorityPaneFixture
  binding: AuthorityBindingFixture
}
type AuthorityManagedPtyFixture = Omit<AuthorityAdoptedSpawnFixture, 'kind'>

type AuthorityLifecycleFixture = {
  prepareSpawn: Mock<
    (
      params: Record<string, unknown>,
      physicalPtyId: string,
      operationId?: string
    ) => Promise<AuthorityPreparedSpawnFixture | AuthorityAdoptedSpawnFixture>
  >
  commitSpawn: Mock<
    (
      prepared: AuthorityPreparedSpawnFixture,
      incarnationId: string
    ) => Promise<AuthorityManagedPtyFixture>
  >
  cancelSpawn: Mock<(prepared: AuthorityPreparedSpawnFixture) => void>
  closePty: Mock<(managed: AuthorityManagedPtyFixture, operationId?: string) => Promise<void>>
  closeExactPtyAccess: Mock<
    (access: TerminalSessionAuthorityPtyAccess, operationId?: string) => Promise<void>
  >
  recordExit: Mock<(managed: AuthorityManagedPtyFixture, code: number | null) => Promise<void>>
  missingPtyState: Mock<
    (params: Record<string, unknown>, physicalPtyId: string) => Promise<{ kind: 'unknown' }>
  >
  bindingIsReachable: Mock<(managed: AuthorityManagedPtyFixture) => boolean>
  managedFromAdoption: Mock<(adopted: AuthorityAdoptedSpawnFixture) => AuthorityManagedPtyFixture>
}

export function createAuthorityDispatcher(): AuthorityDispatcherFixture {
  const requests = new Map<string, RequestHandler>()
  const notifications = new Map<string, NotificationHandler>()
  return {
    onRequest: (method: string, handler: RequestHandler) => requests.set(method, handler),
    onNotification: (method: string, handler: NotificationHandler) =>
      notifications.set(method, handler),
    notify: vi.fn(),
    activeClientIds: () => [1],
    callRequest: (method: string, params: Record<string, unknown>, context?: RequestContext) =>
      requests.get(method)!(params, context),
    callNotification: (method: string, params: Record<string, unknown>, context?: RequestContext) =>
      notifications.get(method)!(params, context)
  }
}

export function authorityRequestContext(clientId: number) {
  return {
    clientId,
    isStale: () => false,
    signal: new AbortController().signal
  }
}

export function authoritySpawnParams(paneGeneration = 3): Record<string, unknown> {
  return {
    terminalSessionAuthorityVersion: 1,
    paneKey: 'pane-a',
    paneGeneration,
    worktreeId: 'repo::/srv/repo',
    cwd: '/srv/repo',
    env: { ORCA_PANE_KEY: 'pane-a', ORCA_WORKTREE_ID: 'repo::/srv/repo' }
  }
}

export function authorityAttachParams(
  id: string,
  incarnationId: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    terminalSessionAuthorityAttachVersion: 1,
    expectedWorktreeId: 'repo::/srv/repo',
    expectedPaneKey: 'pane-a',
    expectedPaneGeneration: 3,
    expectedPtyIncarnationId: incarnationId,
    ...overrides
  }
}

export function createAuthorityTerm(events: string[]): AuthorityTermFixture {
  return {
    pid: process.pid,
    process: 'bash',
    cols: 80,
    rows: 24,
    onData: vi.fn((_callback: (data: string) => void) => ({ dispose: vi.fn() })),
    onExit: vi.fn((_callback: (event: { exitCode: number }) => void) => {
      events.push('exit-listener')
      return { dispose: vi.fn() }
    }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    clear: vi.fn(),
    pause: vi.fn(() => events.push('pause')),
    resume: vi.fn(() => events.push('resume'))
  }
}

export function authorityLifecycleMock(paneGeneration = 3): AuthorityLifecycleFixture {
  const binding = {
    ownerIncarnationId: 'owner-a',
    physicalPtyId: 'pty-1',
    ptyIncarnationId: 'incarnation-1'
  }
  return {
    prepareSpawn: vi.fn(async () => ({
      kind: 'spawn' as const,
      runtime: { service: { namespace: authorityNamespace } },
      pane: {},
      allocation: {}
    })),
    commitSpawn: vi.fn(async (_prepared, incarnationId: string) => ({
      runtime: { service: { namespace: authorityNamespace } },
      pane: { paneKey: 'pane-a', paneGenerationId: `renderer:${paneGeneration}` },
      binding: { ...binding, ptyIncarnationId: incarnationId }
    })),
    cancelSpawn: vi.fn(),
    closePty: vi.fn(async () => {}),
    closeExactPtyAccess: vi.fn(async () => {}),
    recordExit: vi.fn(async () => {}),
    missingPtyState: vi.fn(async () => ({ kind: 'unknown' as const })),
    bindingIsReachable: vi.fn(() => true),
    managedFromAdoption: vi.fn((adopted) => ({
      runtime: adopted.runtime,
      pane: adopted.pane,
      binding: adopted.binding
    }))
  }
}

export function terminalExitOutcome(incarnationId: string) {
  const binding = {
    ownerIncarnationId: 'owner-a',
    physicalPtyId: 'pty-1',
    ptyIncarnationId: incarnationId
  }
  const request = {
    actorId: 'actor-a',
    operationId: 'operation-a',
    baseRevision: 1,
    consumerId: 'consumer-a',
    outcomeId: 'outcome-a',
    change: {
      kind: 'exit' as const,
      pane: { paneKey: 'pane-a', paneGenerationId: 'renderer:3' },
      expected: { paneGenerationId: 'renderer:3', binding },
      exit: { code: 7, signal: null }
    }
  }
  return {
    consumerId: request.consumerId,
    sequence: 1,
    outcomeId: request.outcomeId,
    request,
    result: {
      namespace: authorityNamespace,
      actorId: request.actorId,
      operationId: request.operationId,
      kind: 'exit' as const,
      revision: 2,
      pane: {
        paneKey: 'pane-a',
        paneGenerationId: 'renderer:3',
        status: 'exited' as const,
        binding: null,
        lastBinding: binding,
        revision: 2
      },
      replacementPane: null,
      allocation: null,
      effects: [
        { kind: 'binding-retired' as const, reason: 'exit' as const, binding },
        { kind: 'terminal-exited' as const, binding, code: 7, signal: null }
      ]
    },
    byteLength: 1
  }
}
