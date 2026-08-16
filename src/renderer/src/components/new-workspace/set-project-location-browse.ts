import { toast } from 'sonner'
import { parseExecutionHostId } from '../../../../shared/execution-host'

export type ProjectLocationBrowseTarget =
  | { kind: 'local' }
  | { kind: 'ssh'; targetId: string }
  | { kind: 'runtime'; environmentId: string }

export function getProjectLocationBrowseTarget(hostId: string): ProjectLocationBrowseTarget {
  const parsed = parseExecutionHostId(hostId)
  if (parsed?.kind === 'ssh') {
    return { kind: 'ssh', targetId: parsed.targetId }
  }
  if (parsed?.kind === 'runtime') {
    return { kind: 'runtime', environmentId: parsed.environmentId }
  }
  return { kind: 'local' }
}

export async function pickLocalProjectLocationFolder(
  onPicked: (path: string) => void
): Promise<void> {
  try {
    const path = await window.api.repos.pickFolder()
    if (path) {
      onPicked(path)
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}
