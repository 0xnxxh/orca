import React from 'react'
import {
  PullPolicyRemoteActionNotice,
  isPullPolicyRemoteActionError
} from './source-control-pull-policy-error-notice'
import { SourceControlRecoveryNotice } from './source-control-recovery-notice'
import type { SourceControlPushRecovery } from './source-control-push-recovery'
import type { CreatePrIntentNotice } from './source-control-commit-area-types'
import type {
  SourceControlActionRecipe,
  SourceControlLaunchActionId
} from '../../../../shared/source-control-ai-actions'
import type { SourceControlAiWriteTarget } from '../../../../shared/source-control-ai-recipe-save'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'

export function CommitNotices({
  worktreeId,
  groupId,
  connectionId,
  repoId,
  launchPlatform,
  commitError,
  commitFailureSummary,
  commitFailureKindLabel,
  hasCommitFailureDetails,
  commitFailureRecoveryPrompt,
  pushRecovery,
  remoteActionError,
  createPrIntentNotice,
  generateError,
  sourceControlAiActionsVisible,
  isFixingCommitFailureWithAI,
  isFixingPushFailureWithAI,
  fixCommitFailureRecipe,
  fixPushFailureRecipe,
  onSaveLaunchActionDefault,
  onOpenSourceControlAiSettings,
  onFixCommitFailureWithAI,
  onFixPushFailureWithAI
}: {
  worktreeId: string | null
  groupId: string | null
  connectionId?: string | null
  repoId?: string | null
  launchPlatform?: NodeJS.Platform
  commitError: string | null
  commitFailureSummary: string | null
  commitFailureKindLabel: string | null
  hasCommitFailureDetails: boolean
  commitFailureRecoveryPrompt: string | null
  pushRecovery: SourceControlPushRecovery | null
  remoteActionError: string | null
  createPrIntentNotice?: CreatePrIntentNotice | null
  generateError: string | null
  sourceControlAiActionsVisible: boolean
  isFixingCommitFailureWithAI: boolean
  isFixingPushFailureWithAI: boolean
  fixCommitFailureRecipe?: SourceControlActionRecipe
  fixPushFailureRecipe?: SourceControlActionRecipe
  onSaveLaunchActionDefault?: (
    target: SourceControlAiWriteTarget,
    actionId: SourceControlLaunchActionId,
    recipe: SourceControlActionRecipe
  ) => void | Promise<void>
  onOpenSourceControlAiSettings?: () => void
  onFixCommitFailureWithAI: (promptOverride?: string) => Promise<boolean> | boolean
  onFixPushFailureWithAI: (promptOverride?: string) => Promise<boolean> | boolean
}): React.JSX.Element {
  return (
    <>
      {commitError && commitFailureSummary ? (
        <SourceControlRecoveryNotice
          id="commit-area-error"
          recoveryKind="commit"
          title={translate(
            'auto.components.right.sidebar.SourceControl.011f9713fc',
            'Commit blocked'
          )}
          detailsTitle={translate(
            'auto.components.right.sidebar.SourceControl.a9bf7c171a',
            'Commit Failed'
          )}
          summary={commitFailureSummary}
          detailText={commitError}
          hasDetails={hasCommitFailureDetails}
          kindLabel={commitFailureKindLabel}
          prompt={commitFailureRecoveryPrompt}
          worktreeId={worktreeId}
          groupId={groupId}
          connectionId={connectionId}
          repoId={repoId}
          launchPlatform={launchPlatform}
          sourceControlAiActionsVisible={sourceControlAiActionsVisible}
          isLaunching={isFixingCommitFailureWithAI}
          recipe={fixCommitFailureRecipe}
          onSaveLaunchActionDefault={onSaveLaunchActionDefault}
          onOpenSourceControlAiSettings={onOpenSourceControlAiSettings}
          onFixWithAI={onFixCommitFailureWithAI}
        />
      ) : null}
      {pushRecovery ? (
        <SourceControlRecoveryNotice
          id="commit-area-push-error"
          recoveryKind="push"
          title={translate(
            'auto.components.right.sidebar.SourceControl.pushRecovery.011f9713fc',
            'Push blocked'
          )}
          detailsTitle={translate(
            'auto.components.right.sidebar.SourceControl.pushRecovery.a9bf7c171a',
            'Push Failed'
          )}
          summary={pushRecovery.summary}
          detailText={pushRecovery.detailText}
          hasDetails={pushRecovery.hasDetails}
          kindLabel={pushRecovery.kindLabel}
          prompt={pushRecovery.prompt}
          worktreeId={worktreeId}
          groupId={groupId}
          connectionId={connectionId}
          repoId={repoId}
          launchPlatform={launchPlatform}
          sourceControlAiActionsVisible={sourceControlAiActionsVisible}
          isLaunching={isFixingPushFailureWithAI}
          recipe={fixPushFailureRecipe}
          onSaveLaunchActionDefault={onSaveLaunchActionDefault}
          onOpenSourceControlAiSettings={onOpenSourceControlAiSettings}
          onFixWithAI={onFixPushFailureWithAI}
        />
      ) : null}
      {remoteActionError && isPullPolicyRemoteActionError(remoteActionError) ? (
        <PullPolicyRemoteActionNotice id="commit-area-remote-error" />
      ) : remoteActionError ? (
        <p
          id="commit-area-remote-error"
          role="alert"
          aria-live="polite"
          className="mt-1 text-[11px] text-destructive"
        >
          {remoteActionError}
        </p>
      ) : null}
      {createPrIntentNotice && (
        <div
          id="commit-area-create-pr-intent"
          role={createPrIntentNotice.tone === 'destructive' ? 'alert' : 'status'}
          aria-live="polite"
          className={cn(
            'mt-1 flex min-w-0 items-center gap-1.5 text-[11px]',
            createPrIntentNotice.tone === 'destructive'
              ? 'text-destructive'
              : 'text-muted-foreground'
          )}
        >
          {/* Why: Create Review blockers carry recovery steps; truncating hides the action the user needs in a narrow sidebar. */}
          <span className="min-w-0 flex-1 break-words leading-4 [overflow-wrap:anywhere]">
            {createPrIntentNotice.message}
          </span>
          {createPrIntentNotice.action === 'settings' && onOpenSourceControlAiSettings ? (
            <button
              type="button"
              className="shrink-0 font-medium text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
              onClick={() => onOpenSourceControlAiSettings()}
            >
              {translate(
                'auto.components.right.sidebar.SourceControl.473f18758e',
                'Source Control AI settings'
              )}
            </button>
          ) : null}
        </div>
      )}
      {generateError && (
        <p
          id="commit-area-generate-error"
          role="alert"
          aria-live="polite"
          className="mt-1 text-[11px] text-destructive"
        >
          {generateError}
        </p>
      )}
    </>
  )
}
