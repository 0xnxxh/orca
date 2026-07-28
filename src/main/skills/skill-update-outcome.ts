import {
  SUPPORTED_GLOBAL_SKILL_TOPOLOGIES,
  type SkillFreshnessInstallation
} from '../../shared/skill-freshness'

/**
 * Names that did not land, judged from the post-run inventory.
 *
 * Why not "whatever is still in `eligibleUpdateNames`": a name leaves that list
 * for reasons that are not success. A half-written bundle hashes to
 * `unrecognized`, a failed write can leave the directory unreadable, and a
 * removed skill has no convergent placement at all — each would read as
 * "updated" and show a green check over a broken skill. So demand a positive
 * signal instead: every placement the command writes to has to come back as a
 * revision we recognise.
 *
 * Known limit: the topology filter runs before the status check, so a placement
 * that degrades OUT of the convergent set is dropped from the judgment rather
 * than failing it. A run that rewrites the canonical copy but leaves a
 * provider-alias a broken symlink still reports success. Catching that needs the
 * pre-run inventory to compare convergent-then against convergent-now; every
 * wholly-degraded and removed-entirely case is already reported as a failure.
 */
export function skillUpdateFailedNames(
  names: readonly string[],
  installations: readonly SkillFreshnessInstallation[],
  commandFailed: boolean
): string[] {
  return names.filter((name) => {
    const convergent = installations.filter(
      (entry) => entry.name === name && SUPPORTED_GLOBAL_SKILL_TOPOLOGIES.has(entry.topology)
    )
    if (convergent.length === 0) {
      return true
    }
    // `newer-known` counts as landed: the CLI pulls from the source repo, which
    // can be ahead of the revision this build ships in its manifest.
    //
    // `outdated` is forgiven only when the CLI reported success. `skills update`
    // compares its lock's recorded hash against the source and never reads disk,
    // so when the lock has advanced past the installed bytes it reports "up to
    // date", exits 0, and writes nothing. The copy is left intact — a recognised
    // older revision, not a broken one — and no amount of retrying converges it.
    // Calling that an error invented a failure the CLI never reported and armed
    // a Retry that provably could not succeed. The freshness badge still marks
    // the copy not-current, so this only stops the run being blamed for it.
    //
    // When the command itself failed (spawn error, non-zero exit), an outdated
    // copy means the update never landed — forgiving it there would read an
    // offline no-op as "Updated N skills". A genuinely botched write is still
    // caught in both modes: a half-written bundle hashes to `unrecognized`, and
    // a wholly-degraded or removed copy leaves no convergent placement.
    return convergent.some(
      (entry) =>
        entry.status !== 'current' &&
        entry.status !== 'newer-known' &&
        (commandFailed || entry.status !== 'outdated')
    )
  })
}
