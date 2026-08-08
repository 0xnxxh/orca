import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { relayTestSocketPath } from './relay-test-socket-path'
import { spawnRelay, type RelayProcess } from './subprocess-test-utils'
import {
  SSH_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_GRANT_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_RESOLVE_NAMESPACE_METHOD
} from '../shared/terminal-authority-consumer-methods'
import {
  TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_ACCEPT_METHOD,
  TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_NOTIFICATION,
  TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_ACK_METHOD,
  TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_NOTIFICATION,
  TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
  type TerminalAuthorityNamespaceOutcomeBoundary,
  type TerminalAuthorityNamespaceOutcomePublication
} from '../shared/terminal-session-authority-consumer-transport'
import {
  TERMINAL_AUTHORITY_CONSUMER_PROOF_ALGORITHM,
  TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
  type TerminalAuthorityNamespaceAdmissionChallenge
} from '../shared/terminal-session-authority-consumer-proof'
import {
  createTerminalAuthorityConsumerProof,
  createTerminalAuthorityProofEphemeralKeypair
} from '../main/session-authority/terminal-session-authority-consumer-proof'
import type { TerminalAuthorityNamespace } from '../shared/terminal-session-authority-identity'

const APP_KEYPAIR = createTerminalAuthorityProofEphemeralKeypair()

const RELAY_ENTRY = path.resolve(__dirname, 'relay.ts')
const CREDENTIAL = 'authority-test-credential-0000000000000001'
const PROCESS_TOKEN = 'authority-process-token-0001'

let bundleRoot: string
let relayEntry: string

beforeAll(async () => {
  bundleRoot = mkdtempSync(path.join(tmpdir(), 'relay-authority-grace-'))
  relayEntry = path.join(bundleRoot, 'relay.js')
  await build({
    entryPoints: [RELAY_ENTRY],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: relayEntry,
    external: ['node-pty', '@parcel/watcher', 'electron']
  })
  writeAuthorityNodePty(bundleRoot)
}, 30_000)

afterAll(async () => {
  await rm(bundleRoot, { recursive: true, force: true })
})

describe('terminal authority relay grace lifecycle', () => {
  it('retains PTYs without clients until exact retirement and allows administrative shutdown', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'relay-authority-live-'))
    const authority = spawnAuthority(root)
    let bridge: RelayProcess | null = null
    let stopDelivery: (() => void) | null = null
    try {
      await within(authority.sentinelReceived, 'authority sentinel')
      await delay(750)
      expect(authority.proc.exitCode).toBeNull()
      const expectation = readAuthorityExpectation(root)

      bridge = spawnBridge(root, expectation)
      stopDelivery = driveAuthorityDelivery(bridge)
      await within(bridge.sentinelReceived, 'initial bridge sentinel')
      const grant = await within(openAuthorityClient(bridge), 'authority client admission')
      await within(admitAuthorityConsumer(bridge, root, 'first'), 'authority consumer admission')
      const spawned = await within(spawnAuthorityPty(bridge, root), 'authority PTY spawn')
      await expect(
        within(
          bridge.waitForResponse(bridge.send('relay.configureGraceTime', { graceTimeSeconds: 1 })),
          'grace configuration'
        )
      ).resolves.toMatchObject({ result: { graceTimeMs: 1_000 } })

      stopDelivery?.()
      await stopBridge(bridge)
      bridge = null
      await delay(1_250)
      expect(authority.proc.exitCode).toBeNull()

      bridge = spawnBridge(root, expectation)
      stopDelivery = driveAuthorityDelivery(bridge)
      await within(bridge.sentinelReceived, 'reconnect sentinel')
      await within(openAuthorityClient(bridge, grant), 'authority client resume')
      await within(admitAuthorityConsumer(bridge, root, 'resume'), 'authority consumer resume')
      await expect(
        within(
          bridge.waitForResponse(
            bridge.send('pty.shutdownAuthorityExact', {
              id: spawned.id,
              terminalSessionAuthorityAccess: spawned.terminalSessionAuthorityAccess,
              immediate: false,
              keepHistory: false
            })
          ),
          'exact retirement'
        )
      ).resolves.toMatchObject({ result: { accepted: true } })

      stopDelivery?.()
      await stopBridge(bridge)
      bridge = null
      await delay(1_250)
      expect(authority.proc.exitCode).toBeNull()

      const exit = authority.waitForExit(5_000)
      authority.kill('SIGTERM')
      await expect(within(exit, 'administrative shutdown')).resolves.toBe(0)
    } finally {
      stopDelivery?.()
      if (bridge) {
        await stopBridge(bridge)
      }
      if (authority.proc.exitCode === null && authority.proc.signalCode === null) {
        authority.proc.kill('SIGKILL')
        await authority.waitForExit().catch(() => {})
      }
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})

function spawnAuthority(root: string): RelayProcess {
  const stateDir = path.join(root, 'authority-state')
  const credentialFile = path.join(root, 'endpoint.credential')
  writeFileSync(credentialFile, `${CREDENTIAL}\n`, 'utf8')
  return spawnRelay(
    relayEntry,
    [
      '--detached',
      '--terminal-authority',
      '--grace-time',
      '1',
      '--sock-path',
      relayTestSocketPath(root),
      '--endpoint-dir',
      path.join(root, 'agent-hooks'),
      '--credential-file',
      credentialFile,
      '--authority-state-dir',
      stateDir,
      '--authority-marker-path',
      path.join(stateDir, 'active-endpoint'),
      '--authority-process-token',
      PROCESS_TOKEN
    ],
    { env: { ...process.env, ORCA_RELAY_EMPTY_STARTUP_GRACE_MS: '500' } }
  )
}

function spawnBridge(
  root: string,
  expectation: { authorityHostId: string; ownerInstanceId: string; revision: number }
): RelayProcess {
  return spawnRelay(relayEntry, [
    '--connect',
    '--sock-path',
    relayTestSocketPath(root),
    '--credential-file',
    path.join(root, 'endpoint.credential'),
    '--authority-expect-host-id',
    expectation.authorityHostId,
    '--authority-expect-owner-instance',
    expectation.ownerInstanceId,
    '--authority-expect-revision',
    String(expectation.revision)
  ])
}

function readAuthorityExpectation(root: string): {
  authorityHostId: string
  ownerInstanceId: string
  revision: number
} {
  return JSON.parse(
    readFileSync(path.join(root, 'authority-state', 'active-endpoint'), 'utf8')
  ) as { authorityHostId: string; ownerInstanceId: string; revision: number }
}

async function openAuthorityClient(
  bridge: RelayProcess,
  prior?: { ownerGeneration: number; ownerLease: string }
): Promise<{ ownerGeneration: number; ownerLease: string }> {
  const response = await bridge.waitForResponse(
    bridge.send('pty.openClient', {
      protocolVersion: 1,
      clientInstanceId: 'authority-grace-client',
      requestedRole: 'session-owner',
      ...(prior ? { resume: prior } : {}),
      capabilities: {
        terminalAuthorityExactOperations: { versions: [1] },
        terminalAuthorityConsumerProof: { versions: [TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION] }
      }
    })
  )
  expect(response.error).toBeUndefined()
  expect(response.result).toMatchObject({
    role: 'session-owner',
    capabilities: {
      terminalAuthorityExactOperations: { version: 1 },
      terminalAuthorityConsumerProof: { version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION }
    }
  })
  const result = response.result as { ownerGeneration: number; ownerLease: string }
  return { ownerGeneration: result.ownerGeneration, ownerLease: result.ownerLease }
}

// The full challenge -> proof -> grant handshake. Nothing else can reach a durable consumer claim,
// so the grace journey only holds authority once this completes.
async function admitAuthorityConsumer(
  bridge: RelayProcess,
  root: string,
  intent: 'first' | 'resume'
): Promise<void> {
  const resolved = await bridge.waitForResponse(
    bridge.send(SSH_TERMINAL_AUTHORITY_CONSUMER_RESOLVE_NAMESPACE_METHOD, {
      worktreeId: `repo::${root}`
    })
  )
  expect(resolved.error).toBeUndefined()
  const namespace = resolved.result as TerminalAuthorityNamespace
  const challenged = await bridge.waitForResponse(
    bridge.send(SSH_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_METHOD, {
      start: {
        version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
        algorithm: TERMINAL_AUTHORITY_CONSUMER_PROOF_ALGORITHM,
        namespace,
        appPublicKeyB64: Buffer.from(APP_KEYPAIR.publicKey).toString('base64'),
        candidateProcessIncarnationId: `app-process:grace-${intent}`,
        candidateSessionNonce: `session-nonce:grace-${intent}`,
        requestId: `grace-request-${intent}`,
        intent
      }
    })
  )
  expect(challenged.error).toBeUndefined()
  // The host stages the namespace boundary and waits for this acceptance before it will seal and
  // append the claim, so the grant response only settles once the app answers.
  const granted = await bridge.waitForResponse(
    bridge.send(SSH_TERMINAL_AUTHORITY_CONSUMER_GRANT_METHOD, {
      proof: createTerminalAuthorityConsumerProof(
        challenged.result as TerminalAuthorityNamespaceAdmissionChallenge,
        APP_KEYPAIR
      )
    }),
    10_000
  )
  expect(granted.error).toBeUndefined()
}

/**
 * Stands in for the app's outcome consumer: accepts staged boundaries and ACKs published outcomes for
 * as long as the bridge lives. Without it the host's publication never settles and exact retirement
 * has nowhere to land.
 */
function driveAuthorityDelivery(bridge: RelayProcess): () => void {
  let index = 0
  let stopped = false
  const pump = setInterval(() => {
    if (stopped) {
      return
    }
    while (index < bridge.responses.length) {
      const message = bridge.responses[index++]!
      if (!('method' in message) || !message.params) {
        continue
      }
      if (message.method === TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_NOTIFICATION) {
        const { boundary } = message.params as {
          boundary: TerminalAuthorityNamespaceOutcomeBoundary
        }
        bridge.send(TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_ACCEPT_METHOD, {
          acceptance: {
            version: TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
            consumer: boundary.consumer,
            namespace: boundary.namespace,
            boundaryId: boundary.boundaryId,
            acknowledgedSequence: boundary.acknowledgedSequence,
            outcomeHighWatermark: boundary.outcomeHighWatermark
          }
        })
      } else if (message.method === TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_NOTIFICATION) {
        const { publication } = message.params as {
          publication: TerminalAuthorityNamespaceOutcomePublication
        }
        const tail = (publication.outcomes ?? [publication.outcome]).at(-1)!
        bridge.send(TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_ACK_METHOD, {
          ack: {
            version: TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
            consumer: publication.consumer,
            namespace: publication.namespace,
            sequence: tail.sequence,
            outcomeId: tail.outcomeId
          }
        })
      }
    }
  }, 5)
  pump.unref?.()
  return () => {
    stopped = true
    clearInterval(pump)
  }
}

async function spawnAuthorityPty(
  bridge: RelayProcess,
  root: string
): Promise<{ id: string; terminalSessionAuthorityAccess: unknown }> {
  const response = await bridge.waitForResponse(
    bridge.send('pty.spawn', {
      terminalSessionAuthorityVersion: 1,
      paneKey: 'pane-a',
      paneGeneration: 1,
      worktreeId: `repo::${root}`,
      cwd: root,
      env: { ORCA_PANE_KEY: 'pane-a', ORCA_WORKTREE_ID: `repo::${root}` }
    })
  )
  expect(response.error).toBeUndefined()
  expect(response.result).toMatchObject({
    id: expect.any(String),
    terminalSessionAuthorityAccess: expect.any(Object)
  })
  return response.result as { id: string; terminalSessionAuthorityAccess: unknown }
}

async function stopBridge(bridge: RelayProcess): Promise<void> {
  if (bridge.proc.exitCode !== null || bridge.proc.signalCode !== null) {
    return
  }
  const exit = bridge.waitForExit(2_000)
  bridge.kill('SIGTERM')
  await exit.catch(() => bridge.proc.kill('SIGKILL'))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function within<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    delay(10_000).then(() => {
      throw new Error(`Timed out waiting for ${label}`)
    })
  ])
}

function writeAuthorityNodePty(root: string): void {
  const directory = path.join(root, 'node_modules', 'node-pty', 'lib')
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    path.join(directory, 'index.js'),
    `module.exports = { spawn() {
  const exitHandlers = []
  return {
    pid: process.pid, process: 'mock-shell', cols: 80, rows: 24,
    onData() { return { dispose() {} } },
    onExit(callback) { exitHandlers.push(callback); return { dispose() {} } },
    write() {}, resize() {}, clear() {}, pause() {}, resume() {},
    kill() { setTimeout(() => exitHandlers.forEach((callback) => callback({ exitCode: 0 })), 0) }
  }
} }\n`,
    'utf8'
  )
}
