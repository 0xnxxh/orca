import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import nacl from 'tweetnacl'
// Import from the production source of truth so a filename rename can't silently
// pass these tests against stale names.
import {
  DEVICE_REGISTRY_FILENAME,
  E2EE_KEYPAIR_BACKUP_FILENAME,
  E2EE_IDENTITY_MARKER_FILENAME,
  E2EE_KEYPAIR_FILENAME,
  E2EE_KEYPAIR_STAGE_FILENAME,
  RELAY_REVOKE_OUTBOX_FILENAME
} from './mobile-pairing-files'

// Mutable userData the electron mock resolves. We flip it mid-test to simulate
// app.setName('Orca') changing how app.getPath('userData') resolves (e.g. from
// lowercase 'orca' to uppercase 'Orca' on a case-sensitive filesystem) — the
// divergence that drops paired devices. We use two genuinely distinct directory
// names rather than case variants so the assertion is deterministic regardless
// of whether the test host's filesystem is case-sensitive.
const appState = { userData: '' }

vi.mock('electron', () => ({
  app: { getPath: () => appState.userData },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (plaintext: string) => Buffer.from(plaintext, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8')
  }
}))

describe('mobile pairing userData path stability', () => {
  let root: string
  // The path persistence captures early, before app.setName().
  let canonicalDir: string
  // The path app.getPath('userData') resolves to after app.setName() — a
  // distinct directory standing in for the post-rename resolution.
  let lateDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'orca-pairing-path-'))
    canonicalDir = join(root, 'userdata-early')
    lateDir = join(root, 'userdata-late')
    mkdirSync(canonicalDir, { recursive: true })
    mkdirSync(lateDir, { recursive: true })
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    vi.resetModules()
  })

  it('keeps returning the path captured before app.setName changes resolution', async () => {
    appState.userData = canonicalDir
    const { initDataPath, getCanonicalUserDataPath } = await import('../persistence')
    initDataPath()

    // app.setName('Orca') happens later in startup, changing late resolution.
    appState.userData = lateDir

    expect(getCanonicalUserDataPath()).toBe(canonicalDir)
    const { app } = await import('electron')
    expect(getCanonicalUserDataPath()).not.toBe(app.getPath('userData'))
  })

  it('writes DeviceRegistry + E2EE keypair under the canonical path, not the late one', async () => {
    appState.userData = canonicalDir
    const { initDataPath, getCanonicalUserDataPath } = await import('../persistence')
    initDataPath()

    appState.userData = lateDir // app.setName('Orca') has run by the time the runtime starts

    const { DeviceRegistry } = await import('./device-registry')
    const { loadOrCreateE2EEKeypair } = await import('./e2ee-keypair')

    // Mirrors OrcaRuntimeRpcServer.start(): both read from the same userDataPath.
    loadOrCreateE2EEKeypair(getCanonicalUserDataPath())
    const registry = new DeviceRegistry(getCanonicalUserDataPath())
    registry.addDevice('iPhone')

    // Pairing credentials land beside orca-data.json so they survive restarts/updates.
    expect(existsSync(join(canonicalDir, DEVICE_REGISTRY_FILENAME))).toBe(true)
    expect(existsSync(join(canonicalDir, E2EE_KEYPAIR_FILENAME))).toBe(true)
    // The bug being guarded: the late path would have captured these instead.
    expect(existsSync(join(lateDir, DEVICE_REGISTRY_FILENAME))).toBe(false)
    expect(existsSync(join(lateDir, E2EE_KEYPAIR_FILENAME))).toBe(false)
  })

  it('migrates existing mobile pairing files from the late path as an all-or-nothing pair', async () => {
    appState.userData = canonicalDir
    const {
      initDataPath,
      getCanonicalUserDataPath,
      migrateMobilePairingDataToCanonicalUserDataPath
    } = await import('../persistence')
    initDataPath()

    appState.userData = lateDir
    const lateDevices = JSON.stringify([
      {
        deviceId: 'late-phone',
        name: 'iPhone',
        token: 'late-token',
        scope: 'mobile',
        pairedAt: 1,
        lastSeenAt: 2
      }
    ])
    const lateKeys = nacl.box.keyPair()
    const lateKeypair = JSON.stringify({
      v: 1,
      publicKeyB64: Buffer.from(lateKeys.publicKey).toString('base64'),
      secretKeyB64: Buffer.from(lateKeys.secretKey).toString('base64')
    })
    writeFileSync(join(lateDir, DEVICE_REGISTRY_FILENAME), lateDevices)
    writeFileSync(join(lateDir, E2EE_KEYPAIR_FILENAME), lateKeypair)

    migrateMobilePairingDataToCanonicalUserDataPath(appState.userData)

    expect(readFileSync(join(canonicalDir, DEVICE_REGISTRY_FILENAME), 'utf-8')).toBe(lateDevices)
    expect(readFileSync(join(canonicalDir, E2EE_KEYPAIR_FILENAME), 'utf-8')).toBe(lateKeypair)
    expect(readFileSync(join(lateDir, DEVICE_REGISTRY_FILENAME), 'utf-8')).toBe(lateDevices)
    expect(readFileSync(join(lateDir, E2EE_KEYPAIR_FILENAME), 'utf-8')).toBe(lateKeypair)

    const { DeviceRegistry } = await import('./device-registry')
    const registry = new DeviceRegistry(getCanonicalUserDataPath())
    expect(registry.getDevice('late-phone')?.token).toBe('late-token')

    writeFileSync(join(lateDir, DEVICE_REGISTRY_FILENAME), JSON.stringify([]))
    migrateMobilePairingDataToCanonicalUserDataPath(appState.userData)
    expect(readFileSync(join(canonicalDir, DEVICE_REGISTRY_FILENAME), 'utf-8')).toBe(lateDevices)
  })

  it('migrates valid unpaired identities and first-install recovery states without a registry', async () => {
    const { migrateMobilePairingUserdata } = await import('./mobile-pairing-userdata-migration')
    const { loadOrCreateE2EEKeypair } = await import('./e2ee-keypair')
    const record = (keys: nacl.BoxKeyPair): Record<string, string | number> => ({
      v: 2,
      publicKeyB64: Buffer.from(keys.publicKey).toString('base64'),
      secretKeyB64: Buffer.from(keys.secretKey).toString('base64'),
      installationId: 'first-install-migration-0001'
    })
    const writeStage = (directory: string, withMarker: boolean, purpose = 'first-install') => {
      mkdirSync(directory)
      const keys = nacl.box.keyPair()
      writeFileSync(
        join(directory, E2EE_KEYPAIR_STAGE_FILENAME),
        JSON.stringify({ ...record(keys), purpose })
      )
      if (withMarker) {
        writeFileSync(
          join(directory, E2EE_IDENTITY_MARKER_FILENAME),
          JSON.stringify({ v: 1, installationId: 'first-install-migration-0001' })
        )
      }
      return keys
    }

    const unpairedSource = join(root, 'unpaired-source')
    const unpairedTarget = join(root, 'unpaired-target')
    mkdirSync(unpairedSource)
    mkdirSync(unpairedTarget)
    const active = loadOrCreateE2EEKeypair(unpairedSource)
    migrateMobilePairingUserdata(unpairedSource, unpairedTarget)
    expect(
      JSON.parse(readFileSync(join(unpairedTarget, E2EE_KEYPAIR_FILENAME), 'utf8')).publicKeyB64
    ).toBe(active.publicKeyB64)
    expect(existsSync(join(unpairedTarget, DEVICE_REGISTRY_FILENAME))).toBe(false)

    for (const withMarker of [false, true]) {
      const source = join(root, withMarker ? 'marker-stage-source' : 'stage-source')
      const target = join(root, withMarker ? 'marker-stage-target' : 'stage-target')
      writeStage(source, withMarker)
      mkdirSync(target)
      migrateMobilePairingUserdata(source, target)
      expect(existsSync(join(target, E2EE_KEYPAIR_STAGE_FILENAME))).toBe(true)
      expect(existsSync(join(target, E2EE_IDENTITY_MARKER_FILENAME))).toBe(withMarker)
      expect(existsSync(join(target, DEVICE_REGISTRY_FILENAME))).toBe(false)
    }

    const invalidStates: [string, () => void][] = [
      [
        'marker-only',
        () => {
          const directory = join(root, 'marker-only-source')
          mkdirSync(directory)
          writeFileSync(
            join(directory, E2EE_IDENTITY_MARKER_FILENAME),
            JSON.stringify({ v: 1, installationId: 'marker-only-migration-0001' })
          )
          const target = join(root, 'marker-only-target')
          mkdirSync(target)
          expect(() => migrateMobilePairingUserdata(directory, target)).toThrow()
        }
      ],
      [
        'keypair-only',
        () => {
          const directory = join(root, 'keypair-only-source')
          mkdirSync(directory)
          writeFileSync(
            join(directory, E2EE_KEYPAIR_FILENAME),
            JSON.stringify(record(nacl.box.keyPair()))
          )
          const target = join(root, 'keypair-only-target')
          mkdirSync(target)
          expect(() => migrateMobilePairingUserdata(directory, target)).toThrow()
        }
      ],
      [
        'reset-stage-without-active',
        () => {
          const directory = join(root, 'reset-stage-source')
          const target = join(root, 'reset-stage-target')
          const keys = writeStage(directory, false, 'reset')
          const predecessor = nacl.box.keyPair()
          const stagePath = join(directory, E2EE_KEYPAIR_STAGE_FILENAME)
          const stage = JSON.parse(readFileSync(stagePath, 'utf8')) as Record<string, unknown>
          stage.predecessorPublicKeyB64 = Buffer.from(predecessor.publicKey).toString('base64')
          stage.transactionId = 'reset-stage-migration-0001'
          stage.publicKeyB64 = Buffer.from(keys.publicKey).toString('base64')
          writeFileSync(stagePath, JSON.stringify(stage))
          mkdirSync(target)
          expect(() => migrateMobilePairingUserdata(directory, target)).toThrow('active identity')
        }
      ]
    ]
    for (const [name, check] of invalidStates) {
      expect(check, name).not.toThrow()
    }
  })

  it('migrates a registry-independent markerless legacy identity', async () => {
    const { migrateMobilePairingUserdata } = await import('./mobile-pairing-userdata-migration')
    const source = join(root, 'markerless-legacy-source')
    const target = join(root, 'markerless-legacy-target')
    mkdirSync(source)
    mkdirSync(target)
    const keys = nacl.box.keyPair()
    const legacy = JSON.stringify({
      v: 1,
      publicKeyB64: Buffer.from(keys.publicKey).toString('base64'),
      secretKeyB64: Buffer.from(keys.secretKey).toString('base64')
    })
    writeFileSync(join(source, E2EE_KEYPAIR_FILENAME), legacy)

    migrateMobilePairingUserdata(source, target)

    expect(readFileSync(join(target, E2EE_KEYPAIR_FILENAME), 'utf8')).toBe(legacy)
    expect(existsSync(join(target, DEVICE_REGISTRY_FILENAME))).toBe(false)
    expect(readFileSync(join(source, E2EE_KEYPAIR_FILENAME), 'utf8')).toBe(legacy)
  })

  it.each(['self-link', 'redirect', 'file'] as const)(
    'rejects a %s migration staging directory before copying credentials',
    async (kind) => {
      appState.userData = canonicalDir
      const { initDataPath, migrateMobilePairingDataToCanonicalUserDataPath } =
        await import('../persistence')
      initDataPath()

      const devices = JSON.stringify([
        {
          deviceId: 'late-phone',
          name: 'iPhone',
          token: 'late-token',
          scope: 'mobile',
          pairedAt: 1,
          lastSeenAt: 2
        }
      ])
      const keys = nacl.box.keyPair()
      const keypair = JSON.stringify({
        v: 1,
        publicKeyB64: Buffer.from(keys.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(keys.secretKey).toString('base64')
      })
      writeFileSync(join(lateDir, DEVICE_REGISTRY_FILENAME), devices)
      writeFileSync(join(lateDir, E2EE_KEYPAIR_FILENAME), keypair)

      const redirectDir = join(root, 'migration-redirect')
      if (kind === 'redirect') {
        mkdirSync(redirectDir)
      }
      const stagingDir = join(canonicalDir, '.orca-mobile-pairing-migration')
      if (kind === 'file') {
        writeFileSync(stagingDir, 'not-a-directory')
      } else {
        symlinkSync(
          kind === 'self-link' ? canonicalDir : redirectDir,
          stagingDir,
          process.platform === 'win32' ? 'junction' : 'dir'
        )
      }

      expect(() => migrateMobilePairingDataToCanonicalUserDataPath(lateDir)).toThrow(
        'staging directory is invalid'
      )
      expect(lstatSync(stagingDir).isSymbolicLink()).toBe(kind !== 'file')
      expect(existsSync(join(canonicalDir, DEVICE_REGISTRY_FILENAME))).toBe(false)
      expect(existsSync(join(canonicalDir, E2EE_KEYPAIR_FILENAME))).toBe(false)
      expect(existsSync(join(redirectDir, DEVICE_REGISTRY_FILENAME))).toBe(false)
      expect(existsSync(join(redirectDir, E2EE_KEYPAIR_FILENAME))).toBe(false)
      expect(readFileSync(join(lateDir, DEVICE_REGISTRY_FILENAME), 'utf8')).toBe(devices)
      expect(readFileSync(join(lateDir, E2EE_KEYPAIR_FILENAME), 'utf8')).toBe(keypair)
    }
  )

  it('accepts an owned regular staging directory and remains restart-safe', async () => {
    appState.userData = canonicalDir
    const { initDataPath, migrateMobilePairingDataToCanonicalUserDataPath } =
      await import('../persistence')
    initDataPath()

    const devices = JSON.stringify([
      {
        deviceId: 'late-phone',
        name: 'iPhone',
        token: 'late-token',
        scope: 'mobile',
        pairedAt: 1,
        lastSeenAt: 2
      }
    ])
    const keys = nacl.box.keyPair()
    const keypair = JSON.stringify({
      v: 1,
      publicKeyB64: Buffer.from(keys.publicKey).toString('base64'),
      secretKeyB64: Buffer.from(keys.secretKey).toString('base64')
    })
    writeFileSync(join(lateDir, DEVICE_REGISTRY_FILENAME), devices)
    writeFileSync(join(lateDir, E2EE_KEYPAIR_FILENAME), keypair)

    const stagingDir = join(canonicalDir, '.orca-mobile-pairing-migration')
    mkdirSync(stagingDir)
    writeFileSync(join(stagingDir, DEVICE_REGISTRY_FILENAME), devices)
    writeFileSync(join(stagingDir, E2EE_KEYPAIR_FILENAME), keypair)

    migrateMobilePairingDataToCanonicalUserDataPath(lateDir)
    expect(readFileSync(join(canonicalDir, DEVICE_REGISTRY_FILENAME), 'utf8')).toBe(devices)
    expect(readFileSync(join(canonicalDir, E2EE_KEYPAIR_FILENAME), 'utf8')).toBe(keypair)
    expect(existsSync(stagingDir)).toBe(false)

    migrateMobilePairingDataToCanonicalUserDataPath(lateDir)
    expect(readFileSync(join(canonicalDir, DEVICE_REGISTRY_FILENAME), 'utf8')).toBe(devices)
    expect(readFileSync(join(canonicalDir, E2EE_KEYPAIR_FILENAME), 'utf8')).toBe(keypair)
  })

  it('repairs malformed migration residue while rejecting a valid divergent staged artifact', async () => {
    const { migrateMobilePairingUserdata } = await import('./mobile-pairing-userdata-migration')
    const source = join(root, 'repair-source')
    const target = join(root, 'repair-target')
    mkdirSync(source)
    mkdirSync(target)
    const sourceKeys = nacl.box.keyPair()
    const sourceKeypair = JSON.stringify({
      v: 1,
      publicKeyB64: Buffer.from(sourceKeys.publicKey).toString('base64'),
      secretKeyB64: Buffer.from(sourceKeys.secretKey).toString('base64')
    })
    const registry = '[]'
    writeFileSync(join(source, DEVICE_REGISTRY_FILENAME), registry)
    writeFileSync(join(source, E2EE_KEYPAIR_FILENAME), sourceKeypair)
    const staging = join(target, '.orca-mobile-pairing-migration')
    mkdirSync(staging)
    const stagedKeypair = join(staging, E2EE_KEYPAIR_FILENAME)
    writeFileSync(stagedKeypair, '{')
    writeFileSync(`${stagedKeypair}.tmp`, 'partial-copy')

    migrateMobilePairingUserdata(source, target)
    expect(readFileSync(join(target, E2EE_KEYPAIR_FILENAME), 'utf8')).toBe(sourceKeypair)
    expect(existsSync(join(target, DEVICE_REGISTRY_FILENAME))).toBe(true)
    expect(existsSync(staging)).toBe(false)

    const divergentSource = join(root, 'divergent-source')
    const divergentTarget = join(root, 'divergent-target')
    mkdirSync(divergentSource)
    mkdirSync(divergentTarget)
    const divergentKeys = nacl.box.keyPair()
    const divergentKeypair = JSON.stringify({
      v: 1,
      publicKeyB64: Buffer.from(divergentKeys.publicKey).toString('base64'),
      secretKeyB64: Buffer.from(divergentKeys.secretKey).toString('base64')
    })
    writeFileSync(join(divergentSource, DEVICE_REGISTRY_FILENAME), registry)
    writeFileSync(join(divergentSource, E2EE_KEYPAIR_FILENAME), divergentKeypair)
    const divergentStaging = join(divergentTarget, '.orca-mobile-pairing-migration')
    mkdirSync(divergentStaging)
    writeFileSync(join(divergentStaging, DEVICE_REGISTRY_FILENAME), registry)
    writeFileSync(join(divergentStaging, E2EE_KEYPAIR_FILENAME), sourceKeypair)

    expect(() => migrateMobilePairingUserdata(divergentSource, divergentTarget)).toThrow(
      'source changed during migration'
    )
    expect(existsSync(join(divergentTarget, E2EE_KEYPAIR_FILENAME))).toBe(false)
    expect(readFileSync(join(divergentStaging, E2EE_KEYPAIR_FILENAME), 'utf8')).toBe(sourceKeypair)
  })

  it('does not promote registry-only staged residue without a valid E2EE identity', async () => {
    const { migrateMobilePairingUserdata } = await import('./mobile-pairing-userdata-migration')
    const staging = join(canonicalDir, '.orca-mobile-pairing-migration')
    mkdirSync(staging)
    writeFileSync(join(staging, DEVICE_REGISTRY_FILENAME), '[]')

    expect(() => migrateMobilePairingUserdata(lateDir, canonicalDir)).toThrow('valid E2EE identity')
    expect(existsSync(join(canonicalDir, DEVICE_REGISTRY_FILENAME))).toBe(false)
    expect(existsSync(join(staging, DEVICE_REGISTRY_FILENAME))).toBe(true)
  })

  it('repairs a stage-only target-prefix cut without a source directory', async () => {
    const { migrateMobilePairingUserdata } = await import('./mobile-pairing-userdata-migration')
    const source = join(root, 'stage-only-source')
    const target = join(root, 'stage-only-target')
    mkdirSync(source)
    mkdirSync(target)
    const keys = nacl.box.keyPair()
    const installationId = 'stage-only-recovery-0001'
    const active = JSON.stringify({
      v: 2,
      publicKeyB64: Buffer.from(keys.publicKey).toString('base64'),
      secretKeyB64: Buffer.from(keys.secretKey).toString('base64'),
      installationId
    })
    const marker = JSON.stringify({ v: 1, installationId })
    const staging = join(target, '.orca-mobile-pairing-migration')
    mkdirSync(staging)
    writeFileSync(join(target, E2EE_KEYPAIR_FILENAME), active)
    writeFileSync(join(staging, E2EE_IDENTITY_MARKER_FILENAME), marker)

    migrateMobilePairingUserdata(source, target)

    expect(readFileSync(join(target, E2EE_KEYPAIR_FILENAME), 'utf8')).toBe(active)
    expect(readFileSync(join(target, E2EE_IDENTITY_MARKER_FILENAME), 'utf8')).toBe(marker)
    expect(existsSync(staging)).toBe(false)
  })

  it('fails closed on divergent valid stage-only target and staged identities', async () => {
    const { migrateMobilePairingUserdata } = await import('./mobile-pairing-userdata-migration')
    const source = join(root, 'stage-only-divergent-source')
    const target = join(root, 'stage-only-divergent-target')
    mkdirSync(source)
    mkdirSync(target)
    const targetKeys = nacl.box.keyPair()
    const stagedKeys = nacl.box.keyPair()
    const targetId = 'stage-only-target-0001'
    const stagedId = 'stage-only-stage-0001'
    writeFileSync(
      join(target, E2EE_KEYPAIR_FILENAME),
      JSON.stringify({
        v: 2,
        publicKeyB64: Buffer.from(targetKeys.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(targetKeys.secretKey).toString('base64'),
        installationId: targetId
      })
    )
    writeFileSync(
      join(target, E2EE_IDENTITY_MARKER_FILENAME),
      JSON.stringify({ v: 1, installationId: targetId })
    )
    const staging = join(target, '.orca-mobile-pairing-migration')
    mkdirSync(staging)
    writeFileSync(
      join(staging, E2EE_KEYPAIR_FILENAME),
      JSON.stringify({
        v: 2,
        publicKeyB64: Buffer.from(stagedKeys.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(stagedKeys.secretKey).toString('base64'),
        installationId: stagedId
      })
    )
    writeFileSync(
      join(staging, E2EE_IDENTITY_MARKER_FILENAME),
      JSON.stringify({ v: 1, installationId: stagedId })
    )

    expect(() => migrateMobilePairingUserdata(source, target)).toThrow('target conflicts')
    expect(existsSync(join(target, E2EE_KEYPAIR_FILENAME))).toBe(true)
    expect(existsSync(staging)).toBe(true)
  })

  it('skips legacy migration when only part of the canonical credential pair exists', async () => {
    appState.userData = canonicalDir
    const { initDataPath, migrateMobilePairingDataToCanonicalUserDataPath } =
      await import('../persistence')
    initDataPath()

    appState.userData = lateDir
    const lateDevices = JSON.stringify([
      {
        deviceId: 'late-phone',
        name: 'iPhone',
        token: 'late-token',
        scope: 'mobile',
        pairedAt: 1,
        lastSeenAt: 2
      }
    ])
    const lateKeys = nacl.box.keyPair()
    const lateKeypair = JSON.stringify({
      v: 1,
      publicKeyB64: Buffer.from(lateKeys.publicKey).toString('base64'),
      secretKeyB64: Buffer.from(lateKeys.secretKey).toString('base64')
    })
    const canonicalKeys = nacl.box.keyPair()
    const canonicalKeypair = JSON.stringify({
      v: 1,
      publicKeyB64: Buffer.from(canonicalKeys.publicKey).toString('base64'),
      secretKeyB64: Buffer.from(canonicalKeys.secretKey).toString('base64')
    })
    writeFileSync(join(lateDir, DEVICE_REGISTRY_FILENAME), lateDevices)
    writeFileSync(join(lateDir, E2EE_KEYPAIR_FILENAME), lateKeypair)
    writeFileSync(join(canonicalDir, E2EE_KEYPAIR_FILENAME), canonicalKeypair)

    expect(() => migrateMobilePairingDataToCanonicalUserDataPath(appState.userData)).toThrow(
      'different E2EE identity ownership'
    )

    expect(existsSync(join(canonicalDir, DEVICE_REGISTRY_FILENAME))).toBe(false)
    expect(readFileSync(join(canonicalDir, E2EE_KEYPAIR_FILENAME), 'utf-8')).toBe(canonicalKeypair)
    expect(readFileSync(join(lateDir, DEVICE_REGISTRY_FILENAME), 'utf-8')).toBe(lateDevices)
    expect(readFileSync(join(lateDir, E2EE_KEYPAIR_FILENAME), 'utf-8')).toBe(lateKeypair)
  })

  it('migrates and strictly validates the relay revoke outbox with the lifecycle', async () => {
    appState.userData = canonicalDir
    const { initDataPath, migrateMobilePairingDataToCanonicalUserDataPath } =
      await import('../persistence')
    initDataPath()

    appState.userData = lateDir
    const devices = JSON.stringify([
      {
        deviceId: 'late-phone',
        name: 'iPhone',
        token: 'late-token',
        scope: 'mobile',
        pairedAt: 1,
        lastSeenAt: 2
      }
    ])
    const keys = nacl.box.keyPair()
    const keypair = JSON.stringify({
      v: 1,
      publicKeyB64: Buffer.from(keys.publicKey).toString('base64'),
      secretKeyB64: Buffer.from(keys.secretKey).toString('base64')
    })
    const outbox = JSON.stringify([
      {
        relayHostId: 'relay-host',
        relayDeviceId: 'late-phone',
        ownerIdentityKey: 'owner-profile',
        reqId: 'revoke-1',
        createdAt: 10
      }
    ])
    writeFileSync(join(lateDir, DEVICE_REGISTRY_FILENAME), devices)
    writeFileSync(join(lateDir, E2EE_KEYPAIR_FILENAME), keypair)
    writeFileSync(join(lateDir, RELAY_REVOKE_OUTBOX_FILENAME), outbox)

    migrateMobilePairingDataToCanonicalUserDataPath(lateDir)

    expect(readFileSync(join(canonicalDir, RELAY_REVOKE_OUTBOX_FILENAME), 'utf8')).toBe(outbox)
    expect(readFileSync(join(lateDir, RELAY_REVOKE_OUTBOX_FILENAME), 'utf8')).toBe(outbox)

    const divergentOutbox = JSON.stringify([
      {
        relayHostId: 'relay-host-2',
        relayDeviceId: 'late-phone',
        ownerIdentityKey: 'owner-profile',
        reqId: 'revoke-2',
        createdAt: 11
      }
    ])
    writeFileSync(join(lateDir, RELAY_REVOKE_OUTBOX_FILENAME), divergentOutbox)
    migrateMobilePairingDataToCanonicalUserDataPath(lateDir)
    expect(readFileSync(join(canonicalDir, RELAY_REVOKE_OUTBOX_FILENAME), 'utf8')).toBe(outbox)
  })

  it('rejects complete source and canonical lifecycles with different key material', async () => {
    appState.userData = canonicalDir
    const { initDataPath, migrateMobilePairingDataToCanonicalUserDataPath } =
      await import('../persistence')
    initDataPath()

    const sourceKeys = nacl.box.keyPair()
    const targetKeys = nacl.box.keyPair()
    const registry = JSON.stringify([
      {
        deviceId: 'phone',
        name: 'iPhone',
        token: 'token',
        scope: 'mobile',
        pairedAt: 1,
        lastSeenAt: 2
      }
    ])
    const record = (keys: nacl.BoxKeyPair): string =>
      JSON.stringify({
        v: 1,
        publicKeyB64: Buffer.from(keys.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(keys.secretKey).toString('base64')
      })
    writeFileSync(join(lateDir, DEVICE_REGISTRY_FILENAME), registry)
    writeFileSync(join(lateDir, E2EE_KEYPAIR_FILENAME), record(sourceKeys))
    writeFileSync(join(canonicalDir, DEVICE_REGISTRY_FILENAME), registry)
    const targetRecord = record(targetKeys)
    writeFileSync(join(canonicalDir, E2EE_KEYPAIR_FILENAME), targetRecord)

    expect(() => migrateMobilePairingDataToCanonicalUserDataPath(lateDir)).toThrow(
      'different E2EE identity ownership'
    )
    expect(readFileSync(join(canonicalDir, E2EE_KEYPAIR_FILENAME), 'utf8')).toBe(targetRecord)
  })

  it('rejects complete current lifecycles with different installation lineage', async () => {
    appState.userData = canonicalDir
    const { initDataPath, migrateMobilePairingDataToCanonicalUserDataPath } =
      await import('../persistence')
    initDataPath()

    const keys = nacl.box.keyPair()
    const keypair = JSON.stringify({
      v: 2,
      publicKeyB64: Buffer.from(keys.publicKey).toString('base64'),
      secretKeyB64: Buffer.from(keys.secretKey).toString('base64')
    })
    const registry = JSON.stringify([
      {
        deviceId: 'phone',
        name: 'iPhone',
        token: 'token',
        scope: 'mobile',
        pairedAt: 1,
        lastSeenAt: 2
      }
    ])
    const writeCurrentLifecycle = (directory: string, installationId: string): string => {
      const record = JSON.stringify({ ...JSON.parse(keypair), installationId })
      writeFileSync(join(directory, DEVICE_REGISTRY_FILENAME), registry)
      writeFileSync(join(directory, E2EE_KEYPAIR_FILENAME), record)
      writeFileSync(
        join(directory, E2EE_IDENTITY_MARKER_FILENAME),
        JSON.stringify({ v: 1, installationId })
      )
      return record
    }
    writeCurrentLifecycle(lateDir, 'source-installation-0001')
    const targetRecord = writeCurrentLifecycle(canonicalDir, 'target-installation-0001')

    expect(() => migrateMobilePairingDataToCanonicalUserDataPath(lateDir)).toThrow(
      'different E2EE identity ownership'
    )
    expect(readFileSync(join(canonicalDir, E2EE_KEYPAIR_FILENAME), 'utf8')).toBe(targetRecord)
  })

  it('moves marker and an in-progress successor stage without activating the stage', async () => {
    appState.userData = canonicalDir
    const {
      initDataPath,
      getCanonicalUserDataPath,
      migrateMobilePairingDataToCanonicalUserDataPath
    } = await import('../persistence')
    initDataPath()

    appState.userData = lateDir
    const { loadOrCreateE2EEKeypair, publishE2EEKeypairResetSuccessor } =
      await import('./e2ee-keypair')
    const { DeviceRegistry } = await import('./device-registry')
    const original = loadOrCreateE2EEKeypair(lateDir)
    new DeviceRegistry(lateDir).addDevice('phone')
    writeFileSync(
      join(lateDir, E2EE_KEYPAIR_BACKUP_FILENAME),
      readFileSync(join(lateDir, E2EE_KEYPAIR_FILENAME))
    )
    const marker = JSON.parse(
      readFileSync(join(lateDir, E2EE_IDENTITY_MARKER_FILENAME), 'utf8')
    ) as { installationId: string }
    const successor = nacl.box.keyPair()
    writeFileSync(
      join(lateDir, E2EE_KEYPAIR_STAGE_FILENAME),
      JSON.stringify({
        v: 2,
        publicKeyB64: Buffer.from(successor.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(successor.secretKey).toString('base64'),
        installationId: marker.installationId,
        purpose: 'reset',
        transactionId: 'migration-reset-0001',
        predecessorPublicKeyB64: original.publicKeyB64
      })
    )

    migrateMobilePairingDataToCanonicalUserDataPath(lateDir)

    expect(existsSync(join(getCanonicalUserDataPath(), E2EE_KEYPAIR_STAGE_FILENAME))).toBe(true)
    expect(existsSync(join(getCanonicalUserDataPath(), E2EE_KEYPAIR_BACKUP_FILENAME))).toBe(true)
    expect(
      JSON.parse(readFileSync(join(getCanonicalUserDataPath(), E2EE_KEYPAIR_FILENAME), 'utf8'))
        .publicKeyB64
    ).toBe(original.publicKeyB64)
    expect(existsSync(join(lateDir, E2EE_KEYPAIR_FILENAME))).toBe(true)
    expect(existsSync(join(lateDir, E2EE_KEYPAIR_BACKUP_FILENAME))).toBe(true)
    expect(() => loadOrCreateE2EEKeypair(getCanonicalUserDataPath())).toThrow(
      'cannot replace an active'
    )
    expect(
      publishE2EEKeypairResetSuccessor(getCanonicalUserDataPath(), {
        transactionId: 'migration-reset-0001',
        oldPublicKeyB64: original.publicKeyB64,
        phase: 'creating-successor'
      }).publicKeyB64
    ).toBe(Buffer.from(successor.publicKey).toString('base64'))
  })

  it('no-ops when the source path equals the canonical path (no rename happened)', async () => {
    // Case-insensitive filesystems (macOS/Windows) resolve both paths to the same
    // dir, so migration must be a clean no-op rather than copy a file onto itself.
    appState.userData = canonicalDir
    const { initDataPath, migrateMobilePairingDataToCanonicalUserDataPath } =
      await import('../persistence')
    initDataPath()

    const devices = JSON.stringify([
      { deviceId: 'phone', name: 'iPhone', token: 't', scope: 'mobile', pairedAt: 1, lastSeenAt: 2 }
    ])
    writeFileSync(join(canonicalDir, DEVICE_REGISTRY_FILENAME), devices)

    expect(() => migrateMobilePairingDataToCanonicalUserDataPath(canonicalDir)).not.toThrow()
    expect(readFileSync(join(canonicalDir, DEVICE_REGISTRY_FILENAME), 'utf-8')).toBe(devices)
  })

  it('no-ops on a fresh install with no legacy pairing files to migrate', async () => {
    appState.userData = canonicalDir
    const { initDataPath, migrateMobilePairingDataToCanonicalUserDataPath } =
      await import('../persistence')
    initDataPath()

    appState.userData = lateDir
    expect(() => migrateMobilePairingDataToCanonicalUserDataPath(appState.userData)).not.toThrow()
    expect(existsSync(join(canonicalDir, DEVICE_REGISTRY_FILENAME))).toBe(false)
    expect(existsSync(join(canonicalDir, E2EE_KEYPAIR_FILENAME))).toBe(false)
  })

  it('a previously paired device is still found after a restart on the canonical path', async () => {
    // First launch: pair a device while userData resolves to the canonical path.
    appState.userData = canonicalDir
    {
      const { initDataPath, getCanonicalUserDataPath } = await import('../persistence')
      initDataPath()
      appState.userData = lateDir
      const { DeviceRegistry } = await import('./device-registry')
      new DeviceRegistry(getCanonicalUserDataPath()).addDevice('iPhone')
    }

    // Second launch (e.g. after an update): fresh module state, path captured again.
    vi.resetModules()
    appState.userData = canonicalDir
    const { initDataPath, getCanonicalUserDataPath } = await import('../persistence')
    initDataPath()
    appState.userData = lateDir
    const { DeviceRegistry } = await import('./device-registry')
    const registry = new DeviceRegistry(getCanonicalUserDataPath())

    expect(registry.listDevices().map((d) => d.name)).toContain('iPhone')
  })
})
