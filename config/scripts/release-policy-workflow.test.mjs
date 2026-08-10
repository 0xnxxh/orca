import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const workflow = parse(readFileSync('.github/workflows/release-policy.yml', 'utf8'))

describe('release policy workflow', () => {
  it('enforces published and edited releases with write access', () => {
    expect(workflow.on.release.types).toEqual(['published', 'edited'])
    expect(workflow.permissions.contents).toBe('write')
    expect(workflow.concurrency).toEqual({
      group: 'release-policy',
      'cancel-in-progress': false
    })
  })

  it('loads the policy from main instead of an untrusted release tag', () => {
    const steps = workflow.jobs.enforce.steps
    expect(steps[0]).toMatchObject({
      uses: 'actions/checkout@v6',
      with: { ref: 'main' }
    })
    expect(steps[1].run).toBe('node config/scripts/enforce-release-policy.mjs')
  })
})
