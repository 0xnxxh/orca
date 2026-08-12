import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const workflow = parse(readFileSync('.github/workflows/release-cut.yml', 'utf8'))
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))

function stepNamed(job, name) {
  return job.steps.find((step) => step.name === name)
}

describe('skill-sharing release workflow', () => {
  it('blocks publication on native Windows, macOS, and the Linux floor', () => {
    const platform = workflow.jobs['skill-sharing-release-gate']
    const linux = workflow.jobs['skill-sharing-linux-floor-release-gate']
    const publishNeeds = workflow.jobs['publish-release'].needs

    expect(platform.strategy.matrix.include).toEqual([
      { os: 'macos-15', platform: 'mac' },
      { os: 'windows-2022', platform: 'windows' }
    ])
    expect(linux.container).toBe('ubuntu:20.04')
    expect(publishNeeds).toContain('skill-sharing-release-gate')
    expect(publishNeeds).toContain('skill-sharing-linux-floor-release-gate')
  })

  it('runs the focused contract and transaction suite with real Windows coverage', () => {
    const platform = workflow.jobs['skill-sharing-release-gate']
    const linux = workflow.jobs['skill-sharing-linux-floor-release-gate']
    const platformTest = stepNamed(
      platform,
      'Run skill package, transaction, and compatibility suites'
    )
    const linuxTest = stepNamed(linux, 'Run skill package, transaction, and compatibility suites')
    const command = packageJson.scripts['test:skill-sharing:release']

    expect(platformTest.env.ORCA_REAL_WINDOWS_SKILL_TEST).toContain("runner.os == 'Windows'")
    expect(platformTest.env.ORCA_REAL_PROCESS_SKILL_TEST).toBe('1')
    expect(linuxTest.env.ORCA_REAL_PROCESS_SKILL_TEST).toBe('1')
    expect(platformTest.run).toContain('pnpm test:skill-sharing:release')
    expect(linuxTest.run).toContain('pnpm test:skill-sharing:release')
    expect(command).toContain('src/main/skills')
    expect(command).toContain('src/relay/skill-install-handler.test.ts')
    expect(command).toContain('src/shared/skill-bundle-install-contract.test.ts')
  })

  it('archives bounded machine-readable evidence from every platform', () => {
    for (const jobName of [
      'skill-sharing-release-gate',
      'skill-sharing-linux-floor-release-gate'
    ]) {
      const job = workflow.jobs[jobName]
      const test = stepNamed(job, 'Run skill package, transaction, and compatibility suites')
      const archive = stepNamed(job, 'Archive bounded skill-sharing results')

      expect(test.run).toContain('--reporter=json')
      expect(test.run).toContain('--outputFile=skill-sharing-release-results.json')
      expect(archive.if).toBe('always()')
      expect(archive.with['retention-days']).toBe(14)
      expect(archive.with['if-no-files-found']).toBe('error')
    }
  })
})
