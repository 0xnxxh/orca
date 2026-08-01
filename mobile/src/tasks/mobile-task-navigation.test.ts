import { describe, expect, it, vi } from 'vitest'
import {
  mobileTasksHostRoute,
  mobileTasksRoute,
  mobileTasksRouteFromHostAction,
  navigateToMobileTasks
} from './mobile-task-navigation'

describe('mobileTasksRoute', () => {
  it('builds a concrete encoded host route', () => {
    expect(mobileTasksRoute('host/1')).toBe('/h/host%2F1/tasks')
    expect(mobileTasksRoute('host/1', 'linear')).toBe('/h/host%2F1/tasks?taskSource=linear')
  })

  it('routes through the host index so its nested navigator owns the redirect', () => {
    const push = vi.fn()

    navigateToMobileTasks({ push }, 'host/1', 'github')
    expect(push).toHaveBeenCalledWith(mobileTasksHostRoute('host/1', 'github'))
  })

  it('resolves the host-owned Tasks action after the nested navigator mounts', () => {
    expect(mobileTasksRouteFromHostAction('host/1', 'tasks', 'linear')).toBe(
      '/h/host%2F1/tasks?taskSource=linear'
    )
    expect(mobileTasksRouteFromHostAction('host-1', 'newWorktree', 'github')).toBeNull()
    expect(mobileTasksRouteFromHostAction(undefined, 'tasks', 'github')).toBeNull()
  })
})
