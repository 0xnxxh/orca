import { describe, expect, it, vi } from 'vitest'
import type { LegacySshProjectionSemantics } from './ssh-pty-legacy-projection'
import {
  SshPtyOutputIntake,
  type SshPtyOutputDataEvent,
  type SshPtyOutputIntakeDependencies
} from './ssh-pty-output-intake'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function event(overrides: Partial<SshPtyOutputDataEvent> = {}): SshPtyOutputDataEvent {
  return {
    id: 'pty-1',
    data: 'aaaa',
    providerGeneration: 1,
    ptyIncarnation: 'incarnation-1',
    rawLength: 4,
    transformed: false,
    ...overrides
  }
}

function createHarness(
  overrides: Partial<SshPtyOutputIntakeDependencies> = {},
  options: ConstructorParameters<typeof SshPtyOutputIntake>[1] = {}
) {
  let sequence = 0
  const completions: ReturnType<typeof deferred>[] = []
  const order: string[] = []
  const dependencies: SshPtyOutputIntakeDependencies = {
    getModelSequence: () => sequence,
    acceptModel: (input) => {
      order.push(`model:${input.data}`)
      sequence += input.rawLength
      const completion = deferred()
      completions.push(completion)
      return { sequence, completion: completion.promise }
    },
    project: (input) => order.push(`project:${input.data}`),
    prepareExit: vi.fn(),
    finalizeExit: () => order.push('exit'),
    pauseProvider: vi.fn(() => true),
    resumeProvider: vi.fn(),
    closeProvider: vi.fn(),
    ...overrides
  }
  return {
    intake: new SshPtyOutputIntake(dependencies, options),
    dependencies,
    completions,
    order
  }
}

describe('SshPtyOutputIntake', () => {
  it('plateaus at the model and pressure budgets, then resumes below low water', async () => {
    const harness = createHarness(
      {},
      {
        perPtyHighSourceUnits: 4,
        perPtyHighBytes: 1024,
        perPtyLowSourceUnits: 1,
        perPtyLowBytes: 256,
        globalHighSourceUnits: 4,
        globalHighBytes: 1024,
        globalLowSourceUnits: 1,
        globalLowBytes: 256,
        pressureMaxFrames: 2,
        pressureMaxBytes: 1024
      }
    )
    const first = harness.intake.acceptData(event())
    const second = harness.intake.acceptData(event({ data: 'bbbb' }))
    const third = harness.intake.acceptData(event({ data: 'cccc' }))
    const rejected = harness.intake.acceptData(event({ data: 'dddd' }))

    expect(harness.intake.getDebugSnapshot().model).toMatchObject({
      sourceUnits: 4,
      pressureFrames: 2
    })
    await expect(rejected).rejects.toThrow('ssh_model_admission_pressure_exhausted')
    expect(harness.dependencies.closeProvider).toHaveBeenCalledWith(1, expect.any(String))

    harness.completions[0]!.resolve()
    await first
    harness.completions[1]!.resolve()
    await second
    harness.completions[2]!.resolve()
    await third

    expect(harness.intake.getDebugSnapshot().model).toMatchObject({
      sourceUnits: 0,
      bytes: 0,
      pressureFrames: 0
    })
    expect(harness.dependencies.resumeProvider).toHaveBeenCalled()
  })

  it('preserves per-PTY FIFO while differently sized pressure entries wait', async () => {
    const harness = createHarness(
      {},
      {
        perPtyHighSourceUnits: 4,
        perPtyHighBytes: 4096,
        globalHighSourceUnits: 4,
        globalHighBytes: 4096,
        pressureMaxFrames: 4,
        pressureMaxBytes: 4096
      }
    )
    const receipts = [
      harness.intake.acceptData(event({ data: 'a', rawLength: 1 })),
      harness.intake.acceptData(event({ data: 'bbb', rawLength: 3 })),
      harness.intake.acceptData(event({ data: 'cc', rawLength: 2 })),
      harness.intake.acceptData(event({ data: 'd', rawLength: 1 }))
    ]

    harness.completions[0]!.resolve()
    await receipts[0]
    harness.completions[1]!.resolve()
    await receipts[1]
    harness.completions[2]!.resolve()
    await receipts[2]
    harness.completions[3]!.resolve()
    await receipts[3]

    expect(harness.order).toEqual([
      'model:a',
      'project:a',
      'model:bbb',
      'project:bbb',
      'model:cc',
      'project:cc',
      'model:d',
      'project:d'
    ])
  })

  it('assigns projection sequence ends when queued model capture begins', async () => {
    const harness = createHarness(
      {},
      {
        perPtyHighSourceUnits: 12,
        perPtyHighBytes: 4096,
        globalHighSourceUnits: 12,
        globalHighBytes: 4096
      }
    )
    const first = harness.intake.acceptData(event({ data: 'aaaa' }))
    const second = harness.intake.acceptData(event({ data: 'bbbb' }))
    const third = harness.intake.acceptData(event({ data: 'cccc' }))

    harness.completions[0]!.resolve()
    expect((await first).projection.identity.sequenceEnd).toBe(4)
    harness.completions[1]!.resolve()
    expect((await second).projection.identity.sequenceEnd).toBe(8)
    harness.completions[2]!.resolve()
    expect((await third).projection.identity.sequenceEnd).toBe(12)
  })

  it('transfers projection state and closes the provider on model failure', async () => {
    const harness = createHarness()
    const receipt = harness.intake.acceptData(event())
    harness.completions[0]!.reject(new Error('emulator failed'))

    await expect(receipt).rejects.toThrow('emulator failed')
    expect(harness.intake.getDebugSnapshot().projection.transferred).toBe(1)
    expect(harness.dependencies.closeProvider).toHaveBeenCalledWith(1, 'model-admission-failed')
  })

  it('transfers a committed projection when desktop admission throws', async () => {
    const projections: LegacySshProjectionSemantics[] = []
    const harness = createHarness({
      project: (_event, projection) => {
        projections.push(projection)
        if (projections.length === 1) {
          throw new Error('send failed')
        }
      }
    })
    const receipt = harness.intake.acceptData(event({ data: '\x1b[?20', rawLength: 5 }))
    harness.completions[0]!.resolve()

    await expect(receipt).resolves.toMatchObject({ sequence: 5 })
    expect(harness.intake.getDebugSnapshot().projection.transferred).toBe(1)

    const next = harness.intake.acceptData(event({ data: '31h', rawLength: 3 }))
    harness.completions[1]!.resolve()
    await next
    expect(projections[1]).toMatchObject({
      identity: { displayStart: 5 },
      beforeScanner: { tail: '\x1b[?20', pendingSubscribe: false },
      decision: 'subscribed'
    })
  })

  it('commits an immutable desktop source identity through projection admission', async () => {
    const projections: LegacySshProjectionSemantics[] = []
    const harness = createHarness({
      project: (_event, projection) => projections.push(projection)
    })
    const receipt = harness.intake.acceptData(
      event({
        source: {
          spanId: 'span-1',
          clientGeneration: 2,
          ownerGeneration: 3,
          deliveryToken: 'token-1',
          sourceStartSu: 10,
          sourceEndSu: 14
        }
      })
    )
    harness.completions[0]!.resolve()

    await receipt
    expect(projections[0]?.desktopSpan).toMatchObject({
      spanId: 'span-1',
      projectionSemanticsId: projections[0]?.identity.projectionSemanticsId,
      providerGeneration: 1,
      clientGeneration: 2,
      ownerGeneration: 3,
      ptyIncarnation: 'incarnation-1',
      deliveryToken: 'token-1',
      sourceStartSu: 10,
      sourceEndSu: 14,
      displayStart: 0,
      displayEnd: 4,
      transform: { transformed: false, rawLengthSu: 4, scalarSafe: true }
    })
    expect(Object.isFrozen(projections[0]?.desktopSpan)).toBe(true)
  })

  it('rolls back projection staging when model capture throws synchronously', async () => {
    const project = vi.fn()
    const harness = createHarness({
      acceptModel: () => {
        throw new Error('model reservation failed')
      },
      project
    })

    await expect(harness.intake.acceptData(event())).rejects.toThrow('model reservation failed')
    expect(project).not.toHaveBeenCalled()
    expect(harness.intake.getDebugSnapshot().projection).toMatchObject({
      rolledBack: 1,
      records: 0
    })
    expect(harness.dependencies.closeProvider).toHaveBeenCalledWith(1, 'model-admission-failed')
  })

  it('rolls back projection staging when source reservation validation fails', async () => {
    const harness = createHarness()
    const source = {
      spanId: 'duplicate',
      clientGeneration: 2,
      ownerGeneration: 3,
      deliveryToken: 'token-1',
      sourceStartSu: 0,
      sourceEndSu: 4
    }
    const first = harness.intake.acceptData(event({ source }))
    harness.completions[0]!.resolve()
    await first
    await expect(
      harness.intake.acceptData(
        event({
          source: { ...source, sourceStartSu: 4, sourceEndSu: 8 }
        })
      )
    ).rejects.toThrow('duplicate')
    expect(harness.intake.getDebugSnapshot().projection).toMatchObject({
      rolledBack: 1,
      records: 1
    })
  })

  it('rolls back committed source and scanner facts when model capture throws', async () => {
    let attempts = 0
    const harness = createHarness({
      acceptModel: (accepted) => {
        attempts++
        if (attempts === 1) {
          throw new Error('model reservation failed')
        }
        return {
          sequence: accepted.rawLength,
          completion: Promise.resolve()
        }
      }
    })
    const source = {
      spanId: 'span-1',
      clientGeneration: 2,
      ownerGeneration: 3,
      deliveryToken: 'token-1',
      sourceStartSu: 0,
      sourceEndSu: 5
    }
    await expect(
      harness.intake.acceptData(event({ data: '\x1b[?20', rawLength: 5, source }))
    ).rejects.toThrow('model reservation failed')

    const retry = await harness.intake.acceptData(
      event({ data: '\x1b[?20', rawLength: 5, source: { ...source, spanId: 'span-2' } })
    )
    expect(retry.projection.identity.displayStart).toBe(0)
    expect(retry.projection.beforeScanner).toEqual({ tail: '', pendingSubscribe: false })
  })

  it('rejects stale provider generations without model capture', async () => {
    const harness = createHarness()
    const current = harness.intake.acceptData(event({ providerGeneration: 2 }))
    harness.completions[0]!.resolve()
    await current

    await expect(harness.intake.acceptData(event({ providerGeneration: 1 }))).rejects.toThrow(
      'ssh_output_stale_generation'
    )
    expect(harness.completions).toHaveLength(1)
  })

  it('keeps exit behind accepted model and projection work', async () => {
    const harness = createHarness({}, { exitBarrierMs: 1000 })
    const dataReceipt = harness.intake.acceptData(event())
    const exitReceipt = harness.intake.acceptExit({
      id: 'pty-1',
      code: 0,
      providerGeneration: 1,
      ptyIncarnation: 'incarnation-1'
    })
    await Promise.resolve()
    expect(harness.order).toEqual(['model:aaaa', 'project:aaaa'])

    harness.completions[0]!.resolve()
    await Promise.all([dataReceipt, exitReceipt])
    expect(harness.order).toEqual(['model:aaaa', 'project:aaaa', 'exit'])
  })

  it('retains exited delivery until published renderer projections settle', async () => {
    const harness = createHarness({}, { exitBarrierMs: 1000 })
    const dataReceipt = harness.intake.acceptData(event())
    harness.completions[0]!.resolve()
    const receipt = await dataReceipt
    harness.intake.publishProjectionPrefix(
      [receipt.projection.identity.projectionSemanticsId],
      4,
      4
    )

    let exited = false
    const exitReceipt = harness.intake
      .acceptExit({
        id: 'pty-1',
        code: 0,
        providerGeneration: 1,
        ptyIncarnation: 'incarnation-1'
      })
      .then(() => {
        exited = true
      })
    await Promise.resolve()

    expect(exited).toBe(false)
    expect(harness.intake.getDebugSnapshot().projection.records).toBe(1)
    expect(harness.intake.settleProjectionPrefix('pty-1', 4)).toBe(4)
    await exitReceipt
    expect(harness.order.at(-1)).toBe('exit')
    expect(harness.intake.getDebugSnapshot().projection.records).toBe(0)
  })

  it('keeps timed-out exit projections until generation-close proof', async () => {
    const harness = createHarness({}, { exitBarrierMs: 1 })
    const dataReceipt = harness.intake.acceptData(event())
    harness.completions[0]!.resolve()
    const receipt = await dataReceipt
    harness.intake.publishProjectionPrefix(
      [receipt.projection.identity.projectionSemanticsId],
      4,
      4
    )

    await expect(
      harness.intake.acceptExit({
        id: 'pty-1',
        code: 0,
        providerGeneration: 1,
        ptyIncarnation: 'incarnation-1'
      })
    ).rejects.toThrow('ssh_exit_barrier_timeout')
    expect(harness.dependencies.closeProvider).toHaveBeenCalledWith(1, 'ssh-exit-barrier-timeout')
    expect(harness.intake.getDebugSnapshot().projection.records).toBe(1)

    harness.intake.closeGeneration(1, 'provider-closed')
    expect(harness.intake.getDebugSnapshot().projection.records).toBe(0)
  })

  it('rejects late same-generation data after ordered exit cleanup', async () => {
    const harness = createHarness({}, { exitBarrierMs: 1000 })
    const first = harness.intake.acceptData(event())
    harness.completions[0]!.resolve()
    await first
    await harness.intake.acceptExit({
      id: 'pty-1',
      code: 0,
      providerGeneration: 1,
      ptyIncarnation: 'incarnation-1'
    })

    await expect(harness.intake.acceptData(event())).rejects.toThrow('ssh_output_after_exit')
    await expect(
      harness.intake.acceptExit({
        id: 'pty-1',
        code: 0,
        providerGeneration: 1,
        ptyIncarnation: 'incarnation-1'
      })
    ).rejects.toThrow('ssh_output_duplicate_exit')

    const next = harness.intake.acceptData(
      event({ providerGeneration: 2, ptyIncarnation: 'incarnation-2' })
    )
    harness.completions[1]!.resolve()
    await expect(next).resolves.toMatchObject({
      projection: { identity: { ptyIncarnation: 'incarnation-2', displayStart: 0 } }
    })
  })

  it('closes the provider when exit finalization fails', async () => {
    const harness = createHarness({
      finalizeExit: () => {
        throw new Error('renderer exit send failed')
      }
    })

    await expect(
      harness.intake.acceptExit({
        id: 'pty-1',
        code: 0,
        providerGeneration: 1,
        ptyIncarnation: 'incarnation-1'
      })
    ).rejects.toThrow('renderer exit send failed')
    expect(harness.dependencies.closeProvider).toHaveBeenCalledWith(1, 'pty-exit-finalize-failed')
  })

  it('cancels queued work and exit waiters on generation cleanup', async () => {
    const harness = createHarness(
      {},
      {
        perPtyHighSourceUnits: 8,
        perPtyHighBytes: 2048,
        globalHighSourceUnits: 8,
        globalHighBytes: 2048
      }
    )
    const running = harness.intake.acceptData(event())
    const queued = harness.intake.acceptData(event({ data: 'bbbb' }))
    const exit = harness.intake.acceptExit({
      id: 'pty-1',
      code: 0,
      providerGeneration: 1,
      ptyIncarnation: 'incarnation-1'
    })
    harness.intake.closeGeneration(1, 'provider-closed')

    await expect(queued).rejects.toThrow('provider-closed')
    await expect(exit).rejects.toThrow('provider-closed')
    await expect(harness.intake.acceptData(event())).rejects.toThrow('ssh_output_stale_generation')
    await expect(running).rejects.toThrow('provider-closed')
    expect(harness.intake.getDebugSnapshot().model).toMatchObject({ sourceUnits: 0, bytes: 0 })
    harness.completions[0]!.resolve()
    await Promise.resolve()
    expect(harness.intake.getDebugSnapshot().exitBarriers).toBe(0)
  })

  it('resumes a paused provider during generation cleanup', async () => {
    const harness = createHarness(
      {},
      {
        perPtyHighSourceUnits: 4,
        perPtyHighBytes: 1024,
        globalHighSourceUnits: 4,
        globalHighBytes: 1024,
        pressureMaxFrames: 2,
        pressureMaxBytes: 1024
      }
    )
    const running = harness.intake.acceptData(event())
    const pressured = harness.intake.acceptData(event({ data: 'bbbb' }))

    harness.intake.closeGeneration(1, 'provider-closed')

    await expect(pressured).rejects.toThrow('provider-closed')
    expect(harness.dependencies.resumeProvider).toHaveBeenCalledWith(1, 'pty-1')
    await expect(running).rejects.toThrow('provider-closed')
    harness.completions[0]!.resolve()
    await Promise.resolve()
  })
})
