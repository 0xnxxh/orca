import { beforeEach, describe, expect, it, vi } from 'vitest'

const callMock = vi.fn()

vi.mock('../format', () => ({ printResult: vi.fn() }))
vi.mock('../selectors', () => ({ getTerminalHandle: vi.fn() }))

import { printResult } from '../format'
import { ORCHESTRATION_HANDLERS } from './orchestration'

beforeEach(() => {
  callMock.mockReset()
  vi.mocked(printResult).mockReset()
})

describe('legacy orchestration CLI inspection', () => {
  it('labels legacy rows in plain check output', async () => {
    const result = {
      messages: [
        {
          id: 'msg_legacy',
          run_id: 'run_legacy_local',
          from_handle: 'term_worker',
          subject: 'progress',
          type: 'status'
        }
      ],
      count: 1
    }
    callMock.mockResolvedValue({ result })

    await ORCHESTRATION_HANDLERS['orchestration check']({
      flags: new Map<string, string | boolean>([
        ['terminal', 'term_coord'],
        ['peek', true]
      ]),
      client: { call: callMock },
      cwd: '/repo',
      json: false
    } as never)

    const formatter = vi.mocked(printResult).mock.calls[0]?.[2]
    expect(formatter?.(result)).toContain('msg_legacy [legacy, read-only]')
  })

  it('labels legacy rows in full inbox output without hiding their body', async () => {
    const result = {
      messages: [
        {
          id: 'msg_legacy',
          run_id: 'run_legacy_local',
          from_handle: 'term_worker',
          to_handle: 'term_coord',
          subject: 'progress',
          body: 'Tests are running.'
        }
      ],
      count: 1
    }
    callMock.mockResolvedValue({ result })

    await ORCHESTRATION_HANDLERS['orchestration inbox']({
      flags: new Map<string, string | boolean>([['full', true]]),
      client: { call: callMock },
      cwd: '/repo',
      json: false
    } as never)

    const formatter = vi.mocked(printResult).mock.calls[0]?.[2]
    const output = formatter?.(result)
    expect(output).toContain('msg_legacy [legacy, read-only]')
    expect(output).toContain('Tests are running.')
  })
})
