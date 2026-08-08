import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  parseSshTerminalAuthorityMarker,
  type SshTerminalAuthorityMarker
} from '../shared/ssh-terminal-authority-marker'
import { encodeTerminalAuthorityOwnerToken } from '../main/session-authority/terminal-session-authority-owner-token'
import {
  readCurrentTerminalAuthorityOwnerProcessIdentity,
  type TerminalAuthorityOwnerProcessIdentity
} from '../main/session-authority/terminal-session-authority-owner-process'
import { createRelayOwnerGuardDirectory } from './relay-owner-guard-directory'
import { claimTerminalAuthorityOwnership } from './terminal-authority-owner-marker'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('terminal authority owner marker', () => {
  it('creates one durable host identity and self-describing owner marker', async () => {
    const options = paths()
    const claim = await claimTerminalAuthorityOwnership(options)
    expect(claim).toMatchObject({
      status: 'claimed',
      mayRemoveStaleSocket: false,
      marker: {
        ownerPid: process.pid,
        ownerProcessToken: options.processToken,
        registryWriterOwnerToken: expect.stringMatching(/^terminal-authority-owner-v1\./),
        revision: 1
      }
    })
    const marker = persistedMarker(options.markerPath)
    expect(marker).toEqual(claim.status === 'claimed' ? claim.marker : null)
  })

  it('refuses a second owner and a forged takeover while the exact owner is live', async () => {
    const options = paths()
    const first = await claimed(options)

    await expect(
      claimTerminalAuthorityOwnership({ ...options, processToken: 'second-process-token-123' })
    ).resolves.toMatchObject({ status: 'occupied', marker: { revision: 1 } })
    await expect(
      claimTerminalAuthorityOwnership({
        ...options,
        processToken: 'forged-takeover-token-123',
        takeover: {
          ownerProcessToken: first.ownerProcessToken,
          revision: first.revision
        }
      })
    ).resolves.toMatchObject({ status: 'occupied', marker: { ownerPid: process.pid } })
  })

  it('replaces only an exact marker whose recorded process is locally proven gone', async () => {
    const options = paths()
    const first = await claimed(options)
    const stale = await markerWithProcess(first, await absentProcessIdentity())
    writeMarker(options.markerPath, stale)

    const takeover = await claimTerminalAuthorityOwnership({
      ...options,
      processToken: 'replacement-process-token-123',
      takeover: { ownerProcessToken: stale.ownerProcessToken, revision: stale.revision }
    })

    expect(takeover).toMatchObject({
      status: 'claimed',
      mayRemoveStaleSocket: true,
      marker: { authorityHostId: first.authorityHostId, revision: first.revision + 1 },
      replacedMarker: stale
    })
  })

  it('keeps old or cross-scope process evidence occupied and never authorizes socket removal', async () => {
    const options = paths()
    const first = await claimed(options)
    const incomplete = { ...first, registryWriterOwnerToken: undefined }
    writeMarker(options.markerPath, incomplete)
    await expect(takeover(options, incomplete)).resolves.toMatchObject({ status: 'occupied' })

    const outOfScopeIdentity = await absentProcessIdentity()
    const outOfScope = await markerWithProcess(first, {
      ...outOfScopeIdentity,
      ...(outOfScopeIdentity.platform === 'linux'
        ? { linuxPidNamespace: 'pid:[different-namespace]' }
        : { executionScope: 'different-execution-scope' })
    })
    writeMarker(options.markerPath, outOfScope)
    await expect(takeover(options, outOfScope)).resolves.toMatchObject({ status: 'occupied' })
  })

  it('recovers an orphan takeover guard only after its exact claimant is gone', async () => {
    const options = paths()
    const first = await claimed(options)
    const stale = await markerWithProcess(first, await absentProcessIdentity())
    writeMarker(options.markerPath, stale)
    const orphanToken = await ownerToken(randomUUID(), await absentProcessIdentity())
    await createRelayOwnerGuardDirectory(join(options.stateDir, 'takeover-lock'), orphanToken)

    await expect(takeover(options, stale)).resolves.toMatchObject({
      status: 'claimed',
      marker: { revision: stale.revision + 1 }
    })
  })

  it('does not clear a live or malformed takeover guard', async () => {
    const options = paths()
    const first = await claimed(options)
    const stale = await markerWithProcess(first, await absentProcessIdentity())
    writeMarker(options.markerPath, stale)
    const liveToken = await ownerToken(randomUUID())
    await createRelayOwnerGuardDirectory(join(options.stateDir, 'takeover-lock'), liveToken)
    await expect(takeover(options, stale)).resolves.toEqual({ status: 'contended' })

    const malformed = paths()
    const malformedMarker = await claimed(malformed)
    writeFileSync(join(malformed.stateDir, 'takeover-lock'), '{broken', 'utf8')
    await expect(takeover(malformed, malformedMarker)).resolves.toEqual({ status: 'contended' })
  })

  it('fails closed for malformed persisted state and unsafe process tokens', async () => {
    const options = paths()
    writeFileSync(options.markerPath, '{broken', 'utf8')
    await expect(claimTerminalAuthorityOwnership(options)).resolves.toEqual({ status: 'invalid' })
    await expect(
      claimTerminalAuthorityOwnership({ ...paths(), processToken: '$(unsafe process token)' })
    ).resolves.toEqual({ status: 'invalid' })
  })
})

async function claimed(options: ReturnType<typeof paths>): Promise<SshTerminalAuthorityMarker> {
  const claim = await claimTerminalAuthorityOwnership(options)
  expect(claim.status).toBe('claimed')
  if (claim.status !== 'claimed') {
    throw new Error('test owner claim failed')
  }
  return claim.marker
}

function takeover(options: ReturnType<typeof paths>, marker: SshTerminalAuthorityMarker) {
  return claimTerminalAuthorityOwnership({
    ...options,
    processToken: 'replacement-process-token-123',
    takeover: { ownerProcessToken: marker.ownerProcessToken, revision: marker.revision }
  })
}

async function markerWithProcess(
  marker: SshTerminalAuthorityMarker,
  processIdentity: TerminalAuthorityOwnerProcessIdentity
): Promise<SshTerminalAuthorityMarker> {
  return {
    ...marker,
    ownerPid: processIdentity.pid,
    registryWriterOwnerToken: await ownerToken(marker.ownerInstanceId, processIdentity)
  }
}

async function ownerToken(
  ownerIncarnationId: string,
  processIdentity?: TerminalAuthorityOwnerProcessIdentity
): Promise<string> {
  return encodeTerminalAuthorityOwnerToken(randomUUID(), {
    ownerIncarnationId,
    process: processIdentity ?? (await readCurrentTerminalAuthorityOwnerProcessIdentity())
  })
}

async function absentProcessIdentity(): Promise<TerminalAuthorityOwnerProcessIdentity> {
  return {
    ...(await readCurrentTerminalAuthorityOwnerProcessIdentity()),
    pid: 2_147_483_647
  }
}

function persistedMarker(markerPath: string): SshTerminalAuthorityMarker | null {
  return parseSshTerminalAuthorityMarker(JSON.parse(readFileSync(markerPath, 'utf8')))
}

function writeMarker(markerPath: string, marker: SshTerminalAuthorityMarker): void {
  writeFileSync(markerPath, `${JSON.stringify(marker)}\n`, 'utf8')
}

function paths() {
  const stateDir = mkdtempSync(join(tmpdir(), 'orca-authority-owner-'))
  roots.push(stateDir)
  return {
    stateDir,
    markerPath: join(stateDir, 'active-endpoint'),
    ownerBuildId: '1.2.3+abcdef',
    ownerRelayDir: join(stateDir, '..', 'relay-1.2.3+abcdef'),
    socketPath: join(stateDir, 'authority.sock'),
    credentialFile: join(stateDir, 'endpoint.credential'),
    processToken: 'process-token-123456'
  }
}
