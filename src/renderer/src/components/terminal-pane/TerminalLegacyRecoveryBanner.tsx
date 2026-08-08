import { useId, useMemo, useState } from 'react'
import { Check, ChevronRight, Copy, ShieldAlert } from 'lucide-react'
import type {
  TerminalLegacyPreservationFacts,
  TerminalLegacyRecoveryReason
} from '../../../../shared/terminal-legacy-cutover'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import {
  formatLegacyRecoveryDetailsForClipboard,
  selectUnresolvedLegacyRecoveries,
  type TerminalLegacyRecoveryNotice,
  type TerminalLegacyUnresolvedRecoveryNotice
} from './terminal-legacy-recovery-view-model'

type CopyState = 'copying' | 'copied' | 'failed'

function reasonLabel(reason: TerminalLegacyRecoveryReason): string {
  switch (reason) {
    case 'ambiguous-pane-generation':
      return translate(
        'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.reason.ambiguousPane',
        'Pane generation is ambiguous'
      )
    case 'endpoint-identity-unproved':
      return translate(
        'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.reason.endpointUnproved',
        'Endpoint identity could not be proved'
      )
    case 'physical-pty-incarnation-unproved':
      return translate(
        'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.reason.ptyUnproved',
        'Physical terminal identity could not be proved'
      )
    case 'unsupported-platform':
      return translate(
        'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.reason.unsupportedPlatform',
        'Platform proof is unavailable'
      )
    case 'worker-unreachable':
      return translate(
        'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.reason.workerUnreachable',
        'Previous terminal worker was unreachable'
      )
    case 'workspace-mismatch':
      return translate(
        'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.reason.workspaceMismatch',
        'Workspace evidence did not match'
      )
  }
}

function preservationDescription(kind: TerminalLegacyPreservationFacts['kind']): string {
  switch (kind) {
    case 'isolated-grace-disabled':
      return translate(
        'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.preservation.isolated',
        'Orca retained the previous endpoint identity, isolated it from current terminal authority, and confirmed shutdown grace is disabled.'
      )
    case 'evidence-gc-retained':
      return translate(
        'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.preservation.evidenceOnly',
        'Orca retained the recovery evidence, but could not prove whether the previous terminal process is still running.'
      )
    case 'worker-unreachable':
      return translate(
        'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.preservation.unreachable',
        'The previous worker was unreachable. Orca retained this recovery record, but could not prove whether the terminal process is still running.'
      )
    case 'unsupported-platform':
      return translate(
        'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.preservation.unsupported',
        'This platform could not provide the proof required for migration. Orca retained this recovery record, but could not prove whether the terminal process is still running.'
      )
  }
}

function workspaceLabel(kind: TerminalLegacyUnresolvedRecoveryNotice['workspaceKind']): string {
  switch (kind) {
    case 'git-worktree':
      return translate(
        'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.workspace.gitWorktree',
        'Git worktree'
      )
    case 'folder':
      return translate(
        'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.workspace.folder',
        'Folder workspace'
      )
    case 'floating':
      return translate(
        'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.workspace.floating',
        'Floating terminal'
      )
  }
}

function preservationSummary(
  recoveries: readonly TerminalLegacyUnresolvedRecoveryNotice[]
): string {
  if (recoveries.length === 1) {
    return preservationDescription(recoveries[0].preservationKind)
  }
  const isolatedCount = recoveries.filter(
    (recovery) => recovery.preservationKind === 'isolated-grace-disabled'
  ).length
  if (isolatedCount === recoveries.length) {
    return translate(
      'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.preservation.allIsolated',
      'Orca retained the previous endpoint identities, isolated them from current terminal authority, and confirmed shutdown grace is disabled.'
    )
  }
  if (isolatedCount === 0) {
    return translate(
      'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.preservation.allEvidenceOnly',
      'Orca retained recovery records, but could not prove whether the previous terminal processes are still running.'
    )
  }
  return translate(
    'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.preservation.mixed',
    'Some previous endpoints are isolated with shutdown grace disabled. For the others, Orca retained recovery records but could not prove whether the processes are still running.'
  )
}

function DetailField({ label, value }: { label: string; value: string | number | null }) {
  if (value === null) {
    return null
  }
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all font-mono text-foreground">{value}</dd>
    </>
  )
}

function formatObservedAt(value: number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return translate(
      'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.timestampUnavailable',
      'Unavailable'
    )
  }
  return date.toISOString()
}

function LegacyRecoveryRow({
  recovery,
  index,
  copyState,
  onCopy
}: {
  recovery: TerminalLegacyUnresolvedRecoveryNotice
  index: number
  copyState?: CopyState
  onCopy: () => void
}): React.JSX.Element {
  const headingId = useId()
  const terminalLabel = translate(
    'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.terminalLabel',
    'Terminal {{value0}}',
    { value0: index + 1 }
  )
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-md border border-border bg-muted/30 px-3 py-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={headingId} className="text-xs font-semibold">
            {terminalLabel}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{reasonLabel(recovery.reason)}</p>
        </div>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={copyState === 'copying'}
          onClick={onCopy}
        >
          {copyState === 'copied' ? <Check /> : <Copy />}
          {translate(
            'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.copyDetails',
            'Copy details'
          )}
        </Button>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {preservationDescription(recovery.preservationKind)}
      </p>
      <dl className="mt-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <DetailField
          label={translate(
            'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.field.workspace',
            'Workspace'
          )}
          value={workspaceLabel(recovery.workspaceKind)}
        />
        <DetailField
          label={translate(
            'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.field.evidenceDigest',
            'Evidence digest'
          )}
          value={recovery.evidenceDigest}
        />
        <DetailField
          label={translate(
            'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.field.observed',
            'Observed'
          )}
          value={formatObservedAt(recovery.observedAtMs)}
        />
      </dl>
      {copyState === 'copied' ? (
        <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground" role="status">
          <Check className="size-3.5" />
          {translate(
            'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.copySucceeded',
            'Recovery details copied.'
          )}
        </p>
      ) : copyState === 'failed' ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {translate(
            'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.copyFailed',
            'Recovery details could not be copied. Try again.'
          )}
        </p>
      ) : null}
    </section>
  )
}

function defaultClipboardWriter(text: string): Promise<void> {
  return window.api.ui.writeClipboardText(text)
}

export function TerminalLegacyRecoveryBanner({
  recoveries,
  writeClipboardText = defaultClipboardWriter,
  rootClassName
}: {
  recoveries: readonly TerminalLegacyRecoveryNotice[]
  writeClipboardText?: (text: string) => Promise<void>
  rootClassName?: string
}): React.JSX.Element | null {
  const unresolved = useMemo(() => selectUnresolvedLegacyRecoveries(recoveries), [recoveries])
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [copyStates, setCopyStates] = useState<Readonly<Record<string, CopyState>>>({})

  if (unresolved.length === 0) {
    return null
  }

  const handleCopy = async (recovery: TerminalLegacyUnresolvedRecoveryNotice): Promise<void> => {
    if (copyStates[recovery.recoveryKey] === 'copying') {
      return
    }
    setCopyStates((current) => ({ ...current, [recovery.recoveryKey]: 'copying' }))
    try {
      await writeClipboardText(formatLegacyRecoveryDetailsForClipboard(recovery))
      setCopyStates((current) => ({ ...current, [recovery.recoveryKey]: 'copied' }))
    } catch {
      setCopyStates((current) => ({ ...current, [recovery.recoveryKey]: 'failed' }))
    }
  }

  const singular = unresolved.length === 1
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-3 bottom-3 z-40 flex justify-center',
        rootClassName
      )}
      data-terminal-legacy-recovery-banner={unresolved.length}
    >
      <Collapsible
        className="pointer-events-auto w-full max-w-2xl rounded-md border border-border bg-card text-card-foreground shadow-xs"
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-3 px-3 py-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
            <ShieldAlert className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">
              {singular
                ? translate(
                    'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.singularTitle',
                    'Previous terminal needs review'
                  )
                : translate(
                    'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.pluralTitle',
                    '{{value0}} previous terminals need review',
                    { value0: unresolved.length }
                  )}
            </h2>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {singular
                ? translate(
                    'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.singularBody',
                    'Orca could not safely match this terminal after an upgrade. Orca did not attach to, stop, or replace it.'
                  )
                : translate(
                    'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.pluralBody',
                    'Orca could not safely match these terminals after an upgrade. Orca did not attach to, stop, or replace them.'
                  )}{' '}
              {preservationSummary(unresolved)}
            </p>
          </div>
          <CollapsibleTrigger asChild>
            <Button type="button" size="xs" variant="ghost" className="shrink-0">
              <ChevronRight
                className={cn(
                  'transition-transform motion-reduce:transition-none',
                  detailsOpen && 'rotate-90'
                )}
              />
              {detailsOpen
                ? translate(
                    'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.hideDetails',
                    'Hide details'
                  )
                : translate(
                    'auto.components.terminal.pane.TerminalLegacyRecoveryBanner.showDetails',
                    'Show details'
                  )}
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="border-t border-border px-3 pb-3 pt-3">
          <div className="scrollbar-sleek max-h-72 space-y-2 overflow-y-auto pr-1">
            {unresolved.map((recovery, index) => (
              <LegacyRecoveryRow
                key={recovery.recoveryKey}
                recovery={recovery}
                index={index}
                copyState={copyStates[recovery.recoveryKey]}
                onCopy={() => void handleCopy(recovery)}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
