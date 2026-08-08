import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { LegacyPtyProxyCursorCheckpoint } from './legacy-pty-proxy-cursor'
import { FileLegacyPtyProxyCursorRepository } from './legacy-pty-proxy-cursor-repository'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('file legacy PTY proxy cursor repository', () => {
  it('atomically restores a bounded cumulative ACK cursor after restart', async () => {
    const root = await temporaryDirectory()
    const file = path.join(root, 'private', 'proxy-cursors.json')
    const first = await FileLegacyPtyProxyCursorRepository.open(file, {
      maxRecords: 2,
      maxBytes: 8 * 1024
    })
    await first.checkpointStore('binding-1').commit(checkpoint(4))

    const restarted = await FileLegacyPtyProxyCursorRepository.open(file, {
      maxRecords: 2,
      maxBytes: 8 * 1024
    })
    expect(restarted.restore('binding-1')).toEqual({
      checkpoint: checkpoint(4),
      cursor: { durableDownstreamAckedEndSu: 4, upstreamAckedEndSu: 0 },
      sourceRecovery: {
        status: 'checkpoint',
        clientGeneration: 2,
        ownerGeneration: 3,
        ptyIncarnation: 'incarnation-1',
        deliveryToken: 'delivery-1',
        acceptedSourceEndSu: 4
      }
    })
    await expect(restarted.checkpointStore('binding-1').commit(checkpoint(3))).rejects.toThrow(
      'cursor regressed'
    )
  })

  it('never evicts a durable cursor to exceed its record bound', async () => {
    const root = await temporaryDirectory()
    const repository = await FileLegacyPtyProxyCursorRepository.open(
      path.join(root, 'proxy-cursors.json'),
      { maxRecords: 1 }
    )
    await repository.checkpointStore('binding-1').commit(checkpoint(1))
    await expect(repository.checkpointStore('binding-2').commit(checkpoint(1))).rejects.toThrow(
      'repository is full'
    )
    expect(repository.restore('binding-1')?.checkpoint.creditedEndSu).toBe(1)
  })
})

function checkpoint(creditedEndSu: number): LegacyPtyProxyCursorCheckpoint {
  return Object.freeze({
    checkpointId: 'checkpoint-1',
    acknowledgementId: `ack-${creditedEndSu}`,
    identity: Object.freeze({
      id: 'pty-1',
      providerGeneration: 1,
      clientGeneration: 2,
      ownerGeneration: 3,
      ptyIncarnation: 'incarnation-1',
      deliveryToken: 'delivery-1'
    }),
    creditedEndSu
  })
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'orca-legacy-cursor-'))
  temporaryDirectories.push(directory)
  return directory
}
