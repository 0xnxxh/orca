import {
  runEphemeralVmRecipeCleanup,
  type EphemeralVmRecipeCleanupArgs,
  type EphemeralVmRecipeCleanupResult
} from '../shared/ephemeral-vm-recipe-runner'
import {
  armEphemeralVmDestroyDeadline,
  EPHEMERAL_VM_DESTROY_DEADLINE_MS,
  getEphemeralVmDestroyDeadlineError,
  getEphemeralVmDestroyDeadlineMs
} from '../shared/ephemeral-vm-destroy-deadline'

export async function runEphemeralVmDoctorCleanup(
  args: EphemeralVmRecipeCleanupArgs
): Promise<EphemeralVmRecipeCleanupResult> {
  const deadlineController = new AbortController()
  const disarmDeadline = armEphemeralVmDestroyDeadline(deadlineController)
  const keepAlive = setInterval(() => undefined, EPHEMERAL_VM_DESTROY_DEADLINE_MS)
  try {
    const cleanup = await runEphemeralVmRecipeCleanup({
      ...args,
      forceAbortSignal: deadlineController.signal
    })
    const deadlineMs = getEphemeralVmDestroyDeadlineMs(deadlineController.signal)
    return deadlineMs === null
      ? cleanup
      : {
          ...cleanup,
          ok: false,
          error: getEphemeralVmDestroyDeadlineError(deadlineMs, cleanup.terminationFailed)
        }
  } finally {
    clearInterval(keepAlive)
    disarmDeadline()
  }
}
