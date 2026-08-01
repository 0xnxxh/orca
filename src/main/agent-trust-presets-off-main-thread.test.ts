import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testState = {
  fakeHomeDir: '',
  userDataDir: '',
  workspaceDir: '',
  previousUserDataPath: undefined as string | undefined
}

const syncFsCalls: { name: string; paths: string[] }[] = []
const hangNativeRealpath = { value: false }
// Why: parks the async realpath of specific paths so a synchronous writer can be
// injected at a chosen point of an in-flight async trust write.
const deferredNativeRealpaths: { paths: Set<string>; resume: (() => void)[] } = {
  paths: new Set(),
  resume: []
}

vi.mock('node:fs', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- importOriginal requires inline import()
  const actual = await importOriginal<typeof import('node:fs')>()
  type AnyFn = (...args: unknown[]) => unknown
  type NativeFn = AnyFn & { native?: AnyFn }
  const record = (name: string, args: unknown[]): void => {
    syncFsCalls.push({ name, paths: args.filter((arg) => typeof arg === 'string') })
  }
  const recorded: Record<string, unknown> = { ...actual }
  for (const [name, value] of Object.entries(actual)) {
    if (!name.endsWith('Sync') || typeof value !== 'function') {
      continue
    }
    const original = value as NativeFn
    const wrapper: NativeFn = (...args: unknown[]): unknown => {
      record(name, args)
      return original(...args)
    }
    Object.assign(wrapper, original)
    if (typeof original.native === 'function') {
      const native = original.native
      wrapper.native = (...args: unknown[]): unknown => {
        record(`${name}.native`, args)
        return native(...args)
      }
    }
    recorded[name] = wrapper
  }
  // Why: lets a test model an uninterruptible realpath on a dead network mount.
  const realpath = ((...args: unknown[]) =>
    (actual.realpath as unknown as AnyFn)(...args)) as unknown as typeof actual.realpath
  realpath.native = ((...args: unknown[]) => {
    if (hangNativeRealpath.value) {
      return undefined
    }
    const target = typeof args[0] === 'string' ? args[0] : ''
    if (deferredNativeRealpaths.paths.has(target)) {
      deferredNativeRealpaths.resume.push(() => {
        ;(actual.realpath.native as unknown as AnyFn)(...args)
      })
      return undefined
    }
    return (actual.realpath.native as unknown as AnyFn)(...args)
  }) as unknown as typeof actual.realpath.native
  recorded.realpath = realpath
  return recorded
})

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') {
        return testState.userDataDir
      }
      throw new Error(`unexpected app.getPath(${name})`)
    }
  }
}))

vi.mock('node:os', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- importOriginal requires inline import()
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => testState.fakeHomeDir }
})

const {
  markCodexProjectTrusted,
  markCodexProjectTrustedAsync,
  markCopilotFolderTrusted,
  markCopilotFolderTrustedAsync,
  markCursorWorkspaceTrusted,
  markCursorWorkspaceTrustedAsync
} = await import('./agent-trust-presets')
const { upsertHookTrustEntries } = await import('./codex/config-toml-trust')

function syncCallsTouching(...roots: string[]): string[] {
  return syncFsCalls
    .filter(({ paths }) =>
      paths.some((path) => roots.some((root) => root && path.startsWith(root)))
    )
    .map(({ name, paths }) => `${name}(${paths.join(', ')})`)
}

async function waitForDeferredRealpath(): Promise<void> {
  for (let attempt = 0; attempt < 50 && deferredNativeRealpaths.resume.length === 0; attempt++) {
    await new Promise((fulfill) => setTimeout(fulfill, 0))
  }
}

function releaseDeferredRealpaths(): void {
  const pending = deferredNativeRealpaths.resume.splice(0)
  deferredNativeRealpaths.paths.clear()
  for (const resume of pending) {
    resume()
  }
}

beforeEach(() => {
  testState.fakeHomeDir = realpathSync(mkdtempSync(join(tmpdir(), 'orca-trust-async-home-')))
  testState.userDataDir = realpathSync(mkdtempSync(join(tmpdir(), 'orca-trust-async-data-')))
  testState.workspaceDir = realpathSync(mkdtempSync(join(tmpdir(), 'orca-trust-async-ws-')))
  testState.previousUserDataPath = process.env.ORCA_USER_DATA_PATH
  process.env.ORCA_USER_DATA_PATH = testState.userDataDir
  syncFsCalls.length = 0
  hangNativeRealpath.value = false
  deferredNativeRealpaths.paths.clear()
  deferredNativeRealpaths.resume.length = 0
})

afterEach(() => {
  for (const dir of [testState.fakeHomeDir, testState.userDataDir, testState.workspaceDir]) {
    rmSync(dir, { recursive: true, force: true })
  }
  if (testState.previousUserDataPath === undefined) {
    delete process.env.ORCA_USER_DATA_PATH
  } else {
    process.env.ORCA_USER_DATA_PATH = testState.previousUserDataPath
  }
  testState.previousUserDataPath = undefined
})

function cursorTrustFile(workspacePath: string): string {
  const slug = workspacePath.replace(/^[\\/]+/, '').replace(/[\\/:*?"<>|]+/g, '-')
  return join(testState.fakeHomeDir, '.cursor', 'projects', slug, '.workspace-trusted')
}

function copilotConfigPath(): string {
  return join(testState.fakeHomeDir, '.copilot', 'config.json')
}

function readCopilotTrustedFolders(): unknown[] {
  return JSON.parse(readFileSync(copilotConfigPath(), 'utf-8')).trustedFolders
}

describe('agent trust presets off the main thread', () => {
  it('marks a cursor workspace trusted without touching the workspace synchronously', async () => {
    await markCursorWorkspaceTrustedAsync(testState.workspaceDir)

    expect(syncCallsTouching(testState.workspaceDir)).toEqual([])
    const payload = JSON.parse(readFileSync(cursorTrustFile(testState.workspaceDir), 'utf-8'))
    expect(payload.workspacePath).toBe(testState.workspaceDir)
  })

  it('publishes the cursor trust marker by rename so a reader never sees a partial file', async () => {
    await markCursorWorkspaceTrustedAsync(testState.workspaceDir)

    const trustFile = cursorTrustFile(testState.workspaceDir)
    const renamedInto = syncFsCalls.filter(
      ({ name, paths }) => name === 'renameSync' && paths[1] === trustFile
    )
    expect(renamedInto).toHaveLength(1)
    // Why: the marker path itself must never be opened for writing — cursor-agent
    // reads it concurrently and a torn write reads back as untrusted.
    expect(
      syncFsCalls.filter(({ name, paths }) => name === 'writeFileSync' && paths[0] === trustFile)
    ).toEqual([])
  })

  it('preserves an existing cursor trust marker instead of rewriting it', async () => {
    await markCursorWorkspaceTrustedAsync(testState.workspaceDir)
    const trustFile = cursorTrustFile(testState.workspaceDir)
    const first = readFileSync(trustFile, 'utf-8')

    await markCursorWorkspaceTrustedAsync(testState.workspaceDir)

    expect(readFileSync(trustFile, 'utf-8')).toBe(first)
  })

  it('agrees with the synchronous cursor twin on the marker location', async () => {
    await markCursorWorkspaceTrustedAsync(testState.workspaceDir)
    const asyncMarker = readFileSync(cursorTrustFile(testState.workspaceDir), 'utf-8')

    rmSync(join(testState.fakeHomeDir, '.cursor'), { recursive: true, force: true })
    markCursorWorkspaceTrusted(testState.workspaceDir)

    expect(
      JSON.parse(readFileSync(cursorTrustFile(testState.workspaceDir), 'utf-8'))
    ).toMatchObject({ workspacePath: JSON.parse(asyncMarker).workspacePath })
  })

  it('marks a copilot folder trusted without touching the workspace synchronously', async () => {
    await markCopilotFolderTrustedAsync(testState.workspaceDir)

    expect(syncCallsTouching(testState.workspaceDir)).toEqual([])
    expect(readCopilotTrustedFolders()).toEqual([testState.workspaceDir])
  })

  it('does not lose a trusted folder when two copilot writes overlap', async () => {
    const otherWorkspace = realpathSync(mkdtempSync(join(tmpdir(), 'orca-trust-async-ws2-')))
    try {
      await Promise.all([
        markCopilotFolderTrustedAsync(testState.workspaceDir),
        markCopilotFolderTrustedAsync(otherWorkspace)
      ])

      expect([...readCopilotTrustedFolders()].sort()).toEqual(
        [testState.workspaceDir, otherWorkspace].sort()
      )
    } finally {
      rmSync(otherWorkspace, { recursive: true, force: true })
    }
  })

  it('does not lose a synchronous copilot write that lands mid async trust write', async () => {
    const listedWorkspace = realpathSync(mkdtempSync(join(tmpdir(), 'orca-trust-async-listed-')))
    const syncWorkspace = realpathSync(mkdtempSync(join(tmpdir(), 'orca-trust-async-sync-')))
    mkdirSync(join(testState.fakeHomeDir, '.copilot'), { recursive: true })
    writeFileSync(copilotConfigPath(), JSON.stringify({ trustedFolders: [listedWorkspace] }))
    // Why: park on the already-listed folder's realpath, which is where an async
    // read-modify-write sits between reading the array and writing it back.
    deferredNativeRealpaths.paths.add(listedWorkspace)

    try {
      const trust = markCopilotFolderTrustedAsync(testState.workspaceDir)
      await waitForDeferredRealpath()
      markCopilotFolderTrusted(syncWorkspace)
      releaseDeferredRealpaths()
      await trust

      expect([...readCopilotTrustedFolders()].sort()).toEqual(
        [listedWorkspace, syncWorkspace, testState.workspaceDir].sort()
      )
    } finally {
      rmSync(listedWorkspace, { recursive: true, force: true })
      rmSync(syncWorkspace, { recursive: true, force: true })
    }
  })

  it('marks a codex project trusted without touching the workspace synchronously', async () => {
    await markCodexProjectTrustedAsync(testState.workspaceDir)

    expect(syncCallsTouching(testState.workspaceDir)).toEqual([])
    const config = readFileSync(join(testState.fakeHomeDir, '.codex', 'config.toml'), 'utf-8')
    expect(config).toContain(`[projects."${testState.workspaceDir}"]`)
    expect(config).toContain('trust_level = "trusted"')
  })

  it('agrees with the synchronous codex twin on the trust block it writes', async () => {
    await markCodexProjectTrustedAsync(testState.workspaceDir)
    const configPath = join(testState.fakeHomeDir, '.codex', 'config.toml')
    const fromAsync = readFileSync(configPath, 'utf-8')

    rmSync(join(testState.fakeHomeDir, '.codex'), { recursive: true, force: true })
    markCodexProjectTrusted(testState.workspaceDir)

    expect(readFileSync(configPath, 'utf-8')).toBe(fromAsync)
  })

  // Why: symlinked config.toml gives an async writer an await window (realpath of
  // the link) between its read and its rename — exactly where a sync hook-trust
  // write from codex/hook-service.ts would be silently overwritten.
  it.skipIf(process.platform === 'win32')(
    'does not lose a synchronous hook-trust write that lands mid codex trust write',
    async () => {
      const dotfilesDir = join(testState.fakeHomeDir, 'dotfiles')
      const codexDir = join(testState.fakeHomeDir, '.codex')
      mkdirSync(dotfilesDir, { recursive: true })
      mkdirSync(codexDir, { recursive: true })
      const realConfigPath = join(dotfilesDir, 'config.toml')
      const configPath = join(codexDir, 'config.toml')
      writeFileSync(realConfigPath, 'model = "gpt-5"\n')
      symlinkSync(realConfigPath, configPath)
      deferredNativeRealpaths.paths.add(configPath)

      const trust = markCodexProjectTrustedAsync(testState.workspaceDir)
      await waitForDeferredRealpath()
      upsertHookTrustEntries(configPath, [
        {
          sourcePath: join(codexDir, 'hooks.json'),
          eventLabel: 'session_start',
          groupIndex: 0,
          handlerIndex: 0,
          command: 'orca-hook'
        }
      ])
      releaseDeferredRealpaths()
      await trust

      const content = readFileSync(realConfigPath, 'utf-8')
      expect(content).toContain('trusted_hash')
      expect(content).toContain(`[projects."${testState.workspaceDir}"]`)
      expect(content).toContain('model = "gpt-5"')
    }
  )

  it('keeps the event loop alive while the workspace realpath hangs', async () => {
    hangNativeRealpath.value = true

    const trust = markCodexProjectTrustedAsync(testState.workspaceDir)
    const timerFired = await new Promise<boolean>((fulfill) => {
      setTimeout(() => fulfill(true), 5)
    })

    expect(timerFired).toBe(true)
    expect(syncCallsTouching(testState.workspaceDir, testState.fakeHomeDir)).toEqual([])
    void trust
  })
})
