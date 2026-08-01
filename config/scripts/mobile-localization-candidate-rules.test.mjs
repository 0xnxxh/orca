import { describe, expect, it } from 'vitest'

import { collectLocalizationCandidates } from './audit-localization-coverage.mjs'

describe('mobile-localization-candidate-rules', () => {
  it('finds grammatical fragments returned by repositoryCount', () => {
    const source = `
function repositoryCount(count) {
  return \`\${count} \${count === 1 ? 'repository' : 'repositories'}\`
}
`
    const candidates = collectLocalizationCandidates('/repo/mobile/app/tasks.tsx', source, '/repo')

    expect(candidates.map((candidate) => candidate.text)).toEqual(['repository', 'repositories'])
  })

  it('finds copy embedded in mobile WebView documents', () => {
    const source = String.raw`
export const HTML = \`<!doctype html>
<main data-placeholder="Start writing..."></main>
<button>Copy</button><button>Select All</button>
<script>
  window.prompt('Link URL');
  document.execCommand('insertHTML', false, '<p>Task</p>');
</script>
\`
`
    const candidates = collectLocalizationCandidates(
      '/repo/mobile/src/components/example-html.ts',
      source,
      '/repo'
    )

    expect(candidates.map((candidate) => candidate.text)).toEqual([
      'Start writing...',
      'Copy',
      'Select All',
      'Link URL',
      'Task'
    ])
  })
})
