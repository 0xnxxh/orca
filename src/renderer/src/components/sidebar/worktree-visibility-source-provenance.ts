import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import React from 'react'
import type { Repo, WorktreeVisibilityDefaults } from '../../../../shared/types'
import {
  effectiveDefaultBuiltInWorktreeSourceVisibility,
  effectiveDefaultCustomWorktreeSourceVisibility,
  normalizeCustomWorktreeVisibilitySources,
  normalizeWorktreeVisibilitySourcePreferences
} from '../../../../shared/worktree-visibility-sources'
import type { WorktreeVisibilitySourceRow } from './WorktreeVisibilitySourceList'

type SourceProvenance = {
  kind: 'global' | 'project-override' | 'project-source'
  globalEnabled?: boolean
}

export function hasGloballyShownWorktreeVisibilitySource(
  repo: Repo,
  visibilityDefaults: WorktreeVisibilityDefaults | undefined
): boolean {
  const defaults = visibilityDefaults ?? {}
  const repoCustomSourceIds = new Set(
    normalizeCustomWorktreeVisibilitySources(repo.customWorktreeVisibilitySources)?.map(
      (source) => source.id
    ) ?? []
  )
  const sources: WorktreeVisibilitySourceRow[] = [
    { kind: 'built-in', id: 'claude' },
    { kind: 'built-in', id: 'gsd' },
    ...(normalizeCustomWorktreeVisibilitySources(defaults.customSources) ?? []).map((source) => ({
      kind: 'custom' as const,
      source
    })),
    { kind: 'other' }
  ]

  return sources.some((source) => {
    const provenance = getWorktreeVisibilitySourceProvenance(
      repo,
      source,
      defaults,
      repoCustomSourceIds
    )
    return provenance?.kind === 'global' && provenance.globalEnabled === true
  })
}

export function getWorktreeVisibilitySourceProvenance(
  repo: Repo | undefined,
  source: WorktreeVisibilitySourceRow,
  visibilityDefaults: WorktreeVisibilityDefaults,
  repoCustomSourceIds: ReadonlySet<string>
): SourceProvenance | null {
  if (!repo) {
    return null
  }
  if (source.kind === 'custom' && repoCustomSourceIds.has(source.source.id)) {
    return { kind: 'project-source' }
  }
  const preferences = normalizeWorktreeVisibilitySourcePreferences(
    repo.worktreeVisibilitySourcePreferences
  )
  const overridden =
    source.kind === 'built-in'
      ? preferences?.builtIn?.[source.id] !== undefined ||
        repo.agentWorktreeVisibility !== undefined
      : source.kind === 'custom'
        ? preferences?.custom?.[source.source.id] !== undefined
        : repo.externalWorktreeVisibility !== undefined
  const globalEnabled =
    source.kind === 'built-in'
      ? effectiveDefaultBuiltInWorktreeSourceVisibility(visibilityDefaults, source.id) === 'show'
      : source.kind === 'custom'
        ? effectiveDefaultCustomWorktreeSourceVisibility(visibilityDefaults, source.source.id) ===
          'show'
        : visibilityDefaults.external === 'show'
  return { kind: overridden ? 'project-override' : 'global', globalEnabled }
}

export function getWorktreeVisibilitySourceProvenanceLabel(provenance: SourceProvenance): string {
  if (provenance.kind === 'project-source') {
    return translate(
      'auto.components.sidebar.WorktreeVisibilitySourceList.projectSource',
      'Project source'
    )
  }
  const globalValue = provenance.globalEnabled
    ? translate('auto.components.sidebar.WorktreeVisibilitySourceList.shown', 'Shown')
    : translate('auto.components.sidebar.WorktreeVisibilitySourceList.hidden', 'Hidden')
  return provenance.kind === 'project-override'
    ? translate(
        'auto.components.sidebar.WorktreeVisibilitySourceList.projectOverride',
        'Project override · Global: {{value0}}',
        { value0: globalValue }
      )
    : translate(
        'auto.components.sidebar.WorktreeVisibilitySourceList.usingGlobal',
        'Using global: {{value0}}',
        { value0: globalValue }
      )
}

export function WorktreeVisibilityUseGlobalButton({
  source,
  accessibleLabel,
  disabled,
  onUseDefault
}: {
  source: WorktreeVisibilitySourceRow
  accessibleLabel: string
  disabled: boolean
  onUseDefault: (source: WorktreeVisibilitySourceRow) => Promise<void>
}): React.JSX.Element {
  return React.createElement(
    Button,
    {
      type: 'button',
      variant: 'link',
      size: 'xs',
      className: 'h-auto px-1',
      disabled,
      'aria-label': translate(
        'auto.components.sidebar.WorktreeVisibilitySourceList.useGlobalFor',
        'Use global for {{value0}}',
        { value0: accessibleLabel }
      ),
      onClick: () => void onUseDefault(source)
    },
    translate('auto.components.sidebar.WorktreeVisibilitySourceList.useGlobal', 'Use global')
  )
}
