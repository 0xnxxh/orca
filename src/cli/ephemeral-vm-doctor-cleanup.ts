import {
  runEphemeralVmRecipeCleanup,
  type EphemeralVmRecipeCleanupArgs,
  type EphemeralVmRecipeCleanupResult
} from '../shared/ephemeral-vm-recipe-runner'
import {
  armEphemeralVmDestroyDeadline,
  getEphemeralVmDestroyDeadlineError,
  getEphemeralVmDestroyDeadlineMs
} from '../shared/ephemeral-vm-destroy-deadline'

export async function runEphemeralVmDoctorCleanup(
  args: EphemeralVmRecipeCleanupArgs
): Promise<EphemeralVmRecipeCleanupResult> {
  const deadlineController = new AbortController()
  const disarmDeadline = armEphemeralVmDestroyDeadline(deadlineController, {
    keepProcessAlive: true
  })
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
    disarmDeadline()
  }
}
