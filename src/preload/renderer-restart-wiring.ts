import { ORCA_RENDERER_UNLOAD_PREVENTED_EVENT } from '../shared/renderer-shutdown-events'
import {
  prepareRendererForAppRestart,
  type UpdaterQuitAbortRelay
} from '../shared/renderer-restart-preparation'
import type { UpdateStatus } from '../shared/types'
import {
  ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT,
  ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT
} from '../shared/updater-renderer-events'

export function relayUpdaterStatus(
  relay: Pick<UpdaterQuitAbortRelay, 'handleStatus'>,
  status: UpdateStatus
): void {
  relay.handleStatus(status)
}

export function relayRendererUnloadPrevented(eventTarget: EventTarget): void {
  eventTarget.dispatchEvent(new Event(ORCA_RENDERER_UNLOAD_PREVENTED_EVENT))
}

export async function prepareAndInvokeUpdaterInstall(
  eventTarget: EventTarget,
  relay: Pick<UpdaterQuitAbortRelay, 'markPrepared' | 'abort'>,
  invoke: () => Promise<void>
): Promise<void> {
  await prepareRendererForAppRestart(eventTarget, {
    startedEventName: ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT,
    abortedEventName: ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT
  })
  relay.markPrepared()
  try {
    await invoke()
  } catch (error) {
    relay.abort()
    throw error
  }
}
