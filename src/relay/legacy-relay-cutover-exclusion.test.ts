import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { encodeTerminalAuthorityOwnerToken } from '../main/session-authority/terminal-session-authority-owner-token'
import {
  readCurrentTerminalAuthorityOwnerProcessIdentity,
  type TerminalAuthorityOwnerProcessIdentity
} from '../main/session-authority/terminal-session-authority-owner-process'
import { legacyRelayCutoverExclusion } from './legacy-relay-cutover-exclusion'
import { createRelayOwnerGuardDirectory } from './relay-owner-guard-directory'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('legacy relay cutover exclusion', () => {
  it('rejects a concurrent live owner and releases cleanly for the next cutover', async () => {
    const relayDirectory = await temporaryDirectory()
    let release!: () => void
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const first = legacyRelayCutoverExclusion(relayDirectory).runExclusive(async () => {
      entered()
      await wait
      return 'first'
    })
    await started

    await expect(
      legacyRelayCutoverExclusion(relayDirectory).runExclusive(async () => 'second')
    ).rejects.toThrow('already in progress')
    release()
    await expect(first).resolves.toBe('first')
    await expect(
      legacyRelayCutoverExclusion(relayDirectory).runExclusive(async () => 'third')
    ).resolves.toBe('third')
  })

  it('recovers a crash orphan only from exact same-scope process evidence', async () => {
    const relayDirectory = await temporaryDirectory()
    const guardPath = path.join(relayDirectory, '.terminal-authority-cutover.lock')
    await createRelayOwnerGuardDirectory(guardPath, await ownerToken(await absentIdentity()))

    await expect(
      legacyRelayCutoverExclusion(relayDirectory).runExclusive(async () => 'recovered')
    ).resolves.toBe('recovered')
  })

  it('keeps cross-scope and malformed crash evidence fenced', async () => {
    const relayDirectory = await temporaryDirectory()
    const guardPath = path.join(relayDirectory, '.terminal-authority-cutover.lock')
    const identity = await absentIdentity()
    const crossScope: TerminalAuthorityOwnerProcessIdentity = {
      ...identity,
      ...(identity.platform === 'linux'
        ? { linuxPidNamespace: 'pid:[different-namespace]' }
        : { executionScope: 'different-execution-scope' })
    }
    await createRelayOwnerGuardDirectory(guardPath, await ownerToken(crossScope))
    await expect(
      legacyRelayCutoverExclusion(relayDirectory).runExclusive(async () => undefined)
    ).rejects.toThrow('already in progress')

    const malformedDirectory = await temporaryDirectory()
    await writeFile(
      path.join(malformedDirectory, '.terminal-authority-cutover.lock'),
      'legacy-lock'
    )
    await expect(
      legacyRelayCutoverExclusion(malformedDirectory).runExclusive(async () => undefined)
    ).rejects.toThrow('already in progress')
  })
})

async function ownerToken(identity: TerminalAuthorityOwnerProcessIdentity): Promise<string> {
  return encodeTerminalAuthorityOwnerToken(randomUUID(), {
    ownerIncarnationId: randomUUID(),
    process: identity
  })
}

async function absentIdentity(): Promise<TerminalAuthorityOwnerProcessIdentity> {
  return {
    ...(await readCurrentTerminalAuthorityOwnerProcessIdentity()),
    pid: 2_147_483_647
  }
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'orca-legacy-cutover-lock-'))
  roots.push(directory)
  return directory
}
