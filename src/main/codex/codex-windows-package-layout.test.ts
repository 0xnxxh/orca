import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { repairCodexWindowsPackageLayout } from './codex-windows-package-layout'
import { resolveCodexCommand } from '../codex-cli/command'

// The repair resolves the codex command when none is passed; that resolver can
// throw on a version-manager readdir race. Mock it so a specific test can force
// that throw. Every other test passes an explicit path, so the resolver is unused.
vi.mock('../codex-cli/command', () => ({ resolveCodexCommand: vi.fn(() => '') }))

let root: string
let homePath: string
let appDataPath: string

const ENTRYPOINT_BYTES = 'codex-entrypoint-build-a'
const OTHER_BUILD_BYTES = 'codex-entrypoint-build-b'

function writeReleaseLayout(
  packageRootPath: string,
  {
    entrypointBytes = ENTRYPOINT_BYTES,
    resourcesDirName = 'codex-resources',
    pathDirName = 'codex-path',
    withResources = true,
    withManifest = true
  }: {
    entrypointBytes?: string
    resourcesDirName?: string
    pathDirName?: string
    withResources?: boolean
    withManifest?: boolean
  } = {}
): void {
  mkdirSync(join(packageRootPath, 'bin'), { recursive: true })
  writeFileSync(join(packageRootPath, 'bin', 'codex.exe'), entrypointBytes)
  if (withManifest) {
    writeFileSync(
      join(packageRootPath, 'codex-package.json'),
      JSON.stringify({
        layoutVersion: 1,
        version: '0.145.0',
        target: 'x86_64-pc-windows-msvc',
        entrypoint: 'bin/codex.exe',
        resourcesDir: resourcesDirName,
        pathDir: pathDirName
      })
    )
  }
  if (!withResources) {
    return
  }
  mkdirSync(join(packageRootPath, resourcesDirName), { recursive: true })
  writeFileSync(
    join(packageRootPath, resourcesDirName, 'codex-windows-sandbox-setup.exe'),
    'setup-helper'
  )
  mkdirSync(join(packageRootPath, pathDirName), { recursive: true })
  writeFileSync(join(packageRootPath, pathDirName, 'rg.exe'), 'ripgrep')
}

function getStandaloneReleasePath(name: string): string {
  return join(homePath, '.codex', 'packages', 'standalone', 'releases', name)
}

function getNpmVendorPath(target: string): string {
  return join(
    appDataPath,
    'npm',
    'node_modules',
    '@openai',
    'codex',
    'node_modules',
    '@openai',
    'codex-win32-x64',
    'vendor',
    target
  )
}

function repair(codexCommandPath: string): ReturnType<typeof repairCodexWindowsPackageLayout> {
  return repairCodexWindowsPackageLayout({
    platform: 'win32',
    homePath,
    appDataPath,
    codexCommandPath
  })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orca-codex-layout-'))
  homePath = join(root, 'home')
  appDataPath = join(homePath, 'AppData', 'Roaming')
  mkdirSync(appDataPath, { recursive: true })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('repairCodexWindowsPackageLayout', () => {
  it('does nothing off Windows', () => {
    const installPath = join(root, 'install')
    writeReleaseLayout(installPath, { withResources: false })

    expect(
      repairCodexWindowsPackageLayout({
        platform: 'darwin',
        homePath,
        appDataPath,
        codexCommandPath: join(installPath, 'bin', 'codex.exe')
      })
    ).toEqual({ status: 'not-applicable', packageRootPath: null, restoredDirectories: [] })
    expect(existsSync(join(installPath, 'codex-resources'))).toBe(false)
  })

  it('ignores commands that are not a release entrypoint', () => {
    writeReleaseLayout(getStandaloneReleasePath('0.145.0-x86_64-pc-windows-msvc'))

    for (const command of [
      'codex',
      join(root, 'npm', 'codex.cmd'),
      join(root, 'tools', 'codex.exe')
    ]) {
      expect(repair(command).status).toBe('not-applicable')
    }
  })

  it('leaves a complete install untouched', () => {
    const installPath = join(root, 'install')
    writeReleaseLayout(installPath)

    expect(repair(join(installPath, 'bin', 'codex.exe'))).toEqual({
      status: 'already-complete',
      packageRootPath: installPath,
      restoredDirectories: []
    })
  })

  it('restores the sandbox helper from a byte-identical standalone release', () => {
    const installPath = join(root, 'install')
    writeReleaseLayout(installPath, { withResources: false, withManifest: false })
    writeReleaseLayout(getStandaloneReleasePath('0.145.0-x86_64-pc-windows-msvc'))

    const result = repair(join(installPath, 'bin', 'codex.exe'))

    expect(result.status).toBe('restored')
    expect(result.restoredDirectories).toEqual(['codex-resources', 'codex-path'])
    expect(
      readFileSync(join(installPath, 'codex-resources', 'codex-windows-sandbox-setup.exe'), 'utf-8')
    ).toBe('setup-helper')
    expect(readFileSync(join(installPath, 'codex-path', 'rg.exe'), 'utf-8')).toBe('ripgrep')
    // Why: the restored manifest keeps the next check on the declared names.
    expect(existsSync(join(installPath, 'codex-package.json'))).toBe(true)
  })

  it('restores only the directory that is missing', () => {
    const installPath = join(root, 'install')
    writeReleaseLayout(installPath)
    rmSync(join(installPath, 'codex-resources'), { recursive: true, force: true })
    writeReleaseLayout(getStandaloneReleasePath('0.145.0-x86_64-pc-windows-msvc'))

    expect(repair(join(installPath, 'bin', 'codex.exe')).restoredDirectories).toEqual([
      'codex-resources'
    ])
  })

  it('restores over empty sibling directories left by a partial install', () => {
    const installPath = join(root, 'install')
    writeReleaseLayout(installPath, { withResources: false })
    mkdirSync(join(installPath, 'codex-resources'))
    mkdirSync(join(installPath, 'codex-path'))
    writeReleaseLayout(getStandaloneReleasePath('0.145.0-x86_64-pc-windows-msvc'))

    expect(repair(join(installPath, 'bin', 'codex.exe')).status).toBe('restored')
    expect(
      existsSync(join(installPath, 'codex-resources', 'codex-windows-sandbox-setup.exe'))
    ).toBe(true)
  })

  it('honours directory names declared by the manifest', () => {
    const installPath = join(root, 'install')
    writeReleaseLayout(installPath, {
      withResources: false,
      resourcesDirName: 'helpers',
      pathDirName: 'tools'
    })
    writeReleaseLayout(getStandaloneReleasePath('0.145.0-x86_64-pc-windows-msvc'), {
      resourcesDirName: 'helpers',
      pathDirName: 'tools'
    })

    expect(repair(join(installPath, 'bin', 'codex.exe')).restoredDirectories).toEqual([
      'helpers',
      'tools'
    ])
    expect(existsSync(join(installPath, 'helpers', 'codex-windows-sandbox-setup.exe'))).toBe(true)
  })

  it('refuses a release built from a different codex binary', () => {
    const installPath = join(root, 'install')
    writeReleaseLayout(installPath, { withResources: false })
    writeReleaseLayout(getStandaloneReleasePath('0.140.0-x86_64-pc-windows-msvc'), {
      entrypointBytes: OTHER_BUILD_BYTES
    })

    expect(repair(join(installPath, 'bin', 'codex.exe'))).toEqual({
      status: 'no-donor',
      packageRootPath: installPath,
      restoredDirectories: []
    })
    expect(existsSync(join(installPath, 'codex-resources'))).toBe(false)
  })

  it('falls back to the npm vendor layout when no standalone release is cached', () => {
    const installPath = join(root, 'install')
    writeReleaseLayout(installPath, { withResources: false })
    writeReleaseLayout(getNpmVendorPath('x86_64-pc-windows-msvc'))

    expect(repair(join(installPath, 'bin', 'codex.exe')).status).toBe('restored')
    expect(
      existsSync(join(installPath, 'codex-resources', 'codex-windows-sandbox-setup.exe'))
    ).toBe(true)
  })

  it('reports no donor when nothing on the host carries the resources', () => {
    const installPath = join(root, 'install')
    writeReleaseLayout(installPath, { withResources: false })

    expect(repair(join(installPath, 'bin', 'codex.exe')).status).toBe('no-donor')
  })

  it('retries a failed donor lookup after its brief cache expires', () => {
    vi.useFakeTimers()
    const installPath = join(root, 'install')
    writeReleaseLayout(installPath, { withResources: false })
    const commandPath = join(installPath, 'bin', 'codex.exe')

    expect(repair(commandPath).status).toBe('no-donor')
    writeReleaseLayout(getStandaloneReleasePath('0.145.0-x86_64-pc-windows-msvc'))
    expect(repair(commandPath).status).toBe('no-donor')

    vi.advanceTimersByTime(60_001)
    expect(repair(commandPath).status).toBe('restored')
  })

  it('never throws out of the best-effort repair when command resolution fails', () => {
    vi.mocked(resolveCodexCommand).mockImplementationOnce(() => {
      throw new Error('version-manager readdir raced')
    })

    // No codexCommandPath forces the guarded resolveCodexCommand call, which throws.
    expect(repairCodexWindowsPackageLayout({ platform: 'win32', homePath, appDataPath })).toEqual({
      status: 'not-applicable',
      packageRootPath: null,
      restoredDirectories: []
    })
  })

  // POSIX-only: forces a real publish failure via a read-only root. On win32 the
  // suite would need ACL manipulation; the cached-backoff logic is platform-agnostic.
  const itWithChmod = process.platform === 'win32' ? it.skip : it
  itWithChmod('caches a failed restore and retries only after the cache expires', () => {
    vi.useFakeTimers()
    const installPath = join(root, 'install')
    writeReleaseLayout(installPath, { withResources: false })
    writeReleaseLayout(getStandaloneReleasePath('0.145.0-x86_64-pc-windows-msvc'))
    const commandPath = join(installPath, 'bin', 'codex.exe')

    // A read-only root makes the staged copy unpublishable, so restore fails
    // even though a byte-identical donor was found.
    chmodSync(installPath, 0o500)
    try {
      expect(repair(commandPath).status).toBe('failed')

      // Within the TTL the backoff short-circuits: the second call returns the
      // cached failure without re-scanning, even though the root is writable again.
      chmodSync(installPath, 0o700)
      expect(repair(commandPath).status).toBe('failed')

      vi.advanceTimersByTime(60_001)
      expect(repair(commandPath).status).toBe('restored')
    } finally {
      chmodSync(installPath, 0o700)
    }
  })
})
