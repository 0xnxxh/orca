import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CURSOR_REMOTE_MAX_BUCKETS,
  CURSOR_REMOTE_MAX_SCOPE_PATHS,
  CURSOR_REMOTE_MAX_SESSION_DIRS
} from '../../shared/cursor-sidecar-scan'
import type { AiVaultScanIssue } from '../../shared/ai-vault-types'
import { discoverLocalCursorSidecarsBounded } from './session-scanner-cursor-local-files'
import { cursorBucketForCwd } from './session-scanner-cursor-paths'
import { scanAiVaultSessions } from './session-scanner'
import { isolatedScanRoots } from './session-scanner-test-fixtures'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function bucketName(seed: string): string {
  return createHash('md5').update(seed).digest('hex')
}

async function addSession(
  chatsDir: string,
  bucket: string,
  sessionId: string,
  meta: Record<string, unknown> = {}
): Promise<string> {
  const sessionDir = join(chatsDir, bucket, sessionId)
  await mkdir(sessionDir, { recursive: true })
  const metaPath = join(sessionDir, 'meta.json')
  await Promise.all([
    writeFile(
      metaPath,
      JSON.stringify({
        createdAtMs: 1_750_000_000_000,
        updatedAtMs: 1_750_000_001_000,
        hasConversation: true,
        title: sessionId,
        ...meta
      })
    ),
    writeFile(join(sessionDir, 'store.db'), '')
  ])
  return metaPath
}

describe('local Cursor sidecar discovery bounds', () => {
  it('keeps ordinary unscoped scans bounded on a 10,000-entry store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-cursor-10k-'))
    tempRoots.push(root)
    const chatsDir = join(root, 'chats')
    const bucketCount = 100
    const sessionsPerBucket = 100
    expect(bucketCount * sessionsPerBucket).toBe(10_000)

    for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
      const bucket = bucketName(`bucket-${bucketIndex}`)
      for (let sessionIndex = 0; sessionIndex < sessionsPerBucket; sessionIndex += 1) {
        await addSession(chatsDir, bucket, `session-${String(sessionIndex).padStart(4, '0')}`, {
          updatedAtMs: 1_750_000_000_000 + bucketIndex * 1_000 + sessionIndex
        })
      }
    }

    const issues: AiVaultScanIssue[] = []
    const baselineStarted = Date.now()
    // Historical unbounded baseline for this shape (1 root + 100 readdirs + 10k×3).
    const baselineOps = 30_101
    const result = await discoverLocalCursorSidecarsBounded({
      chatsDir,
      scopePaths: [],
      issues
    })
    const boundedMs = Date.now() - baselineStarted

    const filesystemOperations =
      result.counters.rootReaddir +
      result.counters.bucketReaddir +
      result.counters.fileLstat +
      result.counters.boundedReads +
      result.counters.scopeRealpath

    const maxBucketReaddirs = Math.min(bucketCount, CURSOR_REMOTE_MAX_BUCKETS)
    const maxSessions = Math.min(bucketCount * sessionsPerBucket, CURSOR_REMOTE_MAX_SESSION_DIRS)
    const maxOps = 1 + maxBucketReaddirs + maxSessions * 2

    expect(result.files.length).toBeLessThanOrEqual(CURSOR_REMOTE_MAX_SESSION_DIRS)
    expect(result.files.length).toBe(maxSessions)
    expect(result.truncated.sessionDirs).toBe(true)
    expect(result.truncated.buckets).toBe(false)
    expect(filesystemOperations).toBeLessThanOrEqual(maxOps)
    expect(filesystemOperations).toBeLessThan(10_000)
    expect(filesystemOperations).toBeLessThan(baselineOps / 3)
    expect(boundedMs).toBeLessThan(30_000)
    expect(issues.some((issue) => issue.message.includes('session directories'))).toBe(true)
  }, 120_000)

  it('surfaces an exact scoped bucket outside the unscoped retention window', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-cursor-scope-'))
    tempRoots.push(root)
    const roots = isolatedScanRoots(root)
    const workspace = join(root, 'folder-workspace')
    await mkdir(workspace, { recursive: true })
    const scopedBucket = cursorBucketForCwd(workspace, 'linux')
    const scopedMeta = await addSession(roots.cursorChatsDir, scopedBucket, 'scoped-session', {
      title: 'In-scope old session',
      updatedAtMs: 1
    })

    for (let index = 0; index < 30; index += 1) {
      await addSession(roots.cursorChatsDir, bucketName(`foreign-${index}`), `foreign-${index}`, {
        title: `Foreign ${index}`,
        updatedAtMs: 1_000_000 + index
      })
    }

    const result = await scanAiVaultSessions({
      ...roots,
      platform: 'linux',
      executionHostId: 'local',
      scopePaths: [workspace],
      limit: 5
    })

    expect(result.sessions.some((session) => session.filePath === scopedMeta)).toBe(true)
    expect(result.sessions.find((session) => session.filePath === scopedMeta)).toMatchObject({
      cwd: workspace,
      title: 'In-scope old session'
    })
  })

  it('keeps Linux path flavor for WSL scopes even when process.platform is win32-like', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-cursor-wsl-scope-'))
    tempRoots.push(root)
    const chatsDir = join(root, 'chats')
    const linuxScope = '/home/ada/repo'
    const scopedBucket = cursorBucketForCwd(linuxScope, 'linux')
    const scopedMeta = await addSession(chatsDir, scopedBucket, 'wsl-scoped', {
      title: 'WSL scoped',
      updatedAtMs: 1
    })

    // Fill beyond the unscoped bucket cap with lexicographically earlier names.
    for (let index = 0; index < CURSOR_REMOTE_MAX_BUCKETS + 8; index += 1) {
      const foreign = `0${String(index).padStart(31, '0')}`
      expect(foreign < scopedBucket || !BUCKET_PATTERN_TEST(foreign)).toBeTruthy()
      await addSession(chatsDir, bucketName(`early-${index}`), `early-${index}`, {
        updatedAtMs: 1_000_000 + index
      })
    }
    // Ensure at least 256 foreign buckets exist with md5 names; pad if needed.
    for (let index = 0; index < CURSOR_REMOTE_MAX_BUCKETS + 8; index += 1) {
      await addSession(
        chatsDir,
        bucketName(`pad-foreign-${String(index).padStart(4, '0')}`),
        `pad-${index}`,
        { updatedAtMs: 2_000_000 + index }
      )
    }

    const result = await discoverLocalCursorSidecarsBounded({
      chatsDir,
      scopePaths: [linuxScope],
      issues: [],
      pathPlatform: 'linux'
    })

    expect(result.files.some((file) => file.path === scopedMeta)).toBe(true)
    expect(result.evidenceByPath.get(scopedMeta)).toMatchObject({
      kind: 'scope-bucket',
      cwd: linuxScope,
      bucket: scopedBucket
    })
    expect(result.truncated.buckets).toBe(true)
  })

  it('detects scope-path truncation before applying the cap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-cursor-scope-trunc-'))
    tempRoots.push(root)
    const chatsDir = join(root, 'chats')
    await mkdir(chatsDir, { recursive: true })
    const scopePaths = Array.from(
      { length: CURSOR_REMOTE_MAX_SCOPE_PATHS + 3 },
      (_, index) => `/home/ada/projects/repo-${index}`
    )

    const result = await discoverLocalCursorSidecarsBounded({
      chatsDir,
      scopePaths,
      issues: [],
      pathPlatform: 'linux'
    })

    expect(result.truncated.scopePaths).toBe(true)
  })

  it('honors cancellation during bounded local discovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-cursor-cancel-'))
    tempRoots.push(root)
    const chatsDir = join(root, 'chats')
    for (let index = 0; index < 40; index += 1) {
      await addSession(chatsDir, bucketName(`cancel-${index}`), `session-${index}`)
    }
    const controller = new AbortController()
    controller.abort()
    await expect(
      discoverLocalCursorSidecarsBounded({
        chatsDir,
        scopePaths: [],
        issues: [],
        signal: controller.signal
      })
    ).rejects.toThrow('cursor_sidecar_scan_cancelled')
  })

  it.skipIf(process.platform === 'win32')(
    'rejects symlink session dirs without opening store contents',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'orca-cursor-symlink-'))
      tempRoots.push(root)
      const chatsDir = join(root, 'chats')
      const bucket = bucketName('symlink-bucket')
      await addSession(chatsDir, bucket, 'real-session')
      const linked = join(chatsDir, bucket, 'linked-session')
      await mkdir(linked, { recursive: true })
      await Promise.all([
        symlink(join(chatsDir, bucket, 'real-session', 'meta.json'), join(linked, 'meta.json')),
        writeFile(join(linked, 'store.db'), 'should-not-be-read-as-content')
      ])

      const issues: AiVaultScanIssue[] = []
      const result = await discoverLocalCursorSidecarsBounded({
        chatsDir,
        scopePaths: [],
        issues
      })

      expect(result.files.map((file) => file.path)).toEqual([
        join(chatsDir, bucket, 'real-session', 'meta.json')
      ])
      expect(result.counters.boundedReads).toBe(0)
    }
  )

  it('reports truncation telemetry without recording candidate paths on the counters object', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-cursor-trunc-'))
    tempRoots.push(root)
    const chatsDir = join(root, 'chats')
    for (let index = 0; index < CURSOR_REMOTE_MAX_BUCKETS + 5; index += 1) {
      await addSession(chatsDir, bucketName(`trunc-bucket-${index}`), 'only-session')
    }

    const result = await discoverLocalCursorSidecarsBounded({
      chatsDir,
      scopePaths: [],
      issues: []
    })

    expect(result.truncated.buckets).toBe(true)
    expect(JSON.stringify(result.counters)).not.toContain(chatsDir)
    expect(JSON.stringify(result.truncated)).not.toContain(chatsDir)
  })
})

function BUCKET_PATTERN_TEST(value: string): boolean {
  return /^[0-9a-f]{32}$/u.test(value)
}
