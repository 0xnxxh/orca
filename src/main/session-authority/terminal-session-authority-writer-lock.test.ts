import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireTerminalAuthorityWriterGuard,
  readTerminalAuthorityWriterGuardOwner,
  releaseTerminalAuthorityWriterGuard,
  writeTerminalAuthorityWriterMarker
} from './terminal-authority-writer-storage'
import { TerminalAuthorityWriterLock } from './terminal-session-authority-writer-lock'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('TerminalAuthorityWriterLock', () => {
  it('admits exactly one process writer and advances the durable epoch after clean release', async () => {
    const directory = freshDirectory()
    const first = await TerminalAuthorityWriterLock.acquire({
      directory,
      ownerToken: 'owner-token-a'
    })
    await expect(
      TerminalAuthorityWriterLock.acquire({ directory, ownerToken: 'owner-token-b' })
    ).rejects.toMatchObject({ code: 'writer-fenced' })
    await first.release()
    const second = await TerminalAuthorityWriterLock.acquire({
      directory,
      ownerToken: 'owner-token-b'
    })
    expect(second.identity.epoch).toBe(2)
    await second.release()
  })

  it('requires the exact predecessor token for takeover and fences the old writer', async () => {
    const directory = freshDirectory()
    const first = await TerminalAuthorityWriterLock.acquire({
      directory,
      ownerToken: 'owner-token-a'
    })
    await expect(
      TerminalAuthorityWriterLock.acquire({
        directory,
        ownerToken: 'owner-token-b',
        takeoverOwnerToken: 'wrong-owner-token'
      })
    ).rejects.toMatchObject({ code: 'writer-fenced' })
    const second = await TerminalAuthorityWriterLock.acquire({
      directory,
      ownerToken: 'owner-token-b',
      takeoverOwnerToken: 'owner-token-a'
    })
    expect(second.identity.epoch).toBe(2)
    await expect(first.runExclusive(async () => undefined)).rejects.toMatchObject({
      code: 'writer-fenced'
    })
    await second.release()
  })

  it('serializes concurrent critical sections across independent lock handles', async () => {
    const directory = freshDirectory()
    const first = await TerminalAuthorityWriterLock.acquire({
      directory,
      ownerToken: 'owner-token-a'
    })
    const order: string[] = []
    await first.runExclusive(async () => {
      order.push('first-start')
      const fenced = TerminalAuthorityWriterLock.acquire({
        directory,
        ownerToken: 'owner-token-b'
      })
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
      order.push('first-end')
      await expect(fenced).rejects.toMatchObject({ code: 'writer-fenced' })
    })
    expect(order).toEqual(['first-start', 'first-end'])
    await first.release()
  })

  it.each(['guard-published', 'marker-published'] as const)(
    'recovers an exact owner after a %s crash without an age heuristic',
    async (boundary) => {
      const directory = freshDirectory()
      await acquireTerminalAuthorityWriterGuard(directory, 'owner-token-a')
      if (boundary === 'marker-published') {
        await writeTerminalAuthorityWriterMarker(directory, {
          version: 1,
          ownerToken: 'owner-token-a',
          epoch: 1,
          active: true
        })
      }
      expect(await TerminalAuthorityWriterLock.readCurrentOwnerToken(directory)).toBe(
        'owner-token-a'
      )

      const replacement = await TerminalAuthorityWriterLock.acquire({
        directory,
        ownerToken: 'owner-token-b',
        takeoverOwnerToken: 'owner-token-a',
        allowUninitializedTakeover: true
      })
      expect(replacement.identity.epoch).toBe(boundary === 'guard-published' ? 1 : 2)
      await replacement.release()
    }
  )

  it('admits only one concurrent first-owner contender', async () => {
    const directory = freshDirectory()
    const contenders = await Promise.allSettled([
      TerminalAuthorityWriterLock.acquire({ directory, ownerToken: 'owner-token-a' }),
      TerminalAuthorityWriterLock.acquire({ directory, ownerToken: 'owner-token-b' })
    ])
    const winners = contenders.filter(
      (result): result is PromiseFulfilledResult<TerminalAuthorityWriterLock> =>
        result.status === 'fulfilled'
    )
    const losers = contenders.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expect(losers[0]?.reason).toMatchObject({ code: 'writer-fenced' })
    await winners[0]!.value.release()
  })

  it('never lets a stale release remove its successor guard', async () => {
    const directory = freshDirectory()
    const stale = await acquireTerminalAuthorityWriterGuard(directory, 'owner-token-a')
    expect(await TerminalAuthorityWriterLock.clearProvenGuard(directory, 'owner-token-a')).toBe(
      true
    )
    const current = await acquireTerminalAuthorityWriterGuard(directory, 'owner-token-b')

    await expect(releaseTerminalAuthorityWriterGuard(directory, stale)).rejects.toMatchObject({
      code: 'writer-fenced'
    })
    expect(await readTerminalAuthorityWriterGuardOwner(directory)).toBe('owner-token-b')
    await releaseTerminalAuthorityWriterGuard(directory, current)
  })

  it('fences a stale critical-section release after exact guard replacement', async () => {
    const directory = freshDirectory()
    const writer = await TerminalAuthorityWriterLock.acquire({
      directory,
      ownerToken: 'owner-token-a'
    })
    let finishOperation!: () => void
    let operationEntered!: () => void
    const entered = new Promise<void>((resolve) => {
      operationEntered = resolve
    })
    const finish = new Promise<void>((resolve) => {
      finishOperation = resolve
    })
    const running = writer.runExclusive(async () => {
      operationEntered()
      await finish
    })
    await entered
    expect(await TerminalAuthorityWriterLock.clearProvenGuard(directory, 'owner-token-a')).toBe(
      true
    )
    const successor = await acquireTerminalAuthorityWriterGuard(directory, 'owner-token-b')
    finishOperation()

    await expect(running).rejects.toMatchObject({ code: 'writer-fenced' })
    expect(await readTerminalAuthorityWriterGuardOwner(directory)).toBe('owner-token-b')
    await releaseTerminalAuthorityWriterGuard(directory, successor)
  })

  it('admits only one concurrent recoverer without deleting the winner', async () => {
    const directory = freshDirectory()
    await acquireTerminalAuthorityWriterGuard(directory, 'owner-token-a')
    await writeTerminalAuthorityWriterMarker(directory, {
      version: 1,
      ownerToken: 'owner-token-a',
      epoch: 1,
      active: true
    })
    const contenders = await Promise.allSettled([
      TerminalAuthorityWriterLock.acquire({
        directory,
        ownerToken: 'owner-token-b',
        takeoverOwnerToken: 'owner-token-a'
      }),
      TerminalAuthorityWriterLock.acquire({
        directory,
        ownerToken: 'owner-token-c',
        takeoverOwnerToken: 'owner-token-a'
      })
    ])
    const winners = contenders.filter(
      (result): result is PromiseFulfilledResult<TerminalAuthorityWriterLock> =>
        result.status === 'fulfilled'
    )
    expect(winners).toHaveLength(1)
    expect(await TerminalAuthorityWriterLock.readCurrentOwnerToken(directory)).toBe(
      winners[0]!.value.identity.ownerToken
    )
    await winners[0]!.value.release()
  })

  it('normalizes empty writer markers to record corruption', async () => {
    const directory = freshDirectory()
    writeFileSync(path.join(directory, 'authority-writer.json'), '')
    await expect(
      TerminalAuthorityWriterLock.readCurrentOwnerToken(directory)
    ).rejects.toMatchObject({ code: 'record-corrupt' })
  })
})

function freshDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'orca-authority-lock-'))
  directories.push(directory)
  return directory
}
