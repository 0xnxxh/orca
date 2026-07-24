import { AlertTriangle } from 'lucide-react'
import { useSkillFreshness } from '@/hooks/useSkillFreshness'
import { getSkillFreshnessDisplayStatus } from '@/lib/skill-freshness-display-status'
import { skillFreshnessAttention } from './skill-freshness-skipped-reason'

// Why: an amber pill says something is wrong but not what, and a Details link next to a
// status chip is easy to miss. The rails that own the badge state the cause inline so the
// user learns it without having to suspect there is more to read. The paths lead because
// the shared sentence says "this copy" — in the dialog its location rows supply that
// referent, and here nothing else would.
export function SkillFreshnessAttentionNotice({
  skillName
}: {
  skillName: string
}): React.JSX.Element | null {
  const { inventory } = useSkillFreshness()
  if (getSkillFreshnessDisplayStatus(inventory, skillName) !== 'needs-attention') {
    return null
  }
  const attention = skillFreshnessAttention(inventory, skillName)
  if (!attention) {
    return null
  }
  return (
    <div className="mt-2 flex items-start gap-1.5 text-[12px] leading-snug text-muted-foreground">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
      <div className="min-w-0 space-y-1">
        {attention.paths.map((path) => (
          <p key={path} className="font-mono text-[11px] break-all text-foreground/80">
            {path}
          </p>
        ))}
        <p>{attention.reason}</p>
      </div>
    </div>
  )
}
