import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, realpath, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CURSOR_REMOTE_MAX_AGGREGATE_BYTES,
  CURSOR_SIDECAR_MAX_BYTES
} from '../../shared/cursor-sidecar-scan'
import { startSpan } from '../observability/tracer'
import { processLocalCursorCandidates } from './session-scanner-cursor-local-pipeline'
import { createSessionParseStats } from './session-scanner-parse-cache'
import type {
  FileWithMtime,
  SessionFileCandidate,
  SessionFileDiscovery
} from './session-scanner-types'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Cursor verified-read budgets by storage context', () => {
  it('does not let native reads consume the WSL ingress budget', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-cursor-storage-budget-'))
    roots.push(root)
    const nativeRoot = join(root, 'native', '.cursor', 'chats')
    const wslRoot = join(root, 'wsl', '.cursor', 'chats')
    const nativePayloadBytes = CURSOR_SIDECAR_MAX_BYTES - 44
    const nativeFileCount = Math.floor(CURSOR_REMOTE_MAX_AGGREGATE_BYTES / nativePayloadBytes)
    const wslPayloadBytes = 5_000
    const nativePayload = sidecarPayload(nativePayloadBytes)
    const nativeFiles: FileWithMtime[] = []
    expect(nativePayloadBytes * nativeFileCount + wslPayloadBytes).toBeGreaterThan(
      CURSOR_REMOTE_MAX_AGGREGATE_BYTES
    )

    for (let index = 0; index < nativeFileCount; index += 1) {
      nativeFiles.push(
        await addSession(
          nativeRoot,
          `native-${String(index).padStart(3, '0')}`,
          nativePayload,
          10_000
        )
      )
    }
    const wslFile = await addSession(wslRoot, 'wsl-session', sidecarPayload(wslPayloadBytes), 1_000)
    const discoveries = [
      sidecarDiscovery('native', nativeRoot, await realpath(nativeRoot), nativeFiles),
      sidecarDiscovery('wsl:ubuntu', wslRoot, await realpath(wslRoot), [wslFile])
    ]
    const span = startSpan('cursor-storage-budget-test')
    const issues = []

    try {
      const result = await processLocalCursorCandidates({
        candidates: discoveries.flatMap(discoveryCandidates),
        discoveries,
        executionHostId: 'local',
        issues,
        limit: 100,
        parseStats: createSessionParseStats(),
        platform: 'linux',
        scopeLimit: 100,
        span
      })

      expect(issues).toEqual([])
      expect(result.sessions.map((session) => session.filePath)).toContain(wslFile.path)
      expect(discoveries[0].cursorDiscoveryCounters?.returnedBytes).toBe(
        nativePayloadBytes * nativeFileCount
      )
      expect(discoveries[1].cursorDiscoveryCounters?.returnedBytes).toBe(wslPayloadBytes)
      expect(
        discoveries.map((discovery) => discovery.cursorDiscoveryTruncated?.sidecarBytes)
      ).toEqual([false, false])
    } finally {
      span.end()
    }
  }, 30_000)
})

function sidecarDiscovery(
  storageKey: string,
  rootDir: string,
  expectedRootRealPath: string,
  files: FileWithMtime[]
): SessionFileDiscovery {
  return {
    agent: 'cursor',
    cursorDiscoveryCounters: {
      boundedReads: 0,
      bucketReaddir: 0,
      elapsedMs: 0,
      fileLstat: 0,
      returnedBytes: 0,
      rootReaddir: 0,
      scopeRealpath: 0
    },
    cursorDiscoveryTruncated: {
      buckets: false,
      scopePaths: false,
      sessionDirs: false,
      sidecarBytes: false
    },
    cursorExpectedRootRealPath: expectedRootRealPath,
    cursorLayout: 'sidecar',
    cursorStorageContextKey: storageKey,
    files,
    rootDir
  }
}

function discoveryCandidates(discovery: SessionFileDiscovery): SessionFileCandidate[] {
  return discovery.files.map((file) => ({
    agent: 'cursor',
    codexHome: null,
    cursorExpectedRootRealPath: discovery.cursorExpectedRootRealPath,
    cursorLayout: 'sidecar',
    cursorStorageContextKey: discovery.cursorStorageContextKey,
    file
  }))
}

async function addSession(
  chatsDir: string,
  sessionId: string,
  content: string,
  mtimeMs: number
): Promise<FileWithMtime> {
  const bucket = createHash('md5').update(sessionId).digest('hex')
  const sessionDir = join(chatsDir, bucket, sessionId)
  const metaPath = join(sessionDir, 'meta.json')
  const storePath = join(sessionDir, 'store.db')
  await mkdir(sessionDir, { recursive: true })
  await Promise.all([writeFile(metaPath, content), writeFile(storePath, '')])
  const timestamp = new Date(mtimeMs)
  await Promise.all([
    utimes(metaPath, timestamp, timestamp),
    utimes(storePath, timestamp, timestamp)
  ])
  const [meta, store] = await Promise.all([lstat(metaPath), lstat(storePath)])
  return {
    cursorStoreMtimeMs: store.mtimeMs,
    dev: meta.dev,
    ino: meta.ino,
    modifiedAt: meta.mtime.toISOString(),
    mtimeMs: meta.mtimeMs,
    nlink: meta.nlink,
    path: metaPath,
    sizeBytes: meta.size
  }
}

function sidecarPayload(byteLength: number): string {
  const prefix = '{"createdAtMs":1,"updatedAtMs":2,"hasConversation":true,"title":"session","pad":"'
  const suffix = '"}'
  return `${prefix}${'a'.repeat(byteLength - Buffer.byteLength(prefix + suffix))}${suffix}`
}
