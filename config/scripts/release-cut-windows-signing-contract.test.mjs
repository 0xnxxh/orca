import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const workflowPath = join(projectDir, '.github/workflows/release-cut.yml')

describe('release-cut Windows signing contract', () => {
  it('keeps release policy on canonical main and publishes only after rebuild', () => {
    const workflowText = readFileSync(workflowPath, 'utf8')
    const workflow = parse(workflowText)
    const cutJob = workflow.jobs.cut
    const versionStep = cutJob.steps.find((step) => step.name === 'Compute next version')
    const createReleaseJob = workflow.jobs['create-release']
    const buildJob = workflow.jobs.build
    const publishReleaseJob = workflow.jobs['publish-release']
    const createCheckout = createReleaseJob.steps.find((step) => step.name === 'Checkout')
    const buildCheckout = buildJob.steps.find((step) => step.name === 'Checkout')
    const publishCheckout = publishReleaseJob.steps.find((step) => step.name === 'Checkout')

    expect(cutJob.if).toBe(
      "github.repository == 'stablyai/orca' && github.ref == 'refs/heads/main'"
    )
    expect(cutJob.outputs.tag).toContain('steps.version.outputs.recovered_tag')
    expect(cutJob.outputs.should_release).toContain('steps.version.outputs.recovered_tag')
    expect(cutJob.outputs.latest_published_rc_tag).toBeUndefined()
    expect(cutJob.steps.some((step) => step.id === 'publish_drafts')).toBe(false)
    expect(versionStep.if).not.toContain('publish_drafts')
    expect(workflow.jobs['homebrew-bump-published-rc-draft']).toBeUndefined()
    expect(workflowText).not.toContain('publish-complete-draft-releases')
    expect(existsSync(join(projectDir, 'config/scripts/publish-complete-draft-releases.mjs'))).toBe(
      false
    )
    expect(
      existsSync(join(projectDir, 'config/scripts/publish-complete-draft-releases.test.mjs'))
    ).toBe(false)

    expect(createReleaseJob.if).toBe("needs.cut.outputs.should_release == 'true'")
    expect(buildJob.if).toBe("needs.cut.outputs.should_release == 'true'")
    expect(createCheckout.with.ref).toBe('refs/tags/${{ needs.cut.outputs.tag }}')
    expect(buildCheckout.with.ref).toBe('refs/tags/${{ needs.cut.outputs.tag }}')
    expect(publishReleaseJob.needs).toContain('build')
    expect(publishCheckout.with.ref).toBe('${{ github.sha }}')
    expect(workflowText.match(/--draft=false/g)).toHaveLength(1)
  })

  it('records the complete inner-signing chain before a release-blocking failure', () => {
    const workflow = parse(readFileSync(workflowPath, 'utf8'))
    const steps = workflow.jobs.build.steps
    const stepNames = steps.map((step) => step.name)
    const outerVerifyIndex = stepNames.indexOf('Verify signed Windows installer')
    const innerVerifyIndex = stepNames.indexOf('Verify Windows inner binary signatures')
    const evidenceIndex = stepNames.indexOf('Upload Windows inner signing evidence')
    const publishIndex = stepNames.indexOf('Publish signed Windows release artifacts')
    const innerVerifyStep = steps[innerVerifyIndex]
    const evidenceStep = steps[evidenceIndex]
    const publishStep = steps[publishIndex]

    expect(outerVerifyIndex).toBeGreaterThan(-1)
    expect(innerVerifyIndex).toBe(outerVerifyIndex + 1)
    expect(evidenceIndex).toBe(innerVerifyIndex + 1)
    expect(publishIndex).toBe(evidenceIndex + 1)
    expect(innerVerifyStep.env.ORCA_WINDOWS_INNER_SIGNATURE_REQUIRED).toBe('true')
    expect(innerVerifyStep['continue-on-error']).toBeUndefined()
    expect(evidenceStep.if).toBe("always() && matrix.platform == 'win'")
    expect(publishStep.if).toBe("success() && matrix.platform == 'win'")

    const expectedOutcomes = {
      STAGE_INNER_OUTCOME: '${{ steps.stage-inner.outcome }}',
      UPLOAD_UNSIGNED_INNER_OUTCOME: '${{ steps.upload-unsigned-inner.outcome }}',
      SUBMIT_INNER_SIGNING_OUTCOME: '${{ steps.submit-inner-signing.outcome }}',
      NOTIFY_INNER_SIGNING_OUTCOME: '${{ steps.notify-inner-signing.outcome }}',
      DOWNLOAD_SIGNED_INNER_OUTCOME: '${{ steps.download-signed-inner.outcome }}',
      RESTORE_SIGNED_INNER_OUTCOME: '${{ steps.restore-signed-inner.outcome }}',
      SIGN_ELEVATE_CACHE_OUTCOME: '${{ steps.sign-elevate-cache.outcome }}',
      REBUILD_NSIS_SIGNED_OUTCOME: '${{ steps.rebuild-nsis-signed.outcome }}'
    }
    for (const [name, expression] of Object.entries(expectedOutcomes)) {
      expect(innerVerifyStep.env[name], name).toBe(expression)
    }

    const chainStepNames = [
      'Stage unsigned inner PE files for signing',
      'Upload unsigned inner binaries for SignPath',
      'Submit inner binaries signing request',
      'Notify Slack that inner-binary signing is waiting for approval',
      'Download signed inner binaries from SignPath',
      'Restore signed inner binaries into unpacked app',
      'Replace cached elevate.exe with the signed copy',
      'Rebuild NSIS installer from signed unpacked app'
    ]
    for (const stepName of chainStepNames) {
      const step = steps[stepNames.indexOf(stepName)]
      expect(step, stepName).toBeDefined()
      expect(step['continue-on-error'], stepName).toBe(true)
    }

    const evidenceRun = innerVerifyStep.run
    const firstEvidenceWrite = evidenceRun.indexOf("Set-Content -Path 'inner-signing-evidence.txt'")
    const incompleteChainCheck = evidenceRun.indexOf("if ($env:INNER_SIGNING_COMPLETED -ne 'true')")
    const verificationFailure = evidenceRun.indexOf('$report.Add("failure: $_")')
    const verificationThrow = evidenceRun.lastIndexOf('if ($required) { throw $message }')
    const caughtError = evidenceRun.indexOf('$report.Add("error: $($_.Exception.Message)")')
    const caughtErrorThrow = evidenceRun.indexOf('if ($required) { throw }')

    expect(innerVerifyStep.env.RELEASE_TAG).toBe('${{ needs.cut.outputs.tag }}')
    expect(firstEvidenceWrite).toBeGreaterThan(-1)
    expect(firstEvidenceWrite).toBeLessThan(incompleteChainCheck)
    expect(verificationFailure).toBeLessThan(verificationThrow)
    expect(caughtError).toBeLessThan(caughtErrorThrow)
  })
})
