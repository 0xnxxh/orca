import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SSH_REMOTE_CLI_LAUNCHER_INSTALL_METHOD,
  SSH_REMOTE_CLI_LAUNCHER_INSTALL_VERSION,
  type SshRemoteCliLauncherInstallRequest,
  type SshRemoteCliLauncherInstallResult
} from '../shared/ssh-remote-cli-launcher-install'
import type { RelayDispatcher, RequestContext } from './dispatcher'
import {
  RemoteCliLauncherInstaller,
  createRemoteCliLauncherPlan,
  windowsRemoteCliCompilerCandidates
} from './remote-cli-launcher-installer'

type InstallHandler = (params: Record<string, unknown>, context: RequestContext) => Promise<unknown>

const temporaryRoots: string[] = []

function createInstaller(): InstallHandler {
  let handler: InstallHandler | null = null
  const dispatcher = {
    onRequest: (method: string, candidate: InstallHandler) => {
      if (method === SSH_REMOTE_CLI_LAUNCHER_INSTALL_METHOD) {
        handler = candidate
      }
    }
  } as unknown as RelayDispatcher
  new RemoteCliLauncherInstaller(dispatcher)
  if (!handler) {
    throw new Error('installer handler was not registered')
  }
  return handler
}

function requestForRoot(root: string): SshRemoteCliLauncherInstallRequest {
  return {
    version: SSH_REMOTE_CLI_LAUNCHER_INSTALL_VERSION,
    binDir: join(root, 'bin'),
    relayDir: join(root, 'relay'),
    nodePath: process.execPath,
    sockPath: join(root, 'relay.sock'),
    credentialFile: join(root, 'relay.sock.credential')
  }
}

function requestContext(signal?: AbortSignal): RequestContext {
  return {
    clientId: 1,
    isStale: () => signal?.aborted === true,
    ...(signal ? { signal } : {})
  }
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-remote-cli-installer-'))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

describe('remote CLI launcher installer', () => {
  const itPosix = process.platform === 'win32' ? it.skip : it
  const itWindows = process.platform === 'win32' ? it : it.skip

  itPosix('atomically installs one executable launcher through the relay handler', async () => {
    const root = await makeRoot()
    const request = requestForRoot(root)
    const install = createInstaller()

    const result = (await install(request, requestContext())) as SshRemoteCliLauncherInstallResult
    const launcher = await readFile(result.launcherPath, 'utf8')
    const launcherStat = await stat(result.launcherPath)

    expect(result).toMatchObject({ version: 1, changed: true })
    expect(launcher).toContain('--orca-cli "$@"')
    expect(launcher).toContain(request.credentialFile)
    expect(launcherStat.mode & 0o111).not.toBe(0)
  })

  itPosix('coalesces concurrent installs and skips an unchanged reconnect', async () => {
    const root = await makeRoot()
    const request = requestForRoot(root)
    const install = createInstaller()

    const concurrent = (await Promise.all([
      install(request, requestContext()),
      install(request, requestContext())
    ])) as SshRemoteCliLauncherInstallResult[]
    const reconnect = (await install(
      request,
      requestContext()
    )) as SshRemoteCliLauncherInstallResult

    expect(concurrent.map((result) => result.changed)).toEqual([true, false])
    expect(reconnect.changed).toBe(false)
  })

  itPosix('repairs executable permissions without rewriting an unchanged launcher', async () => {
    const root = await makeRoot()
    const request = requestForRoot(root)
    const install = createInstaller()
    const first = (await install(request, requestContext())) as SshRemoteCliLauncherInstallResult
    await chmod(first.launcherPath, 0o644)

    const repaired = (await install(request, requestContext())) as SshRemoteCliLauncherInstallResult

    expect(repaired.changed).toBe(false)
    expect((await stat(first.launcherPath)).mode & 0o111).not.toBe(0)
  })

  it('rejects stale or relative install requests before mutation', async () => {
    const root = await makeRoot()
    const install = createInstaller()
    const controller = new AbortController()
    controller.abort()

    await expect(install(requestForRoot(root), requestContext(controller.signal))).rejects.toThrow(
      'client_disconnected'
    )
    await expect(
      install({ ...requestForRoot(root), binDir: 'relative/bin' }, requestContext())
    ).rejects.toThrow('remote_cli_launcher_path_not_absolute')
    await expect(stat(join(root, 'bin'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('builds a native Windows launcher plan without cmd.exe or client-provided code', () => {
    const request: SshRemoteCliLauncherInstallRequest = {
      version: 1,
      binDir: 'C:\\Users\\me user\\.orca-relay\\bin',
      relayDir: 'C:\\Users\\me user\\.orca-relay\\relay',
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      sockPath: '\\\\.\\pipe\\orca-relay',
      credentialFile: 'C:\\Users\\me user\\.orca-relay\\relay.credential'
    }

    const plan = createRemoteCliLauncherPlan(request, 'win32')

    expect(plan.launcherPath).toBe('C:\\Users\\me user\\.orca-relay\\bin\\orca.exe')
    expect(plan.source).toContain('ProcessStartInfo')
    expect(plan.source).toContain('"--orca-cli"')
    expect(plan.source).not.toContain('cmd.exe')
    expect(plan.source).not.toContain('%*')
    expect(windowsRemoteCliCompilerCandidates({ WINDIR: 'C:\\Windows' })).toEqual([
      'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
      'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
    ])
  })

  itWindows(
    'preserves multiline argv through the compiled Windows launcher',
    async () => {
      const root = await makeRoot()
      const request = requestForRoot(root)
      await mkdir(request.relayDir, { recursive: true })
      await writeFile(
        join(request.relayDir, 'relay.js'),
        'process.stdout.write(JSON.stringify(process.argv.slice(2)))\n',
        'utf8'
      )
      const install = createInstaller()
      const result = (await install(request, requestContext())) as SshRemoteCliLauncherInstallResult
      const body = 'line one\nline two & whoami\n"quoted" C:\\tail\\'

      const launched = spawnSync(
        result.launcherPath,
        ['orchestration', 'send', '--body', body, '--json'],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            ORCA_RELAY_NODE_PATH: process.execPath,
            ORCA_RELAY_DIR: request.relayDir,
            ORCA_RELAY_SOCKET_PATH: request.sockPath,
            ORCA_RELAY_CREDENTIAL_FILE: request.credentialFile
          }
        }
      )

      expect(launched.status, launched.stderr).toBe(0)
      expect(JSON.parse(launched.stdout)).toEqual([
        '--sock-path',
        request.sockPath,
        '--credential-file',
        request.credentialFile,
        '--orca-cli',
        'orchestration',
        'send',
        '--body',
        body,
        '--json'
      ])
    },
    20_000
  )
})
