import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SshTarget } from '../../shared/ssh-types'
import {
  isOpenSshSecurityKeyPrivateKey,
  isOpenSshSecurityKeyPublicKey
} from './ssh-security-key-identity'
import {
  createOpenSshPrivateKeyFixture,
  createOpenSshPublicKeyFixture
} from './ssh-security-key-identity.test-fixture'
import { requiresSystemSshForSecurityKey } from './ssh-transport-selection'

const ED25519_SECURITY_KEY = 'sk-ssh-ed25519@openssh.com'
const ECDSA_SECURITY_KEY = 'sk-ecdsa-sha2-nistp256@openssh.com'
const tempDirs: string[] = []

function createTarget(overrides: Partial<SshTarget> = {}): SshTarget {
  return {
    id: 'target-1',
    label: 'Test Server',
    host: 'example.com',
    port: 22,
    username: 'deploy',
    ...overrides
  }
}

async function writeKey(contents: Buffer, filename = 'security key'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'orca-security-key-'))
  tempDirs.push(directory)
  const keyPath = join(directory, filename)
  await writeFile(keyPath, contents)
  return keyPath
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('isOpenSshSecurityKeyPrivateKey', () => {
  it.each([ED25519_SECURITY_KEY, ECDSA_SECURITY_KEY])(
    'recognizes unencrypted %s keys',
    (keyType) => {
      expect(isOpenSshSecurityKeyPrivateKey(createOpenSshPrivateKeyFixture([keyType]))).toBe(true)
    }
  )

  it('recognizes authenticated encrypted envelopes with a trailing tag', () => {
    const key = createOpenSshPrivateKeyFixture([ED25519_SECURITY_KEY], {
      cipher: 'aes256-gcm@openssh.com',
      authTag: Buffer.alloc(16, 7)
    })
    expect(isOpenSshSecurityKeyPrivateKey(key)).toBe(true)
  })

  it.each([ED25519_SECURITY_KEY, ECDSA_SECURITY_KEY])(
    'recognizes encrypted %s keys from the public section',
    (keyType) => {
      const key = createOpenSshPrivateKeyFixture([keyType], { encrypted: true })
      expect(isOpenSshSecurityKeyPrivateKey(key)).toBe(true)
    }
  )

  it.each(['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa'])(
    'leaves regular %s keys on ssh2',
    (keyType) => {
      expect(isOpenSshSecurityKeyPrivateKey(createOpenSshPrivateKeyFixture([keyType]))).toBe(false)
    }
  )

  it('supports CRLF armored keys', () => {
    const key = createOpenSshPrivateKeyFixture([ED25519_SECURITY_KEY])
    expect(
      isOpenSshSecurityKeyPrivateKey(Buffer.from(key.toString().replaceAll('\n', '\r\n')))
    ).toBe(true)
  })

  it('does not match security-key text outside a valid public-key type', () => {
    const key = createOpenSshPrivateKeyFixture(['ssh-ed25519'], {
      privateBlock: Buffer.from(ED25519_SECURITY_KEY)
    })
    expect(isOpenSshSecurityKeyPrivateKey(key)).toBe(false)
    expect(
      isOpenSshSecurityKeyPrivateKey(Buffer.from(`${ED25519_SECURITY_KEY} AAAA comment`))
    ).toBe(false)
  })

  it.each([ED25519_SECURITY_KEY, ECDSA_SECURITY_KEY])(
    'validates the %s type inside an OpenSSH public key blob',
    (keyType) => {
      expect(isOpenSshSecurityKeyPublicKey(createOpenSshPublicKeyFixture(keyType))).toBe(true)
    }
  )

  it('rejects regular or mismatched OpenSSH public key blobs', () => {
    expect(isOpenSshSecurityKeyPublicKey(createOpenSshPublicKeyFixture('ssh-ed25519'))).toBe(false)
    expect(
      isOpenSshSecurityKeyPublicKey(
        Buffer.from(`${ED25519_SECURITY_KEY} ${Buffer.from('ssh-ed25519').toString('base64')}`)
      )
    ).toBe(false)
  })

  it('rejects malformed and truncated OpenSSH envelopes without throwing', () => {
    const key = createOpenSshPrivateKeyFixture([ED25519_SECURITY_KEY])
    const malformedLength = Buffer.concat([
      Buffer.from('openssh-key-v1\0', 'ascii'),
      Buffer.from([0xff, 0xff, 0xff, 0xff])
    ]).toString('base64')
    const malformedKey = Buffer.from(
      `-----BEGIN OPENSSH PRIVATE KEY-----\n${malformedLength}\n-----END OPENSSH PRIVATE KEY-----\n`
    )
    expect(isOpenSshSecurityKeyPrivateKey(key.subarray(0, -20))).toBe(false)
    expect(isOpenSshSecurityKeyPrivateKey(malformedKey)).toBe(false)
    expect(isOpenSshSecurityKeyPrivateKey(Buffer.from('not a private key'))).toBe(false)
  })
})

describe('requiresSystemSshForSecurityKey', () => {
  it('detects a manual target identity path with spaces', async () => {
    const keyPath = await writeKey(createOpenSshPrivateKeyFixture([ED25519_SECURITY_KEY]))
    await expect(
      requiresSystemSshForSecurityKey(createTarget({ identityFile: keyPath }), null)
    ).resolves.toBe(true)
  })

  it('checks every fresh resolved identity for config-backed targets', async () => {
    const regularKey = await writeKey(createOpenSshPrivateKeyFixture(['ssh-ed25519']), 'regular')
    const securityKey = await writeKey(
      createOpenSshPrivateKeyFixture([ECDSA_SECURITY_KEY], { encrypted: true }),
      'security'
    )
    const target = createTarget({
      source: 'ssh-config',
      configHost: 'workbox',
      identityFile: '/stale/security-key'
    })

    await expect(
      requiresSystemSshForSecurityKey(target, { identityFile: [regularKey, securityKey] })
    ).resolves.toBe(true)
  })

  it.each([ED25519_SECURITY_KEY, ECDSA_SECURITY_KEY])(
    'detects an agent-backed %s identity from its public sidecar',
    async (keyType) => {
      const directory = await mkdtemp(join(tmpdir(), 'orca-security-key-agent-'))
      tempDirs.push(directory)
      const identityPath = join(directory, 'agent-key')
      await writeFile(`${identityPath}.pub`, createOpenSshPublicKeyFixture(keyType))

      await expect(
        requiresSystemSshForSecurityKey(createTarget({ identityFile: identityPath }), null)
      ).resolves.toBe(true)
    }
  )

  it('ignores stale imported identity paths when fresh config has regular keys', async () => {
    const staleKey = await writeKey(createOpenSshPrivateKeyFixture([ED25519_SECURITY_KEY]), 'stale')
    const regularKey = await writeKey(createOpenSshPrivateKeyFixture(['ssh-ed25519']), 'regular')
    const target = createTarget({
      source: 'ssh-config',
      configHost: 'workbox',
      identityFile: staleKey
    })

    await expect(
      requiresSystemSshForSecurityKey(target, { identityFile: [regularKey] })
    ).resolves.toBe(false)
  })

  it('keeps a manual target identity authoritative over resolved defaults', async () => {
    const regularKey = await writeKey(createOpenSshPrivateKeyFixture(['ssh-ed25519']), 'manual')
    const securityKey = await writeKey(
      createOpenSshPrivateKeyFixture([ED25519_SECURITY_KEY]),
      'resolved'
    )

    await expect(
      requiresSystemSshForSecurityKey(
        createTarget({ source: 'manual', identityFile: regularKey }),
        { identityFile: [securityKey] }
      )
    ).resolves.toBe(false)
  })

  it('degrades to ssh2 when identity files are missing or malformed', async () => {
    const malformedKey = await writeKey(Buffer.from('not a key'), 'malformed')
    await expect(
      requiresSystemSshForSecurityKey(createTarget({ identityFile: malformedKey }), null)
    ).resolves.toBe(false)
    await expect(
      requiresSystemSshForSecurityKey(
        createTarget({ identityFile: join(tmpdir(), 'missing-security-key') }),
        null
      )
    ).resolves.toBe(false)
  })
})
