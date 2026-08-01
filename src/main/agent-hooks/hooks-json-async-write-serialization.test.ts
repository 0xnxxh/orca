import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import type * as NodeFsPromisesModule from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type * as NodeOsModule from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeHooksJsonAsync, writeManagedScriptAsync } from './hooks-json-async-write'

// Why: the single main thread used to serialize every tmp->rename for free.
// Async writes must keep that ordering or two overlapping installs can publish
// their renames out of order and leave the older config on disk.
const state = vi.hoisted(() => ({ home: '' }))

// Why: without a stall the writers finish in call order anyway, so the test
// would pass with no serialization at all. Delaying only the first rename makes
// an unserialized second writer overtake it.
const renameGate = vi.hoisted(() => ({ delayFirstRenameMs: 0, renames: 0 }))

// Why: chmod 000 is not a portable way to make a read fail (root ignores it,
// Windows has no such mode), so inject the EACCES the guard has to survive.
const readGate = vi.hoisted(() => ({ failPath: '' }))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeOsModule>()
  const patched = { ...actual, homedir: () => state.home }
  return { ...patched, default: patched }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromisesModule>()
  const rename = async (from: string, to: string): Promise<void> => {
    renameGate.renames += 1
    if (renameGate.renames === 1 && renameGate.delayFirstRenameMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, renameGate.delayFirstRenameMs))
    }
    await actual.rename(from, to)
  }
  const readFile = (path: unknown, ...rest: unknown[]): unknown => {
    if (readGate.failPath !== '' && path === readGate.failPath) {
      return Promise.reject(Object.assign(new Error(`EACCES: ${String(path)}`), { code: 'EACCES' }))
    }
    return (actual.readFile as (...args: unknown[]) => unknown)(path, ...rest)
  }
  const patched = { ...actual, readFile, rename }
  return { ...patched, default: patched }
})

describe('async hooks.json writes stay serialized per path', () => {
  beforeEach(async () => {
    state.home = await mkdtemp(join(tmpdir(), 'orca-hooks-write-'))
    renameGate.delayFirstRenameMs = 0
    renameGate.renames = 0
    readGate.failPath = ''
  })

  afterEach(async () => {
    readGate.failPath = ''
    await rm(state.home, { recursive: true, force: true })
  })

  it('applies overlapping writes to the same path in call order', async () => {
    const configPath = join(state.home, 'settings.json')
    const writes = Array.from({ length: 8 }, (_, index) =>
      writeHooksJsonAsync(configPath, { generation: index })
    )
    await Promise.all(writes)

    const written = JSON.parse(await readFile(configPath, 'utf-8'))
    expect(written.generation).toBe(7)
    expect(await readdir(state.home)).toEqual(
      expect.arrayContaining(['settings.json', 'settings.json.bak'])
    )
    // Why: a torn write leaves a `.tmp` behind; the finally-unlink must always run.
    expect((await readdir(state.home)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('leaves the previous config recoverable in the rolling backup', async () => {
    const configPath = join(state.home, 'settings.json')
    await writeHooksJsonAsync(configPath, { hooks: { Stop: [] } })
    await writeHooksJsonAsync(configPath, { hooks: { Stop: [{ command: 'next' }] } })

    const backup = JSON.parse(await readFile(`${configPath}.bak`, 'utf-8'))
    expect(backup.hooks.Stop).toEqual([])
  })

  it('skips the write and the backup rotation when content is unchanged', async () => {
    const configPath = join(state.home, 'settings.json')
    await writeHooksJsonAsync(configPath, { hooks: {} })
    await writeHooksJsonAsync(configPath, { hooks: {} })

    await expect(readFile(`${configPath}.bak`, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('still backs up and keeps the mode of a config it could not read', async () => {
    const configPath = join(state.home, 'settings.json')
    await writeHooksJsonAsync(configPath, { hooks: { Stop: [] } })
    const { chmod, stat } = await import('node:fs/promises')
    if (process.platform !== 'win32') {
      await chmod(configPath, 0o600)
    }

    readGate.failPath = configPath
    await writeHooksJsonAsync(
      configPath,
      { hooks: { Stop: [{ command: 'next' }] } },
      {
        preserveMode: true
      }
    )
    readGate.failPath = ''

    // A read that fails for EACCES/EIO is not a missing file: the sync twin
    // gates both of these on existsSync, which still says the file is there.
    expect(JSON.parse(await readFile(`${configPath}.bak`, 'utf-8')).hooks.Stop).toEqual([])
    if (process.platform !== 'win32') {
      expect((await stat(configPath)).mode & 0o777).toBe(0o600)
    }
  })

  it('rewrites a managed script whose content drifted and keeps it executable', async () => {
    const scriptPath = join(state.home, '.orca', 'agent-hooks', 'probe-hook.sh')
    await writeManagedScriptAsync(scriptPath, '#!/bin/sh\necho one\n')
    await writeManagedScriptAsync(scriptPath, '#!/bin/sh\necho two\n')

    expect(await readFile(scriptPath, 'utf-8')).toBe('#!/bin/sh\necho two\n')
    expect(
      (await readdir(join(state.home, '.orca', 'agent-hooks'))).filter((name) =>
        name.endsWith('.tmp')
      )
    ).toEqual([])
  })

  it('follows a symlinked config to its real path instead of replacing the link', async () => {
    const { symlink } = await import('node:fs/promises')
    const realPath = join(state.home, 'dotfiles-settings.json')
    const linkPath = join(state.home, 'settings.json')
    await writeFile(realPath, '{}\n', 'utf-8')
    await symlink(realPath, linkPath)

    await writeHooksJsonAsync(linkPath, { hooks: { Stop: [] } })

    const { lstat } = await import('node:fs/promises')
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true)
    expect(JSON.parse(await readFile(realPath, 'utf-8')).hooks).toEqual({ Stop: [] })
  })
})

describe('a stalled publish still holds the per-path critical section', () => {
  beforeEach(async () => {
    state.home = await mkdtemp(join(tmpdir(), 'orca-hooks-install-'))
    renameGate.delayFirstRenameMs = 0
    renameGate.renames = 0
  })

  afterEach(async () => {
    renameGate.delayFirstRenameMs = 0
    await rm(state.home, { recursive: true, force: true })
  })

  it('does not let a later write overtake a rename parked on a slow mount', async () => {
    const configPath = join(state.home, 'settings.json')
    renameGate.delayFirstRenameMs = 60

    await Promise.all([
      writeHooksJsonAsync(configPath, { generation: 0 }),
      writeHooksJsonAsync(configPath, { generation: 1 })
    ])

    // Unserialized, the second writer reads before the first rename lands, then
    // publishes first — leaving generation 0 on disk with no backup at all.
    expect(JSON.parse(await readFile(configPath, 'utf-8')).generation).toBe(1)
    expect(JSON.parse(await readFile(`${configPath}.bak`, 'utf-8')).generation).toBe(0)
  })

  // Why: a second per-path chain in this module could not see a write the
  // codex-accounts chain already holds, so both writers must use the same map.
  it('shares the critical section with the atomic-write chain in codex-accounts', async () => {
    const configPath = join(state.home, 'settings.json')
    const { serializeAtomicFileWrite, writeFileAtomicallyAsync } =
      await import('../codex-accounts/fs-utils')
    renameGate.delayFirstRenameMs = 60

    await Promise.all([
      serializeAtomicFileWrite(configPath, () =>
        writeFileAtomicallyAsync(configPath, '{\n  "generation": 0\n}\n')
      ),
      writeHooksJsonAsync(configPath, { generation: 1 })
    ])

    expect(JSON.parse(await readFile(configPath, 'utf-8')).generation).toBe(1)
    expect(JSON.parse(await readFile(`${configPath}.bak`, 'utf-8')).generation).toBe(0)
  })
})
