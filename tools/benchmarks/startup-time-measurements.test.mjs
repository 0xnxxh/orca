import { describe, expect, it } from 'vitest'
import { deriveStartupPhases, parseStartupLine } from './startup-time-measurements.mjs'

function event(source, name, t, harnessMs, details = {}) {
  return { source, event: name, details: { t, ...details }, harnessMs }
}

describe('parseStartupLine', () => {
  it('parses bootstrap and startup events into the same event schema', () => {
    expect(
      parseStartupLine(
        '[bootstrap] bundle-enter t=4.25 clock="process-performance-now-ms" argv=["Orca App","--flag"]'
      )
    ).toEqual({
      source: 'bootstrap',
      event: 'bundle-enter',
      details: {
        t: 4.25,
        clock: 'process-performance-now-ms',
        argv: ['Orca App', '--flag']
      }
    })
    expect(
      parseStartupLine(
        '[startup] services-initialized service="desktop startup" t=120.5 clock="process-performance-now-ms"'
      )
    ).toEqual({
      source: 'startup',
      event: 'services-initialized',
      details: {
        service: 'desktop startup',
        t: 120.5,
        clock: 'process-performance-now-ms'
      }
    })
  })

  it('ignores unrelated stderr', () => {
    expect(parseStartupLine('Electron warning')).toBeNull()
  })
})

describe('deriveStartupPhases', () => {
  it('derives explicit non-negative startup phases on their truthful clocks', () => {
    const phases = deriveStartupPhases([
      event('bootstrap', 'bundle-enter', 10, 50),
      event('bootstrap', 'bundle-evaluation-complete', 30, 72),
      event('startup', 'app-ready', 70, 110),
      event('startup', 'services-initialized', 110, 151),
      event('startup', 'renderer-first-react-commit', 160, 202, { rendererT: 20 }),
      event('startup', 'renderer-shell-painted', 170, 220, { rendererT: 36 })
    ])

    expect(phases).toMatchObject({
      spawnToBundleEnterMs: 50,
      synchronousBundleAndDependencyEvaluationMs: 20,
      bundleEvaluationCompleteToAppReadyMs: 40,
      appReadyToServicesInitializedMs: 40,
      servicesInitializedToFirstReactCommitMs: 50,
      firstReactCommitToShellPaintedMs: 16,
      totalToFirstReactCommitMs: 202,
      totalToShellPaintedMs: 220
    })
    expect(Object.values(phases).filter((value) => typeof value === 'number')).toEqual(
      expect.arrayContaining([expect.any(Number)])
    )
    expect(
      Object.values(phases)
        .filter((value) => typeof value === 'number')
        .every((value) => value >= 0)
    ).toBe(true)
  })

  it('returns null for phases whose clock boundaries are unavailable', () => {
    const phases = deriveStartupPhases([event('bootstrap', 'bundle-enter', 5, 20)])

    expect(phases.synchronousBundleAndDependencyEvaluationMs).toBeNull()
    expect(phases.firstReactCommitToShellPaintedMs).toBeNull()
  })
})
