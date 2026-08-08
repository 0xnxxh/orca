import { describe, expect, it, vi } from 'vitest'
import { configureAcknowledgedRelayGraceTime } from './relay-grace-time-coordinator'

describe('acknowledged relay grace configuration', () => {
  it('pins authority retention before applying the control-adapter grace', async () => {
    const order: string[] = []
    const authorityValues: number[] = []
    const controlValues: number[] = []
    const result = await configureAcknowledgedRelayGraceTime({
      params: { graceTimeSeconds: 600 },
      configureAuthority: async (graceTimeSeconds) => {
        order.push('authority')
        authorityValues.push(graceTimeSeconds)
        return { graceTimeMs: 0 }
      },
      configureControl: (graceTimeSeconds) => {
        order.push('control')
        controlValues.push(graceTimeSeconds)
        return { graceTimeMs: 600_000 }
      }
    })

    expect(order).toEqual(['authority', 'control'])
    expect(authorityValues).toEqual([0])
    expect(controlValues).toEqual([600])
    expect(result).toEqual({ graceTimeMs: 600_000 })
  })

  it('leaves control unchanged when authority rejects or returns a false acknowledgement', async () => {
    const configureControl = vi.fn(() => ({ graceTimeMs: 60_000 }))

    await expect(
      configureAcknowledgedRelayGraceTime({
        params: { graceTimeSeconds: 60 },
        configureAuthority: async () => {
          throw new Error('authority unavailable')
        },
        configureControl
      })
    ).rejects.toThrow('authority unavailable')
    await expect(
      configureAcknowledgedRelayGraceTime({
        params: { graceTimeSeconds: 60 },
        configureAuthority: async () => ({ graceTimeMs: 59_000 }),
        configureControl
      })
    ).rejects.toThrow('not_applied')

    expect(configureControl).not.toHaveBeenCalled()
  })

  it('preserves the combined-relay path without requiring an authority peer', async () => {
    const configureControl = vi.fn(() => ({ graceTimeMs: 0 }))

    await expect(
      configureAcknowledgedRelayGraceTime({
        params: { graceTimeSeconds: 0 },
        configureControl
      })
    ).resolves.toEqual({ graceTimeMs: 0 })
    expect(configureControl).toHaveBeenCalledWith(0)
  })

  it.each([-1, 604_801, 1.5, '60', undefined])(
    'rejects malformed grace value %j before touching either process',
    async (graceTimeSeconds) => {
      const configureAuthority = vi.fn(async () => ({ graceTimeMs: 0 }))
      const configureControl = vi.fn(() => ({ graceTimeMs: 0 }))

      await expect(
        configureAcknowledgedRelayGraceTime({
          params: { graceTimeSeconds },
          configureAuthority,
          configureControl
        })
      ).rejects.toThrow('grace_time_invalid')
      expect(configureAuthority).not.toHaveBeenCalled()
      expect(configureControl).not.toHaveBeenCalled()
    }
  )
})
