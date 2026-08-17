import { describe, expect, it } from 'vitest'
import {
  applyWatcherEventRootPathRewrite,
  createWatcherEventRootPathRewrite,
  resolveWatcherRootPaths
} from './watcher-event-root-path-rewrite'

describe('createWatcherEventRootPathRewrite', () => {
  it('maps symlink-resolved macOS paths back onto the subscribed root', () => {
    const rewrite = createWatcherEventRootPathRewrite('/tmp/link', '/private/tmp/real', 'darwin')
    expect(rewrite('/private/tmp/real/src/a.ts')).toBe('/tmp/link/src/a.ts')
    expect(rewrite('/private/tmp/real')).toBe('/tmp/link')
  })

  it('maps on-disk casing back onto the subscribed spelling on macOS', () => {
    const rewrite = createWatcherEventRootPathRewrite(
      '/Users/dev/repo',
      '/Users/dev/repo',
      'darwin'
    )
    expect(rewrite('/Users/dev/Repo/src/a.ts')).toBe('/Users/dev/repo/src/a.ts')
  })

  it('keeps paths already spelled like the subscribed root untouched', () => {
    const rewrite = createWatcherEventRootPathRewrite('/tmp/link', '/private/tmp/real', 'darwin')
    const eventPath = '/tmp/link/src/a.ts'
    expect(rewrite(eventPath)).toBe(eventPath)
  })

  it('leaves paths outside the canonical root alone', () => {
    const rewrite = createWatcherEventRootPathRewrite('/tmp/link', '/private/tmp/real', 'darwin')
    expect(rewrite('/private/tmp/other/a.ts')).toBe('/private/tmp/other/a.ts')
  })

  it('stays case-sensitive on Linux', () => {
    const rewrite = createWatcherEventRootPathRewrite('/home/dev/repo', '/home/dev/repo', 'linux')
    expect(rewrite('/home/dev/Repo/src/a.ts')).toBe('/home/dev/Repo/src/a.ts')
  })

  it('does not treat backslash as a separator for POSIX roots', () => {
    const rewrite = createWatcherEventRootPathRewrite('/tmp/link', '/private/tmp/real', 'darwin')
    expect(rewrite('/private/tmp/real/we\\ird/a.ts')).toBe('/tmp/link/we\\ird/a.ts')
  })

  it('rewrites Windows junction targets with the requested drive spelling', () => {
    const rewrite = createWatcherEventRootPathRewrite('C:\\link', 'D:\\real\\repo', 'win32')
    expect(rewrite('D:\\real\\repo\\src\\a.ts')).toBe('C:\\link\\src\\a.ts')
  })

  it('keeps a forward-slash Windows root spelled with forward slashes', () => {
    const rewrite = createWatcherEventRootPathRewrite('C:/link', 'C:\\real\\repo', 'win32')
    expect(rewrite('C:\\real\\repo\\src\\a.ts')).toBe('C:/link/src\\a.ts')
  })

  it('folds Unicode composition differences without slicing mid-character', () => {
    const composed = '/Users/dev/caf\u00e9'
    const decomposed = '/Users/dev/cafe\u0301'
    const rewrite = createWatcherEventRootPathRewrite(composed, composed, 'darwin')
    expect(rewrite(`${decomposed}/src/a.ts`)).toBe(`${composed}/src/a.ts`)
  })
})

describe('resolveWatcherRootPaths', () => {
  it('falls back to the literal root when realpath fails', () => {
    const { watchRoot, rewriteEventPath } = resolveWatcherRootPaths('/tmp/gone', {
      realpath: () => {
        throw new Error('ENOENT')
      },
      platform: 'linux'
    })
    expect(watchRoot).toBe('/tmp/gone')
    expect(rewriteEventPath('/tmp/gone/a.ts')).toBe('/tmp/gone/a.ts')
  })

  // Why: Linux cannot inotify-watch a symlink at all (IN_ONLYDIR), so the
  // resolved directory — not the caller's spelling — is what gets watched.
  it('watches the resolved root and restores the caller spelling', () => {
    const { watchRoot, rewriteEventPath } = resolveWatcherRootPaths('/tmp/link', {
      realpath: () => '/private/tmp/real',
      platform: 'darwin'
    })
    expect(watchRoot).toBe('/private/tmp/real')
    expect(rewriteEventPath('/private/tmp/real/a.ts')).toBe('/tmp/link/a.ts')
  })
})

describe('applyWatcherEventRootPathRewrite', () => {
  it('returns the same array when nothing needs rewriting', () => {
    const rewrite = createWatcherEventRootPathRewrite('/tmp/link', '/tmp/link', 'linux')
    const events = [{ path: '/tmp/link/a.ts', type: 'update' as const }]
    expect(applyWatcherEventRootPathRewrite(events, rewrite)).toBe(events)
  })

  it('rewrites only the events that moved', () => {
    const rewrite = createWatcherEventRootPathRewrite('/tmp/link', '/private/tmp/real', 'darwin')
    const events = [
      { path: '/tmp/link/a.ts', type: 'update' as const },
      { path: '/private/tmp/real/b.ts', type: 'create' as const }
    ]
    expect(applyWatcherEventRootPathRewrite(events, rewrite)).toEqual([
      { path: '/tmp/link/a.ts', type: 'update' },
      { path: '/tmp/link/b.ts', type: 'create' }
    ])
  })
})
