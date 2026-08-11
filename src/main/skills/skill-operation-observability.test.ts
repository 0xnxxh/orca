import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SkillInstallRequest, SkillInstallResult } from '../../shared/skill-install-contract'
import { collectBundle } from '../observability/bundle'
import { _resetTracerForTests, setActiveSink, type TracerSink } from '../observability/tracer'
import { startSkillInstallOperation } from './skill-operation-observability'

type CapturingSink = TracerSink & { records: unknown[] }

const PRIVATE_VALUES = {
  localPath: '/Users/private/team skills/payroll-skill.tar.gz',
  canonicalPath: '/Users/private/.agents/skills/payroll',
  providerPath: '/Users/private/.codex/skills/payroll',
  connectionId: 'private-production-ssh',
  skillName: 'payroll-instructions',
  filename: 'salary-review.md',
  manifest: 'manifest={private-instructions}',
  acl: 'acl=private-user-id',
  shareUrl: 'orca://skill-share/private-share-id',
  uploadPolicy: 'policy=private-signed-upload',
  downloadGrant: 'https://storage.googleapis.com/private-bucket/object?X-Goog-Signature=secret',
  credential: 'authorization=Bearer private-access-token'
}

function request(): SkillInstallRequest {
  return {
    operationId: 'operation-private',
    package: {
      packageId: 'package-123',
      versionId: 'version-456',
      packageDigest: 'a'.repeat(64),
      archiveSha256: 'b'.repeat(64),
      compressedBytes: 1234
    },
    ingress: { kind: 'local-file', path: PRIVATE_VALUES.localPath },
    destination: {
      scope: 'global',
      executionTarget: { kind: 'ssh', connectionId: PRIVATE_VALUES.connectionId }
    }
  }
}

function result(): SkillInstallResult {
  return {
    operationId: 'operation-private',
    status: 'installed',
    name: PRIVATE_VALUES.skillName,
    packageDigest: 'a'.repeat(64),
    canonicalPath: PRIVATE_VALUES.canonicalPath,
    placements: [
      {
        provider: 'codex',
        path: PRIVATE_VALUES.providerPath,
        topology: 'provider-alias',
        status: 'installed'
      }
    ]
  }
}

let sink: CapturingSink
let directory: string

beforeEach(() => {
  sink = {
    records: [],
    push(record) {
      this.records.push(record)
    },
    flush() {},
    close() {}
  }
  directory = mkdtempSync(join(tmpdir(), 'orca-skill-observability-'))
  setActiveSink(sink)
})

afterEach(() => {
  _resetTracerForTests()
  rmSync(directory, { recursive: true, force: true })
})

describe('skill operation observability', () => {
  it('maps install results to bounded labels without private operation data', () => {
    const operation = startSkillInstallOperation(request())
    operation.complete(result())

    const serialized = JSON.stringify(sink.records)
    expect(serialized).toContain('package-123')
    expect(serialized).toContain('version-456')
    expect(serialized).toContain('global-ssh')
    expect(serialized).toContain('provider-alias')
    for (const value of Object.values(PRIVATE_VALUES)) {
      expect(serialized).not.toContain(value)
    }
  })

  it('keeps support bundles free of paths, filenames, share URLs, policies, ACLs, and grants', () => {
    const operation = startSkillInstallOperation({
      ...request(),
      ingress: {
        kind: 'download-grant',
        url: PRIVATE_VALUES.downloadGrant,
        expiresAt: '2030-01-01T00:00:00Z'
      }
    })
    operation.fail(new Error(Object.values(PRIVATE_VALUES).join(' ')))
    const traceFile = join(directory, 'trace.ndjson')
    writeFileSync(traceFile, `${sink.records.map((record) => JSON.stringify(record)).join('\n')}\n`)

    const bundle = collectBundle({
      traceFilePath: traceFile,
      maxFiles: 1,
      appVersion: 'test',
      platform: 'darwin',
      arch: 'arm64',
      osRelease: 'test',
      orcaChannel: 'dev'
    })

    expect(bundle.payload).toContain('skill-install-unknown')
    for (const value of Object.values(PRIVATE_VALUES)) {
      expect(bundle.payload).not.toContain(value)
    }
  })
})
