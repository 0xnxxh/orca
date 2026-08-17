import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeOs from 'node:os'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type NodeOsModule = typeof NodeOs

const { existsSyncMock, homedirMock, userInfoMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn<(path: string) => boolean>(() => true),
  homedirMock: vi.fn<() => string>(() => '/home/env'),
  userInfoMock: vi.fn<() => { homedir: string }>(() => ({ homedir: '/home/env' }))
}))

vi.mock('node:fs', () => ({ existsSync: existsSyncMock }))
// Why importOriginal: the site-config tests need a real tmpdir(), and a bare factory would replace
// the whole module and leave every other export undefined.
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<NodeOsModule>()),
  homedir: homedirMock,
  userInfo: userInfoMock
}))

import { siteConfigMayRestrictHostKeys, sshGArgsForHost } from './ssh-g-config-resolution'

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
 * Whether the system-wide ssh_config could restrict host keys.
 *
 * `-F` excludes /etc/ssh/ssh_config as well as the per-user file, and there is no ssh-only way to
 * read one while suppressing the other — `-F /dev/null` reports built-in defaults, which would make
 * every machine look permissive. So the file is read, and the question asked is deliberately weaker
 * than "what is the policy": anything ambiguous keeps the caller fail-closed.
 */
describe('siteConfigMayRestrictHostKeys', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orca-site-ssh-config-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('answers no when there is no system config at all', async () => {
    // The case that used to lock people out: nothing to be blind to.
    await expect(siteConfigMayRestrictHostKeys([join(dir, 'absent')])).resolves.toBe(false)
  })

  it('answers no for a config that says nothing about host keys', async () => {
    const file = join(dir, 'ssh_config')
    await writeFile(file, 'Host *\n    SendEnv LANG LC_*\n', 'utf-8')

    await expect(siteConfigMayRestrictHostKeys([file])).resolves.toBe(false)
  })

  it('answers yes when the directive is present, whatever its value', async () => {
    // The value is not parsed on purpose: presence alone is enough to stay strict.
    const file = join(dir, 'ssh_config')
    await writeFile(file, 'Host *\n    StrictHostKeyChecking no\n', 'utf-8')

    await expect(siteConfigMayRestrictHostKeys([file])).resolves.toBe(true)
  })

  it('follows the Include OpenSSH ships by default', async () => {
    // macOS and most distros ship `Include /etc/ssh/ssh_config.d/*`, so missing this would read as
    // "no policy" on nearly every machine that has one.
    const includeDir = join(dir, 'ssh_config.d')
    await mkdir(includeDir)
    await writeFile(join(includeDir, '10-site.conf'), 'StrictHostKeyChecking yes\n', 'utf-8')
    const file = join(dir, 'ssh_config')
    await writeFile(file, 'Include ssh_config.d/*\nHost *\n', 'utf-8')

    await expect(siteConfigMayRestrictHostKeys([file])).resolves.toBe(true)
  })

  it('answers no when an Included directory holds nothing relevant', async () => {
    const includeDir = join(dir, 'ssh_config.d')
    await mkdir(includeDir)
    await writeFile(join(includeDir, '10-site.conf'), 'SendEnv LANG\n', 'utf-8')
    const file = join(dir, 'ssh_config')
    await writeFile(file, 'Include ssh_config.d/*\n', 'utf-8')

    await expect(siteConfigMayRestrictHostKeys([file])).resolves.toBe(false)
  })

  it('ignores a commented-out directive', async () => {
    // A commented directive is not a policy. Reading it as one would reinstate the lockout for
    // anyone whose distro ships the line commented, which is the common shape.
    const file = join(dir, 'ssh_config')
    await writeFile(file, 'Host *\n    # StrictHostKeyChecking yes\n', 'utf-8')

    await expect(siteConfigMayRestrictHostKeys([file])).resolves.toBe(false)
  })

  it('sees the directive inside Host and Match blocks', async () => {
    // No attempt is made to evaluate whether the block applies to this host — presence anywhere is
    // enough, because guessing wrong in the permissive direction is the failure that matters.
    const hostScoped = join(dir, 'host-scoped')
    await writeFile(hostScoped, 'Host prod\n    StrictHostKeyChecking yes\n', 'utf-8')
    const matchScoped = join(dir, 'match-scoped')
    await writeFile(matchScoped, 'Match exec "true"\n    StrictHostKeyChecking yes\n', 'utf-8')

    await expect(siteConfigMayRestrictHostKeys([hostScoped])).resolves.toBe(true)
    await expect(siteConfigMayRestrictHostKeys([matchScoped])).resolves.toBe(true)
  })

  it('sees the equals form', async () => {
    const file = join(dir, 'ssh_config')
    await writeFile(file, 'StrictHostKeyChecking=yes\n', 'utf-8')

    await expect(siteConfigMayRestrictHostKeys([file])).resolves.toBe(true)
  })

  it('does not match a directive that merely starts the same way', async () => {
    const file = join(dir, 'ssh_config')
    await writeFile(file, 'StrictHostKeyCheckingExtended yes\n', 'utf-8')

    await expect(siteConfigMayRestrictHostKeys([file])).resolves.toBe(false)
  })

  it('follows a nested Include', async () => {
    const inner = join(dir, 'inner')
    await writeFile(inner, 'StrictHostKeyChecking yes\n', 'utf-8')
    const middle = join(dir, 'middle')
    await writeFile(middle, `Include ${inner}\n`, 'utf-8')
    const outer = join(dir, 'ssh_config')
    await writeFile(outer, `Include ${middle}\n`, 'utf-8')

    await expect(siteConfigMayRestrictHostKeys([outer])).resolves.toBe(true)
  })

  it('terminates on an Include cycle', async () => {
    const a = join(dir, 'a')
    const b = join(dir, 'b')
    await writeFile(a, `Include ${b}\n`, 'utf-8')
    await writeFile(b, `Include ${a}\n`, 'utf-8')

    await expect(siteConfigMayRestrictHostKeys([a])).resolves.toBe(false)
  })

  it('treats an unreadable config as doubt rather than permission', async () => {
    const file = join(dir, 'ssh_config')
    await writeFile(file, 'Host *\n', 'utf-8')
    await chmod(file, 0o000)

    try {
      await expect(siteConfigMayRestrictHostKeys([file])).resolves.toBe(true)
    } finally {
      await chmod(file, 0o600)
    }
  })
})
