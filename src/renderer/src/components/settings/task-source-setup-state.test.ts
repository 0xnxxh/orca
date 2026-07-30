import { describe, expect, it } from 'vitest'
import type { TaskProvider } from '../../../../shared/types'
import {
  getAutoExpandedTaskProvider,
  getIncompleteVisibleTaskProviders,
  getTaskProviderCompletedSteps,
  getTaskProviderSetupStatus,
  isTaskProviderReady,
  type TaskProviderReadiness
} from './task-source-setup-state'

const ORDER: readonly TaskProvider[] = ['github', 'gitlab', 'linear', 'jira']

function buildReadiness(
  overrides: Partial<Record<TaskProvider, Partial<TaskProviderReadiness>>> = {}
): Record<TaskProvider, TaskProviderReadiness> {
  const base: Record<TaskProvider, TaskProviderReadiness> = {
    github: { connected: true, checking: false, visible: true },
    gitlab: { connected: true, checking: false, visible: true },
    linear: {
      connected: true,
      checking: false,
      skillInstalled: true,
      skillChecking: false,
      visible: true
    },
    jira: { connected: true, checking: false, visible: true }
  }
  for (const provider of ORDER) {
    Object.assign(base[provider], overrides[provider])
  }
  return base
}

describe('task-source-setup-state', () => {
  it('counts Linear readiness as three steps', () => {
    expect(
      getTaskProviderCompletedSteps({
        connected: true,
        checking: false,
        skillInstalled: false,
        visible: true
      })
    ).toEqual({ completed: 2, total: 3 })
  })

  it('counts code-host readiness as two steps', () => {
    expect(
      getTaskProviderCompletedSteps({ connected: true, checking: false, visible: true })
    ).toEqual({ completed: 2, total: 2 })
  })

  it('marks Linear ready only when connected, skill installed, and visible', () => {
    expect(
      isTaskProviderReady({
        connected: true,
        checking: false,
        skillInstalled: true,
        visible: true
      })
    ).toBe(true)
    expect(
      isTaskProviderReady({
        connected: true,
        checking: false,
        skillInstalled: false,
        visible: true
      })
    ).toBe(false)
  })

  it('never reports ready while a check is in flight', () => {
    expect(
      isTaskProviderReady({
        connected: true,
        checking: false,
        skillInstalled: true,
        skillChecking: true,
        visible: true
      })
    ).toBe(false)
    expect(isTaskProviderReady({ connected: true, checking: true, visible: true })).toBe(false)
  })

  it('reports the first unmet step as the status', () => {
    expect(getTaskProviderSetupStatus({ connected: false, checking: true, visible: true })).toBe(
      'checking'
    )
    expect(getTaskProviderSetupStatus({ connected: false, checking: false, visible: true })).toBe(
      'connect-required'
    )
    expect(
      getTaskProviderSetupStatus({
        connected: true,
        checking: false,
        skillInstalled: false,
        visible: true
      })
    ).toBe('skill-required')
    expect(getTaskProviderSetupStatus({ connected: true, checking: false, visible: false })).toBe(
      'hidden'
    )
    expect(getTaskProviderSetupStatus({ connected: true, checking: false, visible: true })).toBe(
      'ready'
    )
  })

  it('treats hidden providers as deliberately disabled regardless of connection state', () => {
    expect(getTaskProviderSetupStatus({ connected: false, checking: false, visible: false })).toBe(
      'hidden'
    )
    expect(getTaskProviderSetupStatus({ connected: false, checking: true, visible: false })).toBe(
      'hidden'
    )
  })

  it('excludes hidden and still-checking providers from the incomplete list', () => {
    const readiness = buildReadiness({
      github: { connected: false, visible: false },
      gitlab: { connected: false, checking: true },
      linear: { skillInstalled: false }
    })

    expect(getIncompleteVisibleTaskProviders(ORDER, readiness)).toEqual(['linear'])
  })

  it('auto-expands only the first incomplete visible provider', () => {
    const readiness = buildReadiness({
      gitlab: { connected: false },
      linear: { skillInstalled: false }
    })

    expect(getIncompleteVisibleTaskProviders(ORDER, readiness)).toEqual(['gitlab', 'linear'])
    expect(getAutoExpandedTaskProvider(ORDER, readiness)).toBe('gitlab')
  })

  it('auto-expands nothing once every visible provider is ready', () => {
    expect(getAutoExpandedTaskProvider(ORDER, buildReadiness())).toBeNull()
  })
})
