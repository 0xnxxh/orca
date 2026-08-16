import { describe, expect, it } from 'vitest'
import { getProjectLocationBrowseTarget } from './set-project-location-browse'

describe('getProjectLocationBrowseTarget', () => {
  it('uses the native picker for the local host', () => {
    expect(getProjectLocationBrowseTarget('local')).toEqual({ kind: 'local' })
  })

  it('opens the SSH file browser for ssh hosts', () => {
    expect(getProjectLocationBrowseTarget('ssh:openclaw')).toEqual({
      kind: 'ssh',
      targetId: 'openclaw'
    })
  })

  it('opens the runtime file browser for paired hosts', () => {
    expect(getProjectLocationBrowseTarget('runtime:gpu')).toEqual({
      kind: 'runtime',
      environmentId: 'gpu'
    })
  })
})
