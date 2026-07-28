import React from 'react'
import { Check, Columns2, Moon, Square, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import ComposerFrame from './ComposerFrame'
import CompareGrid from './CompareGrid'
import DialogFrame from './DialogFrame'
import RunTargetFrame from './RunTargetFrame'
import ComposerPairFrame from './ComposerPairFrame'
import { ALL_VARIANTS } from './registry'
import {
  LAB_LONG_NAME_PROJECT_OPTIONS,
  LAB_PROJECT_OPTIONS,
  LAB_SINGLE_PROJECT_OPTIONS
} from './fixtures'

const PICK_STORAGE_KEY = 'wt-picker-lab.pick'

type DataCase = 'full' | 'long' | 'single' | 'empty'

const DATA_CASES: { id: DataCase; label: string }[] = [
  { id: 'full', label: '13 projects' },
  { id: 'long', label: 'Long names' },
  { id: 'single', label: '1 project' },
  { id: 'empty', label: 'No projects' }
]

function optionsForCase(dataCase: DataCase) {
  if (dataCase === 'long') {
    return LAB_LONG_NAME_PROJECT_OPTIONS
  }
  if (dataCase === 'single') {
    return LAB_SINGLE_PROJECT_OPTIONS
  }
  if (dataCase === 'empty') {
    return []
  }
  return LAB_PROJECT_OPTIONS
}

export default function LabApp(): React.JSX.Element {
  const [dark, setDark] = React.useState(true)
  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  const [mode, setMode] = React.useState<'single' | 'compare'>('single')
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [runTargetOpen, setRunTargetOpen] = React.useState(false)
  const [pairOpen, setPairOpen] = React.useState(false)
  const [dataCase, setDataCase] = React.useState<DataCase>('full')
  const [activeId, setActiveId] = React.useState(ALL_VARIANTS[0]?.id ?? 'baseline')
  const [pickedId, setPickedId] = React.useState<string | null>(() =>
    typeof localStorage === 'undefined' ? null : localStorage.getItem(PICK_STORAGE_KEY)
  )
  // Per-variant selection so switching designs doesn't leak state between them.
  const [selectionByVariant, setSelectionByVariant] = React.useState<Record<string, string | null>>(
    {}
  )

  const active = ALL_VARIANTS.find((v) => v.id === activeId) ?? ALL_VARIANTS[0]

  const pick = React.useCallback((id: string) => {
    setPickedId(id)
    localStorage.setItem(PICK_STORAGE_KEY, id)
    void fetch('/__lab/pick', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id })
    }).catch(() => {})
  }, [])

  const openVariant = React.useCallback((id: string) => {
    setActiveId(id)
    setMode('single')
  }, [])

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-screen min-h-0 bg-background text-foreground">
        <aside className="flex w-[280px] shrink-0 flex-col border-r border-border bg-sidebar">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">Project picker</div>
              <div className="truncate text-[11px] text-muted-foreground">
                {ALL_VARIANTS.length} designs
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setDark(!dark)}
              aria-label="Toggle theme"
            >
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </div>

          <div className="flex gap-1 border-b border-border p-2">
            <Button
              type="button"
              variant={mode === 'single' ? 'secondary' : 'ghost'}
              size="xs"
              className="flex-1"
              onClick={() => setMode('single')}
            >
              <Square className="size-3" /> One
            </Button>
            <Button
              type="button"
              variant={mode === 'compare' ? 'secondary' : 'ghost'}
              size="xs"
              className="flex-1"
              onClick={() => setMode('compare')}
            >
              <Columns2 className="size-3" /> Compare all
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek p-2">
            {ALL_VARIANTS.map((variant) => (
              <button
                key={variant.id}
                type="button"
                onClick={() => openVariant(variant.id)}
                className={cn(
                  'mb-1 flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition',
                  variant.id === activeId && mode === 'single'
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent/50'
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium">{variant.title}</span>
                    {pickedId === variant.id ? (
                      <Check className="size-3.5 shrink-0 text-status-success" />
                    ) : null}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                    {variant.tagline}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">
                {mode === 'compare' ? 'All designs, resting state' : active.title}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {mode === 'compare' ? 'Click Open to try one full-size' : active.tagline}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="flex gap-1">
                {DATA_CASES.map((c) => (
                  <Button
                    key={c.id}
                    type="button"
                    variant={dataCase === c.id ? 'secondary' : 'ghost'}
                    size="xs"
                    onClick={() => setDataCase(c.id)}
                  >
                    {c.label}
                  </Button>
                ))}
              </div>
              {mode === 'single' ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDialogOpen(true)}
                >
                  Open in real Dialog
                </Button>
              ) : null}
              {mode === 'single' ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRunTargetOpen(true)}
                >
                  Run on
                </Button>
              ) : null}
              {mode === 'single' ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setPairOpen(true)}>
                  Pair
                </Button>
              ) : null}
              {mode === 'single' ? (
                <Button
                  type="button"
                  variant={pickedId === active.id ? 'secondary' : 'default'}
                  size="sm"
                  onClick={() => pick(active.id)}
                >
                  {pickedId === active.id ? 'Picked' : 'Pick this one'}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek">
            {mode === 'compare' ? (
              <div className="p-6">
                <CompareGrid
                  variants={ALL_VARIANTS}
                  options={optionsForCase(dataCase)}
                  pickedId={pickedId}
                  onPick={pick}
                  onOpen={openVariant}
                />
              </div>
            ) : (
              <>
                <div className="flex justify-center px-6 py-10">
                  <ComposerFrame
                    key={`${active.id}:${dataCase}`}
                    variant={active}
                    options={optionsForCase(dataCase)}
                    selectedId={selectionByVariant[active.id] ?? null}
                    onSelectedIdChange={(id) =>
                      setSelectionByVariant((prev) => ({ ...prev, [active.id]: id }))
                    }
                  />
                </div>

                <div className="mx-auto max-w-2xl px-6 pb-12">
                  <div className="rounded-lg border border-border bg-card p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                      Design notes
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {active.notes.map((note) => (
                        <li key={note} className="flex gap-2 text-[13px] leading-5">
                          <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" />
                          <span>{note}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </>
            )}
          </div>
        </main>
        {pairOpen ? <ComposerPairFrame open={pairOpen} onOpenChange={setPairOpen} /> : null}
        {runTargetOpen ? (
          <RunTargetFrame open={runTargetOpen} onOpenChange={setRunTargetOpen} />
        ) : null}
        {dialogOpen ? (
          <DialogFrame
            variant={active}
            options={optionsForCase(dataCase)}
            open={dialogOpen}
            onOpenChange={setDialogOpen}
          />
        ) : null}
      </div>
    </TooltipProvider>
  )
}
