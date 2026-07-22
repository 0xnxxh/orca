import { recordDurableCrashBreadcrumb } from '../crash-reporting/durable-crash-breadcrumb'

type FatalMainProcessErrorKind = 'main_uncaught_exception' | 'main_unhandled_rejection'

type FatalMainProcessErrorDetails = {
  errorName: string
  errorMessage: string
  errorStack: string
  errorCode: string
}

function readErrorProperty(error: unknown, property: string): unknown {
  try {
    return error !== null && (typeof error === 'object' || typeof error === 'function')
      ? (error as Record<string, unknown>)[property]
      : undefined
  } catch {
    return undefined
  }
}

function boundedString(value: unknown, maxLength: number, fallback = ''): string {
  try {
    return String(value).slice(0, maxLength)
  } catch {
    return fallback
  }
}

function fatalMainProcessErrorDetails(error: unknown): FatalMainProcessErrorDetails {
  let isError = false
  try {
    isError = error instanceof Error
  } catch {
    // Why: a proxy can throw from instanceof; fatal diagnostics still need a safe fallback.
  }

  return {
    errorName: isError
      ? boundedString(readErrorProperty(error, 'name') ?? 'Error', 100, 'Error')
      : typeof error,
    errorMessage: isError
      ? boundedString(readErrorProperty(error, 'message') ?? '', 500)
      : boundedString(error, 500, '[unprintable value]'),
    errorStack: isError
      ? boundedString(readErrorProperty(error, 'stack') ?? '', 4_000)
          .split('\n')
          .slice(0, 12)
          .join('\n')
      : '',
    errorCode: boundedString(readErrorProperty(error, 'code') ?? '', 100)
  }
}

/** Durably record a main-process fatal/near-fatal error before default handling runs. Exported for tests. */
export function recordFatalMainProcessError(kind: FatalMainProcessErrorKind, error: unknown): void {
  const details = fatalMainProcessErrorDetails(error)
  try {
    recordDurableCrashBreadcrumb(kind, details, kind)
  } catch {
    // Why: diagnostics must never turn a fatal-error report into a second fault.
  }
  try {
    console.error(
      `[${kind}] ${details.errorStack || `${details.errorName}: ${details.errorMessage}`}`
    )
  } catch {
    // Why: custom console sinks must not defeat the process-level safety guard.
  }
}

export function installUncaughtPipeErrorGuard(): void {
  const onUncaughtException = (error: unknown): void => {
    const errorCode = readErrorProperty(error, 'code')
    if (errorCode === 'EIO' || errorCode === 'EPIPE') {
      return
    }

    // Why (issue #9441): the re-throw below exits with a clean code and no macOS crash report; record durably first or the death is undiagnosable in the field.
    recordFatalMainProcessError('main_uncaught_exception', error)
    process.off('uncaughtException', onUncaughtException)
    // Why: throwing inside an uncaughtException handler exits with status 7 and hides the fault; re-throw next tick for the real stack.
    setImmediate(() => {
      throw error
    })
  }

  process.on('uncaughtException', onUncaughtException)
}

/** Keep one failed background promise from silently killing the whole app.
 *
 * Node's default kills the process on an unhandled rejection. Large-profile startup restore runs
 * hundreds of concurrent async chains (worktree scans, terminal reconnects) in main; a single
 * rejection in any of them exited the app with no crash report (issue #9441). Log it durably and
 * stay alive — dying cannot be less disruptive than continuing with one failed background task.
 */
export function installUnhandledRejectionLogging(): void {
  process.on('unhandledRejection', (reason) => {
    recordFatalMainProcessError('main_unhandled_rejection', reason)
  })
}
