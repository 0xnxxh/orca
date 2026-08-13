import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  fishHistorySessionName,
  MAX_RETAINED_FISH_HISTORY_PATHS
} from '../main/fish-history-session'
import { hashWorktreeId } from '../main/terminal-history-id'
import { deleteRelayFishHistory, recordRelayFishHistoryPath } from './fish-history-metadata'

describe('relay Fish history metadata', () => {
  let root: string
  let dataRoot: string
  const worktreeId = 'repo-1::/remote/wt'
  const hash = hashWorktreeId(worktreeId)
  const session = fishHistorySessionName(hash)

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'orca-relay-fish-meta-'))
    dataRoot = join(root, 'data')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('retains only the latest distinct paths and preserves the active path', () => {
    const metadataRoot = join(root, 'metadata')
    for (let index = 0; index < 40; index += 1) {
      recordRelayFishHistoryPath(
        worktreeId,
        { XDG_DATA_HOME: join(dataRoot, String(index)) },
        metadataRoot
      )
    }
    recordRelayFishHistoryPath(worktreeId, { XDG_DATA_HOME: join(dataRoot, '39') }, metadataRoot)

    const meta = JSON.parse(readFileSync(join(metadataRoot, `${hash}.json`), 'utf8')) as {
      fishHistoryPath: string
      fishHistoryPaths: string[]
    }
    expect(meta.fishHistoryPaths).toHaveLength(MAX_RETAINED_FISH_HISTORY_PATHS)
    expect(new Set(meta.fishHistoryPaths).size).toBe(MAX_RETAINED_FISH_HISTORY_PATHS)
    expect(meta.fishHistoryPath).toBe(join(dataRoot, '39', 'fish', `${session}_history`))
    expect(meta.fishHistoryPaths.at(-1)).toBe(meta.fishHistoryPath)
  })

  it('replaces malformed metadata without retaining an unrelated path', () => {
    const metadataRoot = join(root, 'metadata')
    mkdirSync(metadataRoot, { recursive: true })
    const unrelated = join(dataRoot, 'fish', 'fish_history')
    writeFileSync(
      join(metadataRoot, `${hash}.json`),
      JSON.stringify({ fishSession: session, fishHistoryPaths: [unrelated, null] })
    )

    recordRelayFishHistoryPath(worktreeId, { XDG_DATA_HOME: dataRoot }, metadataRoot)

    const meta = JSON.parse(readFileSync(join(metadataRoot, `${hash}.json`), 'utf8')) as {
      fishHistoryPaths: string[]
    }
    expect(meta.fishHistoryPaths).toEqual([join(dataRoot, 'fish', `${session}_history`)])
  })

  it('deletes recorded XDG paths and its bounded metadata', () => {
    const metadataRoot = join(root, 'metadata')
    const historyFile = join(dataRoot, 'fish', `${session}_history`)
    mkdirSync(join(dataRoot, 'fish'), { recursive: true })
    writeFileSync(historyFile, 'secret')
    recordRelayFishHistoryPath(worktreeId, { XDG_DATA_HOME: dataRoot }, metadataRoot)

    deleteRelayFishHistory(worktreeId, metadataRoot, { XDG_DATA_HOME: dataRoot })

    expect(existsSync(historyFile)).toBe(false)
    expect(existsSync(join(metadataRoot, `${hash}.json`))).toBe(false)
  })
})
