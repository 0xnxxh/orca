import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import type { AiVaultDeleteSessionResult } from '../../shared/ai-vault-session-deletion'
import type { ValidateAiVaultSessionDeleteTargetArgs } from './session-delete-target'

const { trashItemMock } = vi.hoisted(() => ({ trashItemMock: vi.fn() }))

vi.mock('electron', () => ({ shell: { trashItem: trashItemMock } }))
vi.mock('../wsl-unc-delete', () => ({ tryDeleteWslUncPath: vi.fn().mockResolvedValue(false) }))

import { deleteAiVaultSessionFile } from './session-delete'
import { resolveAiVaultSessionLiveness } from './session-liveness'
import {
  qualifyAiVaultSessionLiveness,
  readAiVaultTranscriptFingerprint
} from './session-transcript-quiescence'

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
  getSessionLiveness: (filePath: string) => Promise<AiVaultSessionLiveness>
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
    { getSessionLiveness: () => getSessionLiveness(filePath) }
  )
  return { filePath, result }
}

// The production composition: the inventory verdict is only ever accepted after
// the transcript corroborates it.
function resolveThenQualify(
  filePath: string,
  deps: Parameters<typeof resolveAiVaultSessionLiveness>[1]
): Promise<AiVaultSessionLiveness> {
  return readAiVaultTranscriptFingerprint(filePath).then(async (observedBefore) =>
    qualifyAiVaultSessionLiveness({
      liveness: await resolveAiVaultSessionLiveness(
        { agent: 'gemini', sessionId: 'session-live' },
        deps
      ),
      filePath,
      observedBefore,
      nowMs: Date.now()
    })
  )
}

// Nothing Orca manages: no PTYs, no statuses — the shape every unmanaged owner
// presents to the inventory.
const EMPTY_INVENTORY = {
  listProcesses: async () => [],
  getStatusSnapshot: () => [],
  inspectForegroundProcess: async () => ({ available: true, process: 'zsh' }),
  getStatusPtyId: () => null,
  getAgentHint: () => null
} satisfies Parameters<typeof resolveAiVaultSessionLiveness>[1]

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

  it('survives an exact live local hook identity absent from managed PTY inventory', async () => {
    trashItemMock.mockImplementation((path: string) => rm(path))
    const inspectForegroundProcess = vi.fn()
    const externalLiveStatus: AgentStatusIpcPayload = {
      paneKey: 'tab:external-live',
      terminalHandle: 'term_external-live',
      connectionId: null,
      receivedAt: 1,
      stateStartedAt: 1,
      state: 'working',
      prompt: 'test',
      agentType: 'gemini',
      providerSession: { key: 'session_id', id: 'session-live' }
    }

    const { filePath, result } = await attemptDelete(() =>
      resolveAiVaultSessionLiveness(
        { agent: 'gemini', sessionId: 'session-live' },
        {
          listProcesses: async () => [],
          getStatusSnapshot: () => [externalLiveStatus],
          inspectForegroundProcess,
          getStatusPtyId: () => 'external-live',
          getAgentHint: () => null
        }
      )
    )

    expect.soft(result).toEqual({
      outcome: 'rejected',
      agent: 'gemini',
      reason: 'session-liveness-unknown'
    })
    expect.soft(existsSync(filePath), 'external live transcript must survive on disk').toBe(true)
    expect(inspectForegroundProcess).not.toHaveBeenCalled()
  })

  it('survives a dismissed live row retained as liveness-only identity', async () => {
    trashItemMock.mockImplementation((path: string) => rm(path))
    const retainedIdentity: AgentStatusIpcPayload = {
      paneKey: 'tab:external-live',
      connectionId: null,
      receivedAt: 1,
      stateStartedAt: 1,
      state: 'working',
      prompt: 'test',
      agentType: 'gemini',
      providerSession: { key: 'session_id', id: 'session-live' },
      providerSessionOnly: true
    }

    const { filePath, result } = await attemptDelete(() =>
      resolveAiVaultSessionLiveness(
        { agent: 'gemini', sessionId: 'session-live' },
        {
          listProcesses: async () => [],
          getStatusSnapshot: () => [retainedIdentity],
          inspectForegroundProcess: vi.fn(),
          getStatusPtyId: () => null,
          getAgentHint: () => null
        }
      )
    )

    expect.soft(result).toEqual({
      outcome: 'rejected',
      agent: 'gemini',
      reason: 'session-liveness-unknown'
    })
    expect.soft(existsSync(filePath), 'dismissed live transcript must survive on disk').toBe(true)
  })

  // The v1.4.177 regression class: the managed-PTY inventory can only ever
  // describe processes Orca spawned, so every owner below is invisible to it and
  // the raw inventory verdict is a confident, wrong "not-live".
  it('survives a local agent launched outside Orca and absent from the PTY inventory', async () => {
    trashItemMock.mockImplementation((path: string) => rm(path))

    const { filePath, result } = await attemptDelete((path) =>
      resolveThenQualify(path, EMPTY_INVENTORY)
    )

    expect.soft(result).toEqual({
      outcome: 'rejected',
      agent: 'gemini',
      reason: 'session-liveness-unknown'
    })
    expect.soft(existsSync(filePath), 'unmanaged local transcript must survive on disk').toBe(true)
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  it('survives a WSL-distro agent whose hook relay never reported a status', async () => {
    trashItemMock.mockImplementation((path: string) => rm(path))
    // A distro shell Orca did not spawn: the relay carries no status for it and
    // the one managed PTY on the host is an unrelated shell.
    const { filePath, result } = await attemptDelete((path) =>
      resolveThenQualify(path, {
        ...EMPTY_INVENTORY,
        listProcesses: async () => [
          { id: 'wsl-shell', terminalHandle: 'term_wsl-shell', cwd: '/workspace', title: 'bash' }
        ]
      })
    )

    expect.soft(result).toEqual({
      outcome: 'rejected',
      agent: 'gemini',
      reason: 'session-liveness-unknown'
    })
    expect.soft(existsSync(filePath), 'WSL transcript must survive on disk').toBe(true)
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  it('survives when every other agent process is attributed but the target is not', async () => {
    trashItemMock.mockImplementation((path: string) => rm(path))
    const otherSession: AgentStatusIpcPayload = {
      paneKey: 'tab:other',
      terminalHandle: 'term_other',
      connectionId: null,
      receivedAt: 1,
      stateStartedAt: 1,
      state: 'working',
      prompt: 'test',
      agentType: 'gemini',
      providerSession: { key: 'session_id', id: 'session-other' }
    }

    const { filePath, result } = await attemptDelete((path) =>
      resolveThenQualify(path, {
        ...EMPTY_INVENTORY,
        listProcesses: async () => [
          { id: 'other', terminalHandle: 'term_other', cwd: '/workspace', title: 'gemini' }
        ],
        getStatusSnapshot: () => [otherSession],
        inspectForegroundProcess: async () => ({ available: true, process: 'gemini' }),
        getStatusPtyId: () => 'other'
      })
    )

    expect.soft(result).toEqual({
      outcome: 'rejected',
      agent: 'gemini',
      reason: 'session-liveness-unknown'
    })
    expect.soft(existsSync(filePath), 'unattributed transcript must survive on disk').toBe(true)
    expect(trashItemMock).not.toHaveBeenCalled()
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
