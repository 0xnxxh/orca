export const WINDOWS_PTY_JOB_DRAIN_TIMEOUT_MS = 8_000

type WindowsPtyJobControl = {
  pid: number
  terminateJobTree?(timeoutMs: number): Promise<boolean> | undefined
}

export async function terminateWindowsPtyTree(
  proc: WindowsPtyJobControl,
  closeRoot: () => void
): Promise<void> {
  let nativeCompletion: Promise<boolean> | undefined
  try {
    nativeCompletion = proc.terminateJobTree?.call(proc, WINDOWS_PTY_JOB_DRAIN_TIMEOUT_MS)
  } catch (error) {
    // Why: a synchronous native bridge failure must still close ConPTY while
    // the rejected shutdown keeps destructive deletion fail-closed.
    closeRoot()
    throw error
  }
  if (!nativeCompletion) {
    closeRoot()
    throw new Error(`Windows PTY Job ownership unavailable for process ${proc.pid}`)
  }

  closeRoot()
  if (!(await nativeCompletion)) {
    throw new Error(`Windows PTY Job did not drain for process ${proc.pid}`)
  }
}
