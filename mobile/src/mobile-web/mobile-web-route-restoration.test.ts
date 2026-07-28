import { describe, expect, it } from 'vitest'
import {
  mobileWebNavigationRouteTarget,
  mobileWebResumeRouteTarget
} from './mobile-web-route-restoration'

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

  it.each([
    [{ kind: 'tasks' } as const, '/h/paired-orca-desktop/tasks'],
    [
      { kind: 'tasks', taskSource: 'gitlab' } as const,
      '/h/paired-orca-desktop/tasks?taskSource=gitlab'
    ],
    [{ kind: 'accounts' } as const, '/h/paired-orca-desktop/accounts'],
    [{ kind: 'newWorkspace' } as const, '/?action=newWorktree']
  ])('maps the typed native destination %s', (route, expected) => {
    expect(mobileWebNavigationRouteTarget(route, 'paired-orca-desktop')).toBe(expected)
  })
})
