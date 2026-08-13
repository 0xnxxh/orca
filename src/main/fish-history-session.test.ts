import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  attestFishHistoryLocation,
  deleteFishHistoryFile,
  MAX_RETAINED_FISH_HISTORY_PATHS
} from './fish-history-session'

describe('fish history location attestation', () => {
  const session = 'orca_0123456789abcdef'
  let root: string
  let attestationPath: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'orca-fish-attestation-')))
    attestationPath = join(root, 'orca-history', 'fish-history-locations.json')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function historyPath(dataRoot: string): string {
    return join(dataRoot, 'fish', `${session}_history`)
  }

  it('retains only bounded v2 attested XDG locations', () => {
    const paths: string[] = []
    for (let index = 0; index < MAX_RETAINED_FISH_HISTORY_PATHS + 2; index += 1) {
      const path = historyPath(join(root, `data-${index}`))
      attestFishHistoryLocation(attestationPath, session, path)
      writeFileSync(path, `history-${index}`)
      paths.push(path)
    }

    const record = JSON.parse(readFileSync(attestationPath, 'utf8')) as {
      version: number
      fishSession: string
      locations: { path: string }[]
    }
    expect(record.version).toBe(2)
    expect(record.fishSession).toBe(session)
    expect(record.locations).toHaveLength(MAX_RETAINED_FISH_HISTORY_PATHS)
    expect(record.locations.map(({ path }) => path)).toEqual(
      paths.slice(-MAX_RETAINED_FISH_HISTORY_PATHS)
    )
  })

  it('ignores a tampered meta.json path to an unrelated same-named file', () => {
    const owned = historyPath(join(root, 'owned-data'))
    const unrelated = historyPath(join(root, 'unrelated-data'))
    attestFishHistoryLocation(attestationPath, session, owned)
    writeFileSync(owned, 'owned')
    mkdirSync(join(root, 'unrelated-data', 'fish'), { recursive: true })
    writeFileSync(unrelated, 'unrelated')
    writeFileSync(
      attestationPath,
      JSON.stringify({
        version: 2,
        fishSession: session,
        locations: [{ path: unrelated }]
      })
    )

    deleteFishHistoryFile(session, attestationPath)

    expect(readFileSync(owned, 'utf8')).toBe('owned')
    expect(readFileSync(unrelated, 'utf8')).toBe('unrelated')
  })

  it.skipIf(process.platform === 'win32')(
    'rejects a fish parent replaced by a symlink before cleanup',
    () => {
      const dataRoot = join(root, 'data')
      const owned = historyPath(dataRoot)
      attestFishHistoryLocation(attestationPath, session, owned)
      rmSync(join(dataRoot, 'fish'), { recursive: true })

      const targetDir = join(root, 'target-fish')
      mkdirSync(targetDir)
      const target = join(targetDir, `${session}_history`)
      writeFileSync(target, 'unrelated')
      symlinkSync(targetDir, join(dataRoot, 'fish'), 'dir')

      deleteFishHistoryFile(session, attestationPath)

      expect(readFileSync(target, 'utf8')).toBe('unrelated')
    }
  )

  it('rejects a recreated fish directory with a different identity', () => {
    const dataRoot = join(root, 'data')
    const owned = historyPath(dataRoot)
    attestFishHistoryLocation(attestationPath, session, owned)
    rmSync(join(dataRoot, 'fish'), { recursive: true })
    mkdirSync(join(dataRoot, 'fish'))
    writeFileSync(owned, 'replacement')

    deleteFishHistoryFile(session, attestationPath)

    expect(readFileSync(owned, 'utf8')).toBe('replacement')
  })

  it('rejects a final history symlink replacement', () => {
    const dataRoot = join(root, 'data')
    const owned = historyPath(dataRoot)
    attestFishHistoryLocation(attestationPath, session, owned)
    const target = join(root, 'target-history')
    writeFileSync(target, 'unrelated')
    rmSync(owned)
    symlinkSync(target, owned)

    deleteFishHistoryFile(session, attestationPath)

    expect(readFileSync(target, 'utf8')).toBe('unrelated')
  })

  it('rejects a replacement regular file with a different identity', () => {
    const dataRoot = join(root, 'data')
    const owned = historyPath(dataRoot)
    attestFishHistoryLocation(attestationPath, session, owned)
    rmSync(owned)
    writeFileSync(owned, 'replacement')

    deleteFishHistoryFile(session, attestationPath)

    expect(readFileSync(owned, 'utf8')).toBe('replacement')
  })

  it('fails closed for version-one attestations without file identity', () => {
    const dataRoot = join(root, 'data')
    const owned = historyPath(dataRoot)
    mkdirSync(dirname(owned), { recursive: true })
    writeFileSync(owned, 'history')
    mkdirSync(dirname(attestationPath), { recursive: true })
    writeFileSync(
      attestationPath,
      JSON.stringify({
        version: 1,
        fishSession: session,
        locations: [
          { path: owned, directoryDevice: '1', directoryInode: '1', directoryBirthtimeNs: '1' }
        ]
      })
    )

    deleteFishHistoryFile(session, attestationPath)

    expect(readFileSync(owned, 'utf8')).toBe('history')
  })
})
