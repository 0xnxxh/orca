import type { SshTarget } from '../../../../shared/ssh-types'

/** True when an existing Orca host already owns this config alias / label. */
export function isDuplicateSshTargetAlias({
  existingTargets,
  configHost,
  label,
  host
}: {
  existingTargets: readonly Pick<SshTarget, 'configHost' | 'label' | 'host'>[]
  configHost: string
  label: string
  host: string
}): boolean {
  // Why: the config picker's `alreadyInOrca` flag compares lowercased aliases; match it or the
  // two checks disagree on case-only variants.
  const alias = (configHost.trim() || label.trim() || host.trim()).toLowerCase()
  if (!alias) {
    return false
  }
  return existingTargets.some((target) => {
    const existingAlias = (target.configHost ?? target.label ?? target.host).trim()
    return existingAlias.toLowerCase() === alias
  })
}
