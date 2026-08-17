import { beforeEach, describe, expect, it, vi } from 'vitest'

const { existsSyncMock, homedirMock, userInfoMock, execFileMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn<(path: string) => boolean>(() => true),
  homedirMock: vi.fn<() => string>(() => '/home/env'),
  userInfoMock: vi.fn<() => { homedir: string }>(() => ({ homedir: '/home/env' })),
  execFileMock: vi.fn()
}))

vi.mock('node:fs', () => ({ existsSync: existsSyncMock }))
vi.mock('node:os', () => ({ homedir: homedirMock, userInfo: userInfoMock }))
vi.mock('node:child_process', () => ({ execFile: execFileMock }))

import { resolveSiteStrictHostKeyChecking, sshGArgsForHost } from './ssh-g-config-resolution'

describe('sshGArgsForHost', () => {
  beforeEach(() => {
    existsSyncMock.mockReset().mockReturnValue(true)
    homedirMock.mockReset().mockReturnValue('/home/env')
    userInfoMock.mockReset().mockReturnValue({ homedir: '/home/env' })
  })

  it('keeps OpenSSH default resolution when HOME matches the passwd home', () => {
    // Why: the default search still reads /etc/ssh/ssh_config, which the
    // SshResolvedConfig.gssapiAuthentication contract depends on.
    expect(sshGArgsForHost('prod')).toEqual(['-G', '--', 'prod'])
  })

  it('pins the HOME config when it diverges from the passwd home', () => {
    homedirMock.mockReturnValue('/tmp/e2e-home')

    expect(sshGArgsForHost('prod')).toEqual(['-F', '/tmp/e2e-home/.ssh/config', '-G', '--', 'prod'])
    expect(existsSyncMock).toHaveBeenCalledWith('/tmp/e2e-home/.ssh/config')
  })

  it('falls back to passwd-home resolution when the HOME config is absent', () => {
    // Why: ssh exits 255 on a missing -F file, so a divergent HOME without a
    // config must not pin one. The picker lists nothing here, so the wider
    // passwd-home resolution never mints a target.
    homedirMock.mockReturnValue('/tmp/e2e-home')
    existsSyncMock.mockReturnValue(false)

    expect(sshGArgsForHost('prod')).toEqual(['-G', '--', 'prod'])
  })

  it('treats an unavailable passwd entry as a HOME match', () => {
    userInfoMock.mockImplementation(() => {
      throw new Error('getpwuid failed')
    })

    expect(sshGArgsForHost('prod')).toEqual(['-G', '--', 'prod'])
  })

  it('does not let a leading-dash alias become a flag', () => {
    homedirMock.mockReturnValue('/tmp/e2e-home')

    expect(sshGArgsForHost('-oProxyCommand=touch /tmp/pwned')).toEqual([
      '-F',
      '/tmp/e2e-home/.ssh/config',
      '-G',
      '--',
      '-oProxyCommand=touch /tmp/pwned'
    ])
  })
})

/**
 * The site policy, read on its own.
 *
 * `ssh -F <file>` makes OpenSSH ignore /etc/ssh/ssh_config entirely, so on the HOME-divergent path
 * the ordinary resolution cannot see a site-wide StrictHostKeyChecking. Being unable to see it used
 * to mean refusing every unknown host, which locks out anyone whose HOME diverges from their passwd
 * home — devcontainers, `su`, Nix shells. Pointing -F at the null device inverts the exclusion so
 * the value can simply be read.
 */
describe('resolveSiteStrictHostKeyChecking', () => {
  beforeEach(() => {
    execFileMock.mockReset()
  })

  function respond(err: Error | null, stdout: string): void {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(err, stdout, '')
      return { kill: vi.fn() }
    })
  }

  it('reads the value from the system config alone', async () => {
    respond(null, 'stricthostkeychecking yes\nuser someone\n')

    await expect(resolveSiteStrictHostKeyChecking('prod')).resolves.toBe('yes')

    const args = execFileMock.mock.calls[0][1]
    // The null device is what excludes the per-user file; -- keeps a host starting with '-' a host.
    expect(args).toContain('-F')
    expect(args).toContain(process.platform === 'win32' ? 'NUL' : '/dev/null')
    expect(args).toContain('-G')
    expect(args.slice(-2)).toEqual(['--', 'prod'])
  })

  it('answers null when ssh fails, so the caller stays blind and strict', async () => {
    respond(new Error('ssh: not found'), '')

    await expect(resolveSiteStrictHostKeyChecking('prod')).resolves.toBeNull()
  })

  it('answers the default when the system config names no policy', async () => {
    // A successful read that sets nothing is still a successful read, and that is the distinction
    // the caller needs: null means "we could not look", which is the only case that keeps refusing
    // unknown hosts. `ask` here clears the blindness without relaxing anything — strictestHostKeyChecking
    // leaves the user's value alone against it.
    respond(null, 'user someone\n')

    await expect(resolveSiteStrictHostKeyChecking('prod')).resolves.toBe('ask')
  })
})
