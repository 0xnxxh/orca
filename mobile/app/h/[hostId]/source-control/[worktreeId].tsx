import { useLocalSearchParams } from 'expo-router'
import { MobileSourceControlPanel } from '../../../../src/source-control/MobileSourceControlPanel'
import { firstParam } from '../../../../src/source-control/mobile-source-control-screen-state'
import { parseSourceControlHubTab } from '../../../../src/source-control/mobile-source-control-hub-tab'
import type { HostSourceControlBinding } from '../../../../src/source-control/host-source-control-binding'

export function MobileSourceControlRoute({
  binding
}: {
  binding?: HostSourceControlBinding
} = {}) {
  const params = useLocalSearchParams<{
    hostId?: string | string[]
    worktreeId?: string | string[]
    name?: string | string[]
    origin?: string | string[]
    tab?: string | string[]
  }>()
  return (
    <MobileSourceControlPanel
      hostId={firstParam(params.hostId)}
      worktreeId={firstParam(params.worktreeId)}
      name={firstParam(params.name)}
      origin={firstParam(params.origin)}
      initialTab={parseSourceControlHubTab(params.tab)}
      embedded={false}
      binding={binding}
    />
  )
}

export default function MobileSourceControlScreen() {
  return <MobileSourceControlRoute />
}
