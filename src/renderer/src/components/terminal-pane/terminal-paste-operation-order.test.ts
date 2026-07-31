import { describe, expect, it } from 'vitest'

import { sendAgentDraftPasteContent } from '@/lib/agent-draft-paste-content'
import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
  wrapTerminalBracketedPasteText
} from './terminal-bracketed-paste'
import { executeTerminalPastePlan, planTerminalPaste } from './terminal-paste-coordinator'

describe('terminal paste operation ordering', () => {
  it('keeps startup context outside an active chunked user paste frame', async () => {
    const writes: string[] = []
    let startupDraft: Promise<boolean> | null = null
    const writePty = async (data: string): Promise<boolean> => {
      writes.push(data)
      return true
    }
    const userPaste = planTerminalPaste({
      text: 'user-line-1\nuser-line-2',
      source: 'keyboard',
      target: {
        kind: 'terminal',
        paneId: 1,
        leafId: 'leaf-1',
        ptyId: 'pty-1',
        runtime: {
          platform: 'win32',
          runtimeKey: 'local:win32',
          kind: 'local',
          isWindowsConpty: true
        }
      },
      terminalBracketedPasteMode: true,
      maxDirectBytes: 4,
      maxChunkBytes: 12
    })

    const userPasteResult = await executeTerminalPastePlan(userPaste, {
      pasteText: () => {},
      writePty,
      yieldToEventLoop: async () => {
        startupDraft ??= sendAgentDraftPasteContent(null, 'pty-1', 'GENERATED_CONTEXT', writePty)
      }
    })
    await startupDraft

    expect(userPasteResult.status).toBe('pasted')
    expect(writes).toEqual([
      BRACKETED_PASTE_START,
      'user-line-1\r',
      'user-line-2',
      BRACKETED_PASTE_END,
      wrapTerminalBracketedPasteText('GENERATED_CONTEXT')
    ])
  })
})
