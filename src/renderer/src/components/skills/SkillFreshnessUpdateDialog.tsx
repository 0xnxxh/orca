import { useMemo, useState, useSyncExternalStore } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, Copy, Loader2, RefreshCw } from 'lucide-react'
import { buildTargetedSkillUpdateCommand } from '../../../../shared/skill-freshness'
import { useSkillFreshness } from '@/hooks/useSkillFreshness'
import { notifyInstalledAgentSkillsChanged } from '@/hooks/useInstalledAgentSkills'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { TooltipProvider } from '@/components/ui/tooltip'
import { groupSkillFreshness } from './skill-freshness-grouping'
import { SkillFreshnessGroup } from './skill-freshness-group'
import { SkillUpdateResultRows } from './skill-update-result-rows'
import { SummaryHeadline, summarizeInventory } from './skill-freshness-summary-headline'
import {
  acknowledgeSkillUpdateRun,
  startSkillUpdateRun,
  useSkillUpdateRun
} from './skill-update-run-store'
import {
  consumeSkillFreshnessUpdateDialogRequest,
  getSkillFreshnessUpdateDialogRequest,
  subscribeSkillFreshnessUpdateDialog
} from './skill-freshness-update-dialog'

function RunLog({ output }: { output: string }): React.JSX.Element | null {
  if (!output.trim()) {
    return null
  }
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="group -ml-2 gap-1.5 text-muted-foreground"
        >
          <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
          {translate('auto.components.skills.SkillFreshnessUpdateDialog.showLog', 'Show log')}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1">
        {/* Displayed verbatim, never parsed — `skills update` has no --json. */}
        <pre className="scrollbar-sleek max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted px-3 py-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {output.trim()}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function SkillFreshnessUpdateDialog(): React.JSX.Element {
  const state = useSkillFreshness()
  const run = useSkillUpdateRun()
  const open = useSyncExternalStore(
    subscribeSkillFreshnessUpdateDialog,
    getSkillFreshnessUpdateDialogRequest,
    getSkillFreshnessUpdateDialogRequest
  )
  const [copied, setCopied] = useState(false)
  const inventory = state.inventory
  const eligibleNames = useMemo(() => inventory?.eligibleUpdateNames ?? [], [inventory])
  const groups = useMemo(
    () =>
      inventory ? groupSkillFreshness(inventory.installations, inventory.eligibleUpdateNames) : [],
    [inventory]
  )
  const hasBlockedGroup = groups.some((group) => group.status === 'cannot-update')
  const blockedCount = groups.filter((group) => group.status === 'cannot-update').length
  const summaryKind = summarizeInventory(inventory, hasBlockedGroup)
  const isRunning = run.state === 'running'
  const showResult = run.state === 'success' || run.state === 'error'

  const handleOpenChange = (next: boolean): void => {
    if (next) {
      return
    }
    // Why: closing never cancels. The run is owned by main and keeps going; the
    // status-bar segment carries it from here.
    consumeSkillFreshnessUpdateDialogRequest()
    setCopied(false)
    if (showResult) {
      void acknowledgeSkillUpdateRun()
    }
    notifyInstalledAgentSkillsChanged()
  }

  const handleUpdate = (): void => {
    void startSkillUpdateRun(eligibleNames)
  }

  const handleCopyCommand = (): void => {
    const command = buildTargetedSkillUpdateCommand(
      run.state === 'error' ? run.failedNames : eligibleNames
    )
    if (!command) {
      return
    }
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const headline = ((): React.JSX.Element => {
    if (isRunning) {
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
            {run.names.length === 1
              ? translate(
                  'auto.components.skills.SkillFreshnessUpdateDialog.runningOne',
                  'Updating 1 skill…'
                )
              : translate(
                  'auto.components.skills.SkillFreshnessUpdateDialog.runningMany',
                  'Updating {{value0}} skills…',
                  { value0: run.names.length }
                )}
          </div>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.skills.SkillFreshnessUpdateDialog.runningDescription',
              'You can close this window — it keeps running in the background.'
            )}
          </p>
        </div>
      )
    }
    if (run.state === 'success') {
      return (
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
          {run.names.length === 1
            ? translate(
                'auto.components.skills.SkillFreshnessUpdateDialog.updatedOne',
                'Updated 1 skill'
              )
            : translate(
                'auto.components.skills.SkillFreshnessUpdateDialog.updatedMany',
                'Updated {{value0}} skills',
                { value0: run.names.length }
              )}
        </div>
      )
    }
    if (run.state === 'error') {
      const updated = run.names.length - run.failedNames.length
      return (
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <AlertTriangle className="size-4 text-destructive" />
          {translate(
            'auto.components.skills.SkillFreshnessUpdateDialog.updatedPartial',
            'Updated {{value0}} of {{value1}} skills',
            { value0: updated, value1: run.names.length }
          )}
        </div>
      )
    }
    return (
      <SummaryHeadline
        kind={summaryKind}
        eligibleCount={eligibleNames.length}
        blockedCount={blockedCount}
      />
    )
  })()

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="scrollbar-sleek max-h-[85vh] overflow-y-auto sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.skills.SkillFreshnessUpdateDialog.title', 'Update skills')}
          </DialogTitle>
        </DialogHeader>

        {state.error && !isRunning && !showResult ? (
          <p className="text-xs text-destructive">{state.error}</p>
        ) : (
          headline
        )}

        {isRunning ? (
          <>
            {/* Indeterminate on purpose: the CLI reports no parseable progress. */}
            <div
              role="progressbar"
              aria-label={translate(
                'auto.components.skills.SkillFreshnessUpdateDialog.progressAria',
                'Updating skills'
              )}
              className="h-1 overflow-hidden rounded-full bg-secondary"
            >
              <div className="h-full w-2/5 animate-[skill-update-slide_1.35s_ease-in-out_infinite] rounded-full bg-primary motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-40" />
            </div>
            <SkillUpdateResultRows names={run.names} pending />
          </>
        ) : null}

        {showResult ? (
          <SkillUpdateResultRows
            names={run.names}
            failedNames={run.state === 'error' ? run.failedNames : []}
          />
        ) : null}

        {run.state === 'error' ? (
          <div className="space-y-2.5 rounded-md border border-destructive/35 bg-destructive/10 p-3">
            <p className="text-[13px] font-medium text-foreground">
              {translate(
                'auto.components.skills.SkillFreshnessUpdateDialog.errorTitle',
                "The update didn't finish"
              )}
            </p>
            <p className="break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
              {run.message}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Button type="button" variant="outline" size="xs" onClick={handleUpdate}>
                {translate('auto.components.skills.SkillFreshnessUpdateDialog.retry', 'Retry')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="gap-1.5"
                onClick={handleCopyCommand}
              >
                <Copy className="size-3.5" />
                {copied
                  ? translate('auto.components.skills.SkillFreshnessUpdateDialog.copied', 'Copied')
                  : translate(
                      'auto.components.skills.SkillFreshnessUpdateDialog.copyCommand',
                      'Copy command'
                    )}
              </Button>
            </div>
          </div>
        ) : null}

        {isRunning || showResult ? <RunLog output={run.output} /> : null}

        {!isRunning && !showResult && groups.length > 0 ? (
          <div className="min-w-0 divide-y divide-border/40">
            <TooltipProvider>
              {groups.map((group) => (
                <SkillFreshnessGroup key={group.name} group={group} />
              ))}
            </TooltipProvider>
          </div>
        ) : null}

        <DialogFooter className="sm:justify-between">
          {isRunning || showResult ? (
            <span />
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={state.loading}
              onClick={() => void state.refresh()}
            >
              <RefreshCw className={state.loading ? 'animate-spin' : undefined} />
              {translate('auto.components.skills.SkillFreshnessUpdateDialog.checkNow', 'Re-check')}
            </Button>
          )}
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => handleOpenChange(false)}>
              {run.state === 'success'
                ? translate('auto.components.skills.SkillFreshnessUpdateDialog.done', 'Done')
                : translate('auto.components.skills.SkillFreshnessUpdateDialog.close', 'Close')}
            </Button>
            {!showResult && eligibleNames.length > 0 ? (
              <Button type="button" size="sm" disabled={isRunning} onClick={handleUpdate}>
                {isRunning
                  ? translate(
                      'auto.components.skills.SkillFreshnessUpdateDialog.updating',
                      'Updating…'
                    )
                  : eligibleNames.length === 1
                    ? translate(
                        'auto.components.skills.SkillFreshnessUpdateDialog.updateActionOne',
                        'Update 1 skill'
                      )
                    : translate(
                        'auto.components.skills.SkillFreshnessUpdateDialog.updateActionMany',
                        'Update {{value0}} skills',
                        { value0: eligibleNames.length }
                      )}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
