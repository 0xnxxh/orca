import { posix, win32 } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { getCliLaunchArgs, maybeRedirectCliLaunch } from './cli-launch-redirect'

const COMMAND_NAMES = ['serve', 'status', 'skills', 'worktree']

const linux = {
  resourcesPath: '/opt/Orca/resources',
  execPath: '/opt/Orca/orca-ide',
  get cliEntryPath(): string {
    return posix.join(this.resourcesPath, 'app.asar.unpacked', 'out', 'cli', 'index.js')
  }
}
const windows = {
  resourcesPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\Orca\\resources',
  execPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\Orca\\Orca.exe',
  get cliEntryPath(): string {
    return win32.join(this.resourcesPath, 'app.asar.unpacked', 'out', 'cli', 'index.js')
  }
}

const linuxOptions = { platform: 'linux' as const, isPackaged: true, commandNames: COMMAND_NAMES }
const windowsOptions = { platform: 'win32' as const, isPackaged: true, commandNames: COMMAND_NAMES }

describe('CLI launch redirect: entry-path form', () => {
  it('detects a launch that received the unpacked CLI entrypoint', () => {
    expect(
      getCliLaunchArgs(
        [windows.execPath, windows.cliEntryPath.toUpperCase(), 'status', '--json'],
        windows.cliEntryPath,
        windowsOptions
      )
    ).toEqual(['status', '--json'])
  })

  it('ignores normal desktop launches', () => {
    expect(
      getCliLaunchArgs([windows.execPath, '--updated'], windows.cliEntryPath, windowsOptions)
    ).toBeNull()
  })

  it('ignores the entrypoint when it is only the executable itself (argv[0])', () => {
    expect(
      getCliLaunchArgs([windows.cliEntryPath, 'status'], windows.cliEntryPath, windowsOptions)
    ).toBeNull()
  })

  // Why: the same env-loss failure (a wrapper resetting ELECTRON_RUN_AS_NODE)
  // can strand a Linux launcher launch in GUI mode, so this form is not
  // Windows-only any more.
  it('applies on Linux too', () => {
    expect(
      getCliLaunchArgs(
        [linux.execPath, linux.cliEntryPath, 'status'],
        linux.cliEntryPath,
        linuxOptions
      )
    ).toEqual(['status'])
  })
})

describe('CLI launch redirect: command form', () => {
  // Why: this is the #14229 shape. A launch of the packaged binary from an
  // extracted tree exports neither APPIMAGE nor APPDIR, so the old AppImage-only
  // gate skipped it and the launch fell through to Chromium startup, which
  // aborts at Ozone display init on a headless host.
  it('redirects a direct binary launch with no AppImage env at all', () => {
    expect(
      getCliLaunchArgs(
        ['/home/u/.config/orca-runtime/versions/1.4.158/orca-ide', 'skills', 'get', '--full'],
        linux.cliEntryPath,
        linuxOptions
      )
    ).toEqual(['skills', 'get', '--full'])
  })

  it('strips Chromium switches node mode would reject', () => {
    expect(
      getCliLaunchArgs(
        [linux.execPath, '--no-sandbox', '--disable-gpu', 'serve', '--port', '6768'],
        linux.cliEntryPath,
        linuxOptions
      )
    ).toEqual(['serve', '--port', '6768'])
  })

  it('treats help as a CLI launch even without a command', () => {
    expect(getCliLaunchArgs([linux.execPath, '--help'], linux.cliEntryPath, linuxOptions)).toEqual([
      '--help'
    ])
  })

  it('leaves a plain desktop launch alone', () => {
    expect(getCliLaunchArgs([linux.execPath], linux.cliEntryPath, linuxOptions)).toBeNull()
    expect(
      getCliLaunchArgs([linux.execPath, '/home/u/project'], linux.cliEntryPath, linuxOptions)
    ).toBeNull()
  })

  // Why: `--environment` takes a value, so an environment that happens to be
  // named after a command must not be mistaken for the command itself.
  it('skips flag values when looking for the command positional', () => {
    expect(
      getCliLaunchArgs(
        [linux.execPath, '--environment', 'status', 'worktree', 'ps'],
        linux.cliEntryPath,
        linuxOptions
      )
    ).toEqual(['--environment', 'status', 'worktree', 'ps'])
    // No command follows the consumed value, so this is not a CLI launch.
    expect(
      getCliLaunchArgs(
        [linux.execPath, '--environment', 'status'],
        linux.cliEntryPath,
        linuxOptions
      )
    ).toBeNull()
  })

  it('does not apply the command form on macOS or Windows', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      expect(
        getCliLaunchArgs([linux.execPath, 'status'], linux.cliEntryPath, {
          platform,
          isPackaged: true,
          commandNames: COMMAND_NAMES
        })
      ).toBeNull()
    }
  })

  it('never redirects an unpackaged build', () => {
    expect(
      getCliLaunchArgs([linux.execPath, 'status'], linux.cliEntryPath, {
        ...linuxOptions,
        isPackaged: false
      })
    ).toBeNull()
  })
})

describe('CLI launch redirect: spawning', () => {
  it('runs the in-package CLI in Electron node mode with sanitized env', () => {
    const spawn = vi.fn((..._args: unknown[]) => ({ status: 0 }))

    const result = maybeRedirectCliLaunch({
      argv: [linux.execPath, 'status', '--json'],
      env: { NODE_OPTIONS: '--inspect', NODE_REPL_EXTERNAL_MODULE: 'external-loader' },
      platform: 'linux',
      isPackaged: true,
      resourcesPath: linux.resourcesPath,
      execPath: linux.execPath,
      commandNames: COMMAND_NAMES,
      exists: () => true,
      spawn: spawn as never
    })

    expect(result).toEqual({ redirected: true, status: 0 })
    expect(spawn).toHaveBeenCalledWith(
      linux.execPath,
      [linux.cliEntryPath, 'status', '--json'],
      expect.objectContaining({
        env: expect.objectContaining({
          ELECTRON_RUN_AS_NODE: '1',
          ORCA_CLI_LAUNCH_REDIRECTED: '1',
          ORCA_NODE_OPTIONS: '--inspect',
          ORCA_NODE_REPL_EXTERNAL_MODULE: 'external-loader'
        })
      })
    )
    const spawnedEnv = (spawn.mock.calls[0][2] as { env: NodeJS.ProcessEnv }).env
    expect(spawnedEnv).not.toHaveProperty('NODE_OPTIONS')
    expect(spawnedEnv).not.toHaveProperty('NODE_REPL_EXTERNAL_MODULE')
  })

  // Why: the CLI strips the switch before handing argv to the command parser,
  // so the serve child would otherwise silently regain the sandbox the operator
  // turned off.
  it('forwards an explicit --no-sandbox to the serve child', () => {
    const spawn = vi.fn((..._args: unknown[]) => ({ status: 0 }))

    maybeRedirectCliLaunch({
      argv: [linux.execPath, '--no-sandbox', 'serve'],
      env: {},
      platform: 'linux',
      isPackaged: true,
      resourcesPath: linux.resourcesPath,
      execPath: linux.execPath,
      commandNames: COMMAND_NAMES,
      exists: () => true,
      spawn: spawn as never
    })

    const spawnedEnv = (spawn.mock.calls[0][2] as { env: NodeJS.ProcessEnv }).env
    expect(spawnedEnv.ORCA_SERVE_NO_SANDBOX).toBe('1')
  })

  it('does not set the serve sandbox opt-out when the operator did not ask', () => {
    const spawn = vi.fn((..._args: unknown[]) => ({ status: 0 }))

    maybeRedirectCliLaunch({
      argv: [linux.execPath, 'serve'],
      env: {},
      platform: 'linux',
      isPackaged: true,
      resourcesPath: linux.resourcesPath,
      execPath: linux.execPath,
      commandNames: COMMAND_NAMES,
      exists: () => true,
      spawn: spawn as never
    })

    const spawnedEnv = (spawn.mock.calls[0][2] as { env: NodeJS.ProcessEnv }).env
    expect(spawnedEnv).not.toHaveProperty('ORCA_SERVE_NO_SANDBOX')
  })

  it('refuses to redirect twice so a dropped ELECTRON_RUN_AS_NODE cannot loop', () => {
    const spawn = vi.fn((..._args: unknown[]) => ({ status: 0 }))

    const result = maybeRedirectCliLaunch({
      argv: [linux.execPath, 'status'],
      env: { ORCA_CLI_LAUNCH_REDIRECTED: '1' },
      platform: 'linux',
      isPackaged: true,
      resourcesPath: linux.resourcesPath,
      execPath: linux.execPath,
      commandNames: COMMAND_NAMES,
      exists: () => true,
      spawn: spawn as never
    })

    expect(result).toEqual({ redirected: true, status: 1 })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('reports a missing CLI entrypoint instead of booting the desktop app', () => {
    const spawn = vi.fn((..._args: unknown[]) => ({ status: 0 }))

    const result = maybeRedirectCliLaunch({
      argv: [linux.execPath, 'status'],
      env: {},
      platform: 'linux',
      isPackaged: true,
      resourcesPath: linux.resourcesPath,
      execPath: linux.execPath,
      commandNames: COMMAND_NAMES,
      exists: () => false,
      spawn: spawn as never
    })

    expect(result).toEqual({ redirected: true, status: 1 })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('surfaces a spawn failure as a non-zero exit', () => {
    const result = maybeRedirectCliLaunch({
      argv: [linux.execPath, 'status'],
      env: {},
      platform: 'linux',
      isPackaged: true,
      resourcesPath: linux.resourcesPath,
      execPath: linux.execPath,
      commandNames: COMMAND_NAMES,
      exists: () => true,
      spawn: (() => ({ error: new Error('spawn ENOENT') })) as never
    })

    expect(result).toEqual({ redirected: true, status: 1 })
  })
})
