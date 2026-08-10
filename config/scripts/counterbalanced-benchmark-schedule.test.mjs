import { describe, expect, it } from 'vitest'

import { buildCounterbalancedSchedule } from './counterbalanced-benchmark-schedule.mjs'

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

describe('counterbalanced benchmark schedule', () => {
  it('builds complete ABBA blocks', () => {
    expect(buildCounterbalancedSchedule(4, 'login', 'fast')).toEqual([
      ['login', 'fast'],
      ['fast', 'login'],
      ['login', 'fast'],
      ['fast', 'login']
    ])
  })

  it('rejects counts that cannot balance launch positions', () => {
    for (const pairCount of [0, 1, 3, 4.5]) {
      expect(() => buildCounterbalancedSchedule(pairCount, 'login', 'fast')).toThrow(
        'positive even pair count'
      )
    }
  })

  it('requires distinct arms', () => {
    expect(() => buildCounterbalancedSchedule(2, 'login', 'login')).toThrow('two distinct arms')
  })

  it('gives each arm the same mean launch position', () => {
    const launches = buildCounterbalancedSchedule(20, 'login', 'fast').flat()
    const positions = { login: [], fast: [] }
    launches.forEach((arm, index) => positions[arm].push(index))

    expect(mean(positions.login)).toBe(mean(positions.fast))
  })

  it('cancels linear drift from paired arm deltas', () => {
    const schedule = buildCounterbalancedSchedule(20, 'login', 'fast')
    const trueDuration = { login: 100, fast: 80 }
    const driftPerLaunch = 7
    const pairDeltas = schedule.map((order, pairIndex) => {
      const byArm = Object.fromEntries(
        order.map((arm, orderIndex) => [
          arm,
          trueDuration[arm] + (pairIndex * 2 + orderIndex) * driftPerLaunch
        ])
      )
      return byArm.fast - byArm.login
    })

    expect(mean(pairDeltas)).toBe(trueDuration.fast - trueDuration.login)
  })
})
