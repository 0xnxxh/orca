import { readFileSync } from 'node:fs'

import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const workflow = parse(readFileSync('.github/workflows/pr.yml', 'utf8'))
const headlessLinuxGuide = readFileSync('docs/reference/headless-linux-server.md', 'utf8')

function readSystemdUnitBlocks(doc, unitName) {
  return [...doc.matchAll(new RegExp(`^# /etc/systemd/system/${unitName}$`, 'gm'))].map((match) => {
    const start = match.index + match[0].length
    return doc.slice(start, doc.indexOf('```', start))
  })
}

describe('headless serve shutdown PR gate', () => {
  it('packages an x64 AppImage before running the Docker signal oracle', () => {
    const steps = workflow.jobs.package.steps
    const packageStep = steps.find((step) => step.name === 'Package unpacked app')
    const shutdownStep = steps.find((step) => step.name === 'Verify headless serve signal shutdown')

    expect(packageStep.run).toContain('--linux AppImage --x64 --publish never')
    expect(shutdownStep.run).toBe(
      'node config/scripts/run-headless-serve-shutdown-docker.mjs --appimage dist/orca-linux.AppImage'
    )
    expect(steps.indexOf(shutdownStep)).toBeGreaterThan(steps.indexOf(packageStep))
  })

  it('keeps owned Xvfb alive during the documented systemd graceful stop', () => {
    const serveUnits = readSystemdUnitBlocks(headlessLinuxGuide, 'orca-serve.service')
    const ownedXvfbUnits = serveUnits.filter((unit) => !/^Environment=DISPLAY=/m.test(unit))
    const managedXvfbUnits = serveUnits.filter((unit) => /^Environment=DISPLAY=/m.test(unit))

    expect(ownedXvfbUnits).toHaveLength(1)
    expect(ownedXvfbUnits[0]).toMatch(/^ExecStart=.*orca-linux\.AppImage serve.*$/m)
    expect(ownedXvfbUnits[0]).toMatch(/^KillMode=mixed$/m)
    expect(managedXvfbUnits).toHaveLength(1)
    expect(managedXvfbUnits[0]).not.toMatch(/^KillMode=/m)
  })
})
