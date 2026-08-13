import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  it('deletes each attested XDG location and caps retained identities', () => {
    const paths: string[] = []
    for (let index = 0; index < MAX_RETAINED_FISH_HISTORY_PATHS + 2; index += 1) {
      const path = historyPath(join(root, `data-${index}`))
      attestFishHistoryLocation(attestationPath, session, path)
      writeFileSync(path, `history-${index}`)
      paths.push(path)
    }

    deleteFishHistoryFile(session, attestationPath)

    expect(existsSync(paths[0])).toBe(true)
    expect(existsSync(paths[1])).toBe(true)
    expect(paths.slice(2).every((path) => !existsSync(path))).toBe(true)
  })

  it('ignores a tampered meta.json path to an unrelated same-named file', () => {
    const owned = historyPath(join(root, 'owned-data'))
    const unrelated = historyPath(join(root, 'unrelated-data'))
    attestFishHistoryLocation(attestationPath, session, owned)
    writeFileSync(owned, 'owned')
    mkdirSync(join(root, 'unrelated-data', 'fish'), { recursive: true })
    writeFileSync(unrelated, 'unrelated')
    writeFileSync(
      join(root, 'orca-history', 'meta.json'),
      JSON.stringify({ fishSession: session, fishHistoryPath: unrelated })
    )

    deleteFishHistoryFile(session, attestationPath)

    expect(existsSync(owned)).toBe(false)
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
})
