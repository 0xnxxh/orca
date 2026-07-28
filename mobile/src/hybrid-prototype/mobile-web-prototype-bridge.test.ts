import { describe, expect, it } from 'vitest'
import {
  parseMobileWebPrototypeRequest,
  sanitizeMobileWebPrototypeWorkspaces
} from './mobile-web-prototype-bridge'

describe('mobile web prototype bridge', () => {
  it('accepts only the explicit versioned capabilities', () => {
    expect(parseMobileWebPrototypeRequest('{"v":1,"type":"ready"}')).toEqual({
      v: 1,
      type: 'ready'
    })
    expect(
      parseMobileWebPrototypeRequest('{"v":1,"type":"workspace.list","id":"workspace-1"}')
    ).toEqual({ v: 1, type: 'workspace.list', id: 'workspace-1' })
    expect(
      parseMobileWebPrototypeRequest('{"v":1,"type":"rpc","id":"1","method":"file.read"}')
    ).toBeNull()
    expect(
      parseMobileWebPrototypeRequest(
        JSON.stringify({ v: 1, type: 'workspace.list', id: 'x'.repeat(129) })
      )
    ).toBeNull()
    expect(parseMobileWebPrototypeRequest(' '.repeat(16 * 1024 + 1))).toBeNull()
  })

  it('bounds and sanitizes workspace data before it crosses into the WebView', () => {
    const workspaces = sanitizeMobileWebPrototypeWorkspaces({
      worktrees: [
        {
          worktreeId: 'workspace-1',
          displayName: 'A'.repeat(200),
          repo: 'orca',
          branch: 'mobile-rearch',
          isActive: true,
          liveTerminalCount: 3,
          deviceToken: 'must-not-cross-the-bridge'
        },
        { worktreeId: 42, displayName: 'invalid' }
      ]
    })

    expect(workspaces).toEqual([
      {
        id: 'workspace-1',
        name: 'A'.repeat(160),
        repo: 'orca',
        branch: 'mobile-rearch',
        isActive: true,
        liveTerminalCount: 3
      }
    ])
    expect(JSON.stringify(workspaces)).not.toContain('deviceToken')
  })
})
