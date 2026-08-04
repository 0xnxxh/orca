import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle } from './session'
import { TerminalHost } from './terminal-host'

vi.mock('../pty-descendant-termination', () => ({ killWithDescendantSweep: vi.fn() }))

const PANE_KEY = 'tab-1:1b8c2f10-4a3e-4b1c-9d2e-7f6a5b4c3d2e'

function createSubprocess(): SubprocessHandle {
  let onExit: ((code: number) => void) | null = null
  return {
    pid: 99_999,
    getForegroundProcess: vi.fn(() => null),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(() => onExit?.(0)),
    forceKill: vi.fn(() => onExit?.(137)),
    signal: vi.fn(),
    onData: () => {},
    onExit: (callback) => {
      onExit = callback
    },
    dispose: vi.fn()
  }
}

describe('TerminalHost session pane identity', () => {
  let host: TerminalHost

  afterEach(async () => {
    await host?.dispose()
  })

  async function listWithPaneEnv(paneKey?: string) {
    host = new TerminalHost({ spawnSubprocess: () => createSubprocess() })
    await host.createOrAttach({
      sessionId: 'pane-test',
      cols: 80,
      rows: 24,
      env: {
        ORCA_TERMINAL_HANDLE: 'term_abc',
        ...(paneKey === undefined ? {} : { ORCA_PANE_KEY: paneKey })
      },
      streamClient: { onData: vi.fn(), onExit: vi.fn() }
    })
    return host.listSessions()[0]
  }

  it('retains and lists a valid ORCA_PANE_KEY', async () => {
    expect(await listWithPaneEnv(PANE_KEY)).toMatchObject({
      terminalHandle: 'term_abc',
      paneKey: PANE_KEY
    })
  })

  // Why: an absent key must omit the field, not emit null — older adapters read
  // the listing structurally and a null would read as "known to have no pane".
  it('omits paneKey entirely when ORCA_PANE_KEY is absent', async () => {
    const listed = await listWithPaneEnv(undefined)
    expect(listed).not.toHaveProperty('paneKey')
    expect(listed.terminalHandle).toBe('term_abc')
  })

  it.each([
    ['no delimiter', 'tab-1'],
    ['non-UUID leaf', 'tab-1:pane-3'],
    ['extra delimiter', 'tab-1:2:1b8c2f10-4a3e-4b1c-9d2e-7f6a5b4c3d2e'],
    ['empty tabId', ':1b8c2f10-4a3e-4b1c-9d2e-7f6a5b4c3d2e'],
    ['empty value', ''],
    ['overlong', `${'t'.repeat(300)}:1b8c2f10-4a3e-4b1c-9d2e-7f6a5b4c3d2e`]
  ])('drops a malformed ORCA_PANE_KEY (%s)', async (_label, value) => {
    expect(await listWithPaneEnv(value)).not.toHaveProperty('paneKey')
  })
})
