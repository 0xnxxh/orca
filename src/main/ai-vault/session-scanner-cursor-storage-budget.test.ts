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
  it('stops after the first verified read when cancellation lands during parsing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-cursor-parse-cancel-'))
    roots.push(root)
    const chatsRoot = join(root, '.cursor', 'chats')
    const files = await Promise.all([
      addSession(chatsRoot, 'first-session', sidecarPayload(5_000), 2_000),
      addSession(chatsRoot, 'second-session', sidecarPayload(5_000), 1_000)
    ])
    const discovery = sidecarDiscovery('native', chatsRoot, await realpath(chatsRoot), files)
    let cancellationChecks = 0
    const signal = {
      get aborted() {
        cancellationChecks += 1
        return cancellationChecks > 1
      }
    } as AbortSignal
    const span = startSpan('cursor-parse-cancel-test')

    try {
      await expect(
        processLocalCursorCandidates({
          candidates: discoveryCandidates(discovery),
          discoveries: [discovery],
          executionHostId: 'local',
          issues: [],
          limit: 20,
          parseStats: createSessionParseStats(),
          platform: 'linux',
          scopeLimit: 20,
          signal,
          span
        })
      ).rejects.toMatchObject({ name: 'AbortError' })
      expect(discovery.cursorDiscoveryCounters?.boundedReads).toBe(1)
    } finally {
      span.end()
    }
  })

  it('charges a raced verified read and skips later candidates after budget exhaustion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-cursor-storage-race-'))
    roots.push(root)
    const chatsRoot = join(root, '.cursor', 'chats')
    const fillerBytes = CURSOR_SIDECAR_MAX_BYTES - 100
    const fillerCount = Math.floor(CURSOR_REMOTE_MAX_AGGREGATE_BYTES / fillerBytes)
    const fillerFiles: FileWithMtime[] = []
    for (let index = 0; index < fillerCount; index += 1) {
      fillerFiles.push(
        await addSession(
          chatsRoot,
          `filler-${String(index).padStart(3, '0')}`,
          sidecarPayload(fillerBytes),
          10_000
        )
      )
    }
    const racedFiles = await Promise.all([
      addSession(chatsRoot, 'race-first', sidecarPayload(1_000), 2_000),
      addSession(chatsRoot, 'race-second', sidecarPayload(1_000), 1_000)
    ])
    const racedBytes = 8_000
    await Promise.all(racedFiles.map((file) => writeFile(file.path, sidecarPayload(racedBytes))))
    const files = [...fillerFiles, ...racedFiles]
    const discovery = sidecarDiscovery('native', chatsRoot, await realpath(chatsRoot), files)
    const span = startSpan('cursor-storage-race-test')

    try {
      const result = await processLocalCursorCandidates({
        candidates: discoveryCandidates(discovery),
        discoveries: [discovery],
        executionHostId: 'local',
        issues: [],
        limit: 100,
        parseStats: createSessionParseStats(),
        platform: 'linux',
        scopeLimit: 100,
        span
      })
      const fillerTotal = fillerBytes * fillerCount

      expect(result.sessions).toHaveLength(fillerCount)
      expect(discovery.cursorDiscoveryCounters?.boundedReads).toBe(fillerCount + 1)
      expect(discovery.cursorDiscoveryCounters?.returnedBytes).toBe(fillerTotal + racedBytes)
      expect(discovery.cursorDiscoveryCounters?.returnedBytes).toBeGreaterThan(
        CURSOR_REMOTE_MAX_AGGREGATE_BYTES
      )
      expect(discovery.cursorDiscoveryTruncated?.sidecarBytes).toBe(true)
    } finally {
      span.end()
    }
  }, 30_000)

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
