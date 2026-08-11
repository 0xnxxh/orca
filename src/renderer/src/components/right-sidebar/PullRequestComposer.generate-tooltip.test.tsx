// @vitest-environment happy-dom

import { renderToStaticMarkup } from 'react-dom/server'
import { useState } from 'react'
import { cleanup, fireEvent, render as renderDom, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CreateHostedReviewComposer } from './CreateHostedReviewComposer'
import type { HostedReviewStackParent } from './useHostedReviewStackParent'
import { resolveDropdownItems } from './source-control-dropdown-items'
import { resolvePrimaryAction } from './source-control-primary-action'

type RenderPullRequestComposerOptions = {
  aiGenerationEnabled?: boolean
  generating?: boolean
  generateDisabled?: boolean
  generateDisabledReason?: string
  stackedCreationSupported?: boolean
  stackParentReview?: HostedReviewStackParent | null
  base?: string
  setBase?: (value: string) => void
  baseQuery?: string
  setBaseQuery?: (value: string) => void
  baseResults?: string[]
  setBaseResults?: (value: string[]) => void
  onPrimaryAction?: (stacked: boolean) => void
}

const EMPTY_BASE_RESULTS: string[] = []

function pullRequestComposerElement({
  aiGenerationEnabled = true,
  generating = false,
  generateDisabled = false,
  generateDisabledReason,
  stackedCreationSupported = true,
  stackParentReview = null,
  base = 'master',
  setBase = vi.fn(),
  baseQuery = '',
  setBaseQuery = vi.fn(),
  baseResults = [],
  setBaseResults = vi.fn(),
  onPrimaryAction = vi.fn()
}: RenderPullRequestComposerOptions = {}): React.JSX.Element {
  const sourceControlInputs = {
    stagedCount: 1,
    hasUnstagedChanges: false,
    hasStageableChanges: false,
    hasPartiallyStagedChanges: false,
    hasMessage: true,
    hasUnresolvedConflicts: false,
    isCommitting: false,
    isRemoteOperationActive: false,
    upstreamStatus: { hasUpstream: true, ahead: 1, behind: 0 }
  }
  const primaryAction = resolvePrimaryAction(sourceControlInputs)

  return (
    <TooltipProvider>
      <CreateHostedReviewComposer
        provider="github"
        branch="branch-login-issue"
        base={base}
        setBase={setBase}
        title="Ready to create"
        setTitle={vi.fn()}
        body=""
        setBody={vi.fn()}
        draft={false}
        setDraft={vi.fn()}
        stackedCreationSupported={stackedCreationSupported}
        stackParentReview={stackParentReview}
        baseQuery={baseQuery}
        setBaseQuery={setBaseQuery}
        baseResults={baseResults}
        setBaseResults={setBaseResults}
        baseSearchError={null}
        aiGenerationEnabled={aiGenerationEnabled}
        generating={generating}
        generateDisabled={generateDisabled}
        generateDisabledReason={generateDisabledReason}
        generateError={null}
        createError={null}
        isCreating={false}
        primaryAction={primaryAction}
        dropdownItems={resolveDropdownItems(sourceControlInputs)}
        onGenerate={vi.fn()}
        onCancelGenerate={vi.fn()}
        onPrimaryAction={onPrimaryAction}
        onDropdownAction={vi.fn()}
      />
    </TooltipProvider>
  )
}

function renderPullRequestComposer(options: RenderPullRequestComposerOptions = {}): string {
  return renderToStaticMarkup(pullRequestComposerElement(options))
}

function InteractiveBaseComposer({ baseResults = EMPTY_BASE_RESULTS }: { baseResults?: string[] }) {
  const [base, setBase] = useState('main')
  const [baseQuery, setBaseQuery] = useState('')
  const [results, setBaseResults] = useState(baseResults)

  return pullRequestComposerElement({
    base,
    setBase,
    baseQuery,
    setBaseQuery,
    baseResults: results,
    setBaseResults
  })
}

function elementByLabel(markup: string, tagName: string, label: string): string {
  const element = [...markup.matchAll(new RegExp(`<${tagName}\\b[\\s\\S]*?</${tagName}>`, 'g'))]
    .map((match) => match[0])
    .find((entry) => entry.includes(`aria-label="${label}"`))

  if (!element) {
    throw new Error(`${tagName} not found: ${label}`)
  }

  return element
}

describe('CreateHostedReviewComposer generate tooltip', () => {
  afterEach(cleanup)

  it('renders hosted review labels without leaking interpolation placeholders', () => {
    const markup = renderPullRequestComposer()

    expect(markup).toContain('aria-label="Generate pull request details with AI"')
    expect(markup).not.toContain('{{value0}}')
    expect(markup).not.toContain('title="Generate {{value0}} details with AI"')
  })

  it('hides hosted review generation controls when Source Control AI actions are hidden', () => {
    const markup = renderPullRequestComposer({ aiGenerationEnabled: false })

    expect(markup).not.toContain('Generate pull request details with AI')
    expect(markup).toContain('Create')
  })

  it('keeps enabled generation controls as direct tooltip triggers', () => {
    const markup = renderPullRequestComposer()
    const button = elementByLabel(markup, 'button', 'Generate pull request details with AI')

    expect(button).toContain('data-slot="tooltip-trigger"')
  })

  it('wraps only disabled generation controls so the disabled reason can show on hover', () => {
    const markup = renderPullRequestComposer({
      generateDisabled: true,
      generateDisabledReason: 'Stage changes before generating.'
    })
    const wrapper = elementByLabel(markup, 'span', 'Generate pull request details with AI')
    const button = elementByLabel(markup, 'button', 'Generate pull request details with AI')

    expect(wrapper).toContain('data-slot="tooltip-trigger"')
    expect(button).toContain('disabled=""')
    expect(button).toContain('data-slot="button"')
  })

  it('keeps the active stop control focusable as the tooltip trigger', () => {
    const markup = renderPullRequestComposer({ generating: true, generateDisabled: true })
    const button = elementByLabel(markup, 'button', 'Stop generating pull request details')

    expect(button).toContain('data-slot="tooltip-trigger"')
    expect(button).not.toContain('disabled=""')
  })

  it('does not ask for a PR type without an open parent review', () => {
    const markup = renderPullRequestComposer()

    expect(markup).not.toContain('Regular PR')
    expect(markup).not.toContain('Stacked PR')
    expect(markup).not.toContain('Stack this PR above')
  })

  it('shows the parent-child preview and stack create action for an open parent review', () => {
    const onPrimaryAction = vi.fn()
    const { container } = renderDom(
      pullRequestComposerElement({
        stackParentReview: { number: 13741, url: 'https://github.com/stablyai/orca/pull/13741' },
        onPrimaryAction
      })
    )

    fireEvent.click(screen.getByRole('checkbox', { name: /Stack this PR above #13741/ }))

    const markup = container.innerHTML

    expect(markup).toContain('#13741')
    expect(markup).toContain('master')
    expect(markup).toContain('branch-login-issue')
    expect(markup).toContain("Creates a GitHub Stack or extends the parent's existing stack.")
    expect(markup).toContain('Create PR in stack')

    fireEvent.click(screen.getByRole('button', { name: /Create PR in stack/ }))
    expect(onPrimaryAction).toHaveBeenCalledWith(true)
  })

  it('hides stacked creation when the executing host lacks the capability', () => {
    const markup = renderPullRequestComposer({
      stackedCreationSupported: false,
      stackParentReview: { number: 13741, url: 'https://github.com/stablyai/orca/pull/13741' }
    })

    expect(markup).not.toContain('Stack this PR above #13741')
  })

  it('keeps temporary base search text separate from the committed branch', () => {
    renderDom(<InteractiveBaseComposer />)
    const input = screen.getByRole('combobox', { name: 'Pull Request base branch' })

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '' } })
    expect((input as HTMLInputElement).value).toBe('')

    fireEvent.change(input, { target: { value: 'release/candidate' } })
    expect((input as HTMLInputElement).value).toBe('release/candidate')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect((input as HTMLInputElement).value).toBe('main')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'release/candidate' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect((input as HTMLInputElement).value).toBe('release/candidate')
  })

  it('places base search results directly under the combobox', () => {
    const { container } = renderDom(<InteractiveBaseComposer baseResults={['release/candidate']} />)
    fireEvent.focus(screen.getByRole('combobox', { name: 'Pull Request base branch' }))

    const markup = container.innerHTML
    expect(markup.indexOf('release/candidate')).toBeLessThan(markup.indexOf('Create as draft'))
  })
})
