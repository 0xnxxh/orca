import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as SecureFileModule from '../../../shared/secure-file'
import {
  loadRelayRevokeOutboxForReset,
  RELAY_REVOKE_OUTBOX_FILENAME,
  RelayRevokeOutbox
} from './relay-revoke-outbox'

const secureFileMocks = vi.hoisted(() => ({ failWrites: false }))

vi.mock('../../../shared/secure-file', async (importOriginal) => {
  const actual = await importOriginal<typeof SecureFileModule>()
  return {
    ...actual,
    writeSecureJsonFile: (targetPath: string, value: unknown) => {
      if (secureFileMocks.failWrites) {
        throw new Error('disk full')
      }
      actual.writeSecureJsonFile(targetPath, value)
    }
  }
})

describe('RelayRevokeOutbox', () => {
  const paths: string[] = []
  afterEach(() => {
    secureFileMocks.failWrites = false
    for (const path of paths.splice(0)) {
      rmSync(path, { recursive: true, force: true })
    }
  })

  it('durably retains an idempotent account-scoped revoke after local deletion', () => {
    const path = mkdtempSync(join(tmpdir(), 'orca-relay-revoke-'))
    paths.push(path)
    const binding = {
      relayHostId: 'AbCdEf0123_-xyZ9',
      relayDeviceId: 'device-1',
      ownerIdentityKey: 'user-1\0profile-1\0org-1'
    }
    const first = new RelayRevokeOutbox(path).enqueue(binding)
    const reloaded = new RelayRevokeOutbox(path)
    expect(reloaded.enqueue(binding).reqId).toBe(first.reqId)
    expect(reloaded.pendingFor(binding.ownerIdentityKey, binding.relayHostId)).toEqual([first])
    reloaded.remove(first.reqId)
    expect(
      new RelayRevokeOutbox(path).pendingFor(binding.ownerIdentityKey, binding.relayHostId)
    ).toEqual([])
  })

  it('does not retain an enqueue that failed to reach disk', () => {
    const path = mkdtempSync(join(tmpdir(), 'orca-relay-revoke-'))
    paths.push(path)
    const binding = {
      relayHostId: 'AbCdEf0123_-xyZ9',
      relayDeviceId: 'device-1',
      ownerIdentityKey: 'user-1\0profile-1\0org-1'
    }
    const outbox = new RelayRevokeOutbox(path)
    secureFileMocks.failWrites = true
    expect(() => outbox.enqueue(binding)).toThrow('disk full')

    secureFileMocks.failWrites = false
    const persisted = outbox.enqueue(binding)
    expect(
      new RelayRevokeOutbox(path).pendingFor(binding.ownerIdentityKey, binding.relayHostId)
    ).toEqual([persisted])
  })

  it('does not remove an item in memory when the durable removal fails', () => {
    const path = mkdtempSync(join(tmpdir(), 'orca-relay-revoke-'))
    paths.push(path)
    const binding = {
      relayHostId: 'AbCdEf0123_-xyZ9',
      relayDeviceId: 'device-1',
      ownerIdentityKey: 'user-1\0profile-1\0org-1'
    }
    const outbox = new RelayRevokeOutbox(path)
    const item = outbox.enqueue(binding)
    secureFileMocks.failWrites = true
    expect(() => outbox.remove(item.reqId)).toThrow('disk full')

    secureFileMocks.failWrites = false
    expect(outbox.pendingFor(binding.ownerIdentityKey, binding.relayHostId)).toEqual([item])
  })

  it('propagates corrupt outbox state through the reset loader', () => {
    const path = mkdtempSync(join(tmpdir(), 'orca-relay-revoke-'))
    paths.push(path)
    writeFileSync(join(path, RELAY_REVOKE_OUTBOX_FILENAME), '{invalid')

    expect(() => loadRelayRevokeOutboxForReset(path)).toThrow('Relay revoke outbox is invalid')
    expect(new RelayRevokeOutbox(path).pendingFor('owner', 'host')).toEqual([])
  })

  it('rejects missing state only through the reset loader', () => {
    const path = mkdtempSync(join(tmpdir(), 'orca-relay-revoke-'))
    paths.push(path)

    expect(() => loadRelayRevokeOutboxForReset(path)).toThrow('Relay revoke outbox is missing')
    expect(new RelayRevokeOutbox(path).pendingFor('owner', 'host')).toEqual([])
  })

  it.each(['symlink', 'directory'] as const)('rejects a %s reset outbox path', (kind) => {
    const path = mkdtempSync(join(tmpdir(), 'orca-relay-revoke-'))
    const outside = mkdtempSync(join(tmpdir(), 'orca-relay-revoke-target-'))
    paths.push(path, outside)
    const target = join(outside, 'outbox.json')
    writeFileSync(target, '[]')
    if (kind === 'symlink') {
      symlinkSync(target, join(path, RELAY_REVOKE_OUTBOX_FILENAME))
    } else {
      mkdirSync(join(path, RELAY_REVOKE_OUTBOX_FILENAME))
    }

    expect(() => loadRelayRevokeOutboxForReset(path)).toThrow('Relay revoke outbox is invalid')
  })
})
