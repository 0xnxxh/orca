import { lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataDir = ''
vi.mock('electron', () => ({ app: { getPath: () => userDataDir } }))

import {
  deleteWorktreeHistoryDir,
  flushPendingWorktreeHistoryDeletions
} from './terminal-history-deletion'
import { hashWorktreeId } from './terminal-history-paths'
import { deleteFishHistoryFile, fishHistorySessionName } from './fish-history-session'

describe('attested fish history deletion', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'orca-attested-history-'))
  })
  afterEach(async () => {
    await flushPendingWorktreeHistoryDeletions()
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('warns when an attested fish history file disappears before deletion', async () => {
    const worktreeId = 'repo::/missing-fish-history'
    const hash = hashWorktreeId(worktreeId)
    const dir = join(userDataDir, 'terminal-history', hash)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'meta.json'),
      JSON.stringify({ worktreeId, fishSession: fishHistorySessionName(hash) })
    )
    const session = fishHistorySessionName(hash)
    const historyPath = join(userDataDir, 'fish', `${session}_history`)
    const attestationPath = join(dir, 'fish-history-locations.json')
    mkdirSync(join(userDataDir, 'fish'), { recursive: true })
    writeFileSync(historyPath, 'history')
    const directory = lstatSync(join(userDataDir, 'fish'), { bigint: true })
    const file = lstatSync(historyPath, { bigint: true })
    writeFileSync(
      attestationPath,
      JSON.stringify({
        version: 2,
        fishSession: session,
        locations: [
          {
            path: historyPath,
            directoryDevice: directory.dev.toString(),
            directoryInode: directory.ino.toString(),
            directoryBirthtimeNs: directory.birthtimeNs.toString(),
            fileDevice: file.dev.toString(),
            fileInode: file.ino.toString(),
            fileBirthtimeNs: file.birthtimeNs.toString()
          }
        ]
      })
    )
    rmSync(historyPath)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      deleteFishHistoryFile(session, attestationPath)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('No attested fish history'))
      deleteWorktreeHistoryDir(worktreeId)
      await flushPendingWorktreeHistoryDeletions()
    } finally {
      warn.mockRestore()
    }
  })
})
