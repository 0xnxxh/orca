/*
 * macOS reports OS-canonical paths (symlinks resolved, on-disk casing), which
 * land outside the root the caller subscribed with. Consumers derive a
 * worktree-relative path from that root and drop anything outside it, so an
 * agent's edit under a symlinked worktree never reloaded the editor tab, never
 * refreshed the File Explorer, and never re-ran Source Control status.
 *
 * The rewrite lives in the supervisor, the one boundary every desktop, runtime,
 * and relay watch passes, so assert it there for both subscription entry points.
 */
import type * as NodeFs from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acknowledgeWatcherSubscribe,
  currentWatcherChild,
  FakeWatcherChild
} from './parcel-watcher-process-test-child'

const { forkMock, existsSyncMock, mkdtempSyncMock, parcelSubscribeMock, rmSyncMock } = vi.hoisted(
  () => ({
    forkMock: vi.fn(),
    existsSyncMock: vi.fn(),
    mkdtempSyncMock: vi.fn(() => '/tmp/orca-watcher-canary-rewrite-test'),
    parcelSubscribeMock: vi.fn(),
    rmSyncMock: vi.fn()
  })
)

vi.mock('node:child_process', () => ({ fork: forkMock }))
vi.mock('node:fs', async (importOriginal) => {
  // Why: the supervisor resolves the watched root with realpathSync.native, so
  // keep the real implementation while stubbing the child-launch surface.
  const actual = await importOriginal<typeof NodeFs>()
  return {
    existsSync: existsSyncMock,
    mkdtempSync: mkdtempSyncMock,
    rmSync: rmSyncMock,
    realpathSync: actual.realpathSync
  }
})
vi.mock('@parcel/watcher', () => ({ subscribe: parcelSubscribeMock }))

import {
  disposeWatcherProcess,
  resetRuntimeWatcherProcessForTest,
  resetWatcherProcessForTest,
  subscribeViaRuntimeWatcherProcess,
  subscribeViaWatcherProcess,
  type WatcherProcessEvent
} from './parcel-watcher-process'

type SymlinkedRoot = {
  base: string
  realRoot: string
  linkedRoot: string
}

async function createSymlinkedRoot(): Promise<SymlinkedRoot> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'watcher-rewrite-')))
  const realRoot = join(base, 'real')
  const linkedRoot = join(base, 'linked')
  await mkdir(realRoot, { recursive: true })
  await symlink(realRoot, linkedRoot)
  return { base, realRoot, linkedRoot }
}

describe('watcher-process root path rewrite', () => {
  let root: SymlinkedRoot | null = null

  beforeEach(() => {
    resetWatcherProcessForTest()
    resetRuntimeWatcherProcessForTest()
    // Why: these assertions target the forked-process mode that ships, so hide
    // the vitest marker that would route them to the in-process fallback.
    vi.stubEnv('VITEST', '')
    existsSyncMock.mockReturnValue(true)
    forkMock.mockImplementation(() => new FakeWatcherChild())
  })

  afterEach(async () => {
    disposeWatcherProcess()
    resetRuntimeWatcherProcessForTest()
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    if (root) {
      await rm(root.base, { recursive: true, force: true })
      root = null
    }
  })

  async function subscribeAndEmit(
    subscribe: typeof subscribeViaWatcherProcess,
    linkedRoot: string,
    events: WatcherProcessEvent[]
  ): Promise<WatcherProcessEvent[][]> {
    const delivered: WatcherProcessEvent[][] = []
    const pending = subscribe(linkedRoot, (_error, batch) => delivered.push(batch), {})
    const child = currentWatcherChild(forkMock)
    const id = acknowledgeWatcherSubscribe(child)
    await pending
    child.emit('message', { op: 'events', id, events })
    return delivered
  }

  it('rewrites symlink-resolved paths for desktop watches', async () => {
    root = await createSymlinkedRoot()
    const delivered = await subscribeAndEmit(subscribeViaWatcherProcess, root.linkedRoot, [
      { type: 'update', path: join(root.realRoot, 'src', 'agent-edit.ts'), isDirectory: false }
    ])

    expect(delivered).toEqual([
      [
        {
          type: 'update',
          path: join(root.linkedRoot, 'src', 'agent-edit.ts'),
          isDirectory: false
        }
      ]
    ])
  })

  // The runtime pool is also what a relay host uses for every SSH worktree watch.
  it('rewrites symlink-resolved paths for runtime and relay watches', async () => {
    root = await createSymlinkedRoot()
    const delivered = await subscribeAndEmit(subscribeViaRuntimeWatcherProcess, root.linkedRoot, [
      { type: 'create', path: join(root.realRoot, 'docs', 'notes.md') }
    ])

    expect(delivered).toEqual([
      [{ type: 'create', path: join(root.linkedRoot, 'docs', 'notes.md') }]
    ])
  })

  it('leaves an unaliased root untouched', async () => {
    root = await createSymlinkedRoot()
    const eventPath = join(root.realRoot, 'src', 'agent-edit.ts')
    const delivered = await subscribeAndEmit(subscribeViaWatcherProcess, root.realRoot, [
      { type: 'update', path: eventPath, isDirectory: false }
    ])

    expect(delivered).toEqual([[{ type: 'update', path: eventPath, isDirectory: false }]])
  })
})
