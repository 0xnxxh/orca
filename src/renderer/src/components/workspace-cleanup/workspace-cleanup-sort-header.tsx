import React from 'react'
import { ArrowDown, ArrowUp, Check, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { WORKSPACE_CLEANUP_SORT_FIELD_VALUES } from '../../../../shared/workspace-cleanup-facet-rankings'
import type {
  WorkspaceCleanupSortField,
  WorkspaceCleanupSortState
} from '../../../../shared/workspace-cleanup-filter-model'
import { getWorkspaceCleanupSortFieldLabel } from './workspace-cleanup-facet-labels'

/** Columns the flat list actually renders; the rest stay in the overflow menu. */
const PRIMARY_SORT_FIELDS: readonly WorkspaceCleanupSortField[] = [
  'name',
  'repo',
  'git',
  'review',
  'size',
  'last-activity'
]

export function WorkspaceCleanupSortHeader({
  sort,
  selectableCount,
  selectedCount,
  onToggleSortField,
  onSetSort,
  onToggleSelectAll
}: {
  sort: WorkspaceCleanupSortState
  selectableCount: number
  selectedCount: number
  onToggleSortField: (field: WorkspaceCleanupSortField) => void
  onSetSort: (next: WorkspaceCleanupSortState) => void
  onToggleSelectAll: (selectAll: boolean) => void
}): React.JSX.Element {
  const allSelected = selectableCount > 0 && selectedCount >= selectableCount
  return (
    <div className="flex items-center gap-1 border-b border-border bg-muted/25 px-3 py-1.5">
      <button
        type="button"
        role="checkbox"
        aria-checked={allSelected}
        disabled={selectableCount === 0}
        aria-label={translate(
          'components.workspace.cleanup.browse.selectAll',
          'Select all matching workspaces'
        )}
        onClick={() => onToggleSelectAll(!allSelected)}
        className="flex size-4 shrink-0 items-center justify-center rounded border border-border bg-background text-primary hover:bg-accent disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {allSelected ? <Check className="size-3" strokeWidth={3} /> : null}
      </button>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
        {PRIMARY_SORT_FIELDS.map((field) => (
          <SortHeaderButton
            key={field}
            field={field}
            sort={sort}
            onToggleSortField={onToggleSortField}
          />
        ))}
      </div>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            className="shrink-0 text-[11px] text-muted-foreground"
            aria-label={translate('components.workspace.cleanup.browse.moreSorts', 'More sorts')}
          >
            <ChevronsUpDown className="size-3" />
            {translate('components.workspace.cleanup.browse.moreSorts', 'More sorts')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            {translate('components.workspace.cleanup.browse.sortBy', 'Sort by')}
          </DropdownMenuLabel>
          {WORKSPACE_CLEANUP_SORT_FIELD_VALUES.map((field) => (
            <DropdownMenuItem
              key={field}
              onSelect={() =>
                onSetSort({
                  field,
                  direction:
                    sort.field === field && sort.direction === 'asc' ? 'desc' : sort.direction
                })
              }
            >
              <span className="flex-1">{getWorkspaceCleanupSortFieldLabel(field)}</span>
              {sort.field === field ? <SortDirectionIcon direction={sort.direction} /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function SortHeaderButton({
  field,
  sort,
  onToggleSortField
}: {
  field: WorkspaceCleanupSortField
  sort: WorkspaceCleanupSortState
  onToggleSortField: (field: WorkspaceCleanupSortField) => void
}): React.JSX.Element {
  const active = sort.field === field
  const label = getWorkspaceCleanupSortFieldLabel(field)
  return (
    <button
      type="button"
      data-sort-field={field}
      aria-pressed={active}
      aria-label={translate(
        'components.workspace.cleanup.browse.sortByField',
        'Sort by {{value0}}',
        {
          value0: label
        }
      )}
      onClick={() => onToggleSortField(field)}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        active && 'bg-accent text-accent-foreground'
      )}
    >
      {label}
      {active ? <SortDirectionIcon direction={sort.direction} /> : null}
    </button>
  )
}

function SortDirectionIcon({ direction }: { direction: 'asc' | 'desc' }): React.JSX.Element {
  return direction === 'asc' ? (
    <ArrowUp className="size-3" aria-hidden="true" />
  ) : (
    <ArrowDown className="size-3" aria-hidden="true" />
  )
}
