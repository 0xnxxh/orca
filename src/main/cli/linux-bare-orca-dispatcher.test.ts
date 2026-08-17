import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: true }
}))

import { installLinuxBareOrcaDispatcher } from './linux-bare-orca-dispatcher'

const created: string[] = []

async function makeFixture(): Promise<{ homePath: string; resourcesPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'orca-bare-dispatcher-'))
  created.push(root)
  const resourcesPath = join(root, 'resources')
  // The bundled orca-ide launcher must exist for the dispatcher to be written.
  await mkdir(join(resourcesPath, 'bin'), { recursive: true })
  await writeFile(join(resourcesPath, 'bin', 'orca-ide'), '#!/usr/bin/env bash\n', 'utf8')
  return { homePath: join(root, 'home'), resourcesPath }
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('installLinuxBareOrcaDispatcher', () => {
  it('writes an executable bare-orca dispatcher that execs the bundled orca-ide launcher', async () => {
    const { homePath, resourcesPath } = await makeFixture()

    const result = await installLinuxBareOrcaDispatcher({
      resourcesPath,
      homePath,
      appImagePath: null
    })

    const expectedTarget = join(resourcesPath, 'bin', 'orca-ide')
    expect(result.state).toBe('installed')
    expect(result.target).toBe(expectedTarget)
    expect(result.dispatcherPath).toBe(join(homePath, '.local', 'bin', 'orca'))

    const content = await readFile(result.dispatcherPath, 'utf8')
    expect(content).toContain('#!/usr/bin/env bash')
    // Single-quoted so a resources path with shell metacharacters can't break out.
    expect(content).toContain(`exec '${expectedTarget}' "$@"`)

    const mode = (await stat(result.dispatcherPath)).mode & 0o777
    expect(mode & 0o111).not.toBe(0)
  })

  it('is idempotent — a second install rewrites its own dispatcher without throwing', async () => {
    const { homePath, resourcesPath } = await makeFixture()

    const first = await installLinuxBareOrcaDispatcher({
      resourcesPath,
      homePath,
      appImagePath: null
    })
    const second = await installLinuxBareOrcaDispatcher({
      resourcesPath,
      homePath,
      appImagePath: null
    })

    expect(second).toEqual(first)
    expect(second.state).toBe('installed')
  })

  it('quotes a resources path containing spaces so the exec line cannot be split', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-bare-dispatcher-space-'))
    created.push(root)
    const resourcesPath = join(root, 'App Support', 'resources')
    await mkdir(join(resourcesPath, 'bin'), { recursive: true })
    await writeFile(join(resourcesPath, 'bin', 'orca-ide'), '#!/usr/bin/env bash\n', 'utf8')

    const result = await installLinuxBareOrcaDispatcher({
      resourcesPath,
      homePath: join(root, 'home'),
      appImagePath: null
    })

    const content = await readFile(result.dispatcherPath, 'utf8')
    expect(content).toContain(`exec '${join(resourcesPath, 'bin', 'orca-ide')}' "$@"`)
  })

  // Why: this dispatcher must survive a restart, and an AppImage's resourcesPath
  // is a mount that dies with the app. Point it at the extracted payload, which
  // also keeps it clear of AppRun's `--no-sandbox` injection (#11609).
  it('execs the extracted payload (not the ephemeral mount) when running from an AppImage', async () => {
    const { homePath, resourcesPath } = await makeFixture()
    const appImagePath = join(homePath, 'Orca.AppImage')
    await mkdir(homePath, { recursive: true })
    await writeFile(appImagePath, '#!/usr/bin/env bash\n', { encoding: 'utf8', mode: 0o755 })
    const cacheRootPath = join(homePath, 'cache')

    const result = await installLinuxBareOrcaDispatcher({
      resourcesPath,
      homePath,
      appImagePath,
      appImageCacheRootPath: cacheRootPath,
      appImageExtractRunner: async (_appImagePath, cwd) => {
        const launcherDir = join(cwd, 'squashfs-root', 'resources', 'bin')
        await mkdir(launcherDir, { recursive: true })
        await writeFile(join(launcherDir, 'orca-ide'), '', { encoding: 'utf8', mode: 0o755 })
      }
    })

    expect(result.state).toBe('installed')
    expect(result.target).toMatch(/cache\/[0-9a-f]{24}\/resources\/bin\/orca-ide$/)
    const content = await readFile(result.dispatcherPath, 'utf8')
    expect(content).toContain(result.target as string)
    // Neither the ephemeral mount nor the outer AppImage may appear.
    expect(content).not.toContain(resourcesPath)
    expect(content).not.toContain(appImagePath)
  })

  it('skips (does not clobber) a user-owned orca already at ~/.local/bin', async () => {
    const { homePath, resourcesPath } = await makeFixture()
    const dispatcherPath = join(homePath, '.local', 'bin', 'orca')
    await mkdir(join(homePath, '.local', 'bin'), { recursive: true })
    await writeFile(dispatcherPath, '#!/bin/sh\necho my own orca\n', 'utf8')

    const result = await installLinuxBareOrcaDispatcher({
      resourcesPath,
      homePath,
      appImagePath: null
    })

    expect(result.state).toBe('skipped-foreign')
    expect(await readFile(dispatcherPath, 'utf8')).toBe('#!/bin/sh\necho my own orca\n')
  })

  it('skips when the bundled orca-ide launcher is missing from the build', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-bare-dispatcher-nolauncher-'))
    created.push(root)

    const result = await installLinuxBareOrcaDispatcher({
      resourcesPath: join(root, 'resources'),
      homePath: join(root, 'home'),
      appImagePath: null
    })

    expect(result.state).toBe('skipped-launcher-missing')
    expect(result.target).toBeNull()
  })
})
