import { describe, expect, it } from 'vitest'
import { webHostScreenHostState } from './web-host-screen-host-state'

describe('web host screen host state', () => {
  it('supplies shell-owned identity without page persistence', async () => {
    const state = webHostScreenHostState({
      name: 'Paired Orca Desktop',
      publicKeyB64: ''
    })

    expect(await state.loadIdentity('opaque-host')).toEqual({
      name: 'Paired Orca Desktop',
      publicKeyB64: ''
    })
    expect(state.cachedWorkspaces('opaque-host')).toBeNull()
    expect(await state.loadPinnedWorkspaceIds('opaque-host')).toEqual(new Set())
    state.cacheWorkspaces('opaque-host', [])
    state.cacheRepositories('opaque-host', [])
    await expect(
      state.savePinnedWorkspaceIds('opaque-host', new Set(['opaque-workspace']))
    ).resolves.toBeUndefined()
    await expect(state.recordConnected('opaque-host')).resolves.toBeUndefined()
    expect(await state.loadIdentity('opaque-host')).toEqual({
      name: 'Paired Orca Desktop',
      publicKeyB64: ''
    })
  })
})
