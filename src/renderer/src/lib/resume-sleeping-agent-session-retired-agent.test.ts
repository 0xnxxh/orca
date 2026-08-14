import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SleepingAgentSessionRecord } from '../../../shared/agent-session-resume'
import { useAppStore } from '@/store'
import { resumeSleepingAgentSessionsForWorktree } from './resume-sleeping-agent-session'

const initialAppStoreState = useAppStore.getState()

afterEach(() => {
  vi.unstubAllGlobals()
  useAppStore.setState(initialAppStoreState, true)
})

describe('retired-agent sleeping-session recovery', () => {
  it('clears retired-agent records without wedging resume of valid sessions', () => {
    const retired: SleepingAgentSessionRecord = {
      paneKey: 'tab-1:leaf-1',
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      // Why: persisted data violates the type; pre-retirement builds wrote gemini.
      agent: 'gemini' as SleepingAgentSessionRecord['agent'],
      providerSession: { key: 'session_id', id: 'sess-0' },
      prompt: 'legacy gemini work',
      state: 'working',
      capturedAt: 1,
      updatedAt: 1
    }
    const valid: SleepingAgentSessionRecord = {
      paneKey: 'tab-2:leaf-1',
      tabId: 'tab-2',
      worktreeId: 'wt-1',
      agent: 'pi',
      providerSession: {
        key: 'session_id',
        id: 'sess-1',
        transcriptPath: 'transcript-file'
      },
      prompt: 'finish the task',
      state: 'working',
      capturedAt: 2,
      updatedAt: 2
    }
    useAppStore.setState({
      tabsByWorktree: { 'wt-1': [] },
      sleepingAgentSessionsByPaneKey: {
        [retired.paneKey]: retired,
        [valid.paneKey]: valid
      }
    } as never)

    const launched = resumeSleepingAgentSessionsForWorktree('wt-1')

    const state = useAppStore.getState()
    expect(launched).toBe(1)
    expect(state.tabsByWorktree['wt-1']?.[0]?.launchAgent).toBe('pi')
    expect(state.sleepingAgentSessionsByPaneKey[retired.paneKey]).toBeUndefined()
    expect(state.sleepingAgentSessionsByPaneKey[valid.paneKey]).toBeUndefined()
  })
})
