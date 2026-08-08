import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nacl from 'tweetnacl'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  E2EE_IDENTITY_MARKER_FILENAME,
  E2EE_KEYPAIR_BACKUP_FILENAME,
  E2EE_KEYPAIR_FILENAME,
  E2EE_KEYPAIR_STAGE_FILENAME,
  DEVICE_REGISTRY_FILENAME,
  RELAY_REVOKE_OUTBOX_FILENAME
} from './mobile-pairing-files'
import {
  finalizeE2EEKeypairResetSuccessor,
  loadE2EEKeypair,
  loadOrCreateE2EEKeypair,
  publishE2EEKeypairResetSuccessor,
  stageE2EEKeypairResetSuccessor,
  validateE2EEIdentityStorage
} from './e2ee-keypair'
import { migrateMobilePairingUserdata } from './mobile-pairing-userdata-migration'

describe('E2EE lifecycle regression boundaries', () => {
  let userDataPath: string

  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'orca-e2ee-regression-'))
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
  })

  it('accepts only an exact legacy migration stage beside a marker', () => {
    const legacy = nacl.box.keyPair()
    const installationId = 'marker-before-v2-stage-0001'
    writeFileSync(
      join(userDataPath, E2EE_KEYPAIR_FILENAME),
      JSON.stringify({
        v: 1,
        publicKeyB64: Buffer.from(legacy.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(legacy.secretKey).toString('base64')
      })
    )
    writeFileSync(
      join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME),
      JSON.stringify({
        v: 2,
        publicKeyB64: Buffer.from(legacy.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(legacy.secretKey).toString('base64'),
        installationId,
        purpose: 'first-install'
      })
    )
    writeFileSync(
      join(userDataPath, E2EE_IDENTITY_MARKER_FILENAME),
      JSON.stringify({ v: 1, installationId })
    )

    expect(() => validateE2EEIdentityStorage(userDataPath)).not.toThrow()
    expect(loadE2EEKeypair(userDataPath).publicKeyB64).toBe(
      Buffer.from(legacy.publicKey).toString('base64')
    )
  })

  it('accepts a markerless legacy migration stage before marker publication', () => {
    const legacy = nacl.box.keyPair()
    const installationId = 'markerless-v2-stage-0001'
    writeFileSync(
      join(userDataPath, E2EE_KEYPAIR_FILENAME),
      JSON.stringify({
        v: 1,
        publicKeyB64: Buffer.from(legacy.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(legacy.secretKey).toString('base64')
      })
    )
    writeFileSync(
      join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME),
      JSON.stringify({
        v: 2,
        publicKeyB64: Buffer.from(legacy.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(legacy.secretKey).toString('base64'),
        installationId,
        purpose: 'first-install'
      })
    )

    expect(() => validateE2EEIdentityStorage(userDataPath)).not.toThrow()
    expect(loadE2EEKeypair(userDataPath).publicKeyB64).toBe(
      Buffer.from(legacy.publicKey).toString('base64')
    )
  })

  it('fails closed when a missing active has no exact staged rollback lineage', () => {
    const first = loadOrCreateE2EEKeypair(userDataPath)
    unlinkSync(join(userDataPath, E2EE_KEYPAIR_FILENAME))
    const replacement = nacl.box.keyPair()
    writeFileSync(
      join(userDataPath, E2EE_KEYPAIR_BACKUP_FILENAME),
      JSON.stringify({
        v: 2,
        publicKeyB64: Buffer.from(replacement.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(replacement.secretKey).toString('base64'),
        installationId: first.installationId
      })
    )

    expect(() => loadOrCreateE2EEKeypair(userDataPath)).toThrow('backup does not match')
    expect(existsSync(join(userDataPath, E2EE_KEYPAIR_FILENAME))).toBe(false)
  })

  it('rejects a published same-material successor with a substituted predecessor at every boundary', () => {
    const first = loadOrCreateE2EEKeypair(userDataPath)
    const successor = nacl.box.keyPair()
    const substituted = nacl.box.keyPair()
    const transaction = {
      transactionId: 'reset-transaction-published-binding-0001',
      oldPublicKeyB64: Buffer.from(substituted.publicKey).toString('base64'),
      phase: 'creating-successor'
    } as const
    writeFileSync(
      join(userDataPath, E2EE_KEYPAIR_FILENAME),
      JSON.stringify({
        v: 2,
        publicKeyB64: Buffer.from(successor.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(successor.secretKey).toString('base64'),
        installationId: first.installationId
      })
    )
    writeFileSync(
      join(userDataPath, E2EE_KEYPAIR_BACKUP_FILENAME),
      JSON.stringify({
        v: 2,
        publicKeyB64: first.publicKeyB64,
        secretKeyB64: Buffer.from(first.secretKey).toString('base64'),
        installationId: first.installationId
      })
    )
    writeFileSync(
      join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME),
      JSON.stringify({
        v: 2,
        publicKeyB64: Buffer.from(successor.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(successor.secretKey).toString('base64'),
        installationId: first.installationId,
        purpose: 'reset',
        transactionId: transaction.transactionId,
        predecessorPublicKeyB64: transaction.oldPublicKeyB64
      })
    )
    writeFileSync(
      join(userDataPath, E2EE_IDENTITY_MARKER_FILENAME),
      JSON.stringify({ v: 1, installationId: first.installationId })
    )

    expect(() => validateE2EEIdentityStorage(userDataPath)).toThrow('reset predecessor')
    expect(() => loadE2EEKeypair(userDataPath)).toThrow()
    expect(() => stageE2EEKeypairResetSuccessor(userDataPath, transaction)).toThrow()
    expect(() => publishE2EEKeypairResetSuccessor(userDataPath, transaction)).toThrow()
    expect(() =>
      finalizeE2EEKeypairResetSuccessor(userDataPath, {
        ...transaction,
        phase: 'successor-published'
      })
    ).toThrow()
  })

  it('reconciles equivalent identity JSON while preserving an established target', () => {
    const source = join(userDataPath, 'source')
    const target = join(userDataPath, 'target')
    mkdirSync(source)
    mkdirSync(target)
    const active = nacl.box.keyPair()
    const successor = nacl.box.keyPair()
    const installationId = 'migration-equivalent-lineage-0001'
    const predecessorPublicKeyB64 = Buffer.from(active.publicKey).toString('base64')
    const successorPublicKeyB64 = Buffer.from(successor.publicKey).toString('base64')
    const registry = JSON.stringify([
      {
        deviceId: 'phone',
        name: 'Phone',
        token: 'token',
        scope: 'mobile',
        pairedAt: 1,
        lastSeenAt: 2
      }
    ])
    const outbox = JSON.stringify([
      {
        relayHostId: 'relay-host',
        relayDeviceId: 'phone',
        ownerIdentityKey: 'owner',
        reqId: 'revoke-equivalent-1',
        createdAt: 3
      }
    ])
    const stage = {
      v: 2 as const,
      publicKeyB64: successorPublicKeyB64,
      secretKeyB64: Buffer.from(successor.secretKey).toString('base64'),
      installationId,
      purpose: 'reset' as const,
      transactionId: 'migration-equivalent-reset-0001',
      predecessorPublicKeyB64
    }
    writeCurrentLifecycle(source, active, installationId, stage)
    writeFileSync(join(source, DEVICE_REGISTRY_FILENAME), registry)
    writeFileSync(join(source, RELAY_REVOKE_OUTBOX_FILENAME), outbox)
    writeFileSync(
      join(target, E2EE_KEYPAIR_FILENAME),
      ` {\n  "installationId": "${installationId}",\n  "secretKeyB64": "${Buffer.from(active.secretKey).toString('base64')}",\n  "publicKeyB64": "${Buffer.from(active.publicKey).toString('base64')}",\n  "v": 2\n}\n`
    )
    writeFileSync(
      join(target, E2EE_IDENTITY_MARKER_FILENAME),
      ` { "installationId": "${installationId}", "v": 1 } `
    )
    writeFileSync(join(target, E2EE_KEYPAIR_STAGE_FILENAME), JSON.stringify(stage, null, 2))
    writeFileSync(join(target, DEVICE_REGISTRY_FILENAME), registry)

    const targetActive = readFileSync(join(target, E2EE_KEYPAIR_FILENAME), 'utf8')
    const targetMarker = readFileSync(join(target, E2EE_IDENTITY_MARKER_FILENAME), 'utf8')
    const targetStage = readFileSync(join(target, E2EE_KEYPAIR_STAGE_FILENAME), 'utf8')
    migrateMobilePairingUserdata(source, target)

    expect(readFileSync(join(target, E2EE_KEYPAIR_FILENAME), 'utf8')).toBe(targetActive)
    expect(readFileSync(join(target, E2EE_IDENTITY_MARKER_FILENAME), 'utf8')).toBe(targetMarker)
    expect(readFileSync(join(target, E2EE_KEYPAIR_STAGE_FILENAME), 'utf8')).toBe(targetStage)
    expect(readFileSync(join(target, RELAY_REVOKE_OUTBOX_FILENAME), 'utf8')).toBe(outbox)
  })

  it('retains established registry and outbox when the source copy has mutable drift', () => {
    const source = join(userDataPath, 'source')
    const target = join(userDataPath, 'target')
    mkdirSync(source)
    mkdirSync(target)
    const active = nacl.box.keyPair()
    const successor = nacl.box.keyPair()
    const installationId = 'migration-mutable-drift-0001'
    const stage = {
      v: 2 as const,
      publicKeyB64: Buffer.from(successor.publicKey).toString('base64'),
      secretKeyB64: Buffer.from(successor.secretKey).toString('base64'),
      installationId,
      purpose: 'reset' as const,
      transactionId: 'migration-mutable-reset-0001',
      predecessorPublicKeyB64: Buffer.from(active.publicKey).toString('base64')
    }
    const targetRegistry = JSON.stringify([
      {
        deviceId: 'target-phone',
        name: 'Target',
        token: 'target-token',
        scope: 'mobile',
        pairedAt: 1,
        lastSeenAt: 2
      }
    ])
    const sourceRegistry = JSON.stringify([
      {
        deviceId: 'source-phone',
        name: 'Source',
        token: 'source-token',
        scope: 'mobile',
        pairedAt: 3,
        lastSeenAt: 4
      }
    ])
    const targetOutbox = JSON.stringify([
      {
        relayHostId: 'target-relay',
        relayDeviceId: 'target-phone',
        ownerIdentityKey: 'target-owner',
        reqId: 'target-1',
        createdAt: 5
      }
    ])
    const sourceOutbox = JSON.stringify([
      {
        relayHostId: 'source-relay',
        relayDeviceId: 'source-phone',
        ownerIdentityKey: 'source-owner',
        reqId: 'source-1',
        createdAt: 6
      }
    ])
    writeCurrentLifecycle(source, active, installationId, stage)
    writeFileSync(join(source, DEVICE_REGISTRY_FILENAME), sourceRegistry)
    writeFileSync(join(source, RELAY_REVOKE_OUTBOX_FILENAME), sourceOutbox)
    writeCurrentLifecycle(target, active, installationId)
    writeFileSync(join(target, DEVICE_REGISTRY_FILENAME), targetRegistry)
    writeFileSync(join(target, RELAY_REVOKE_OUTBOX_FILENAME), targetOutbox)

    migrateMobilePairingUserdata(source, target)

    expect(readFileSync(join(target, DEVICE_REGISTRY_FILENAME), 'utf8')).toBe(targetRegistry)
    expect(readFileSync(join(target, RELAY_REVOKE_OUTBOX_FILENAME), 'utf8')).toBe(targetOutbox)
    expect(existsSync(join(target, E2EE_KEYPAIR_STAGE_FILENAME))).toBe(true)
  })

  it('repairs partial target and staging cuts from a complete candidate', () => {
    const source = join(userDataPath, 'source')
    const target = join(userDataPath, 'target')
    const staging = join(target, '.orca-mobile-pairing-migration')
    mkdirSync(source)
    mkdirSync(target)
    mkdirSync(staging)
    const active = nacl.box.keyPair()
    const installationId = 'migration-partial-cut-0001'
    const registry = JSON.stringify([
      {
        deviceId: 'phone',
        name: 'Phone',
        token: 'token',
        scope: 'mobile',
        pairedAt: 1,
        lastSeenAt: 2
      }
    ])
    const outbox = JSON.stringify([
      {
        relayHostId: 'relay',
        relayDeviceId: 'phone',
        ownerIdentityKey: 'owner',
        reqId: 'partial-1',
        createdAt: 1
      }
    ])
    writeCurrentLifecycle(source, active, installationId)
    writeFileSync(join(source, DEVICE_REGISTRY_FILENAME), registry)
    writeFileSync(join(source, RELAY_REVOKE_OUTBOX_FILENAME), outbox)
    const targetActive = JSON.stringify({
      v: 2,
      publicKeyB64: Buffer.from(active.publicKey).toString('base64'),
      secretKeyB64: Buffer.from(active.secretKey).toString('base64'),
      installationId
    })
    writeFileSync(join(target, E2EE_KEYPAIR_FILENAME), targetActive)
    writeFileSync(join(target, DEVICE_REGISTRY_FILENAME), registry)
    writeFileSync(join(target, RELAY_REVOKE_OUTBOX_FILENAME), '[')
    writeFileSync(
      join(staging, E2EE_IDENTITY_MARKER_FILENAME),
      ` { "installationId": "${installationId}", "v": 1 } `
    )
    writeFileSync(join(staging, DEVICE_REGISTRY_FILENAME), '{')

    migrateMobilePairingUserdata(source, target)

    expect(readFileSync(join(target, E2EE_KEYPAIR_FILENAME), 'utf8')).toBe(targetActive)
    expect(existsSync(join(target, E2EE_IDENTITY_MARKER_FILENAME))).toBe(true)
    expect(readFileSync(join(target, DEVICE_REGISTRY_FILENAME), 'utf8')).toBe(registry)
    expect(readFileSync(join(target, RELAY_REVOKE_OUTBOX_FILENAME), 'utf8')).toBe(outbox)
    expect(existsSync(staging)).toBe(false)
  })

  it.each(['transaction', 'predecessor'] as const)(
    'fails closed when a complete target has a divergent reset %s binding',
    (difference) => {
      const source = join(userDataPath, `source-${difference}`)
      const target = join(userDataPath, `target-${difference}`)
      mkdirSync(source)
      mkdirSync(target)
      const active = nacl.box.keyPair()
      const sourceSuccessor = nacl.box.keyPair()
      const targetSuccessor = nacl.box.keyPair()
      const targetPredecessor = nacl.box.keyPair()
      const installationId = `migration-binding-${difference}-0001`
      const sourceStage = {
        v: 2 as const,
        publicKeyB64: Buffer.from(sourceSuccessor.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(sourceSuccessor.secretKey).toString('base64'),
        installationId,
        purpose: 'reset' as const,
        transactionId: 'migration-binding-source-0001',
        predecessorPublicKeyB64: Buffer.from(active.publicKey).toString('base64')
      }
      const targetStage = {
        ...sourceStage,
        publicKeyB64: Buffer.from(targetSuccessor.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(targetSuccessor.secretKey).toString('base64'),
        ...(difference === 'transaction'
          ? { transactionId: 'migration-binding-target-0001' }
          : {
              predecessorPublicKeyB64: Buffer.from(targetPredecessor.publicKey).toString('base64')
            })
      }
      writeCurrentLifecycle(source, active, installationId, sourceStage)
      writeCurrentLifecycle(target, active, installationId, targetStage)
      const targetBefore = readFileSync(join(target, E2EE_KEYPAIR_STAGE_FILENAME), 'utf8')

      expect(() => migrateMobilePairingUserdata(source, target)).toThrow()
      expect(readFileSync(join(target, E2EE_KEYPAIR_STAGE_FILENAME), 'utf8')).toBe(targetBefore)
    }
  )
})

function writeCurrentLifecycle(
  directory: string,
  active: nacl.BoxKeyPair,
  installationId: string,
  stage?: {
    v: 2
    publicKeyB64: string
    secretKeyB64: string
    installationId: string
    purpose: 'reset'
    transactionId: string
    predecessorPublicKeyB64: string
  }
): void {
  writeFileSync(
    join(directory, E2EE_KEYPAIR_FILENAME),
    JSON.stringify({
      v: 2,
      publicKeyB64: Buffer.from(active.publicKey).toString('base64'),
      secretKeyB64: Buffer.from(active.secretKey).toString('base64'),
      installationId
    })
  )
  writeFileSync(
    join(directory, E2EE_IDENTITY_MARKER_FILENAME),
    JSON.stringify({ v: 1, installationId })
  )
  if (stage) {
    writeFileSync(join(directory, E2EE_KEYPAIR_STAGE_FILENAME), JSON.stringify(stage))
  }
}
