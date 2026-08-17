import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: true }
}))

import { resolveAppImageCacheKey } from './appimage-extracted-root'
import { ensureLinuxTerminalOrcaCliShimDir } from './linux-terminal-orca-cli-shim'

const created: string[] = []

async function makeFixture(): Promise<{ userDataPath: string; resourcesPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'orca-terminal-cli-shim-'))
  created.push(root)
  const resourcesPath = join(root, 'resources')
  // The bundled orca-ide launcher must exist for the shim to be written.
  mkdirSync(join(resourcesPath, 'bin'), { recursive: true })
  writeFileSync(join(resourcesPath, 'bin', 'orca-ide'), '#!/usr/bin/env bash\n', 'utf8')
  return { userDataPath: join(root, 'user-data'), resourcesPath }
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('ensureLinuxTerminalOrcaCliShimDir', () => {
  it('writes an executable bare-orca shim that execs the bundled orca-ide launcher', async () => {
    const { userDataPath, resourcesPath } = await makeFixture()

    const shimDir = ensureLinuxTerminalOrcaCliShimDir({
      userDataPath,
      resourcesPath,
      appImagePath: null
    })

    expect(shimDir).toBe(join(userDataPath, 'linux-orca-cli-shim'))
    const content = readFileSync(join(shimDir!, 'orca'), 'utf8')
    // Single-quoted so a resources path with shell metacharacters can't break out.
    expect(content).toContain(`exec '${join(resourcesPath, 'bin', 'orca-ide')}' "$@"`)
    const mode = statSync(join(shimDir!, 'orca')).mode & 0o777
    expect(mode & 0o111).not.toBe(0)
  })

  it('memoizes per userDataPath and re-asserts the exec bit for a stale shim', async () => {
    const { userDataPath, resourcesPath } = await makeFixture()
    const options = { userDataPath, resourcesPath, appImagePath: null }

    const first = ensureLinuxTerminalOrcaCliShimDir(options)
    expect(first).not.toBeNull()
    const shimPath = join(first!, 'orca')
    chmodSync(shimPath, 0o644)

    // A distinct userData path is not memoized, so ensure runs again and heals
    // the exec bit lost above only when it actually processes that path.
    const second = ensureLinuxTerminalOrcaCliShimDir(options)
    expect(second).toBe(first)

    const root = await mkdtemp(join(tmpdir(), 'orca-terminal-cli-shim-2-'))
    created.push(root)
    const otherUserData = join(root, 'user-data')
    mkdirSync(join(otherUserData, 'linux-orca-cli-shim'), { recursive: true })
    writeFileSync(join(otherUserData, 'linux-orca-cli-shim', 'orca'), 'stale contents', 'utf8')
    chmodSync(join(otherUserData, 'linux-orca-cli-shim', 'orca'), 0o644)

    const healed = ensureLinuxTerminalOrcaCliShimDir({
      userDataPath: otherUserData,
      resourcesPath,
      appImagePath: null
    })
    expect(healed).not.toBeNull()
    const healedPath = join(healed!, 'orca')
    expect(readFileSync(healedPath, 'utf8')).toContain('orca-ide')
    expect(statSync(healedPath).mode & 0o111).not.toBe(0)
  })

  // Why: a terminal spawn must not block on a ~540 MB extraction, so the shim
  // prefers an extracted payload only when one already exists and otherwise
  // uses the live mount — correct for as long as those terminals are alive.
  it('prefers an already-extracted AppImage payload over the ephemeral mount', async () => {
    const { userDataPath, resourcesPath } = await makeFixture()
    const appImagePath = join(userDataPath, 'Orca.AppImage')
    await mkdir(userDataPath, { recursive: true })
    await writeFile(appImagePath, '#!/usr/bin/env bash\n', { encoding: 'utf8', mode: 0o755 })
    const cacheRootPath = join(userDataPath, 'cache')
    const cacheKey = resolveAppImageCacheKey(appImagePath)
    const extractedLauncher = join(cacheRootPath, cacheKey!, 'resources', 'bin', 'orca-ide')
    await mkdir(dirname(extractedLauncher), { recursive: true })
    await writeFile(extractedLauncher, '', { encoding: 'utf8', mode: 0o755 })

    const shimDir = ensureLinuxTerminalOrcaCliShimDir({
      userDataPath,
      resourcesPath,
      appImagePath,
      appImageCacheRootPath: cacheRootPath
    })

    const content = readFileSync(join(shimDir!, 'orca'), 'utf8')
    expect(content).toContain(extractedLauncher)
    expect(content).not.toContain(appImagePath)
  })

  it('falls back to the live resources launcher when nothing is extracted yet', async () => {
    const { userDataPath, resourcesPath } = await makeFixture()
    const appImagePath = join(userDataPath, 'Orca.AppImage')
    await mkdir(userDataPath, { recursive: true })
    await writeFile(appImagePath, '#!/usr/bin/env bash\n', { encoding: 'utf8', mode: 0o755 })

    const shimDir = ensureLinuxTerminalOrcaCliShimDir({
      userDataPath,
      resourcesPath,
      appImagePath,
      appImageCacheRootPath: join(userDataPath, 'empty-cache')
    })

    const content = readFileSync(join(shimDir!, 'orca'), 'utf8')
    expect(content).toContain(join(resourcesPath, 'bin', 'orca-ide'))
  })

  it('returns null (and does not memoize) when the bundled launcher is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-terminal-cli-shim-missing-'))
    created.push(root)
    const userDataPath = join(root, 'user-data')

    const missing = ensureLinuxTerminalOrcaCliShimDir({
      userDataPath,
      resourcesPath: join(root, 'resources'),
      appImagePath: null
    })
    expect(missing).toBeNull()

    // Once the launcher exists (e.g. later probe with real resources), the same
    // userData path succeeds — proving failures are not cached.
    const resourcesPath = join(root, 'resources')
    mkdirSync(join(resourcesPath, 'bin'), { recursive: true })
    writeFileSync(join(resourcesPath, 'bin', 'orca-ide'), '#!/usr/bin/env bash\n', 'utf8')
    const recovered = ensureLinuxTerminalOrcaCliShimDir({
      userDataPath,
      resourcesPath,
      appImagePath: null
    })
    expect(recovered).toBe(join(userDataPath, 'linux-orca-cli-shim'))
  })
})
