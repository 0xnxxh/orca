import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const workflow = parse(readFileSync('.github/workflows/readme-downloads-badge.yml', 'utf8'))

describe('README release metadata workflow', () => {
  it('pins download links from the semantic latest stable release', () => {
    const steps = workflow.jobs.update.steps
    const pinStep = steps.find((step) => step.name === 'Pin downloads to latest stable tag')

    expect(pinStep.env).toEqual({ GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' })
    expect(pinStep.run).toContain('node config/scripts/latest-stable-release.mjs')
    expect(pinStep.run).toContain('node config/scripts/pin-release-download-links.mjs "$tag"')
  })

  it('commits pinned documentation with the downloads badge', () => {
    const steps = workflow.jobs.update.steps
    const commitStep = steps.find((step) => step.name === 'Commit badge update')

    expect(commitStep.run).toContain(
      'git add README.md docs/assets/readme-downloads.svg docs/readme docs/reference/headless-linux-server.md'
    )
  })
})
