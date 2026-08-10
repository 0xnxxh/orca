import React from 'react'
import { translate } from '@/i18n/i18n'
import type { WorkspaceCleanupBrowseController } from './use-workspace-cleanup-browse-state'
import type { WorkspaceCleanupFacetRows } from './use-workspace-cleanup-facet-rows'
import {
  hasActiveWorkspaceCleanupFilters,
  listActiveWorkspaceCleanupFacetGroups
} from './workspace-cleanup-active-facets'
import { WorkspaceCleanupEmptyState } from './workspace-cleanup-dialog-notices'
import { WorkspaceCleanupFilterBar } from './workspace-cleanup-filter-bar'
import { WorkspaceCleanupPresetChips } from './workspace-cleanup-preset-chips'
import { WorkspaceCleanupSortHeader } from './workspace-cleanup-sort-header'

export function WorkspaceCleanupBrowseToolbar({
  browse,
  facetRows,
  selectedCount,
  spaceScanning,
  gitPendingCount,
  gitCheckedTotal,
  onRunSpaceScan,
  onToggleSelectAll
}: {
  browse: WorkspaceCleanupBrowseController
  facetRows: WorkspaceCleanupFacetRows
  selectedCount: number
  spaceScanning: boolean
  gitPendingCount: number
  gitCheckedTotal: number
  onRunSpaceScan: () => void
  onToggleSelectAll: (selectAll: boolean) => void
}): React.JSX.Element {
  const activeFilters = hasActiveWorkspaceCleanupFilters(browse.filters)
  return (
    <>
      <WorkspaceCleanupPresetChips
        presets={browse.presets}
        matchedPresetId={browse.matchedPresetId}
        requestedPresetId={browse.browse.activePresetId}
        hasActiveFilters={activeFilters}
        onApplyPreset={browse.applyPreset}
        onClearFilters={browse.clearFilters}
      />
      <WorkspaceCleanupFilterBar
        facetProps={{
          filters: browse.filters,
          counts: facetRows.facetCounts,
          totalCount: facetRows.totalCount,
          options: facetRows.options,
          onPatch: browse.patchFilters
        }}
        activeFacetGroupCount={listActiveWorkspaceCleanupFacetGroups(browse.filters).length}
        matchedCount={facetRows.matchedCount}
        hasActiveFilters={activeFilters}
        sizeScan={{
          measuredCount: facetRows.measuredSizeCount,
          scanning: spaceScanning,
          onRun: onRunSpaceScan
        }}
        gitEvidence={{ pendingCount: gitPendingCount, totalCount: gitCheckedTotal }}
        onQueryChange={(query) => browse.patchFilters('query', query)}
        onClearFilters={browse.clearFilters}
      />
      <WorkspaceCleanupSortHeader
        sort={browse.sort}
        selectableCount={facetRows.selectableWorktreeIds.length}
        selectedCount={selectedCount}
        onToggleSortField={browse.toggleSortField}
        onSetSort={browse.setSort}
        onToggleSelectAll={onToggleSelectAll}
      />
      {browse.sort.field === 'size' && facetRows.measuredSizeCount === 0 ? (
        <WorkspaceCleanupEmptyState
          title={translate(
            'components.workspace.cleanup.browse.noSizes',
            'No workspace sizes measured yet.'
          )}
          description={translate(
            'components.workspace.cleanup.browse.noSizesDescription',
            'Sizes come from the disk-space scan. Run it to sort and filter by size.'
          )}
          actionLabel={translate(
            'components.workspace.cleanup.browse.measureSizes',
            'Measure sizes'
          )}
          onAction={onRunSpaceScan}
        />
      ) : null}
    </>
  )
}
