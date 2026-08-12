import type { ReactNode } from 'react'
import { AlertTriangle, Check, Loader2, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type {
  SkillInstallPreview,
  SkillInstallResult
} from '../../../../shared/skill-install-contract'
import { skillInstallResultLabel } from './skill-install-result-label'
import { summarizeSkillShareVersion, type ResolvedSkillShare } from './skill-share-version-summary'
import { translate } from '@/i18n/i18n'

export function SkillShareLinkInputForm({
  link,
  busy,
  onLinkChange,
  onSubmit
}: {
  link: string
  busy: boolean
  onLinkChange: (link: string) => void
  onSubmit: () => void
}): React.JSX.Element {
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="skill-share-link">
          {translate(
            'auto.components.skills.SkillInstallReviewContent.93eb0fe8c7',
            'Orca skill link'
          )}
        </Label>
        <Input
          id="skill-share-link"
          value={link}
          onChange={(event) => onLinkChange(event.target.value)}
          placeholder={translate(
            'auto.components.skills.SkillInstallReviewContent.66cff7a804',
            'https://app.orca.dev/skills/share/…'
          )}
          className="font-mono text-xs"
          autoFocus
        />
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.skills.SkillInstallReviewContent.27672470d9',
            'Opening the link does not install anything. Review the immutable version first.'
          )}
        </p>
      </div>
      <Button type="submit" disabled={busy || !link.trim()} className="w-32">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
        {busy
          ? translate('auto.components.skills.SkillInstallReviewContent.69236de8d6', 'Checking…')
          : translate(
              'auto.components.skills.SkillInstallReviewContent.157de228b4',
              'Inspect skill'
            )}
      </Button>
    </form>
  )
}

export function SkillInstallOutcome({ result }: { result: SkillInstallResult }): React.JSX.Element {
  return (
    <div className="space-y-3">
      <div
        className="flex items-center gap-3 rounded-md border border-border p-3"
        role="status"
        aria-live="polite"
      >
        <div className="flex size-8 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          {result.status === 'failed' || result.status === 'cancelled' ? (
            <AlertTriangle className="size-4" />
          ) : (
            <Check className="size-4" />
          )}
        </div>
        <div>
          <p className="text-sm font-medium">{skillInstallResultLabel(result)}</p>
          <p className="text-xs text-muted-foreground">
            {result.placements.length}{' '}
            {translate('auto.components.skills.SkillInstallReviewContent.3fc62a61eb', 'placement')}
            {result.placements.length === 1 ? '' : 's'}{' '}
            {translate('auto.components.skills.SkillInstallReviewContent.1b6ad2ca5c', 'checked.')}
          </p>
        </div>
      </div>
      {result.status === 'partial' ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          {result.placements
            .filter((item) => item.status === 'failed' || item.status === 'skipped')
            .map((item) => (
              <p key={`${item.provider}:${item.path}`}>
                {item.provider}: {item.errorCategory || item.status}
              </p>
            ))}
        </div>
      ) : null}
      {result.failure ? (
        <p className="text-xs text-muted-foreground">
          {result.failure.code}
          {result.failure.retryable
            ? translate(
                'auto.components.skills.SkillInstallReviewContent.66270286ac',
                '· You can retry safely.'
              )
            : ''}
        </p>
      ) : null}
    </div>
  )
}

export function SkillInstallReview({
  preview,
  destinationPreview,
  result,
  busy,
  onDiscard,
  children
}: {
  preview: ResolvedSkillShare
  destinationPreview: SkillInstallPreview | null
  result: SkillInstallResult | null
  busy: boolean
  onDiscard: () => void
  children: ReactNode
}): React.JSX.Element {
  const version = preview.version
  const versionSummary = summarizeSkillShareVersion(version)
  const hasConflict =
    result?.status === 'conflict' ||
    (destinationPreview &&
      ['modified', 'unowned', 'external-link', 'name-collision'].includes(
        destinationPreview.currentState
      ))
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{version.name}</h3>
            <p className="text-xs leading-5 text-muted-foreground">{version.description}</p>
          </div>
          <Badge variant="outline">
            {translate(
              'auto.components.skills.SkillInstallReviewContent.8f9833d509',
              'Immutable version'
            )}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <Badge variant="outline">
            {versionSummary.fileCount}{' '}
            {translate('auto.components.skills.SkillInstallReviewContent.fab8fce842', 'files')}
          </Badge>
          <Badge variant="outline">
            {versionSummary.scriptCount}{' '}
            {translate('auto.components.skills.SkillInstallReviewContent.87137bcb8d', 'scripts')}
          </Badge>
          <Badge variant="outline">
            {versionSummary.executableCount}{' '}
            {translate('auto.components.skills.SkillInstallReviewContent.3d8421ca2f', 'executable')}
          </Badge>
        </div>
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          {translate('auto.components.skills.SkillInstallReviewContent.f72ee4022a', 'SHA-256')}{' '}
          {version.packageDigest}
        </p>
        {version.publisher ? (
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.skills.SkillInstallReviewContent.9daf13c180',
              'Published by Orca user'
            )}{' '}
            {version.publisher.userId}
            {version.publisher.organizationId
              ? translate(
                  'auto.components.skills.SkillInstallReviewContent.8cedddfcd5',
                  ' in organization {{value0}}',
                  { value0: version.publisher.organizationId }
                )
              : ''}
            .
          </p>
        ) : null}
        <p className="text-xs leading-5 text-muted-foreground">
          {translate(
            'auto.components.skills.SkillInstallReviewContent.98ed90e523',
            'A skill contains instructions and may include scripts. Treat it as code from its author.'
          )}
        </p>
      </section>

      {children}

      {hasConflict ? (
        <section className="space-y-2 rounded-md border border-border p-3" role="alert">
          <div className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="size-4" />{' '}
            {translate(
              'auto.components.skills.SkillInstallReviewContent.651b7d8a57',
              'Local copy needs a decision'
            )}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {translate('auto.components.skills.SkillInstallReviewContent.2a31912f14', 'Orca found')}{' '}
            {result?.conflict?.kind ||
              destinationPreview?.currentState ||
              translate(
                'auto.components.skills.SkillInstallReviewContent.37d990b94c',
                'changed'
              )}{' '}
            {translate(
              'auto.components.skills.SkillInstallReviewContent.a5675fb371',
              'content and left it untouched. Keep it, or explicitly discard and replace it with this version.'
            )}
          </p>
          <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={onDiscard}>
            {translate(
              'auto.components.skills.SkillInstallReviewContent.89e2601162',
              'Discard and replace'
            )}
          </Button>
        </section>
      ) : null}
    </div>
  )
}
