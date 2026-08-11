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
import { WorkspaceCleanupSortHeader } from './workspace-cleanup-sort-header'
import type { WorkspaceSpaceScanProgress } from '../../../../shared/workspace-space-types'

export function WorkspaceCleanupBrowseToolbar({
  browse,
  facetRows,
  selectableCount,
  selectedCount,
  spaceScanning,
  spaceProgress,
  gitPendingCount,
  gitCheckedTotal,
  onRunSpaceScan,
  onToggleSelectAll
}: {
  browse: WorkspaceCleanupBrowseController
  facetRows: WorkspaceCleanupFacetRows
  selectableCount: number
  selectedCount: number
  spaceScanning: boolean
  spaceProgress: WorkspaceSpaceScanProgress | null
  gitPendingCount: number
  gitCheckedTotal: number
  onRunSpaceScan: () => void
  onToggleSelectAll: (selectAll: boolean) => void
}): React.JSX.Element {
  const activeFilters = hasActiveWorkspaceCleanupFilters(browse.filters)
  return (
    <>
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
          scannedCount: spaceProgress?.scannedWorktreeCount ?? 0,
          totalCount: spaceProgress?.totalWorktreeCount ?? 0,
          onRun: onRunSpaceScan
        }}
        gitEvidence={{ pendingCount: gitPendingCount, totalCount: gitCheckedTotal }}
        onQueryChange={(query) => browse.patchFilters('query', query)}
        onClearFilters={browse.clearFilters}
      />
      <WorkspaceCleanupSortHeader
        sort={browse.sort}
        selectableCount={selectableCount}
        selectedCount={selectedCount}
        onToggleSortField={browse.toggleSortField}
        onToggleSelectAll={onToggleSelectAll}
      />
      {browse.sort.field === 'size' && facetRows.measuredSizeCount === 0 && !spaceScanning ? (
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
