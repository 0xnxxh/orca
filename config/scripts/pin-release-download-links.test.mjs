import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  pinReleaseDownloadLinks,
  pinReleaseDownloadLinksInText
} from './pin-release-download-links.mjs'

const tempDirs = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('pinReleaseDownloadLinksInText', () => {
  it('pins mutable and stale desktop links without changing mobile releases', () => {
    const text = [
      'https://github.com/stablyai/orca/releases/latest/download/orca-windows-setup.exe',
      'https://github.com/stablyai/orca/releases/download/v1.4.147-rc.3/orca-linux.AppImage',
      'https://github.com/stablyai/orca/releases/latest',
      'https://github.com/stablyai/orca/releases/download/mobile-android-v0.0.43/app-release.apk'
    ].join('\n')

    expect(pinReleaseDownloadLinksInText(text, 'v1.4.178')).toBe(
      [
        'https://github.com/stablyai/orca/releases/download/v1.4.178/orca-windows-setup.exe?download=1',
        'https://github.com/stablyai/orca/releases/download/v1.4.178/orca-linux.AppImage?download=1',
        'https://github.com/stablyai/orca/releases/tag/v1.4.178',
        'https://github.com/stablyai/orca/releases/download/mobile-android-v0.0.43/app-release.apk'
      ].join('\n')
    )
  })

  it('rejects prerelease and evidence tags', () => {
    expect(() => pinReleaseDownloadLinksInText('text', 'v1.4.179-rc.1')).toThrow(/non-stable/)
    expect(() => pinReleaseDownloadLinksInText('text', 'qa-pr13411')).toThrow(/non-stable/)
    expect(() => pinReleaseDownloadLinksInText('text', 'v01.4.178')).toThrow(/non-stable/)
  })

  it('keeps an already pinned download query idempotent', () => {
    const pinned =
      'https://github.com/stablyai/orca/releases/download/v1.4.178/orca-macos-arm64.dmg?download=1'
    expect(pinReleaseDownloadLinksInText(pinned, 'v1.4.178')).toBe(pinned)
  })
})

describe('pinReleaseDownloadLinks', () => {
  it('writes only files whose release links changed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orca-release-links-'))
    tempDirs.push(dir)
    const mutable = join(dir, 'mutable.md')
    const fixed = join(dir, 'fixed.md')
    await writeFile(
      mutable,
      'https://github.com/stablyai/orca/releases/latest/download/orca-macos-arm64.dmg'
    )
    await writeFile(fixed, 'https://example.com/download')

    await expect(pinReleaseDownloadLinks('v1.4.178', [mutable, fixed])).resolves.toEqual([mutable])
    await expect(readFile(mutable, 'utf8')).resolves.toContain(
      '/download/v1.4.178/orca-macos-arm64.dmg?download=1'
    )
    await expect(readFile(fixed, 'utf8')).resolves.toBe('https://example.com/download')
  })
})
