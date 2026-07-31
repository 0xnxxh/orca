import { describe, expect, it, vi } from 'vitest'
import { replayTerminalLayout } from './layout-serialization'

const LEAF_1 = '11111111-1111-4111-8111-111111111111'
const LEAF_2 = '22222222-2222-4222-8222-222222222222'

describe('duplicate PTY layout replay', () => {
  it('replays one surface when restored leaves point to the same PTY', () => {
    const manager = {
      createInitialPane: vi.fn((opts?: { leafId?: string }) => ({
        id: 1,
        leafId: opts?.leafId ?? LEAF_1
      })),
      splitPane: vi.fn()
    }

    const restored = replayTerminalLayout(
      manager as unknown as Parameters<typeof replayTerminalLayout>[0],
      {
        root: {
          type: 'split',
          direction: 'vertical',
          first: { type: 'leaf', leafId: LEAF_1 },
          second: { type: 'leaf', leafId: LEAF_2 }
        },
        activeLeafId: LEAF_2,
        expandedLeafId: null,
        ptyIdsByLeafId: {
          [LEAF_1]: 'pty-agent',
          [LEAF_2]: 'pty-agent'
        }
      },
      true
    )

    expect(manager.createInitialPane).toHaveBeenCalledWith({ focus: true, leafId: LEAF_2 })
    expect(manager.splitPane).not.toHaveBeenCalled()
    expect([...restored]).toEqual([[LEAF_2, 1]])
  })
})
