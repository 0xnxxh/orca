import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { PortScanCommandClient, type PortScanCommandOutcome } from './port-scan-command-client'

// Why: resolves the built worker entry and owns the process-wide client, so the
// client class stays Electron-free (electron is require'd lazily here) and the
// scanner depends only on runPortScanCommand below. Mirrors
// session-scanner-opencode-sqlite-worker-spawn.ts.

function resolveWorkerEntryPath(): string {
  let app: { isPackaged: boolean } | null = null
  try {
    app = require('electron').app ?? null
  } catch {
    app = null
  }
  if (app?.isPackaged) {
    return join(
      process.resourcesPath,
      'app.asar',
      'out',
      'main',
      'port-scan-command-worker-entry.js'
    )
  }
  return join(__dirname, 'port-scan-command-worker-entry.js')
}

function defaultWorkerFactory(): Worker {
  const workerPath = resolveWorkerEntryPath()
  // A missing built entry must throw synchronously so the client can fail
  // closed instead of waiting on a worker that can never post a result.
  if (!existsSync(workerPath)) {
    throw new Error(`Port scan command worker entry not found: ${workerPath}`)
  }
  return new Worker(workerPath, { name: 'orca-port-scan-command' })
}

let sharedClient: PortScanCommandClient | null = null

function getSharedClient(): PortScanCommandClient {
  sharedClient ??= new PortScanCommandClient({ workerFactory: defaultWorkerFactory })
  return sharedClient
}

/**
 * Run one port-scan command off the main thread.
 * @param command - Binary to execute (never a shell).
 * @param args - Argument vector.
 * @returns stdout plus how long process creation blocked the worker thread.
 */
export function runPortScanCommand(
  command: string,
  args: readonly string[]
): Promise<PortScanCommandOutcome> {
  return getSharedClient().run(command, args)
}
