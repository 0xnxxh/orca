import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nacl from 'tweetnacl'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEVICE_REGISTRY_FILENAME,
  E2EE_KEYPAIR_BACKUP_FILENAME,
  E2EE_IDENTITY_MARKER_FILENAME,
  E2EE_KEYPAIR_FILENAME,
  E2EE_KEYPAIR_STAGE_FILENAME,
  RELAY_REVOKE_OUTBOX_FILENAME
} from './mobile-pairing-files'
import {
  loadE2EEKeypair,
  loadOrCreateE2EEKeypair,
  finalizeE2EEKeypairResetSuccessor,
  publishE2EEKeypairResetSuccessor,
  stageE2EEKeypairResetSuccessor,
  validateE2EEIdentityStorage
} from './e2ee-keypair'
import { replaceVerifiedKeypairStage } from './e2ee-keypair-storage'

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

describe('durable E2EE identity lifecycle', () => {
  let userDataPath: string

  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'orca-e2ee-identity-'))
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
  })

  it('creates once on a fresh install and reloads the same identity', () => {
    const first = loadOrCreateE2EEKeypair(userDataPath)
    const second = loadOrCreateE2EEKeypair(userDataPath)
    const keypairRecord = JSON.parse(
      readFileSync(join(userDataPath, E2EE_KEYPAIR_FILENAME), 'utf8')
    ) as Record<string, unknown>
    const markerRecord = JSON.parse(
      readFileSync(join(userDataPath, E2EE_IDENTITY_MARKER_FILENAME), 'utf8')
    ) as Record<string, unknown>

    expect(second.publicKeyB64).toBe(first.publicKeyB64)
    expect(second.publicKey).toEqual(first.publicKey)
    expect(second.secretKey).toEqual(first.secretKey)
    expect(keypairRecord.v).toBe(2)
    expect(keypairRecord.installationId).toBe(markerRecord.installationId)
    expect(markerRecord).not.toHaveProperty('consumerId')
    expect(existsSync(join(userDataPath, E2EE_IDENTITY_MARKER_FILENAME))).toBe(true)
  })

  it('migrates only a validated markerless legacy keypair with the same key material', () => {
    const legacy = nacl.box.keyPair()
    writeFileSync(
      join(userDataPath, E2EE_KEYPAIR_FILENAME),
      JSON.stringify({
        v: 1,
        publicKeyB64: Buffer.from(legacy.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(legacy.secretKey).toString('base64')
      })
    )

    const migrated = loadOrCreateE2EEKeypair(userDataPath)
    const current = JSON.parse(
      readFileSync(join(userDataPath, E2EE_KEYPAIR_FILENAME), 'utf8')
    ) as Record<string, unknown>

    expect(migrated.publicKeyB64).toBe(Buffer.from(legacy.publicKey).toString('base64'))
    expect(current.v).toBe(2)
    expect(current.installationId).toBeTruthy()
    expect(existsSync(join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME))).toBe(false)
  })

  it('finishes marker-before-v2 recovery with the same legacy key material', () => {
    const legacy = nacl.box.keyPair()
    const installationId = 'marker-before-v2-0001'
    writeFileSync(
      join(userDataPath, E2EE_KEYPAIR_FILENAME),
      JSON.stringify({
        v: 1,
        publicKeyB64: Buffer.from(legacy.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(legacy.secretKey).toString('base64')
      })
    )
    writeFileSync(
      join(userDataPath, E2EE_IDENTITY_MARKER_FILENAME),
      JSON.stringify({ v: 1, installationId })
    )

    expect(() => loadE2EEKeypair(userDataPath)).toThrow('does not match the keypair')
    expect(readFileSync(join(userDataPath, E2EE_KEYPAIR_FILENAME), 'utf8')).toContain(
      Buffer.from(legacy.publicKey).toString('base64')
    )
  })

  it('fails closed when a current keypair loses its marker', () => {
    loadOrCreateE2EEKeypair(userDataPath)
    const keypairPath = join(userDataPath, E2EE_KEYPAIR_FILENAME)
    const markerPath = join(userDataPath, E2EE_IDENTITY_MARKER_FILENAME)
    const activeBefore = readFileSync(keypairPath, 'utf8')
    unlinkSync(markerPath)

    expect(() => loadOrCreateE2EEKeypair(userDataPath)).toThrow('marker')
    expect(readFileSync(keypairPath, 'utf8')).toBe(activeBefore)
  })

  it('fails closed when marker and current keypair installation identities differ', () => {
    loadOrCreateE2EEKeypair(userDataPath)
    const markerPath = join(userDataPath, E2EE_IDENTITY_MARKER_FILENAME)
    writeFileSync(markerPath, JSON.stringify({ v: 1, installationId: 'different-installation-id' }))

    expect(() => loadOrCreateE2EEKeypair(userDataPath)).toThrow('does not match')
  })

  it('recovers the exact staged first-install keypair before marker publication', () => {
    const staged = nacl.box.keyPair()
    const installationId = 'staged-installation-0001'
    writeFileSync(
      join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME),
      JSON.stringify({
        v: 2,
        publicKeyB64: Buffer.from(staged.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(staged.secretKey).toString('base64'),
        installationId,
        purpose: 'first-install'
      })
    )

    const recovered = loadOrCreateE2EEKeypair(userDataPath)

    expect(recovered.publicKeyB64).toBe(Buffer.from(staged.publicKey).toString('base64'))
    expect(existsSync(join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME))).toBe(false)
    expect(
      JSON.parse(readFileSync(join(userDataPath, E2EE_IDENTITY_MARKER_FILENAME), 'utf8'))
    ).toEqual({ v: 1, installationId })
  })

  it('recovers the exact staged first-install keypair after marker publication', () => {
    const staged = nacl.box.keyPair()
    const installationId = 'published-installation-0001'
    writeFileSync(
      join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME),
      JSON.stringify({
        v: 2,
        publicKeyB64: Buffer.from(staged.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(staged.secretKey).toString('base64'),
        installationId,
        purpose: 'first-install'
      })
    )
    writeFileSync(
      join(userDataPath, E2EE_IDENTITY_MARKER_FILENAME),
      JSON.stringify({ v: 1, installationId })
    )

    expect(loadOrCreateE2EEKeypair(userDataPath).publicKeyB64).toBe(
      Buffer.from(staged.publicKey).toString('base64')
    )
    expect(existsSync(join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME))).toBe(false)
  })

  it('publishes a reset successor with the same installation marker', () => {
    const first = loadOrCreateE2EEKeypair(userDataPath)
    const markerPath = join(userDataPath, E2EE_IDENTITY_MARKER_FILENAME)
    const markerBefore = readFileSync(markerPath, 'utf8')
    const transaction = {
      transactionId: 'reset-transaction-0001',
      oldPublicKeyB64: first.publicKeyB64,
      phase: 'creating-successor'
    } as const

    stageE2EEKeypairResetSuccessor(userDataPath, transaction)
    const stagedSuccessor = JSON.parse(
      readFileSync(join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME), 'utf8')
    ) as { publicKeyB64: string }
    const successor = publishE2EEKeypairResetSuccessor(userDataPath, transaction)

    expect(successor.publicKeyB64).toBe(stagedSuccessor.publicKeyB64)
    expect(successor.publicKeyB64).not.toBe(first.publicKeyB64)
    expect(readFileSync(markerPath, 'utf8')).toBe(markerBefore)
    expect(existsSync(join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME))).toBe(true)
    expect(loadE2EEKeypair(userDataPath).publicKeyB64).toBe(successor.publicKeyB64)
    expect(
      finalizeE2EEKeypairResetSuccessor(userDataPath, {
        transactionId: transaction.transactionId,
        oldPublicKeyB64: transaction.oldPublicKeyB64,
        phase: 'successor-published'
      }).publicKeyB64
    ).toBe(successor.publicKeyB64)
    expect(existsSync(join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME))).toBe(true)
  })

  it('does not activate a reset successor during ordinary startup', () => {
    const first = loadOrCreateE2EEKeypair(userDataPath)
    const marker = JSON.parse(
      readFileSync(join(userDataPath, E2EE_IDENTITY_MARKER_FILENAME), 'utf8')
    ) as { installationId: string }
    const successor = nacl.box.keyPair()
    const transactionId = 'reset-transaction-0002'
    writeFileSync(
      join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME),
      JSON.stringify({
        v: 2,
        publicKeyB64: Buffer.from(successor.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(successor.secretKey).toString('base64'),
        installationId: marker.installationId,
        purpose: 'reset',
        transactionId,
        predecessorPublicKeyB64: first.publicKeyB64
      })
    )

    expect(() => loadE2EEKeypair(userDataPath)).toThrow('cannot replace an active')
    expect(
      (
        JSON.parse(readFileSync(join(userDataPath, E2EE_KEYPAIR_FILENAME), 'utf8')) as Record<
          string,
          unknown
        >
      ).publicKeyB64
    ).toBe(first.publicKeyB64)
  })

  it('rejects a reset stage when its active predecessor is missing', () => {
    const staged = nacl.box.keyPair()
    const installationId = 'reset-without-active-0001'
    writeFileSync(
      join(userDataPath, E2EE_IDENTITY_MARKER_FILENAME),
      JSON.stringify({ v: 1, installationId })
    )
    writeFileSync(
      join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME),
      JSON.stringify({
        v: 2,
        publicKeyB64: Buffer.from(staged.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(staged.secretKey).toString('base64'),
        installationId,
        purpose: 'reset',
        transactionId: 'reset-transaction-0007',
        predecessorPublicKeyB64: Buffer.from(staged.publicKey).toString('base64')
      })
    )

    expect(() => validateE2EEIdentityStorage(userDataPath)).toThrow(
      'reset stage requires an active identity'
    )
  })

  it('rejects a reset successor equal to its predecessor in every lifecycle phase', () => {
    const first = loadOrCreateE2EEKeypair(userDataPath)
    const transaction = {
      transactionId: 'reset-transaction-equal-0001',
      oldPublicKeyB64: first.publicKeyB64,
      phase: 'creating-successor'
    } as const
    writeFileSync(
      join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME),
      JSON.stringify({
        v: 2,
        publicKeyB64: first.publicKeyB64,
        secretKeyB64: Buffer.from(first.secretKey).toString('base64'),
        installationId: first.installationId,
        purpose: 'reset',
        transactionId: transaction.transactionId,
        predecessorPublicKeyB64: first.publicKeyB64
      })
    )

    expect(() => stageE2EEKeypairResetSuccessor(userDataPath, transaction)).toThrow()
    expect(() => validateE2EEIdentityStorage(userDataPath)).toThrow()
    expect(() => publishE2EEKeypairResetSuccessor(userDataPath, transaction)).toThrow()
    expect(() =>
      finalizeE2EEKeypairResetSuccessor(userDataPath, {
        ...transaction,
        phase: 'successor-published'
      })
    ).toThrow()
    expect(
      JSON.parse(readFileSync(join(userDataPath, E2EE_KEYPAIR_FILENAME), 'utf8')).publicKeyB64
    ).toBe(first.publicKeyB64)
  })

  it('rejects an active first-install residue that changes key material', () => {
    const original = loadOrCreateE2EEKeypair(userDataPath)
    const staged = nacl.box.keyPair()
    const marker = JSON.parse(
      readFileSync(join(userDataPath, E2EE_IDENTITY_MARKER_FILENAME), 'utf8')
    ) as { installationId: string }
    writeFileSync(
      join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME),
      JSON.stringify({
        v: 2,
        publicKeyB64: Buffer.from(staged.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(staged.secretKey).toString('base64'),
        installationId: marker.installationId,
        purpose: 'first-install'
      })
    )

    expect(() => validateE2EEIdentityStorage(userDataPath)).toThrow(
      'first-install stage does not preserve'
    )
    expect(() => loadE2EEKeypair(userDataPath)).toThrow('cannot replace an active')
    expect(
      (
        JSON.parse(readFileSync(join(userDataPath, E2EE_KEYPAIR_FILENAME), 'utf8')) as {
          publicKeyB64: string
        }
      ).publicKeyB64
    ).toBe(original.publicKeyB64)
  })

  it('rejects a reset stage for the wrong transaction and reuses the matching stage', () => {
    const first = loadOrCreateE2EEKeypair(userDataPath)
    const transaction = {
      transactionId: 'reset-transaction-0003',
      oldPublicKeyB64: first.publicKeyB64,
      phase: 'creating-successor'
    } as const
    const wrongTransaction = {
      transactionId: 'reset-transaction-0004',
      oldPublicKeyB64: first.publicKeyB64,
      phase: 'creating-successor'
    } as const

    stageE2EEKeypairResetSuccessor(userDataPath, transaction)
    const stageBefore = readFileSync(join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME), 'utf8')
    stageE2EEKeypairResetSuccessor(userDataPath, transaction)
    expect(readFileSync(join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME), 'utf8')).toBe(stageBefore)
    expect(() => publishE2EEKeypairResetSuccessor(userDataPath, wrongTransaction)).toThrow(
      'does not match the reset transaction'
    )
    expect(readFileSync(join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME), 'utf8')).toBe(stageBefore)
    expect(publishE2EEKeypairResetSuccessor(userDataPath, transaction).publicKeyB64).not.toBe('')
  })

  it('retains the exact stage across publish retries until later-phase finalization', () => {
    const first = loadOrCreateE2EEKeypair(userDataPath)
    const transaction = {
      transactionId: 'reset-transaction-retry-0001',
      oldPublicKeyB64: first.publicKeyB64,
      phase: 'creating-successor'
    } as const

    stageE2EEKeypairResetSuccessor(userDataPath, transaction)
    const staged = readFileSync(join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME), 'utf8')
    const published = publishE2EEKeypairResetSuccessor(userDataPath, transaction)
    expect(readFileSync(join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME), 'utf8')).toBe(staged)
    expect(publishE2EEKeypairResetSuccessor(userDataPath, transaction).publicKeyB64).toBe(
      published.publicKeyB64
    )
    stageE2EEKeypairResetSuccessor(userDataPath, transaction)
    expect(readFileSync(join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME), 'utf8')).toBe(staged)

    const finalized = finalizeE2EEKeypairResetSuccessor(userDataPath, {
      transactionId: transaction.transactionId,
      oldPublicKeyB64: transaction.oldPublicKeyB64,
      phase: 'finalizing-successor'
    })
    expect(
      finalizeE2EEKeypairResetSuccessor(userDataPath, {
        transactionId: transaction.transactionId,
        oldPublicKeyB64: transaction.oldPublicKeyB64,
        phase: 'successor-published'
      }).publicKeyB64
    ).toBe(finalized.publicKeyB64)
    expect(existsSync(join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME))).toBe(true)
    expect(() => stageE2EEKeypairResetSuccessor(userDataPath, transaction)).not.toThrow()
    expect(() => publishE2EEKeypairResetSuccessor(userDataPath, transaction)).not.toThrow()
  })

  it('rejects a substituted predecessor on every reset retry after publication', () => {
    const first = loadOrCreateE2EEKeypair(userDataPath)
    const transaction = {
      transactionId: 'reset-transaction-predecessor-fence-0001',
      oldPublicKeyB64: first.publicKeyB64,
      phase: 'creating-successor'
    } as const
    stageE2EEKeypairResetSuccessor(userDataPath, transaction)
    publishE2EEKeypairResetSuccessor(userDataPath, transaction)
    const substituted = nacl.box.keyPair()
    const retry = {
      ...transaction,
      oldPublicKeyB64: Buffer.from(substituted.publicKey).toString('base64')
    }

    expect(() => stageE2EEKeypairResetSuccessor(userDataPath, retry)).toThrow(
      'does not match the reset transaction'
    )
    expect(() => publishE2EEKeypairResetSuccessor(userDataPath, retry)).toThrow(
      'does not match the reset transaction'
    )
    expect(() =>
      finalizeE2EEKeypairResetSuccessor(userDataPath, {
        ...retry,
        phase: 'successor-published'
      })
    ).toThrow('does not match the reset transaction')
    expect(
      (
        JSON.parse(readFileSync(join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME), 'utf8')) as {
          predecessorPublicKeyB64: string
        }
      ).predecessorPublicKeyB64
    ).toBe(first.publicKeyB64)
  })

  it('rejects reset stages without strict predecessor evidence or canonical base64', () => {
    const first = loadOrCreateE2EEKeypair(userDataPath)
    const transaction = {
      transactionId: 'reset-transaction-predecessor-schema-0001',
      oldPublicKeyB64: first.publicKeyB64,
      phase: 'creating-successor'
    } as const
    stageE2EEKeypairResetSuccessor(userDataPath, transaction)
    const stagePath = join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME)
    const stage = JSON.parse(readFileSync(stagePath, 'utf8')) as Record<string, unknown>
    delete stage.predecessorPublicKeyB64
    writeFileSync(stagePath, JSON.stringify(stage))
    expect(() => validateE2EEIdentityStorage(userDataPath)).toThrow('stage is invalid')

    const finalIndex = first.publicKeyB64.length - 2
    const finalValue = BASE64_ALPHABET.indexOf(first.publicKeyB64[finalIndex]!)
    const noncanonicalFinal = BASE64_ALPHABET[(finalValue & 0b110000) | 1]!
    stage.predecessorPublicKeyB64 = `${first.publicKeyB64.slice(0, finalIndex)}${noncanonicalFinal}=`
    writeFileSync(stagePath, JSON.stringify(stage))
    expect(() => validateE2EEIdentityStorage(userDataPath)).toThrow('stage is invalid')

    stage.predecessorPublicKeyB64 = Buffer.from(nacl.box.keyPair().publicKey).toString('base64')
    writeFileSync(stagePath, JSON.stringify(stage))
    expect(() => validateE2EEIdentityStorage(userDataPath)).toThrow('active predecessor')
  })

  it('reuses a reset stage after a crash just before stage cleanup', () => {
    const first = loadOrCreateE2EEKeypair(userDataPath)
    const transaction = {
      transactionId: 'reset-transaction-0005',
      oldPublicKeyB64: first.publicKeyB64,
      phase: 'creating-successor'
    } as const
    stageE2EEKeypairResetSuccessor(userDataPath, transaction)
    const stage = JSON.parse(
      readFileSync(join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME), 'utf8')
    ) as Record<string, string>
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
      join(userDataPath, E2EE_KEYPAIR_FILENAME),
      JSON.stringify({
        v: 2,
        publicKeyB64: stage.publicKeyB64,
        secretKeyB64: stage.secretKeyB64,
        installationId: first.installationId
      })
    )

    const recovered = publishE2EEKeypairResetSuccessor(userDataPath, transaction)
    expect(recovered.publicKeyB64).toBe(stage.publicKeyB64)
    expect(existsSync(join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME))).toBe(true)
  })

  it('keeps the stage as the crash boundary until the normative reset phase commits', () => {
    const first = loadOrCreateE2EEKeypair(userDataPath)
    const transaction = {
      transactionId: 'reset-transaction-finalize-crash-0001',
      oldPublicKeyB64: first.publicKeyB64,
      phase: 'creating-successor'
    } as const
    stageE2EEKeypairResetSuccessor(userDataPath, transaction)
    const staged = JSON.parse(
      readFileSync(join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME), 'utf8')
    ) as { publicKeyB64: string }
    publishE2EEKeypairResetSuccessor(userDataPath, transaction)

    expect(loadE2EEKeypair(userDataPath).publicKeyB64).toBe(staged.publicKeyB64)
    expect(existsSync(join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME))).toBe(true)
    expect(() => stageE2EEKeypairResetSuccessor(userDataPath, transaction)).not.toThrow()

    const nextTransaction = {
      transactionId: 'reset-transaction-finalize-crash-0002',
      oldPublicKeyB64: staged.publicKeyB64,
      phase: 'creating-successor'
    } as const
    expect(() => stageE2EEKeypairResetSuccessor(userDataPath, nextTransaction)).toThrow(
      'does not match the reset transaction'
    )
  })

  it('rejects replay of the creating transaction after its later phase removes the stage', () => {
    const first = loadOrCreateE2EEKeypair(userDataPath)
    const transaction = {
      transactionId: 'reset-transaction-finalize-cleanup-0001',
      oldPublicKeyB64: first.publicKeyB64,
      phase: 'creating-successor'
    } as const

    stageE2EEKeypairResetSuccessor(userDataPath, transaction)
    publishE2EEKeypairResetSuccessor(userDataPath, transaction)
    finalizeE2EEKeypairResetSuccessor(userDataPath, {
      ...transaction,
      phase: 'finalizing-successor'
    })
    unlinkSync(join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME))

    expect(() => stageE2EEKeypairResetSuccessor(userDataPath, transaction)).toThrow('backup')
  })

  it('never creates an identity from a reset stage during ordinary startup', () => {
    const successor = nacl.box.keyPair()
    writeFileSync(
      join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME),
      JSON.stringify({
        v: 2,
        publicKeyB64: Buffer.from(successor.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(successor.secretKey).toString('base64'),
        installationId: 'reset-stage-install-0001',
        purpose: 'reset',
        transactionId: 'reset-transaction-0006',
        predecessorPublicKeyB64: Buffer.from(successor.publicKey).toString('base64')
      })
    )

    expect(() => loadOrCreateE2EEKeypair(userDataPath)).toThrow('first-install')
    expect(existsSync(join(userDataPath, E2EE_KEYPAIR_FILENAME))).toBe(false)
    expect(existsSync(join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME))).toBe(true)
  })

  it('restores the old active file when Windows replacement cannot rename the stage', () => {
    const activePath = join(userDataPath, 'active.json')
    const stagePath = join(userDataPath, 'stage.json')
    const activeContents = 'old-active'
    const stageContents = 'new-stage'
    writeFileSync(activePath, activeContents)
    writeFileSync(stagePath, stageContents)

    const rename = (source: string, destination: string): void => {
      if (source === stagePath && destination === activePath) {
        throw new Error('sharing violation')
      }
      renameSync(source, destination)
    }

    expect(() =>
      replaceVerifiedKeypairStage(stagePath, activePath, { platform: 'win32', rename })
    ).toThrow('sharing violation')
    expect(readFileSync(activePath, 'utf8')).toBe(activeContents)
    expect(readFileSync(stagePath, 'utf8')).toBe(stageContents)
  })

  it('recovers a Windows replacement interrupted after the first rename', () => {
    const first = loadOrCreateE2EEKeypair(userDataPath)
    const transaction = {
      transactionId: 'reset-transaction-0008',
      oldPublicKeyB64: first.publicKeyB64,
      phase: 'creating-successor'
    } as const
    stageE2EEKeypairResetSuccessor(userDataPath, transaction)
    const activePath = join(userDataPath, E2EE_KEYPAIR_FILENAME)
    const backupPath = join(userDataPath, E2EE_KEYPAIR_BACKUP_FILENAME)
    renameSync(activePath, backupPath)

    expect(() => loadE2EEKeypair(userDataPath)).toThrow('cannot replace an active')
    expect(readFileSync(activePath, 'utf8')).toContain(first.publicKeyB64)
    expect(existsSync(backupPath)).toBe(false)
    expect(publishE2EEKeypairResetSuccessor(userDataPath, transaction).publicKeyB64).not.toBe(
      first.publicKeyB64
    )
  })

  it('keeps a Windows replacement interrupted after the second rename recoverable', () => {
    const first = loadOrCreateE2EEKeypair(userDataPath)
    const transaction = {
      transactionId: 'reset-transaction-0009',
      oldPublicKeyB64: first.publicKeyB64,
      phase: 'creating-successor'
    } as const
    stageE2EEKeypairResetSuccessor(userDataPath, transaction)
    const activePath = join(userDataPath, E2EE_KEYPAIR_FILENAME)
    const backupPath = join(userDataPath, E2EE_KEYPAIR_BACKUP_FILENAME)
    const stage = JSON.parse(
      readFileSync(join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME), 'utf8')
    ) as { publicKeyB64: string; secretKeyB64: string; installationId: string }
    renameSync(activePath, backupPath)
    writeFileSync(
      activePath,
      JSON.stringify({
        v: 2,
        publicKeyB64: stage.publicKeyB64,
        secretKeyB64: stage.secretKeyB64,
        installationId: stage.installationId
      })
    )

    expect(loadE2EEKeypair(userDataPath).publicKeyB64).toBe(stage.publicKeyB64)
    expect(existsSync(backupPath)).toBe(true)
    expect(publishE2EEKeypairResetSuccessor(userDataPath, transaction).publicKeyB64).toBe(
      stage.publicKeyB64
    )
    expect(existsSync(backupPath)).toBe(true)
    expect(loadE2EEKeypair(userDataPath).publicKeyB64).toBe(stage.publicKeyB64)
    expect(first.publicKeyB64).not.toBe(stage.publicKeyB64)
  })

  it('fails closed on an ambiguous replacement backup', () => {
    const first = loadOrCreateE2EEKeypair(userDataPath)
    const backup = nacl.box.keyPair()
    writeFileSync(
      join(userDataPath, E2EE_KEYPAIR_BACKUP_FILENAME),
      JSON.stringify({
        v: 2,
        publicKeyB64: Buffer.from(backup.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(backup.secretKey).toString('base64'),
        installationId: 'different-backup-install-0001'
      })
    )

    expect(() => loadE2EEKeypair(userDataPath)).toThrow('backup does not match')
    expect(existsSync(join(userDataPath, E2EE_KEYPAIR_BACKUP_FILENAME))).toBe(true)
    expect(
      (
        JSON.parse(readFileSync(join(userDataPath, E2EE_KEYPAIR_FILENAME), 'utf8')) as {
          publicKeyB64: string
        }
      ).publicKeyB64
    ).toBe(first.publicKeyB64)
  })

  it.each([
    ['malformed JSON', '{'],
    ['wrong version', JSON.stringify({ v: 2, publicKeyB64: 'x', secretKeyB64: 'x' })],
    ['wrong lengths', JSON.stringify({ v: 1, publicKeyB64: 'AA==', secretKeyB64: 'AA==' })]
  ])('fails closed on %s without regenerating', (_name, contents) => {
    loadOrCreateE2EEKeypair(userDataPath)
    const keypairPath = join(userDataPath, E2EE_KEYPAIR_FILENAME)
    const markerPath = join(userDataPath, E2EE_IDENTITY_MARKER_FILENAME)
    const markerBefore = readFileSync(markerPath, 'utf8')
    writeFileSync(keypairPath, contents)

    expect(() => loadOrCreateE2EEKeypair(userDataPath)).toThrow()
    expect(readFileSync(keypairPath, 'utf8')).toBe(contents)
    expect(readFileSync(markerPath, 'utf8')).toBe(markerBefore)
  })

  it('fails closed on an oversized established record', () => {
    loadOrCreateE2EEKeypair(userDataPath)
    const keypairPath = join(userDataPath, E2EE_KEYPAIR_FILENAME)
    const oversized = 'x'.repeat(9 * 1024)
    writeFileSync(keypairPath, oversized)

    expect(() => loadOrCreateE2EEKeypair(userDataPath)).toThrow('too large')
    expect(statSync(keypairPath).size).toBe(Buffer.byteLength(oversized))
  })

  it('rejects a public key that is not derived from the stored secret', () => {
    const original = loadOrCreateE2EEKeypair(userDataPath)
    const other = nacl.box.keyPair()
    const keypairPath = join(userDataPath, E2EE_KEYPAIR_FILENAME)
    writeFileSync(
      keypairPath,
      JSON.stringify({
        v: 1,
        publicKeyB64: Buffer.from(other.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(original.secretKey).toString('base64')
      })
    )

    expect(() => loadOrCreateE2EEKeypair(userDataPath)).toThrow('does not match')
  })

  it('rejects establishment evidence for a different identity', () => {
    loadOrCreateE2EEKeypair(userDataPath)
    writeFileSync(
      join(userDataPath, E2EE_IDENTITY_MARKER_FILENAME),
      JSON.stringify({ v: 1, consumerId: 'app-profile:v1:other' })
    )

    expect(() => loadOrCreateE2EEKeypair(userDataPath)).toThrow('marker does not match')
  })

  it('rejects a noncanonical base64 encoding', () => {
    const original = loadOrCreateE2EEKeypair(userDataPath)
    const canonical = Buffer.from(original.secretKey).toString('base64')
    const finalIndex = canonical.length - 2
    const value = BASE64_ALPHABET.indexOf(canonical[finalIndex]!)
    const alternate = BASE64_ALPHABET[(value & 0b110000) | 1]!
    const keypairPath = join(userDataPath, E2EE_KEYPAIR_FILENAME)
    writeFileSync(
      keypairPath,
      JSON.stringify({
        v: 1,
        publicKeyB64: original.publicKeyB64,
        secretKeyB64: `${canonical.slice(0, finalIndex)}${alternate}=`
      })
    )

    expect(() => loadOrCreateE2EEKeypair(userDataPath)).toThrow('secret key is invalid')
  })

  it('treats deletion after establishment as missing identity', () => {
    loadOrCreateE2EEKeypair(userDataPath)
    unlinkSync(join(userDataPath, E2EE_KEYPAIR_FILENAME))

    expect(() => loadOrCreateE2EEKeypair(userDataPath)).toThrow('missing')
    expect(existsSync(join(userDataPath, E2EE_IDENTITY_MARKER_FILENAME))).toBe(true)
  })

  it('does not create when pairing state exists without the keypair', () => {
    writeFileSync(join(userDataPath, DEVICE_REGISTRY_FILENAME), '[]')

    expect(() => loadOrCreateE2EEKeypair(userDataPath)).toThrow('missing')
  })

  it.each([
    ['missing', null, false],
    ['valid', '[]', true],
    ['invalid', '{invalid', true]
  ] as const)(
    'treats a %s relay revoke outbox as established lifecycle evidence',
    (_name, data, established) => {
      if (data !== null) {
        writeFileSync(join(userDataPath, RELAY_REVOKE_OUTBOX_FILENAME), data)
      }

      if (established) {
        expect(() => loadOrCreateE2EEKeypair(userDataPath)).toThrow('missing')
        expect(existsSync(join(userDataPath, E2EE_KEYPAIR_FILENAME))).toBe(false)
      } else {
        expect(loadOrCreateE2EEKeypair(userDataPath).publicKey).toHaveLength(32)
        expect(existsSync(join(userDataPath, E2EE_KEYPAIR_FILENAME))).toBe(true)
      }
    }
  )

  it('keeps strict established loading separate from first-install creation', () => {
    expect(() => loadE2EEKeypair(userDataPath)).toThrow('missing')
    const created = loadOrCreateE2EEKeypair(userDataPath)

    expect(loadE2EEKeypair(userDataPath).publicKeyB64).toBe(created.publicKeyB64)
  })

  it.runIf(process.platform !== 'win32')('hardens identity files on Unix', () => {
    loadOrCreateE2EEKeypair(userDataPath)
    const keypairPath = join(userDataPath, E2EE_KEYPAIR_FILENAME)
    const markerPath = join(userDataPath, E2EE_IDENTITY_MARKER_FILENAME)
    chmodSync(userDataPath, 0o755)
    chmodSync(keypairPath, 0o644)
    chmodSync(markerPath, 0o644)

    loadOrCreateE2EEKeypair(userDataPath)

    expect(statSync(userDataPath).mode & 0o777).toBe(0o700)
    expect(statSync(keypairPath).mode & 0o777).toBe(0o600)
    expect(statSync(markerPath).mode & 0o777).toBe(0o600)
  })

  it('uses path.join-safe userdata paths', () => {
    const nestedPath = join(userDataPath, 'user data', 'Orca')
    const keypair = loadOrCreateE2EEKeypair(nestedPath)

    expect(keypair.publicKey).toHaveLength(32)
    expect(existsSync(join(nestedPath, E2EE_KEYPAIR_FILENAME))).toBe(true)
  })
})
