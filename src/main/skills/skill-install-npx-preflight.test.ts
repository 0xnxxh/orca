import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  hydrateShellPath: vi.fn(),
  isCommandOnPath: vi.fn()
}))

vi.mock('../ipc/agent-detection-shell-path', () => ({
  hydrateShellPathForAgentDetection: mocks.hydrateShellPath
}))

vi.mock('../ipc/preflight-command-exec', () => ({
  isCommandOnPath: mocks.isCommandOnPath
}))

import { isNpxOnPathForSkillInstall } from './skill-install-npx-preflight'

describe('isNpxOnPathForSkillInstall', () => {
  beforeEach(() => {
    mocks.hydrateShellPath.mockReset()
    mocks.hydrateShellPath.mockResolvedValue(undefined)
    mocks.isCommandOnPath.mockReset()
    mocks.isCommandOnPath.mockResolvedValue(true)
  })

  it('hydrates and checks the local host PATH', async () => {
    await expect(isNpxOnPathForSkillInstall()).resolves.toBe(true)

    expect(mocks.hydrateShellPath).toHaveBeenCalledWith(undefined)
    expect(mocks.isCommandOnPath).toHaveBeenCalledWith('npx', undefined)
  })

  it('checks the selected WSL distro on Windows', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const context = { wslDistro: 'Ubuntu' }

    await expect(isNpxOnPathForSkillInstall(context)).resolves.toBe(true)

    expect(mocks.hydrateShellPath).toHaveBeenCalledWith(context)
    expect(mocks.isCommandOnPath).toHaveBeenCalledWith('npx', { distro: 'Ubuntu' })
  })
})
