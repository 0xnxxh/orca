import { closeSync, existsSync, readFileSync, rmSync } from 'node:fs'
import {
  killRecordedAndMatchingProcesses,
  runBenchmarkCleanupStages,
  signalValidatedProcessGroup
} from './macos-computer-helper-owner-loss-processes.mjs'

export function cleanupOwnerLossTrial(options) {
  const groupState = { stopped: false }
  let error
  let output = ''
  try {
    runBenchmarkCleanupStages([
      () => {
        if (options.failed) {
          signalValidatedProcessGroup(options.pid, options.marker, 'SIGSTOP', groupState)
        }
      },
      () => {
        if (options.failed) {
          killRecordedAndMatchingProcesses(options.recordPath, options.helperPath, [
            options.helperPath,
            options.tempDir
          ])
        }
      },
      () => {
        if (options.failed) {
          signalValidatedProcessGroup(options.pid, options.marker, 'SIGKILL', groupState)
        }
      },
      () => {
        if (options.stderrDescriptor !== undefined) {
          closeSync(options.stderrDescriptor)
        }
      },
      () => {
        if (options.stdoutDescriptor !== undefined) {
          closeSync(options.stdoutDescriptor)
        }
      },
      () => {
        output = options.outputPaths
          .filter(existsSync)
          .map((outputPath) => readFileSync(outputPath, 'utf8'))
          .join('')
      },
      () => rmSync(options.launcherDir, { recursive: true, force: true }),
      () => rmSync(options.tempDir, { recursive: true, force: true })
    ])
  } catch (caught) {
    error = caught
  }
  return { error, output }
}
