import { writeSync } from 'node:fs'

export const STARTUP_DIAGNOSTICS_ENV = 'ORCA_STARTUP_DIAGNOSTICS'
export const STARTUP_PROCESS_CLOCK = 'process-performance-now-ms'

export type StartupDiagnosticSink = (fd: number, text: string) => unknown

export function writeStartupDiagnosticLine(
  message: string,
  write: StartupDiagnosticSink = writeSync
): void {
  try {
    write(2, message.endsWith('\n') ? message : `${message}\n`)
  } catch {
    console.error(message)
  }
}

export function isStartupDiagnosticsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[STARTUP_DIAGNOSTICS_ENV] === '1'
}

export function logStartupDiagnostic(
  event: string,
  details: Record<string, unknown> = {},
  write?: StartupDiagnosticSink
): void {
  const detailText = Object.entries(details)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ')
  writeStartupDiagnosticLine(`[startup] ${event}${detailText ? ` ${detailText}` : ''}`, write)
}

export function logStartupMilestone(event: string, details: Record<string, unknown> = {}): void {
  if (isStartupDiagnosticsEnabled()) {
    logStartupDiagnostic(event, {
      ...details,
      t: Math.round(performance.now() * 10) / 10,
      clock: STARTUP_PROCESS_CLOCK
    })
  }
}
