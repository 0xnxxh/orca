import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acquireTerminalAuthorityWriterGuard,
  writeTerminalAuthorityWriterMarker
} from './terminal-authority-writer-storage'
import { TerminalSessionAuthorityHostRuntime } from './terminal-session-authority-host-runtime'
import { encodeTerminalAuthorityOwnerToken } from './terminal-session-authority-owner-token'
import {
  terminalAuthorityOwnerProcessObservationProvesGone,
  type TerminalAuthorityOwnerProcessIdentity
} from './terminal-session-authority-owner-process'
import { TerminalAuthorityWriterLock } from './terminal-session-authority-writer-lock'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('TerminalSessionAuthorityHostRuntime', () => {
  it('keeps one durable host identity and mints a fresh owner after clean restart', async () => {
    const directory = freshDirectory()
    const first = await openRuntime(directory, ['host-a', 'writer-a', 'owner-a'])
    await first.close()
    const second = await openRuntime(directory, ['writer-b', 'owner-b'])

    expect(second.authorityHostId).toBe(first.authorityHostId)
    expect(second.ownerIncarnationId).not.toBe(first.ownerIncarnationId)
    await second.close()
  })

  it('takes over an active writer only after positive predecessor-death proof', async () => {
    const directory = freshDirectory()
    const first = await openRuntime(directory, ['host-a', 'writer-a', 'owner-a'])
    const predecessorIsGone = vi.fn(async () => true)
    const second = await openRuntime(directory, ['writer-b', 'owner-b'], predecessorIsGone)

    expect(predecessorIsGone).toHaveBeenCalledOnce()
    expect(second.authorityHostId).toBe(first.authorityHostId)
    await expect(first.close()).rejects.toMatchObject({ code: 'writer-fenced' })
    await second.close()
  })

  it('keeps an indeterminate predecessor fenced', async () => {
    const directory = freshDirectory()
    const first = await openRuntime(directory, ['host-a', 'writer-a', 'owner-a'])
    const predecessorIsGone = vi.fn(async () => false)

    await expect(
      openRuntime(directory, ['writer-b', 'owner-b'], predecessorIsGone)
    ).rejects.toMatchObject({ code: 'writer-fenced' })
    expect(predecessorIsGone).toHaveBeenCalledOnce()
    await first.close()
  })

  it('recovers a missing predecessor only inside the same execution scope', async () => {
    const directory = freshDirectory()
    const processIdentity = linuxProcessIdentity('host-a', 'pid:[101]')
    const first = await openRuntime(
      directory,
      ['host-a', 'writer-a', 'owner-a'],
      undefined,
      processIdentity
    )
    const second = await openRuntime(
      directory,
      ['writer-b', 'owner-b'],
      async (proof) =>
        terminalAuthorityOwnerProcessObservationProvesGone(proof.process, {
          status: 'missing',
          platform: 'linux',
          bootId: 'shared-boot',
          linuxPidNamespace: 'pid:[101]',
          executionScope: 'host-a'
        }),
      processIdentity
    )

    await expect(first.close()).rejects.toMatchObject({ code: 'writer-fenced' })
    await second.close()
  })

  it.each([
    ['pid:[101]', 'pid:[202]'],
    ['pid:[202]', 'pid:[101]']
  ])(
    'keeps shared storage fenced across Linux PID namespaces (%s to %s)',
    async (owner, observer) => {
      const directory = freshDirectory()
      const first = await openRuntime(
        directory,
        ['host-a', 'writer-a', 'owner-a'],
        undefined,
        linuxProcessIdentity('host-a', owner)
      )

      await expect(
        openRuntime(
          directory,
          ['writer-b', 'owner-b'],
          async (proof) =>
            terminalAuthorityOwnerProcessObservationProvesGone(proof.process, {
              status: 'missing',
              platform: 'linux',
              bootId: 'shared-boot',
              linuxPidNamespace: observer,
              executionScope: 'host-a'
            }),
          linuxProcessIdentity('host-a', observer)
        )
      ).rejects.toMatchObject({ code: 'writer-fenced' })
      await first.close()
    }
  )

  it('keeps shared storage fenced across Windows hosts with colliding PIDs', async () => {
    const directory = freshDirectory()
    const first = await openRuntime(
      directory,
      ['host-a', 'writer-a', 'owner-a'],
      undefined,
      windowsProcessIdentity('machine-a')
    )

    await expect(
      openRuntime(
        directory,
        ['writer-b', 'owner-b'],
        async (proof) =>
          terminalAuthorityOwnerProcessObservationProvesGone(proof.process, {
            status: 'missing',
            platform: 'win32',
            executionScope: 'machine-b'
          }),
        windowsProcessIdentity('machine-b')
      )
    ).rejects.toMatchObject({ code: 'writer-fenced' })
    await first.close()
  })

  it.each(['guard-published', 'marker-published'] as const)(
    'recovers a first owner that crashed at %s from its lease-carried process proof',
    async (boundary) => {
      const directory = freshDirectory()
      const proof = {
        ownerIncarnationId: 'crashed-owner',
        process: { pid: 88_888, platform: 'legacy' as const, startedAtMs: 1_600_000_000_000 }
      }
      const ownerToken = encodeTerminalAuthorityOwnerToken('crashed-nonce', proof)
      const registryDirectory = path.join(directory, 'registry')
      mkdirSync(registryDirectory, { recursive: true })
      await acquireTerminalAuthorityWriterGuard(registryDirectory, ownerToken)
      if (boundary === 'marker-published') {
        await writeTerminalAuthorityWriterMarker(registryDirectory, {
          version: 1,
          ownerToken,
          epoch: 1,
          active: true
        })
      }

      const replacement = await openRuntime(
        directory,
        ['host-a', 'writer-b', 'owner-b'],
        async (candidate) => candidate.ownerIncarnationId === proof.ownerIncarnationId
      )
      expect(replacement.ownerIncarnationId).toBe('owner-b')
      await replacement.close()
    }
  )

  it('recovers a replacement that crashed after publishing its takeover marker', async () => {
    const directory = freshDirectory()
    const first = await openRuntime(directory, ['host-a', 'writer-a', 'owner-a'])
    const registryDirectory = path.join(directory, 'registry')
    const firstToken = await TerminalAuthorityWriterLock.readCurrentOwnerToken(registryDirectory)
    expect(firstToken).not.toBeNull()
    const replacementToken = encodeTerminalAuthorityOwnerToken('writer-b', {
      ownerIncarnationId: 'owner-b',
      process: {
        pid: 77_777,
        platform: 'legacy',
        startedAtMs: 1_650_000_000_000
      }
    })
    await TerminalAuthorityWriterLock.acquire({
      directory: registryDirectory,
      ownerToken: replacementToken,
      takeoverOwnerToken: firstToken!
    })

    const finalRuntime = await openRuntime(
      directory,
      ['writer-c', 'owner-c'],
      async (candidate) => candidate.ownerIncarnationId === 'owner-b'
    )
    expect(finalRuntime.ownerIncarnationId).toBe('owner-c')
    await expect(first.close()).rejects.toMatchObject({ code: 'writer-fenced' })
    await finalRuntime.close()
  })

  it.each([
    { name: 'only marker owner', gone: ['owner-a'], succeeds: false },
    { name: 'only guard owner', gone: ['owner-b'], succeeds: false },
    { name: 'both owners', gone: ['owner-a', 'owner-b'], succeeds: true }
  ])(
    'requires positive death proof for $name across a marker-A and guard-B crash',
    async ({ gone, succeeds }) => {
      const directory = freshDirectory()
      const first = await openRuntime(directory, ['host-a', 'writer-a', 'owner-a'])
      const registryDirectory = path.join(directory, 'registry')
      const guardToken = encodeTerminalAuthorityOwnerToken('writer-b', {
        ownerIncarnationId: 'owner-b',
        process: {
          pid: 77_777,
          platform: 'legacy',
          startedAtMs: 1_650_000_000_000
        }
      })
      await acquireTerminalAuthorityWriterGuard(registryDirectory, guardToken)
      const checkedOwners: string[] = []
      const replacement = openRuntime(directory, ['writer-c', 'owner-c'], async (proof) => {
        checkedOwners.push(proof.ownerIncarnationId)
        return gone.includes(proof.ownerIncarnationId)
      })

      if (!succeeds) {
        await expect(replacement).rejects.toMatchObject({ code: 'writer-fenced' })
        expect(checkedOwners).toEqual(
          gone.includes('owner-b') ? ['owner-b', 'owner-a'] : ['owner-b']
        )
        if (gone.includes('owner-b')) {
          await first.close()
        }
        return
      }
      const finalRuntime = await replacement
      expect(checkedOwners).toEqual(['owner-b', 'owner-a'])
      await expect(first.close()).rejects.toMatchObject({ code: 'writer-fenced' })
      await finalRuntime.close()
    }
  )

  it('fails closed for corrupt and oversized self-describing owner tokens', async () => {
    const corruptDirectory = freshDirectory()
    const corrupt = await TerminalAuthorityWriterLock.acquire({
      directory: path.join(corruptDirectory, 'registry'),
      ownerToken: 'terminal-authority-owner-v1.not-json'
    })
    const predecessorIsGone = vi.fn(async () => true)
    await expect(
      openRuntime(corruptDirectory, ['host-a', 'writer-b', 'owner-b'], predecessorIsGone)
    ).rejects.toMatchObject({ code: 'writer-fenced' })
    expect(predecessorIsGone).not.toHaveBeenCalled()
    await corrupt.release()

    const oversizedDirectory = freshDirectory()
    const registryDirectory = path.join(oversizedDirectory, 'registry')
    mkdirSync(registryDirectory, { recursive: true })
    writeFileSync(
      path.join(registryDirectory, 'authority-writer.json'),
      JSON.stringify({
        version: 1,
        ownerToken: `terminal-authority-owner-v1.${'a'.repeat(1_024)}`,
        epoch: 1,
        active: true
      })
    )
    await expect(
      openRuntime(oversizedDirectory, ['host-a', 'writer-c', 'owner-c'], predecessorIsGone)
    ).rejects.toThrow('writer ownerToken is invalid')
    expect(predecessorIsGone).not.toHaveBeenCalled()
  })

  it('admits only one concurrent runtime owner', async () => {
    const directory = freshDirectory()
    const [left, right] = await Promise.allSettled([
      openRuntime(directory, ['host-left', 'writer-left', 'owner-left'], async () => false),
      openRuntime(directory, ['host-right', 'writer-right', 'owner-right'], async () => false)
    ])
    const results = [left, right]
    const winners = results.filter(
      (result): result is PromiseFulfilledResult<TerminalSessionAuthorityHostRuntime> =>
        result.status === 'fulfilled'
    )
    const losers = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expect(losers[0]?.reason).toMatchObject({ code: 'writer-fenced' })
    await winners[0]!.value.close()
  })
})

function freshDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'orca-authority-host-'))
  directories.push(directory)
  return directory
}

async function openRuntime(
  directory: string,
  ids: string[],
  predecessorIsGone?: NonNullable<
    Parameters<typeof TerminalSessionAuthorityHostRuntime.open>[0]['predecessorIsGone']
  >,
  processIdentity: TerminalAuthorityOwnerProcessIdentity = {
    pid: 99_999,
    platform: 'legacy',
    startedAtMs: 1_700_000_000_000
  }
): Promise<TerminalSessionAuthorityHostRuntime> {
  let index = 0
  return await TerminalSessionAuthorityHostRuntime.open({
    directory,
    processIdentity,
    createId: () => ids[index++] ?? `unexpected-${index}`,
    ...(predecessorIsGone ? { predecessorIsGone } : {})
  })
}

function linuxProcessIdentity(
  executionScope: string,
  linuxPidNamespace: string
): TerminalAuthorityOwnerProcessIdentity {
  return {
    pid: 1,
    platform: 'linux',
    linuxStartTicks: '100',
    linuxPidNamespace,
    bootId: 'shared-boot',
    executionScope
  }
}

function windowsProcessIdentity(executionScope: string): TerminalAuthorityOwnerProcessIdentity {
  return { pid: 42, platform: 'win32', startedAtMs: 1_000, executionScope }
}
