// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GITHUB_TASK_SEARCH_IDLE_MS,
  useGitHubTaskSearchCommit
} from './use-github-task-search-commit'

describe('useGitHubTaskSearchCommit', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('commits only the final value after a full idle window', () => {
    const onCommit = vi.fn()
    const view = renderHook(
      ({ value }) => useGitHubTaskSearchCommit({ enabled: true, onCommit, value }),
      { initialProps: { value: 'r' } }
    )

    act(() => vi.advanceTimersByTime(400))
    view.rerender({ value: 'ra' })
    act(() => vi.advanceTimersByTime(400))
    view.rerender({ value: 'rate' })
    act(() => vi.advanceTimersByTime(GITHUB_TASK_SEARCH_IDLE_MS - 1))

    expect(onCommit).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(1))
    expect(onCommit).toHaveBeenCalledOnce()
    expect(onCommit).toHaveBeenCalledWith('rate')
  })

  it('does not schedule a commit while disabled', () => {
    const onCommit = vi.fn()
    renderHook(() => useGitHubTaskSearchCommit({ enabled: false, onCommit, value: 'rate' }))

    act(() => vi.runAllTimers())
    expect(onCommit).not.toHaveBeenCalled()
  })
})
