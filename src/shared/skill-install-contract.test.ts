import { describe, expect, it } from 'vitest'
import { SkillInstallRequestSchema, SkillInstallResultSchema } from './skill-install-contract'

const packageIdentity = {
  packageId: 'package_1',
  versionId: 'version_1',
  packageDigest: 'a'.repeat(64),
  archiveSha256: 'b'.repeat(64),
  compressedBytes: 128
}

describe('skill install wire compatibility', () => {
  it('accepts an older client request that omits every additive field', () => {
    expect(
      SkillInstallRequestSchema.parse({
        operationId: 'operation_1',
        package: packageIdentity,
        ingress: {
          kind: 'download-grant',
          url: 'https://storage.googleapis.com/package',
          expiresAt: '2026-08-11T12:00:00.000Z'
        },
        destination: { scope: 'global' }
      })
    ).toMatchObject({ destination: { scope: 'global' } })
  })

  it('accepts an older host result that omits additive failure and placement fields', () => {
    expect(
      SkillInstallResultSchema.parse({
        operationId: 'operation_1',
        status: 'failed',
        name: 'private-skill',
        packageDigest: packageIdentity.packageDigest,
        placements: [
          {
            provider: 'claude',
            path: '/host-owned/path',
            topology: 'provider-alias',
            status: 'failed'
          }
        ]
      })
    ).toMatchObject({ status: 'failed', placements: [{ status: 'failed' }] })
  })
})
