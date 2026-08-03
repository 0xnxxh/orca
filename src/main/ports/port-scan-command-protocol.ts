// Why: request/response shapes shared by the port-scan worker entry and its
// main-thread client. Kept type-only and Electron-free so importing it into the
// worker bundle cannot drag Electron across the thread boundary.

export const PORT_SCAN_COMMAND_TIMEOUT_MS = 4_000
export const PORT_SCAN_MAX_BUFFER_BYTES = 2 * 1024 * 1024

// The client's own deadline must outlast the command budget: on a host that
// hooks process creation the worker is stuck in uv_spawn long before the
// command itself starts, and killing the worker for that would discard a scan
// that is about to succeed.
export const PORT_SCAN_WORKER_CALL_TIMEOUT_MS = 30_000

export type PortScanCommandRequest = {
  id: number
  command: string
  args: readonly string[]
}

export type PortScanCommandResponse =
  | { id: number; ok: true; stdout: string; spawnMs: number }
  | { id: number; ok: false; error: string; timedOut: boolean; spawnMs: number }
