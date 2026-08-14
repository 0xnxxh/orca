import { afterEach, describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSshGOutput, type SshResolvedConfig } from './ssh-g-config-resolution'
import { matchKnownHosts, readHostKeyType, type KnownHostsEntry } from './ssh-known-hosts'
import {
  defaultKnownHostsFiles,
  loadKnownHostsEntries,
  loadKnownHostsEvidence,
  resolveKnownHostsFiles,
  resolveKnownHostsLookupHost
} from './ssh-known-hosts-source'

const ED_A = 'AAAAC3NzaC1lZDI1NTE5AAAAIKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
const ED_B = 'AAAAC3NzaC1lZDI1NTE5AAAAILu7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7'
const ED_C = 'AAAAC3NzaC1lZDI1NTE5AAAAIMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzM'

const blob = (base64: string): Buffer => Buffer.from(base64, 'base64')
const hostLine = (hosts: string, key: string): string => `${hosts} ssh-ed25519 ${key}\n`

function verdict(entries: KnownHostsEntry[], host: string, key: string): string {
  return matchKnownHosts(entries, {
    host,
    port: 22,
    keyType: readHostKeyType(blob(key)) ?? '',
    key: blob(key)
  })
}

const roots: string[] = []
const savedHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-known-hosts-'))
  roots.push(root)
  return root
}

/** os.homedir() reads HOME on POSIX and USERPROFILE on Windows. */
function pretendHomeIs(path: string): void {
  process.env.HOME = path
  process.env.USERPROFILE = path
}

function resolvedConfig(overrides: Partial<SshResolvedConfig> = {}): SshResolvedConfig {
  return {
    hostname: 'prod.internal',
    port: 22,
    identityFile: [],
    identitiesOnly: false,
    forwardAgent: false,
    proxyUseFdpass: false,
    controlMaster: 'no',
    controlPersist: 'no',
    userKnownHostsFiles: [],
    globalKnownHostsFiles: [],
    strictHostKeyChecking: 'ask',
    hashKnownHosts: false,
    updateHostKeys: 'no',
    ...overrides
  }
}

afterEach(async () => {
  for (const key of ['HOME', 'USERPROFILE'] as const) {
    const value = savedHome[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('resolveKnownHostsFiles', () => {
  it('splits the space-separated list ssh -G prints on one line', () => {
    const resolved = parseSshGOutput(
      [
        'hostname prod.internal',
        'userknownhostsfile /a/known_hosts /a/known_hosts2 /b/known_hosts',
        'globalknownhostsfile /etc/ssh/ssh_known_hosts /etc/ssh/ssh_known_hosts2'
      ].join('\n')
    )

    expect(resolved.userKnownHostsFiles).toEqual([
      '/a/known_hosts',
      '/a/known_hosts2',
      '/b/known_hosts'
    ])
    expect(resolveKnownHostsFiles(resolved)).toEqual([
      '/a/known_hosts',
      '/a/known_hosts2',
      '/b/known_hosts',
      '/etc/ssh/ssh_known_hosts',
      '/etc/ssh/ssh_known_hosts2'
    ])
  })

  it('expands ~ in a reported path', () => {
    pretendHomeIs(join('/pretend', 'home'))

    const resolved = parseSshGOutput('userknownhostsfile ~/.ssh/known_hosts ~/other_hosts')

    expect(resolveKnownHostsFiles(resolved)).toEqual([
      join('/pretend', 'home', '.ssh', 'known_hosts'),
      join('/pretend', 'home', 'other_hosts')
    ])
  })

  it('keeps a double-quoted path containing spaces whole', () => {
    const resolved = parseSshGOutput(
      'userknownhostsfile "/Users/dev/my hosts/known_hosts" /plain/known_hosts'
    )

    expect(resolveKnownHostsFiles(resolved)).toEqual([
      '/Users/dev/my hosts/known_hosts',
      '/plain/known_hosts'
    ])
  })

  it('falls back to the default files when ssh -G reported nothing', () => {
    pretendHomeIs(join('/pretend', 'home'))

    // Why not an empty list: no ssh, a non-zero exit or a timeout must not turn a host the user
    // already verified into first contact.
    expect(resolveKnownHostsFiles(null)).toEqual([
      join('/pretend', 'home', '.ssh', 'known_hosts'),
      join('/pretend', 'home', '.ssh', 'known_hosts2')
    ])
    expect(defaultKnownHostsFiles()).toEqual(resolveKnownHostsFiles(null))
  })

  it('drops an explicit none without falling back to the defaults', () => {
    const resolved = parseSshGOutput(
      ['userknownhostsfile none', 'globalknownhostsfile /etc/ssh/ssh_known_hosts'].join('\n')
    )

    expect(resolveKnownHostsFiles(resolved)).toEqual(['/etc/ssh/ssh_known_hosts'])
  })
})

describe('loadKnownHostsEntries', () => {
  it('unions the entries of every file', async () => {
    const root = await createRoot()
    const userFile = join(root, 'known_hosts')
    const globalFile = join(root, 'ssh_known_hosts')
    await writeFile(userFile, hostLine('alpha.example', ED_A))
    await writeFile(globalFile, hostLine('beta.example', ED_B))

    const entries = await loadKnownHostsEntries([userFile, globalFile])

    expect(entries).toHaveLength(2)
    expect(verdict(entries, 'alpha.example', ED_A)).toBe('match')
    expect(verdict(entries, 'beta.example', ED_B)).toBe('match')
  })

  it('lets a hit in either file win over a disagreeing entry in the other', async () => {
    const root = await createRoot()
    const first = join(root, 'first')
    const second = join(root, 'second')
    await writeFile(first, hostLine('shared.example', ED_A))
    await writeFile(second, hostLine('shared.example', ED_B))

    const entries = await loadKnownHostsEntries([first, second])

    expect(verdict(entries, 'shared.example', ED_A)).toBe('match')
    expect(verdict(entries, 'shared.example', ED_B)).toBe('match')
    // The union still detects a key neither file holds.
    expect(verdict(entries, 'shared.example', ED_C)).toBe('mismatch')
  })

  it('skips a missing file and keeps the rest', async () => {
    const root = await createRoot()
    const present = join(root, 'known_hosts')
    await writeFile(present, hostLine('alpha.example', ED_A))

    const entries = await loadKnownHostsEntries([join(root, 'absent'), present])

    expect(verdict(entries, 'alpha.example', ED_A)).toBe('match')
  })

  it('skips a path that is a directory', async () => {
    const root = await createRoot()
    const present = join(root, 'known_hosts')
    await mkdir(join(root, 'a_directory'))
    await writeFile(present, hostLine('alpha.example', ED_A))

    const entries = await loadKnownHostsEntries([join(root, 'a_directory'), present])

    expect(verdict(entries, 'alpha.example', ED_A)).toBe('match')
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'skips an unreadable file and keeps the rest',
    async () => {
      const root = await createRoot()
      const unreadable = join(root, 'unreadable')
      const present = join(root, 'known_hosts')
      await writeFile(unreadable, hostLine('secret.example', ED_B))
      await chmod(unreadable, 0o000)
      await writeFile(present, hostLine('alpha.example', ED_A))

      const entries = await loadKnownHostsEntries([unreadable, present])

      expect(verdict(entries, 'alpha.example', ED_A)).toBe('match')
      expect(verdict(entries, 'secret.example', ED_B)).toBe('unknown')
    }
  )

  it('returns nothing when no file can be read', async () => {
    const root = await createRoot()

    await expect(loadKnownHostsEntries([join(root, 'absent')])).resolves.toEqual([])
  })
})

// The caller turns this count into a refusal, so the line between the two cases is the line between
// "every connection works" and "no connection works".
describe('loadKnownHostsEvidence', () => {
  // A profile that has never connected has no known_hosts — ssh writes one on its own first
  // connect. Counting that as a source we failed to read would refuse every first connection every
  // new user ever makes.
  it('does not count an absent file as unreadable', async () => {
    const root = await createRoot()

    const evidence = await loadKnownHostsEvidence([
      join(root, 'known_hosts'),
      join(root, 'known_hosts2')
    ])

    expect(evidence.unreadableFileCount).toBe(0)
    expect(evidence.entries).toEqual([])
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'counts a file that exists but will not open',
    async () => {
      const root = await createRoot()
      const unreadable = join(root, 'known_hosts')
      await writeFile(unreadable, hostLine('secret.example', ED_B))
      await chmod(unreadable, 0o000)

      const evidence = await loadKnownHostsEvidence([unreadable])

      // The entry that would have said "this key changed" could be in here; we cannot tell.
      expect(evidence.unreadableFileCount).toBe(1)
    }
  )

  it('counts a path that is a directory', async () => {
    const root = await createRoot()
    await mkdir(join(root, 'a_directory'))

    const evidence = await loadKnownHostsEvidence([join(root, 'a_directory')])

    expect(evidence.unreadableFileCount).toBe(1)
  })

  it('reports nothing unreadable when every file parses', async () => {
    const root = await createRoot()
    const present = join(root, 'known_hosts')
    await writeFile(present, hostLine('alpha.example', ED_A))

    const evidence = await loadKnownHostsEvidence([present])

    expect(evidence.unreadableFileCount).toBe(0)
    expect(evidence.entries).toHaveLength(1)
  })

  // An empty file is a file we read successfully. Nothing is withheld, so nothing is suppressed.
  it('does not count an empty file as unreadable', async () => {
    const root = await createRoot()
    const empty = join(root, 'known_hosts')
    await writeFile(empty, '')

    const evidence = await loadKnownHostsEvidence([empty])

    expect(evidence.unreadableFileCount).toBe(0)
  })
})

describe('resolveKnownHostsLookupHost', () => {
  it('prefers HostKeyAlias over the resolved hostname', () => {
    // A bastion tunnelled through localhost:2200 would otherwise mismatch on every target.
    const resolved = resolvedConfig({ hostname: '127.0.0.1', hostKeyAlias: 'bastion' })

    expect(resolveKnownHostsLookupHost(resolved, '127.0.0.1')).toBe('bastion')
  })

  // INVERTED from 'uses the resolved hostname, never the Orca label'. That test encoded an
  // assumption verified false against OpenSSH 10.2p1: `ssh -G` echoes its own argument back as
  // `hostname` when no Host block matches, so for a manual target `resolved.hostname` IS the Orca
  // label — the one name the design forbids keying on, and one `ssh` never wrote. Keying on it
  // consults no entries at all, so an impersonated host reads as first contact.
  //
  // The dialed host is correct in both cases: buildConnectConfig has already applied HostName
  // resolution, so a config alias dials the real host too.
  it('uses the dialed host, because a resolved hostname can just echo the label', () => {
    const resolved = resolvedConfig({ hostname: 'my-orca-label' })

    expect(resolveKnownHostsLookupHost(resolved, '10.0.0.5')).toBe('10.0.0.5')
  })

  it('still prefers an explicit HostKeyAlias over the dialed host', () => {
    const resolved = resolvedConfig({ hostname: 'my-orca-label', hostKeyAlias: 'bastion' })

    expect(resolveKnownHostsLookupHost(resolved, '10.0.0.5')).toBe('bastion')
  })

  it('falls back to the dialed host when nothing was resolved', () => {
    expect(resolveKnownHostsLookupHost(null, 'direct.example')).toBe('direct.example')
    expect(resolveKnownHostsLookupHost(resolvedConfig({ hostname: '' }), 'direct.example')).toBe(
      'direct.example'
    )
  })
})
