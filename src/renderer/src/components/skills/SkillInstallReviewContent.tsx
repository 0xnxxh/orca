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
        <Label htmlFor="skill-share-link">Orca skill link</Label>
        <Input
          id="skill-share-link"
          value={link}
          onChange={(event) => onLinkChange(event.target.value)}
          placeholder="https://app.orca.dev/skills/share/…"
          className="font-mono text-xs"
          autoFocus
        />
        <p className="text-xs text-muted-foreground">
          Opening the link does not install anything. Review the immutable version first.
        </p>
      </div>
      <Button type="submit" disabled={busy || !link.trim()} className="w-32">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
        {busy ? 'Checking…' : 'Inspect skill'}
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
            {result.placements.length} placement{result.placements.length === 1 ? '' : 's'} checked.
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
          {result.failure.retryable ? ' · You can retry safely.' : ''}
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
          <Badge variant="outline">Immutable version</Badge>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <Badge variant="outline">{version.manifest.files.length} files</Badge>
          <Badge variant="outline">{versionSummary.scriptCount} scripts</Badge>
          <Badge variant="outline">{versionSummary.executableCount} executable</Badge>
        </div>
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          SHA-256 {version.packageDigest}
        </p>
        {version.publisher ? (
          <p className="text-xs text-muted-foreground">
            Published by Orca user {version.publisher.userId}
            {version.publisher.organizationId
              ? ` in organization ${version.publisher.organizationId}`
              : ''}
            .
          </p>
        ) : null}
        <p className="text-xs leading-5 text-muted-foreground">
          A skill contains instructions and may include scripts. Treat it as code from its author.
        </p>
      </section>

      {children}

      {hasConflict ? (
        <section className="space-y-2 rounded-md border border-border p-3" role="alert">
          <div className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="size-4" /> Local copy needs a decision
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            Orca found {result?.conflict?.kind || destinationPreview?.currentState || 'changed'}{' '}
            content and left it untouched. Keep it, or explicitly discard and replace it with this
            version.
          </p>
          <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={onDiscard}>
            Discard and replace
          </Button>
        </section>
      ) : null}
    </div>
  )
}
