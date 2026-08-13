import { describe, expect, it } from 'vitest'
import { hostTestAttachParams } from './structured-agent-session-host-test-data'
import { pinnedAgentSessionLaunchEnv } from './structured-agent-session-launch-env'

describe('pinnedAgentSessionLaunchEnv', () => {
  it('layers the pinned account home over the shell environment', async () => {
    await expect(
      pinnedAgentSessionLaunchEnv(
        async () => ({ CODEX_LB_API_KEY: 'shell-exported', CODEX_HOME: '/shell/home' }),
        hostTestAttachParams(null)
      )
    ).resolves.toEqual({
      launchEnv: {
        CODEX_LB_API_KEY: 'shell-exported',
        CODEX_HOME: '/home/dev/.codex'
      }
    })
  })
})
