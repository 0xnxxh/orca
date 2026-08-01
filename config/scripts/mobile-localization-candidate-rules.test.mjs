import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  collectLocalizationCandidates,
  main as auditLocalizationCoverage
} from './audit-localization-coverage.mjs'

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

  it('finds arbitrary doctype documents and template-literal insertHTML copy', () => {
    const source = [
      'export const HTML = `<!doctype html>',
      '<main>Diagram controls</main>',
      '<script>',
      "document.execCommand('insertHTML', false, \\`<p>Retry ${name}</p><p>Follow up</p>\\`);",
      '</script>',
      '`'
    ].join('\n')
    const candidates = collectLocalizationCandidates(
      '/repo/mobile/src/components/pr-sidebar/MermaidDiagram.tsx',
      source,
      '/repo'
    )

    expect(candidates.map(({ dynamic, text }) => ({ dynamic, text }))).toEqual([
      { dynamic: false, text: 'Diagram controls' },
      { dynamic: true, text: 'Retry' },
      { dynamic: false, text: 'Follow up' }
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

  it('finds literals assigned to variables rendered through user-visible JSX attributes', () => {
    const source = `
export function Example() {
  const copy = 'Save changes'
  const className = 'not-visible-copy'
  return <Button title={copy} className={className} />
}
`
    const candidates = collectLocalizationCandidates(
      '/repo/mobile/src/components/Example.tsx',
      source,
      '/repo'
    )

    expect(candidates.map((candidate) => candidate.text)).toEqual(['Save changes'])
  })

  it('finds unlocalized success-toast object copy', () => {
    const source = `
export const launch = {
  options: { successToast: 'Quick command inserted' }
}
`
    const candidates = collectLocalizationCandidates(
      '/repo/mobile/src/terminal/quick-commands.ts',
      source,
      '/repo'
    )

    expect(candidates.map((candidate) => candidate.text)).toEqual(['Quick command inserted'])
  })

  it('finds unlocalized fallbacks returned by commentAuthor', () => {
    const source = `
function commentAuthor(comment) {
  return comment.author ?? 'unknown'
}
export function Example({ comment }) {
  return <Text>{commentAuthor(comment)}</Text>
}
`
    const candidates = collectLocalizationCandidates(
      '/repo/mobile/app/h/[hostId]/tasks.tsx',
      source,
      '/repo'
    )

    expect(candidates.map((candidate) => candidate.text)).toEqual(['unknown'])
  })

  it('finds copy returned by a helper whose result is rendered', () => {
    const source = `
function lookup() {
  return 'Extracting model'
}
function internalValue() {
  return 'internal-only'
}
function projectRowType() {
  return 'issue'
}
export function Example() {
  const render = lookup
  return <>{projectRowType() ? <Text>{render()}</Text> : null}</>
}
`
    const candidates = collectLocalizationCandidates(
      '/repo/mobile/src/components/Example.tsx',
      source,
      '/repo'
    )

    expect(candidates.map((candidate) => candidate.text)).toEqual(['Extracting model'])
  })

  it('finds Android notification-channel names', () => {
    const source = `
const channel = {
  name: 'Desktop Notifications',
  importance: Notifications.AndroidImportance.HIGH
}
Notifications.setNotificationChannelAsync('orca-desktop', channel)
`
    const candidates = collectLocalizationCandidates(
      '/repo/mobile/src/notifications/local-notification-scheduling.ts',
      source,
      '/repo'
    )

    expect(candidates.map((candidate) => candidate.text)).toEqual(['Desktop Notifications'])
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
import * as i18n from '@/i18n/mobile-i18n'
const localized = translateMobile('example.localized')
export function Example(translateMobile) {
  return <Text>{translateMobile('Unlocalized shadowed copy')}</Text>
}
export function MemberExample(i18n) {
  return <Text>{i18n.t('Unlocalized shadowed member copy')}</Text>
}
`
    const candidates = collectLocalizationCandidates(
      '/repo/mobile/src/components/Example.tsx',
      source,
      '/repo'
    )

    expect(candidates.map((candidate) => candidate.text)).toEqual([
      'Unlocalized shadowed copy',
      'Unlocalized shadowed member copy'
    ])
  })

  it('rejects stale allowlist entries before their approval can be reused', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'orca-localization-allowlist-'))
    const sourceDirectory = path.join(root, 'mobile', 'src')
    const configDirectory = path.join(root, 'config')
    mkdirSync(sourceDirectory, { recursive: true })
    mkdirSync(configDirectory, { recursive: true })
    writeFileSync(path.join(sourceDirectory, 'Example.tsx'), "export const value = 'internal'\n")
    writeFileSync(
      path.join(configDirectory, 'allowlist.json'),
      `${JSON.stringify([
        {
          filePath: 'mobile/src/Example.tsx',
          kind: 'jsx-text',
          text: 'Removed approved copy',
          dynamic: false,
          count: 1
        }
      ])}\n`
    )
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      await expect(
        auditLocalizationCoverage(root, [
          '--check',
          '--source-root',
          'mobile/src',
          '--allowlist',
          'config/allowlist.json'
        ])
      ).resolves.toBe(1)
      expect(error.mock.calls.flat().join('\n')).toContain(
        'Stale localization allowlist entries were found.'
      )
    } finally {
      error.mockRestore()
    }
  })
})
