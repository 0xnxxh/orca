// Why: `orca.yaml` lives at the repo root, which may be a stalled SMB/NFS mount or a FIFO.
// Any *Sync fs call on that path blocks the Electron main thread for as long as the mount
// hangs — no repaint, no menus, no Force Quit (freezes #1 and #9). These tests pin that the
// polled/IPC hook lookups reach the file only through fs/promises.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

const { syncCalls, readFileMock, accessMock } = vi.hoisted(() => ({
  syncCalls: [] as string[],
  readFileMock: vi.fn(),
  accessMock: vi.fn()
}))

// Record every sync fs entry point hooks.ts could reach for; the assertions below
// check that none of them were handed an orca.yaml / .orca path.
vi.mock('node:fs', () => {
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      syncCalls.push(`${name}:${String(args[0])}`)
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }
  return {
    existsSync: vi.fn(record('existsSync')),
    readFileSync: vi.fn(record('readFileSync')),
    statSync: vi.fn(record('statSync')),
    mkdirSync: vi.fn(record('mkdirSync')),
    writeFileSync: vi.fn(record('writeFileSync')),
    chmodSync: vi.fn(record('chmodSync')),
    rmSync: vi.fn(record('rmSync')),
    openSync: vi.fn(record('openSync')),
    accessSync: vi.fn(record('accessSync'))
  }
})

vi.mock('node:fs/promises', () => ({ readFile: readFileMock, access: accessMock }))

vi.mock('./git/runner', () => ({
  gitExecFileSync: vi.fn(() => ''),
  promptGuardShellEnv: (env: NodeJS.ProcessEnv) => env
}))

const REPO = join('/mnt', 'stalled-nas', 'repo')
const YAML = join(REPO, 'orca.yaml')
const ISSUE_COMMAND = join(REPO, '.orca', 'issue-command')

const enoent = (): NodeJS.ErrnoException => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })

beforeEach(() => {
  syncCalls.length = 0
  readFileMock.mockReset()
  accessMock.mockReset()
  accessMock.mockResolvedValue(undefined)
})

describe('orca.yaml hook lookups never issue a sync syscall', () => {
  it('answers hooks:check from one async read with no existsSync probe', async () => {
    readFileMock.mockResolvedValue('scripts:\n  setup: pnpm install\n')

    const { checkOrcaYamlHooks } = await import('./hooks')
    await expect(checkOrcaYamlHooks(REPO)).resolves.toEqual({
      hasHooksFile: true,
      hooks: { scripts: { setup: 'pnpm install' } },
      mayNeedUpdate: false
    })

    expect(syncCalls).toEqual([])
    expect(readFileMock).toHaveBeenCalledTimes(1)
    expect(readFileMock).toHaveBeenCalledWith(YAML, 'utf-8')
  })

  it('reports mayNeedUpdate from the same read instead of a second one', async () => {
    readFileMock.mockResolvedValue('somethingBrandNew:\n  value: 1\n')

    const { checkOrcaYamlHooks } = await import('./hooks')
    await expect(checkOrcaYamlHooks(REPO)).resolves.toEqual({
      hasHooksFile: true,
      hooks: null,
      mayNeedUpdate: true
    })

    expect(syncCalls).toEqual([])
    expect(readFileMock).toHaveBeenCalledTimes(1)
  })

  it('treats ENOENT as the no-hooks branch', async () => {
    readFileMock.mockRejectedValue(enoent())

    const { checkOrcaYamlHooks, loadHooksAsync } = await import('./hooks')
    await expect(checkOrcaYamlHooks(REPO)).resolves.toEqual({
      hasHooksFile: false,
      hooks: null,
      mayNeedUpdate: false
    })
    await expect(loadHooksAsync(REPO)).resolves.toBeNull()
    expect(syncCalls).toEqual([])
  })

  // Why: an unreadable-but-present orca.yaml must still report hasHooksFile, matching
  // the existsSync semantics this replaced — a mode-000 *file* is still there.
  it('still reports the file as present when the read fails for another reason', async () => {
    readFileMock.mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }))

    const { checkOrcaYamlHooks } = await import('./hooks')
    await expect(checkOrcaYamlHooks(REPO)).resolves.toEqual({
      hasHooksFile: true,
      hooks: null,
      mayNeedUpdate: false
    })
    expect(accessMock).toHaveBeenCalledWith(YAML)
    expect(syncCalls).toEqual([])
  })

  // Why: existsSync is access(F_OK), which is FALSE for EACCES/ELOOP/EIO — a repo directory at
  // mode 000 fails readFile with EACCES but reported hasHooksFile: false before the async
  // conversion. Mapping every non-ENOENT code to exists:true flipped hooks:check for those.
  it.each([['EACCES'], ['ELOOP'], ['EIO']])(
    'reports no hooks file when the path itself is unreachable (%s)',
    async (code) => {
      readFileMock.mockRejectedValue(Object.assign(new Error(code), { code }))
      accessMock.mockRejectedValue(Object.assign(new Error(code), { code }))

      const { checkOrcaYamlHooks } = await import('./hooks')
      await expect(checkOrcaYamlHooks(REPO)).resolves.toEqual({
        hasHooksFile: false,
        hooks: null,
        mayNeedUpdate: false
      })
      expect(syncCalls).toEqual([])
    }
  )

  it('classifies an absent file without a second syscall', async () => {
    readFileMock.mockRejectedValue(enoent())

    const { checkOrcaYamlHooks } = await import('./hooks')
    await expect(checkOrcaYamlHooks(REPO)).resolves.toMatchObject({ hasHooksFile: false })
    expect(accessMock).not.toHaveBeenCalled()
  })

  it('resolves the issue command without probing either path synchronously', async () => {
    readFileMock.mockImplementation(async (path: string) => {
      if (path === ISSUE_COMMAND) {
        throw enoent()
      }
      return 'issueCommand: |\n  gh issue develop\n'
    })

    const { readIssueCommandAsync } = await import('./hooks')
    await expect(readIssueCommandAsync(REPO)).resolves.toEqual({
      localContent: null,
      sharedContent: 'gh issue develop',
      effectiveContent: 'gh issue develop',
      localFilePath: ISSUE_COMMAND,
      source: 'shared'
    })

    expect(syncCalls).toEqual([])
  })

  it('keeps the event loop alive while the orca.yaml read is stuck forever', async () => {
    // Why: a hung mount cannot be bounded, but it must not stop timers from firing —
    // that is the difference between "one stale panel" and "the whole app is frozen".
    readFileMock.mockReturnValue(new Promise(() => {}))

    const { checkOrcaYamlHooks } = await import('./hooks')
    let settled = false
    void checkOrcaYamlHooks(REPO).then(() => {
      settled = true
    })

    const timerFired = await new Promise<boolean>((resolve) => {
      setTimeout(() => {
        resolve(true)
      }, 1)
    })

    expect(timerFired).toBe(true)
    expect(settled).toBe(false)
    expect(syncCalls).toEqual([])
  })
})
