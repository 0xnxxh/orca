// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useRetiredWorktreeNames } from './useRetiredWorktreeNames'

const listRetiredNames = vi.fn()

beforeEach(() => {
  listRetiredNames.mockReset()
  Object.assign(window, { api: { worktrees: { listRetiredNames } } })
})

describe('useRetiredWorktreeNames', () => {
  it('keeps the previous names while a refresh is in flight', async () => {
    // Why: refreshKey changes on every workspace-list mutation, so create-multiple refetches after
    // each create. Dropping to empty in between would suggest a spent name in exactly that window.
    listRetiredNames.mockResolvedValueOnce(['nautilus'])
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useRetiredWorktreeNames('repo-1', key),
      { initialProps: { key: 'a' } }
    )
    await waitFor(() => expect(result.current.names).toEqual(['nautilus']))

    let resolveSecond: (names: string[]) => void = () => {}
    listRetiredNames.mockReturnValueOnce(
      new Promise<string[]>((resolve) => {
        resolveSecond = resolve
      })
    )
    rerender({ key: 'b' })

    expect(result.current.names).toEqual(['nautilus'])
    expect(result.current.loading).toBe(true)

    resolveSecond(['nautilus', 'seahorse'])
    await waitFor(() => expect(result.current.names).toEqual(['nautilus', 'seahorse']))
  })

  it('returns a referentially stable array across refreshes that change nothing', async () => {
    // The suggestion memo downstream keys on this array; a new identity per refetch reruns it.
    const names = ['nautilus']
    listRetiredNames.mockResolvedValue(names)
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useRetiredWorktreeNames('repo-1', key),
      { initialProps: { key: 'a' } }
    )
    await waitFor(() => expect(result.current.names).toEqual(['nautilus']))
    const first = result.current.names

    rerender({ key: 'b' })

    expect(result.current.names).toBe(first)
  })

  it('drops names when the repo changes rather than showing another repo pool', async () => {
    listRetiredNames.mockResolvedValueOnce(['nautilus'])
    const { result, rerender } = renderHook(
      ({ repoId }: { repoId: string }) => useRetiredWorktreeNames(repoId, 'key'),
      { initialProps: { repoId: 'repo-1' } }
    )
    await waitFor(() => expect(result.current.names).toEqual(['nautilus']))

    listRetiredNames.mockReturnValueOnce(new Promise<string[]>(() => {}))
    rerender({ repoId: 'repo-2' })

    expect(result.current.names).toEqual([])
  })

  it('keeps previously loaded names when a refresh fails', async () => {
    listRetiredNames.mockResolvedValueOnce(['nautilus'])
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useRetiredWorktreeNames('repo-1', key),
      { initialProps: { key: 'a' } }
    )
    await waitFor(() => expect(result.current.names).toEqual(['nautilus']))

    vi.spyOn(console, 'warn').mockImplementation(() => {})
    listRetiredNames.mockRejectedValueOnce(new Error('host unreachable'))
    rerender({ key: 'b' })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.names).toEqual(['nautilus'])
  })
})
