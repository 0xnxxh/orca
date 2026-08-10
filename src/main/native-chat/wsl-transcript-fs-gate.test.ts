import { describe, expect, it, vi } from 'vitest'
import { runWslTranscriptFsTask, shareWslTranscriptFsTask } from './wsl-transcript-fs-gate'

describe('WSL transcript filesystem task scheduling', () => {
  it('allows an exact probe to run between directory reads from one scan', async () => {
    const started: string[] = []
    let finishFirstRead: (() => void) | undefined
    let finishExactProbe: (() => void) | undefined

    const scan = shareWslTranscriptFsTask('scan:yield', async () => {
      await runWslTranscriptFsTask(
        'readdir:first',
        () =>
          new Promise<void>((resolve) => {
            started.push('first-read')
            finishFirstRead = resolve
          })
      )
      await runWslTranscriptFsTask('readdir:second', async () => {
        started.push('second-read')
      })
    })

    await vi.waitFor(() => expect(started).toEqual(['first-read']))
    const exactProbe = runWslTranscriptFsTask(
      'access:exact',
      () =>
        new Promise<void>((resolve) => {
          started.push('exact-probe')
          finishExactProbe = resolve
        })
    )

    finishFirstRead?.()
    await vi.waitFor(() => expect(started).toEqual(['first-read', 'exact-probe']))
    finishExactProbe?.()
    await Promise.all([scan, exactProbe])
    expect(started).toEqual(['first-read', 'exact-probe', 'second-read'])
  })

  it('shares identical multi-read scans without consuming another permit', async () => {
    const scanTask = vi.fn(async () => ['rollout.jsonl'])

    const first = shareWslTranscriptFsTask('scan:same', scanTask)
    const duplicate = shareWslTranscriptFsTask('scan:same', scanTask)

    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      ['rollout.jsonl'],
      ['rollout.jsonl']
    ])
    expect(scanTask).toHaveBeenCalledTimes(1)
  })
})
