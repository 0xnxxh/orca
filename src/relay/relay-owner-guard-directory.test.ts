import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createRelayOwnerGuardDirectory,
  inspectRelayOwnerGuardDirectory,
  releaseRelayOwnerGuardDirectory
} from './relay-owner-guard-directory'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('relay owner guard directory', () => {
  it('publishes one nonempty owner generation and releases idempotently', async () => {
    const guard = await guardPath()

    await expect(createRelayOwnerGuardDirectory(guard, 'owner-a')).resolves.toBe(true)
    await expect(createRelayOwnerGuardDirectory(guard, 'owner-b')).resolves.toBe(false)
    await expect(inspectRelayOwnerGuardDirectory(guard)).resolves.toEqual({
      status: 'owned',
      ownerToken: 'owner-a'
    })
    await expect(releaseRelayOwnerGuardDirectory(guard, 'owner-a')).resolves.toBe(true)
    await expect(releaseRelayOwnerGuardDirectory(guard, 'owner-a')).resolves.toBe(true)
  })

  it('prevents a stale releaser from deleting a replacement generation', async () => {
    const guard = await guardPath()
    await createRelayOwnerGuardDirectory(guard, 'owner-a')
    const staleInspection = await inspectRelayOwnerGuardDirectory(guard)
    await releaseRelayOwnerGuardDirectory(guard, 'owner-a')
    await createRelayOwnerGuardDirectory(guard, 'owner-b')

    expect(staleInspection).toEqual({ status: 'owned', ownerToken: 'owner-a' })
    await expect(releaseRelayOwnerGuardDirectory(guard, 'owner-a')).resolves.toBe(false)
    await expect(inspectRelayOwnerGuardDirectory(guard)).resolves.toEqual({
      status: 'owned',
      ownerToken: 'owner-b'
    })
  })

  it('fails closed for legacy files and malformed directory contents', async () => {
    const guard = await guardPath()
    await writeFile(guard, 'legacy-lock')
    await expect(inspectRelayOwnerGuardDirectory(guard)).resolves.toEqual({ status: 'invalid' })
    await expect(releaseRelayOwnerGuardDirectory(guard, 'owner-a')).resolves.toBe(false)

    await rm(guard)
    await mkdir(guard)
    await writeFile(path.join(guard, 'unexpected'), 'owner-a')
    await expect(inspectRelayOwnerGuardDirectory(guard)).resolves.toEqual({ status: 'invalid' })
  })
})

async function guardPath(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'orca-relay-owner-guard-'))
  roots.push(root)
  return path.join(root, 'guard')
}
