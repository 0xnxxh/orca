import { useCallback, useEffect, useRef, useState } from 'react'
import { Clipboard, Link2Off, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { SkillCloudOwnedShare } from '../../../../shared/skill-cloud-contract'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

function inventoryError(status: string): string {
  return status === 'reconnect-required'
    ? translate(
        'auto.components.settings.shareSkills.linksReconnect',
        'Sign in again to manage shared links.'
      )
    : translate(
        'auto.components.settings.shareSkills.linksUnavailable',
        'Shared links are unavailable right now.'
      )
}

export function OwnedSkillShareLinks(): React.JSX.Element {
  const [shares, setShares] = useState<SkillCloudOwnedShare[]>([])
  const [loading, setLoading] = useState(true)
  const [busyShareId, setBusyShareId] = useState<string | null>(null)
  const [confirmShareId, setConfirmShareId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    const current = ++generation.current
    setLoading(true)
    setError(null)
    try {
      const operation = await window.api.skills.listOwnedShares()
      if (generation.current !== current) {
        return
      }
      if (operation.status !== 'ok') {
        setError(inventoryError(operation.status))
        return
      }
      setShares(operation.value)
    } catch {
      if (generation.current === current) {
        setError(
          translate(
            'auto.components.settings.shareSkills.linksUnavailable',
            'Shared links are unavailable right now.'
          )
        )
      }
    } finally {
      if (generation.current === current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void load()
    return () => {
      generation.current += 1
    }
  }, [load])

  const copy = async (share: SkillCloudOwnedShare): Promise<void> => {
    await window.api.ui.writeClipboardText(share.url)
    toast.success(translate('auto.components.settings.shareSkills.linkCopied', 'Share link copied'))
  }

  const unshare = async (share: SkillCloudOwnedShare): Promise<void> => {
    if (confirmShareId !== share.id) {
      setConfirmShareId(share.id)
      return
    }
    setBusyShareId(share.id)
    setError(null)
    try {
      const operation = await window.api.skills.revokeShare(share.id)
      if (operation.status !== 'ok') {
        setError(inventoryError(operation.status))
        return
      }
      setShares((current) => current.filter((candidate) => candidate.id !== share.id))
      setConfirmShareId(null)
      toast.success(translate('auto.components.settings.shareSkills.linkRevoked', 'Link revoked'))
    } catch {
      setError(
        translate(
          'auto.components.settings.shareSkills.revokeFailed',
          'Orca could not revoke this link.'
        )
      )
    } finally {
      setBusyShareId(null)
    }
  }

  return (
    <section className="space-y-3 py-5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">
            {translate('auto.components.settings.shareSkills.activeLinks', 'Active shared links')}
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {translate(
              'auto.components.settings.shareSkills.activeLinksDescription',
              'Only people with a link can open it. Unshare a link to block future inspection and installs.'
            )}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {translate('auto.components.settings.shareSkills.refreshLinks', 'Refresh')}
        </Button>
      </div>

      {!loading && shares.length === 0 && !error ? (
        <p className="rounded-md border border-border p-3 text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.shareSkills.noActiveLinks',
            'No active links. Publish a skill bundle from Skills to create one.'
          )}
        </p>
      ) : null}

      {shares.length > 0 ? (
        <ul className="space-y-2">
          {shares.map((share) => (
            <li key={share.id} className="space-y-2 rounded-md border border-border p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{share.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{share.url}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => void copy(share)}>
                  <Clipboard className="size-4" />
                  {translate('auto.components.settings.shareSkills.copyLink', 'Copy link')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={confirmShareId === share.id ? 'destructive' : 'outline'}
                  disabled={busyShareId !== null}
                  onClick={() => void unshare(share)}
                >
                  {busyShareId === share.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Link2Off className="size-4" />
                  )}
                  {confirmShareId === share.id
                    ? translate(
                        'auto.components.settings.shareSkills.confirmUnshare',
                        'Confirm unshare'
                      )
                    : translate('auto.components.settings.shareSkills.unshare', 'Unshare')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
