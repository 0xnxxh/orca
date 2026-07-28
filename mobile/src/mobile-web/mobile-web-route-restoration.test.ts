import { describe, expect, it } from 'vitest'
import { mobileWebResumeRouteTarget } from './mobile-web-route-restoration'

describe('mobile web route restoration', () => {
  it('keeps the workspace list as the default recovery route', () => {
    expect(mobileWebResumeRouteTarget({ kind: 'workspaceList' }, 'paired-orca-desktop')).toBeNull()
  })

  it('restores only the opaque workspace handle and bounded display name', () => {
    expect(
      mobileWebResumeRouteTarget(
        {
          kind: 'session',
          workspaceId: 'opaque/workspace?one',
          workspaceName: 'Feature & tests'
        },
        'paired-orca-desktop'
      )
    ).toBe('/h/paired-orca-desktop/session/opaque%2Fworkspace%3Fone?name=Feature+%26+tests')
  })
})
