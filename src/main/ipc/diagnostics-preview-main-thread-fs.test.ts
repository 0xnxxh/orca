// Regression guard for freeze #15: the diagnostics bundle preview is written
// into app.getPath('temp'), which on some setups is redirected onto a network
// share. A sync mkdir/write there blocks the Electron main thread.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeFs from 'node:fs'
import type * as NodeFsPromises from 'node:fs/promises'
import type { CollectedBundle } from '../observability/bundle'

const {
  syncFsCalls,
  gate,
  previewRoot,
  collectDiagnosticBundleMock,
  RECORDED_SYNC,
  RECORDED_ASYNC
} = vi.hoisted(() => ({
  syncFsCalls: [] as string[],
  gate: { block: null as Promise<void> | null },
  previewRoot: { dir: '' },
  collectDiagnosticBundleMock: vi.fn(),
  RECORDED_SYNC: [
    'accessSync',
    'existsSync',
    'mkdirSync',
    'readFileSync',
    'renameSync',
    'statSync',
    'unlinkSync',
    'writeFileSync'
  ] as const,
  RECORDED_ASYNC: ['mkdir', 'unlink', 'writeFile'] as const
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof NodeFs>('node:fs')
  const patched: Record<string, unknown> = { ...actual }
  for (const name of RECORDED_SYNC) {
    const real = actual[name] as (...args: unknown[]) => unknown
    patched[name] = (...args: unknown[]) => {
      syncFsCalls.push(`${name} ${String(args[0])}`)
      return real(...args)
    }
  }
  return patched
})

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
  const patched: Record<string, unknown> = { ...actual }
  for (const name of RECORDED_ASYNC) {
    const real = actual[name] as (...args: unknown[]) => Promise<unknown>
    patched[name] = async (...args: unknown[]) => {
      if (gate.block) {
        await gate.block
      }
      return real(...args)
    }
  }
  return patched
})

const handlers = new Map<string, (event: unknown, args?: unknown) => unknown>()

vi.mock('electron', () => ({
  app: { getPath: () => previewRoot.dir, getVersion: () => '1.2.3-test' },
  dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })) },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    })
  },
  shell: { openPath: vi.fn(async () => '') }
}))

vi.mock('../observability', () => ({
  collectDiagnosticBundle: collectDiagnosticBundleMock,
  deleteDiagnosticBundle: vi.fn(),
  getDiagnosticsStatus: () => ({
    localFileEnabled: true,
    bundleEnabled: true,
    traceFilePath: '/tmp/main.trace.ndjson',
    traceFamilySize: 0
  }),
  uploadDiagnosticBundle: vi.fn()
}))

function makeBundle(bundleSubmissionId: string): CollectedBundle {
  return {
    bundleSubmissionId,
    payload: '{"type":"bundle-header"}\n',
    bytes: 25,
    spanCount: 0
  }
}

function invoke(channel: string, args?: unknown): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) {
    throw new Error(`no handler for ${channel}`)
  }
  return Promise.resolve(handler(null, args))
}

describe('diagnostics preview writes stay off main-thread sync fs', () => {
  beforeEach(async () => {
    previewRoot.dir = mkdtempSync(join(tmpdir(), 'orca-diagnostics-freeze-'))
    gate.block = null
    collectDiagnosticBundleMock.mockReset()
    vi.resetModules()
    handlers.clear()
    const { registerDiagnosticsHandlers } = await import('./diagnostics')
    registerDiagnosticsHandlers()
    syncFsCalls.length = 0
  })

  afterEach(() => {
    gate.block = null
    rmSync(previewRoot.dir, { recursive: true, force: true })
  })

  it('collects and discards a bundle preview without a synchronous fs call', async () => {
    collectDiagnosticBundleMock.mockReturnValue(makeBundle('bundleabcdefghijklmnop'))

    await invoke('diagnostics:collectBundle', 30)
    await invoke('diagnostics:discardBundlePreview', 'bundleabcdefghijklmnop')

    expect(syncFsCalls).toEqual([])
  })

  it('keeps the event loop running while the preview write is parked', async () => {
    collectDiagnosticBundleMock.mockReturnValue(makeBundle('bundleabcdefghijklmnop'))
    gate.block = new Promise<void>(() => {})

    let settled = false
    void invoke('diagnostics:collectBundle', 30).then(() => {
      settled = true
    })

    let timerFired = false
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        timerFired = true
        resolve()
      }, 5)
    })

    expect(timerFired).toBe(true)
    expect(settled).toBe(false)
    expect(syncFsCalls).toEqual([])
  })
})
