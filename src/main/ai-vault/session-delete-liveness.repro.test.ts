import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiVaultDeleteSessionResult } from '../../shared/ai-vault-session-deletion'
import type { ValidateAiVaultSessionDeleteTargetArgs } from './session-delete-target'

const { trashItemMock } = vi.hoisted(() => ({ trashItemMock: vi.fn() }))

vi.mock('electron', () => ({ shell: { trashItem: trashItemMock } }))
vi.mock('../wsl-unc-delete', () => ({ tryDeleteWslUncPath: vi.fn().mockResolvedValue(false) }))

import { deleteAiVaultSessionFile } from './session-delete'

type AiVaultSessionLiveness = 'live' | 'not-live' | 'unknown'

type DeleteWithLiveness = (
  args: ValidateAiVaultSessionDeleteTargetArgs & { sessionId: string },
  deps: { getSessionLiveness: () => Promise<AiVaultSessionLiveness> }
) => Promise<AiVaultDeleteSessionResult>

const deleteWithLiveness = deleteAiVaultSessionFile as unknown as DeleteWithLiveness
const fixtureRoots: string[] = []

async function createTranscript(): Promise<{ filePath: string; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'orca-ai-vault-live-delete-repro-'))
  fixtureRoots.push(root)
  const filePath = join(root, 'session-live.json')
  await writeFile(filePath, '{"sessionId":"session-live"}\n')
  return { filePath, root }
}

async function attemptDelete(
  getSessionLiveness: () => Promise<AiVaultSessionLiveness>
): Promise<{ filePath: string; result: AiVaultDeleteSessionResult }> {
  const { filePath, root } = await createTranscript()
  const result = await deleteWithLiveness(
    {
      agent: 'gemini',
      sessionId: 'session-live',
      filePath,
      executionHostId: 'local',
      rootOptions: { geminiSessionsDir: root }
    },
    { getSessionLiveness }
  )
  return { filePath, result }
}

describe('live AI Vault session delete safety invariant', () => {
  afterEach(async () => {
    trashItemMock.mockReset()
    await Promise.all(
      fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
    )
  })

  it('survives when the session becomes live after confirmation but before main authorization', async () => {
    trashItemMock.mockImplementation((path: string) => rm(path))
    const rendererPaneSnapshot = new Set<string>()
    expect(rendererPaneSnapshot.has('session-live')).toBe(false)

    let authoritativeLiveness: AiVaultSessionLiveness = 'not-live'
    const confirmationOpened = true
    authoritativeLiveness = 'live'
    expect(confirmationOpened).toBe(true)

    const { filePath, result } = await attemptDelete(async () => authoritativeLiveness)

    expect.soft(result).toEqual({ outcome: 'rejected', agent: 'gemini', reason: 'session-live' })
    expect.soft(existsSync(filePath), 'live transcript must survive on disk').toBe(true)
  })

  it('survives when a paired owner is absent from the renderer pane snapshot', async () => {
    trashItemMock.mockImplementation((path: string) => rm(path))
    const rendererPaneSnapshot = new Set<string>()
    const authoritativeOwner = {
      runtimeId: 'host-runtime',
      connectionId: 'paired-client',
      generation: 'generation-1',
      sessionId: 'session-live',
      liveness: 'live' as const
    }
    expect(rendererPaneSnapshot.has(authoritativeOwner.sessionId)).toBe(false)

    const { filePath, result } = await attemptDelete(async () => authoritativeOwner.liveness)

    expect.soft(result).toEqual({ outcome: 'rejected', agent: 'gemini', reason: 'session-live' })
    expect.soft(existsSync(filePath), 'externally owned transcript must survive on disk').toBe(true)
  })

  it('fails closed when authoritative liveness is unavailable', async () => {
    trashItemMock.mockImplementation((path: string) => rm(path))

    const { filePath, result } = await attemptDelete(async () => 'unknown')

    expect(result).toEqual({
      outcome: 'rejected',
      agent: 'gemini',
      reason: 'session-liveness-unknown'
    })
    expect(existsSync(filePath), 'unknown-liveness transcript must survive on disk').toBe(true)
  })
})
