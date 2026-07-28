import React, { useCallback, useMemo, useRef, useState } from 'react'
import { Popover, PopoverContent } from '@/components/ui/popover'
import { translate } from '@/i18n/i18n'
import type {
  NeedsSetupProjectHostOption,
  ProjectHostSetupOption
} from '@/lib/project-host-setup-options'
import { useWheelScrollable } from './use-wheel-scrollable'
import {
  ConnectHostButton,
  HostRowIcon,
  NeedsSetupHostIcon,
  RunTargetRow
} from './RunTargetComboboxRow'
import {
  buildRunTargetRows,
  getEphemeralVmLabel,
  getRecipeDetail,
  RUN_TARGET_ADD_HOST_KEY,
  type EphemeralVmRecipeOption
} from './run-target-options'
import { AddHostSubmenuRow, RecipesSubmenuRow } from './RunTargetSubmenus'
import RunTargetField from './RunTargetField'

type RunTargetComboboxProps = {
  hostOptions: readonly ProjectHostSetupOption[]
  hostValue: string | null
  onHostChange?: (setupId: string) => void
  recipes: EphemeralVmRecipeOption[]
  recipeValue: string | null
  onRecipeChange?: (recipeId: string | null) => void
  onAddRemoteServer?: () => void
  onAddSshHost?: () => void
  onConnectHost?: (option: NeedsSetupProjectHostOption) => Promise<void> | void
}

/** True when an event target is the field/anchor this popover belongs to. */
function isWithinCombobox(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest('[data-run-target-combobox-root="true"]') !== null
  )
}

/**
 * Run-target picker, built to match the project picker: the field *is* the
 * search, exactly one row is armed and Enter takes it, hovering arms, and the
 * "Add host" row is pinned to the popover edge so it survives every state.
 *
 * Two things the project picker doesn't have: disconnected hosts carry an
 * inline Connect action that must not select the row, and two rows open nested
 * lists (VM recipes, Add host) rather than committing.
 */
export default function RunTargetCombobox({
  hostOptions,
  hostValue,
  onHostChange,
  recipes,
  recipeValue,
  onRecipeChange,
  onAddRemoteServer,
  onAddSshHost,
  onConnectHost
}: RunTargetComboboxProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [submenu, setSubmenu] = useState<'recipes' | 'add-host' | null>(null)
  // Armed by key (not index) so a host list arriving late over SSH can't slide
  // a different target under a keypress the user already aimed. The query it
  // was aimed at rides along, so a newer query drops it during render.
  const [armed, setArmed] = useState<{ key: string; query: string } | null>(null)
  // Track in-flight connects per host so one stalling connect never blocks the others.
  const [connectingHostIds, setConnectingHostIds] = useState<ReadonlySet<string>>(() => new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const { ref: listRef, setNode: setListNode } = useWheelScrollable<HTMLDivElement>()
  const listId = React.useId()

  const hasAddHost = Boolean(onAddSshHost || onAddRemoteServer)
  const { rows, matchedRecipes } = useMemo(
    () => buildRunTargetRows({ hostOptions, recipes, query, hasAddHost }),
    [hasAddHost, hostOptions, query, recipes]
  )
  const readyHostOptions = useMemo(
    () => hostOptions.filter((option) => option.kind === 'ready'),
    [hostOptions]
  )
  const selectedHost =
    readyHostOptions.find((option) => option.id === hostValue) ?? readyHostOptions[0] ?? null
  const selectedRecipe = recipes.find((recipe) => recipe.id === recipeValue) ?? null

  const armProject = useCallback((key: string) => setArmed({ key, query }), [query])
  const armedKey = armed !== null && armed.query === query ? armed.key : null
  const armedIndex = Math.max(armedKey === null ? -1 : rows.findIndex((r) => r.key === armedKey), 0)
  const armedRow = rows[armedIndex] ?? null
  // Only a committed selection paints the field; typing replaces it.
  const committed = query.length === 0 && (selectedRecipe !== null || selectedHost !== null)

  React.useEffect(() => {
    if (open) {
      listRef.current?.querySelector('[data-armed="true"]')?.scrollIntoView({ block: 'nearest' })
    }
  }, [listRef, open, armedIndex, rows.length])

  const close = useCallback((): void => {
    setOpen(false)
    setQuery('')
    setSubmenu(null)
  }, [])

  const selectHost = useCallback(
    (setupId: string): void => {
      onHostChange?.(setupId)
      onRecipeChange?.(null)
      close()
    },
    [close, onHostChange, onRecipeChange]
  )

  const selectRecipe = useCallback(
    (recipeId: string): void => {
      onRecipeChange?.(recipeId)
      close()
    },
    [close, onRecipeChange]
  )

  const connectHost = useCallback(
    async (option: NeedsSetupProjectHostOption): Promise<void> => {
      if (!option.connectAction || !onConnectHost || connectingHostIds.has(option.hostId)) {
        return
      }
      setConnectingHostIds((current) => new Set(current).add(option.hostId))
      try {
        await onConnectHost(option)
      } finally {
        // Always clear when the connect settles (success, failure, or timeout)
        // so the row's spinner stops.
        setConnectingHostIds((current) => {
          if (!current.has(option.hostId)) {
            return current
          }
          const next = new Set(current)
          next.delete(option.hostId)
          return next
        })
      }
    },
    [connectingHostIds, onConnectHost]
  )

  /** Commits a row, or opens its submenu when the row is a submenu row. */
  const activate = useCallback(
    (key: string | null): void => {
      const row = rows.find((candidate) => candidate.key === key)
      if (!row) {
        return
      }
      if (row.kind === 'ready') {
        selectHost(row.option.id)
        return
      }
      if (row.kind === 'needs-setup') {
        // Not ready: selecting is a no-op, the Connect action is the way forward.
        return
      }
      setSubmenu(row.kind === 'recipes' ? 'recipes' : 'add-host')
    },
    [rows, selectHost]
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setOpen(true)
        const step = event.key === 'ArrowDown' ? 1 : -1
        const nextKey = rows[Math.min(Math.max(armedIndex + step, 0), rows.length - 1)]?.key
        if (nextKey !== undefined) {
          armProject(nextKey)
          setSubmenu(null)
        }
        return
      }
      if ((event.key === 'Enter' || event.key === 'ArrowRight') && open) {
        event.preventDefault()
        activate(armedRow?.key ?? null)
        return
      }
      if (event.key === 'Escape' && (open || query.length > 0)) {
        event.preventDefault()
        event.stopPropagation()
        // A submenu closes first, so Escape backs out one layer at a time.
        if (submenu !== null) {
          setSubmenu(null)
          return
        }
        close()
      }
    },
    [activate, armProject, armedIndex, armedRow, close, open, query, rows, submenu]
  )

  // A query only means something while the list is open; closing without
  // committing drops it so the field never shows text matching nothing.
  const handleOpenChange = useCallback(
    (next: boolean): void => {
      if (next) {
        setOpen(true)
        return
      }
      close()
    },
    [close]
  )

  const fieldLabel = selectedRecipe
    ? `${getEphemeralVmLabel()} / ${selectedRecipe.name}`
    : (selectedHost?.label ?? '')
  const fieldDetail = selectedRecipe ? getRecipeDetail(selectedRecipe) : (selectedHost?.path ?? '')

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <RunTargetField
        query={query}
        onQueryChange={(value) => {
          setQuery(value)
          setOpen(true)
          setSubmenu(null)
        }}
        open={open}
        onOpenRequest={() => setOpen(true)}
        onToggle={() => setOpen(!open)}
        committed={committed}
        isRecipe={selectedRecipe !== null}
        hostId={selectedHost?.hostId ?? null}
        label={fieldLabel}
        detail={fieldDetail}
        listId={listId}
        hasArmedRow={armedRow !== null}
        inputRef={inputRef}
        onKeyDown={handleKeyDown}
      />
      <PopoverContent
        align="start"
        sideOffset={4}
        // Opaque + no fade: this lands on the composer dialog, so a translucent
        // fade would show the field underneath mid-animation.
        className="flex w-[var(--radix-popover-trigger-width)] min-w-[18rem] flex-col bg-[var(--popover)] p-0 data-[state=closed]:fade-out-100 data-[state=open]:fade-in-100 dark:bg-[var(--popover)]"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        // The field lives in the anchor, not the content, so Radix would see a
        // focus/pointer event "outside" and dismiss the instant you tab in.
        onFocusOutside={(event) => {
          if (isWithinCombobox(event.target)) {
            event.preventDefault()
          }
        }}
        onInteractOutside={(event) => {
          if (isWithinCombobox(event.target)) {
            event.preventDefault()
          }
        }}
      >
        <div
          id={listId}
          role="listbox"
          aria-label={translate(
            'auto.components.new.workspace.RunTargetCombobox.listLabel',
            'Run targets'
          )}
          className="flex min-h-0 flex-col"
        >
          <div
            ref={setListNode}
            role="presentation"
            className="max-h-72 min-h-0 flex-1 overflow-y-auto p-1 scrollbar-sleek"
          >
            {rows.filter((row) => row.kind !== 'add-host').length === 0 ? (
              <p className="flex h-8 items-center justify-center px-2 text-sm text-muted-foreground">
                {translate(
                  'auto.components.NewWorkspaceComposerCard.noRunTargets',
                  'No run targets are ready for this project.'
                )}
              </p>
            ) : null}
            {rows.map((row) => {
              if (row.kind === 'add-host') {
                return null
              }
              const isArmed = armedRow?.key === row.key
              const optionId = isArmed ? `${listId}-armed` : undefined
              if (row.kind === 'ready') {
                return (
                  <RunTargetRow
                    key={row.key}
                    icon={<HostRowIcon hostId={row.option.hostId} />}
                    label={row.option.label}
                    detail={row.option.path}
                    armed={isArmed}
                    current={selectedRecipe === null && row.option.id === selectedHost?.id}
                    optionId={optionId}
                    onArm={() => {
                      armProject(row.key)
                      setSubmenu(null)
                    }}
                    onCommit={() => selectHost(row.option.id)}
                  />
                )
              }
              if (row.kind === 'needs-setup') {
                const connecting = connectingHostIds.has(row.option.hostId)
                return (
                  <RunTargetRow
                    key={row.key}
                    icon={
                      <NeedsSetupHostIcon
                        hostId={row.option.hostId}
                        connecting={connecting}
                        attention={row.option.attention}
                      />
                    }
                    label={row.option.label}
                    detail={row.option.detail}
                    armed={isArmed}
                    current={false}
                    dimmed
                    optionId={optionId}
                    onArm={() => {
                      armProject(row.key)
                      setSubmenu(null)
                    }}
                    onCommit={() => {}}
                    trailing={
                      row.option.connectAction && onConnectHost ? (
                        <ConnectHostButton
                          connecting={connecting}
                          onConnect={() => void connectHost(row.option)}
                        />
                      ) : undefined
                    }
                  />
                )
              }
              // Recipes submenu row.
              return (
                <RecipesSubmenuRow
                  key={row.key}
                  open={submenu === 'recipes'}
                  onOpenChange={(next) => setSubmenu(next ? 'recipes' : null)}
                  armed={isArmed}
                  optionId={optionId}
                  recipes={matchedRecipes}
                  selectedRecipeId={selectedRecipe?.id ?? null}
                  onArm={() => {
                    armProject(row.key)
                    setSubmenu('recipes')
                  }}
                  onSelectRecipe={selectRecipe}
                />
              )
            })}
          </div>
          {hasAddHost ? (
            <AddHostSubmenuRow
              open={submenu === 'add-host'}
              onOpenChange={(next) => setSubmenu(next ? 'add-host' : null)}
              armed={armedRow?.key === RUN_TARGET_ADD_HOST_KEY}
              optionId={armedRow?.key === RUN_TARGET_ADD_HOST_KEY ? `${listId}-armed` : undefined}
              onArm={() => {
                armProject(RUN_TARGET_ADD_HOST_KEY)
                setSubmenu('add-host')
              }}
              {...(onAddSshHost
                ? {
                    onAddSshHost: () => {
                      close()
                      onAddSshHost()
                    }
                  }
                : {})}
              {...(onAddRemoteServer
                ? {
                    onAddRemoteServer: () => {
                      close()
                      onAddRemoteServer()
                    }
                  }
                : {})}
            />
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
