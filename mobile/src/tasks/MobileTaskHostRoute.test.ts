import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileTaskHostRoute } from './MobileTaskHostRoute'

const mocks = vi.hoisted(() => ({
  params: {} as { hostId?: string; action?: string; taskSource?: string },
  isWideLayout: false
}))

vi.mock('expo-router', () => ({
  Redirect: 'Redirect',
  useLocalSearchParams: () => mocks.params
}))

vi.mock('../layout/responsive-layout', () => ({
  useResponsiveLayout: () => ({ isWideLayout: mocks.isWideLayout })
}))

vi.mock('../components/WorkspaceDetailPlaceholder', () => ({
  WorkspaceDetailPlaceholder: 'WorkspaceDetailPlaceholder'
}))

function HostScreen() {
  return null
}

afterEach(() => {
  mocks.params = {}
  mocks.isWideLayout = false
})

describe('MobileTaskHostRoute', () => {
  it('redirects a mounted host action to its concrete Tasks route', () => {
    mocks.params = { hostId: 'host/1', action: 'tasks', taskSource: 'github' }

    expect(MobileTaskHostRoute({ hostScreen: HostScreen })).toMatchObject({
      type: 'Redirect',
      props: { href: '/h/host%2F1/tasks?taskSource=github' }
    })
  })

  it('renders the normal host screen without the Tasks action', () => {
    expect(MobileTaskHostRoute({ hostScreen: HostScreen })).toMatchObject({ type: HostScreen })
  })
})
