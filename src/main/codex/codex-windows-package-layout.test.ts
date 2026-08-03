import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { repairCodexWindowsPackageLayout } from './codex-windows-package-layout'

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
})
