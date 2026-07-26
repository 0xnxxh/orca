import { rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import {
  createBranchCommit,
  openSourceControl,
  seedCreatePrComposer
} from './helpers/source-control-ai-generation'
import { waitForSessionReady } from './helpers/store'

/**
 * Echoes back whichever issue number reached the PR prompt as the generated
 * title, so the assertion covers renderer → IPC → meta → template → agent stdin
 * for the pull-request path (the commit twin lives in source-control-commit-message-ai).
 */
function writeLinkedIssuePrEchoGenerator(scriptPath: string, base: string): void {
  writeFileSync(
    scriptPath,
    [
      'const chunks = []',
      "process.stdin.on('data', (chunk) => chunks.push(chunk))",
      "process.stdin.on('end', () => {",
      "  const prompt = Buffer.concat(chunks).toString('utf8')",
      // Why: capture the whole line, not `\d*` — a `\d*` capture matches zero digits before
      // an unexpanded `{linkedIssue}` and reports it as `empty`, hiding a literal token.
      '  const match = prompt.match(/ORCA_E2E_ISSUE=([^\\r\\n]*)/)',
      "  const issue = match ? match[1] || 'empty' : 'missing'",
      '  process.stdout.write(JSON.stringify({',
      `    base: ${JSON.stringify(base)},`,
      '    title: `saw-issue:${issue}`,',
      "    body: 'linked-issue e2e body',",
      '    draft: false',
      '  }))',
      '})'
    ].join('\n')
  )
}

test.describe('Source Control AI pull request linkedIssue', () => {
  // Why: the unlinked case separates a real resolver from one that always returns a number,
  // and — because the generator echoes the whole line into the title — a literal
  // `{linkedIssue}` reaches the assertion as `saw-issue:{linkedIssue}` instead of
  // masquerading as the empty expansion.
  for (const { label, linkedIssue, expected } of [
    { label: 'substitutes the workspace-linked issue into', linkedIssue: 4242, expected: '4242' },
    {
      label: 'expands the issue token to nothing for an unlinked workspace in',
      linkedIssue: null,
      expected: 'empty'
    }
  ]) {
    test(`${label} the pull-request recipe`, async ({ orcaPage }) => {
      await waitForSessionReady(orcaPage)
      const { prWorktreeId, prWorktreePath, primaryBranch } = await seedCreatePrComposer(orcaPage)
      createBranchCommit(prWorktreePath)

      const generatorPath = path.join(
        os.tmpdir(),
        `e2e-pr-linked-issue-${Date.now()}-${Math.random().toString(16).slice(2)}.cjs`
      )
      writeLinkedIssuePrEchoGenerator(generatorPath, primaryBranch)

      try {
        await orcaPage.evaluate(
          async ({ generatorPath, linkedIssue, worktreeId }) => {
            const store = window.__store
            if (!store) {
              throw new Error('window.__store is not available')
            }
            await window.api.worktrees.updateMeta({ worktreeId, updates: { linkedIssue } })
            const customAgentCommand = `node ${JSON.stringify(generatorPath)}`
            await store.getState().updateSettings({
              activeRuntimeEnvironmentId: null,
              sourceControlAi: {
                enabled: true,
                agentId: 'custom' as const,
                selectedModelByAgent: {},
                selectedThinkingByModel: {},
                customAgentCommand,
                instructionsByOperation: {},
                actions: {
                  pullRequest: {
                    agentId: 'custom' as const,
                    commandInputTemplate: 'ORCA_E2E_ISSUE={linkedIssue}\n\n{basePrompt}'
                  }
                }
              }
            })
          },
          { generatorPath, linkedIssue, worktreeId: prWorktreeId }
        )

        await openSourceControl(orcaPage, prWorktreeId)

        const title = orcaPage.getByRole('textbox', { name: 'Pull request title' })
        await expect(title).toBeVisible({ timeout: 10_000 })

        const generate = orcaPage.getByRole('button', {
          name: 'Generate pull request details with AI'
        })
        await expect(generate).toBeEnabled()
        await generate.click()

        await expect(title).toHaveValue(`saw-issue:${expected}`, { timeout: 15_000 })
      } finally {
        rmSync(generatorPath, { force: true })
      }
    })
  }
})
