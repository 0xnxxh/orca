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
  document.execCommand('insertHTML', false, '<p>Task ' + localized + '</p><p>Follow up</p>');
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
      'Task',
      'Follow up'
    ])
  })

  it('finds static copy around dynamic WebView values and prompts', () => {
    const source = [
      'export const HTML = `<!doctype html>',
      '<button title="Copy ${name}">Retry ${name}</button>',
      '<script>window.alert(\\`Could not load ${name}\\`);</script>',
      '`'
    ].join('\n')
    const candidates = collectLocalizationCandidates(
      '/repo/mobile/src/components/example-webview-html.ts',
      source,
      '/repo'
    )

    expect(candidates.map(({ dynamic, text }) => ({ dynamic, text }))).toEqual([
      { dynamic: true, text: 'Copy' },
      { dynamic: true, text: 'Retry' },
      { dynamic: true, text: 'Could not load' }
    ])
  })

  it('finds literals assigned to variables that later render in JSX', () => {
    const source = `
export function Example({ alternate }) {
  const copy = alternate ? 'Primary explanation' : 'Alternate explanation'
  let followUp = 'Initial recovery note'
  const fileLocation = \`\${path}:L\${line}\`
  if (alternate) {
    followUp = 'Updated recovery note'
  }
  return <><Text>{copy}</Text><Text>{followUp}</Text><Text>{fileLocation}</Text></>
}
`
    const candidates = collectLocalizationCandidates(
      '/repo/mobile/src/components/Example.tsx',
      source,
      '/repo'
    )

    expect(candidates.map((candidate) => candidate.text)).toEqual([
      'Primary explanation',
      'Alternate explanation',
      'Initial recovery note',
      'Updated recovery note'
    ])
  })

  it('finds user-visible subject fallbacks in returned rows', () => {
    const source = `
export function toRow(item) {
  return { subject: item.subject || '(no commit message)' }
}
`
    const candidates = collectLocalizationCandidates(
      '/repo/mobile/src/source-control/mobile-git-history.ts',
      source,
      '/repo'
    )

    expect(candidates.map((candidate) => candidate.text)).toEqual(['(no commit message)'])
  })

  it('recognizes aliased translators and reports calls shadowed by parameters', () => {
    const source = `
import { t as translateMobile } from '@/i18n/mobile-i18n'
const localized = translateMobile('example.localized')
export function Example(translateMobile) {
  return <Text>{translateMobile('Unlocalized shadowed copy')}</Text>
}
`
    const candidates = collectLocalizationCandidates(
      '/repo/mobile/src/components/Example.tsx',
      source,
      '/repo'
    )

    expect(candidates.map((candidate) => candidate.text)).toEqual(['Unlocalized shadowed copy'])
  })
})
