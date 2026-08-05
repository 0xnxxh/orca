import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCodexSessionMigrationScheduler } from './codex-session-migration-scheduler'

describe('createCodexSessionMigrationScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('runs after a managed-account startup switches to host system default', async () => {
    let eligible = false
    const prepareScheduledRun = vi.fn()
    const startBackfill = vi.fn().mockResolvedValue(null)
    const startIndexHeal = vi.fn().mockResolvedValue(null)
    const scheduler = createCodexSessionMigrationScheduler({
      isEligible: () => eligible,
      isQuitting: () => false,
      resolveSystemCodexHomePathOverride: () => undefined,
      prepareScheduledRun,
      startBackfill,
      startIndexHeal
    })

    scheduler.scheduleInitialRun()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(startBackfill).not.toHaveBeenCalled()

    eligible = true
    scheduler.requestRun()
    await vi.waitFor(() => expect(startIndexHeal).toHaveBeenCalledOnce())
    expect(startBackfill).toHaveBeenCalledOnce()
    expect(prepareScheduledRun).not.toHaveBeenCalled()
  })

  it('schedules a delayed rerun after a shared-home launch', async () => {
    vi.setSystemTime(new Date(2026, 7, 5, 10, 0, 0))
    const prepareScheduledRun = vi.fn()
    const finishScheduledRun = vi.fn()
    const startBackfill = vi.fn().mockResolvedValue(null)
    const startIndexHeal = vi.fn().mockResolvedValue(null)
    const scheduler = createCodexSessionMigrationScheduler({
      isEligible: () => true,
      isQuitting: () => false,
      resolveSystemCodexHomePathOverride: () => undefined,
      prepareScheduledRun,
      finishScheduledRun,
      startBackfill,
      startIndexHeal,
      initialDelayMs: 1_000
    })

    scheduler.scheduleRun()
    scheduler.scheduleRun()
    await vi.advanceTimersByTimeAsync(999)
    expect(startBackfill).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(startIndexHeal).toHaveBeenCalledOnce())
    expect(startBackfill).toHaveBeenCalledOnce()
    expect(startBackfill).toHaveBeenCalledWith(
      expect.objectContaining({
        scanDates: [['2026', '08', '05']],
        ignoreCompletionMarker: true
      }),
      undefined
    )
    expect(prepareScheduledRun).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(finishScheduledRun).toHaveBeenCalledOnce())
  })

  it('covers both launch and run dates when a delayed pass crosses midnight', async () => {
    vi.setSystemTime(new Date(2026, 7, 5, 23, 59, 59, 500))
    const startBackfill = vi.fn().mockResolvedValue(null)
    const scheduler = createCodexSessionMigrationScheduler({
      isEligible: () => true,
      isQuitting: () => false,
      resolveSystemCodexHomePathOverride: () => undefined,
      startBackfill,
      startIndexHeal: vi.fn().mockResolvedValue(null),
      initialDelayMs: 1_000
    })

    scheduler.scheduleRun()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(startBackfill).toHaveBeenCalledWith(
      expect.objectContaining({
        scanDates: [
          ['2026', '08', '05'],
          ['2026', '08', '06']
        ]
      }),
      undefined
    )
  })

  it('keeps launch passes full when no completed baseline can cover older failures', async () => {
    const startBackfill = vi.fn().mockResolvedValue(null)
    const scheduler = createCodexSessionMigrationScheduler({
      isEligible: () => true,
      isQuitting: () => false,
      resolveSystemCodexHomePathOverride: () => undefined,
      startBackfill,
      startIndexHeal: vi.fn().mockResolvedValue(null),
      initialDelayMs: 1_000
    })

    scheduler.scheduleRun(true)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(startBackfill).toHaveBeenCalledWith(
      expect.objectContaining({ scanDates: undefined }),
      undefined
    )
  })

  it('upgrades a bounded pass when its target changed before the timer fired', async () => {
    const startBackfill = vi.fn().mockResolvedValue(null)
    const scheduler = createCodexSessionMigrationScheduler({
      isEligible: () => true,
      isQuitting: () => false,
      resolveSystemCodexHomePathOverride: () => '/moved-history',
      prepareScheduledRun: () => true,
      startBackfill,
      startIndexHeal: vi.fn().mockResolvedValue(null),
      initialDelayMs: 1_000
    })

    scheduler.scheduleRun()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(startBackfill).toHaveBeenCalledWith(
      expect.objectContaining({ scanDates: undefined }),
      '/moved-history'
    )
  })

  it('delays the startup run from the latest shared-home launch', async () => {
    const prepareScheduledRun = vi.fn()
    const startBackfill = vi.fn().mockResolvedValue(null)
    const startIndexHeal = vi.fn().mockResolvedValue(null)
    const scheduler = createCodexSessionMigrationScheduler({
      isEligible: () => true,
      isQuitting: () => false,
      resolveSystemCodexHomePathOverride: () => undefined,
      prepareScheduledRun,
      startBackfill,
      startIndexHeal,
      initialDelayMs: 1_000
    })

    scheduler.scheduleInitialRun()
    await vi.advanceTimersByTimeAsync(999)
    scheduler.scheduleRun()

    await vi.advanceTimersByTimeAsync(1)
    expect(startBackfill).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(999)
    await vi.waitFor(() => expect(startIndexHeal).toHaveBeenCalledOnce())
    expect(startBackfill).toHaveBeenCalledOnce()
    expect(prepareScheduledRun).toHaveBeenCalledOnce()
  })

  it('preserves a delayed launch rerun while an earlier migration is active', async () => {
    let releaseFirstIndexHeal: (() => void) | undefined
    const prepareScheduledRun = vi.fn()
    const startBackfill = vi.fn().mockResolvedValue(null)
    const startIndexHeal = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseFirstIndexHeal = resolve
          })
      )
      .mockResolvedValueOnce(null)
    const scheduler = createCodexSessionMigrationScheduler({
      isEligible: () => true,
      isQuitting: () => false,
      resolveSystemCodexHomePathOverride: () => undefined,
      prepareScheduledRun,
      startBackfill,
      startIndexHeal,
      initialDelayMs: 1_000
    })

    scheduler.requestRun()
    await vi.waitFor(() => expect(startIndexHeal).toHaveBeenCalledOnce())

    scheduler.scheduleRun()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(startBackfill).toHaveBeenCalledOnce()
    expect(prepareScheduledRun).not.toHaveBeenCalled()

    releaseFirstIndexHeal?.()
    await vi.waitFor(() => expect(startBackfill).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(startIndexHeal).toHaveBeenCalledTimes(2))
    expect(prepareScheduledRun).toHaveBeenCalledOnce()
    expect(prepareScheduledRun.mock.invocationCallOrder[0]).toBeLessThan(
      startBackfill.mock.invocationCallOrder[1]!
    )
  })

  it('prepares a delayed launch pass after an earlier migration settles before the timer', async () => {
    let releaseFirstBackfill: (() => void) | undefined
    let markerPresent = false
    const prepareScheduledRun = vi.fn(() => {
      markerPresent = false
    })
    const startBackfill = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseFirstBackfill = () => {
              markerPresent = true
              resolve()
            }
          })
      )
      .mockImplementationOnce(async () => {
        expect(markerPresent).toBe(false)
      })
    const startIndexHeal = vi.fn().mockResolvedValue(null)
    const scheduler = createCodexSessionMigrationScheduler({
      isEligible: () => true,
      isQuitting: () => false,
      resolveSystemCodexHomePathOverride: () => undefined,
      prepareScheduledRun,
      startBackfill,
      startIndexHeal,
      initialDelayMs: 1_000
    })

    scheduler.requestRun()
    scheduler.scheduleRun()
    releaseFirstBackfill?.()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(markerPresent).toBe(true)
    expect(startIndexHeal).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => expect(startBackfill).toHaveBeenCalledTimes(2))
    expect(prepareScheduledRun).toHaveBeenCalledOnce()
  })

  it('coalesces concurrent run requests and stops before index heal after opt-out', async () => {
    let eligible = true
    let releaseBackfill: (() => void) | undefined
    const startBackfill = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseBackfill = resolve
        })
    )
    const startIndexHeal = vi.fn().mockResolvedValue(null)
    const scheduler = createCodexSessionMigrationScheduler({
      isEligible: () => eligible,
      isQuitting: () => false,
      resolveSystemCodexHomePathOverride: () => '/custom/history',
      startBackfill,
      startIndexHeal
    })

    scheduler.requestRun()
    scheduler.requestRun()
    expect(startBackfill).toHaveBeenCalledOnce()
    expect(startBackfill).toHaveBeenCalledWith(expect.any(Object), '/custom/history')

    eligible = false
    releaseBackfill?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(startIndexHeal).not.toHaveBeenCalled()
  })

  it('reruns after a stopping migration becomes eligible again', async () => {
    let eligible = true
    let releaseFirstBackfill: ((result: { stopped: boolean }) => void) | undefined
    const startBackfill = vi
      .fn()
      .mockImplementationOnce(
        (_options) =>
          new Promise<{ stopped: boolean }>((resolve) => {
            releaseFirstBackfill = resolve
          })
      )
      .mockResolvedValueOnce({ stopped: false })
    const startIndexHeal = vi.fn().mockResolvedValue(null)
    const scheduler = createCodexSessionMigrationScheduler({
      isEligible: () => eligible,
      isQuitting: () => false,
      resolveSystemCodexHomePathOverride: () => undefined,
      startBackfill,
      startIndexHeal
    })

    scheduler.requestRun()
    const firstRunOptions = startBackfill.mock.calls[0]?.[0]
    eligible = false
    expect(firstRunOptions?.shouldStop()).toBe(true)
    eligible = true
    scheduler.requestRun()
    releaseFirstBackfill?.({ stopped: true })

    await vi.waitFor(() => expect(startBackfill).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(startIndexHeal).toHaveBeenCalledOnce())
  })
})
