import { parentPort } from 'node:worker_threads'
import {
  PortScanCommandTimeoutError,
  runPortScanCommandInProcess
} from './port-scan-command-execution'
import type { PortScanCommandRequest, PortScanCommandResponse } from './port-scan-command-protocol'

// Why (#11161): owns every port-scan spawn so the hooked CreateProcessW stalls
// this thread instead of CrBrowserMain. Must stay Electron-free — a worker
// thread cannot require('electron').

const port = parentPort
if (port) {
  port.on('message', (request: PortScanCommandRequest) => {
    void handle(request).then((response) => port.postMessage(response))
  })
}

async function handle(request: PortScanCommandRequest): Promise<PortScanCommandResponse> {
  try {
    const { stdout, spawnMs } = await runPortScanCommandInProcess(request.command, request.args)
    return { id: request.id, ok: true, stdout, spawnMs }
  } catch (error) {
    return {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      timedOut: error instanceof PortScanCommandTimeoutError,
      // The stall is the diagnostically interesting part of a failure here, but
      // it is unknown once the call threw, so report it as unmeasured.
      spawnMs: 0
    }
  }
}
