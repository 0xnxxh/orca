import { EventEmitter } from 'node:events'
import { Worker } from 'node:worker_threads'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_QUEUED_CALLS,
  PortScanCommandClient,
  PortScanCommandTimeout,
  PortScanWorkerUnavailableError
} from './port-scan-command-client'
import type { PortScanCommandRequest, PortScanCommandResponse } from './port-scan-command-protocol'

class FakeWorker extends EventEmitter {
  readonly posted: PortScanCommandRequest[] = []
  terminated = false

  postMessage(request: PortScanCommandRequest): void {
    this.posted.push(request)
  }
  unref(): void {}
  terminate(): Promise<number> {
    this.terminated = true
    return Promise.resolve(0)
  }
  respond(response: PortScanCommandResponse): void {
    this.emit('message', response)
  }
}

function clientWithFakeWorker(callTimeoutMs = 30_000): {
  client: PortScanCommandClient
  workers: FakeWorker[]
} {
  const workers: FakeWorker[] = []
  const client = new PortScanCommandClient({
    workerFactory: () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker as unknown as Worker
    },
    callTimeoutMs,
    log: () => {}
  })
  return { client, workers }
}

describe('PortScanCommandClient', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('dispatches one command at a time so a stalled spawn cannot fan out', async () => {
    const { client, workers } = clientWithFakeWorker()

    const first = client.run('netstat', ['-ano'])
    const second = client.run('powershell.exe', ['-NoProfile'])
    await Promise.resolve()

    expect(workers[0].posted).toHaveLength(1)
    workers[0].respond({ id: workers[0].posted[0].id, ok: true, stdout: 'a', spawnMs: 3 })
    await expect(first).resolves.toMatchObject({ stdout: 'a' })

    expect(workers[0].posted).toHaveLength(2)
    workers[0].respond({ id: workers[0].posted[1].id, ok: true, stdout: 'b', spawnMs: 4 })
    await expect(second).resolves.toMatchObject({ stdout: 'b' })
  })

  it('ignores responses that do not correlate with the active request', async () => {
    const { client, workers } = clientWithFakeWorker()
    const pending = client.run('netstat', [])
    await Promise.resolve()

    workers[0].respond({ id: 999, ok: true, stdout: 'stale', spawnMs: 1 })
    workers[0].respond({ id: workers[0].posted[0].id, ok: true, stdout: 'fresh', spawnMs: 1 })

    await expect(pending).resolves.toMatchObject({ stdout: 'fresh' })
  })

  it('rehydrates a worker-side command timeout so the scan can back off', async () => {
    const { client, workers } = clientWithFakeWorker()
    const pending = client.run('lsof', [])
    await Promise.resolve()

    workers[0].respond({
      id: workers[0].posted[0].id,
      ok: false,
      error: 'lsof timed out after 4000ms',
      timedOut: true,
      spawnMs: 2
    })

    await expect(pending).rejects.toBeInstanceOf(PortScanCommandTimeout)
  })

  it('reports a worker crash as a non-timeout error and respawns for the next call', async () => {
    const { client, workers } = clientWithFakeWorker()
    const first = client.run('lsof', [])
    await Promise.resolve()

    workers[0].emit('error', new Error('worker died'))
    await expect(first).rejects.toThrow('worker died')
    // A crash is not a command timeout: backing off would blame the command.
    await expect(first.catch((e) => e)).resolves.not.toBeInstanceOf(PortScanCommandTimeout)

    const second = client.run('lsof', [])
    await Promise.resolve()
    expect(workers).toHaveLength(2)
    workers[1].respond({ id: workers[1].posted[0].id, ok: true, stdout: 'ok', spawnMs: 1 })
    await expect(second).resolves.toMatchObject({ stdout: 'ok' })
  })

  it('terminates a silent worker at the call deadline without arming the backoff', async () => {
    vi.useFakeTimers()
    const { client, workers } = clientWithFakeWorker(1_000)
    const pending = client.run('lsof', [])
    const assertion = expect(pending).rejects.not.toBeInstanceOf(PortScanCommandTimeout)
    await vi.advanceTimersByTimeAsync(1_000)

    await assertion
    expect(workers[0].terminated).toBe(true)
  })

  it('rejects overflow instead of growing the queue without bound', async () => {
    const { client } = clientWithFakeWorker()
    // One dispatched call plus a full queue; the worker never responds.
    const held = Array.from({ length: MAX_QUEUED_CALLS + 1 }, () => client.run('lsof', []))
    held.forEach((pending) => pending.catch(() => {}))

    await expect(client.run('lsof', [])).rejects.toThrow('queue is full')
  })

  it('fails closed instead of spawning the command on this thread', async () => {
    const client = new PortScanCommandClient({
      workerFactory: () => {
        throw new Error('worker entry not found')
      },
      log: () => {}
    })

    await expect(client.run('netstat', [])).rejects.toBeInstanceOf(PortScanWorkerUnavailableError)
  })
})

describe('PortScanCommandClient on a real worker thread', () => {
  // The load-bearing assertion for #11161: a worker that blocks its own thread
  // inside process creation, exactly as a hooked CreateProcessW does, must not
  // stall the calling event loop. Reverting to an in-process execFile fails it.
  const WORKER_SOURCE = `
    const { parentPort } = require('node:worker_threads')
    const { execFile } = require('node:child_process')
    parentPort.on('message', (request) => {
      const startedAt = Date.now()
      const until = startedAt + 800
      while (Date.now() < until) {}
      execFile(process.execPath, ['-e', '0'], () => {
        parentPort.postMessage({
          id: request.id,
          ok: true,
          stdout: '',
          spawnMs: Date.now() - startedAt
        })
      })
    })
  `

  it('keeps the calling event loop responsive while a spawn stalls', async () => {
    const client = new PortScanCommandClient({
      workerFactory: () => new Worker(WORKER_SOURCE, { eval: true }),
      log: () => {}
    })

    let maxStallMs = 0
    let last = Date.now()
    const monitor = setInterval(() => {
      const now = Date.now()
      maxStallMs = Math.max(maxStallMs, now - last - 10)
      last = now
    }, 10)

    try {
      const results = await Promise.all([client.run('netstat', []), client.run('lsof', [])])
      expect(results[0].spawnMs).toBeGreaterThanOrEqual(700)
      expect(results[1].spawnMs).toBeGreaterThanOrEqual(700)
      expect(maxStallMs).toBeLessThan(400)
    } finally {
      clearInterval(monitor)
    }
  }, 20_000)
})
