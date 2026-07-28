import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { MOBILE_FILE_WRITE_METHODS } from './mobile-file-write-if-unchanged'

describe('mobile conflict-safe file write RPC', () => {
  it('writes UTF-8 only after the current authorized content matches', async () => {
    const runtime = fileRuntime('before')
    const dispatcher = new RpcDispatcher({ runtime, methods: MOBILE_FILE_WRITE_METHODS })

    const response = await dispatcher.dispatch(
      request({
        expectedRevision: revision('before'),
        contentBase64: Buffer.from('after').toString('base64'),
        expectedExecutionHostId: 'ssh:target-1',
        expectedSshTargetId: 'target-1',
        expectedSshConnectionGeneration: 7
      })
    )

    expect(runtime.writeFileExplorerFile).toHaveBeenCalledWith(
      'id:repo-1::/workspace',
      'src/index.ts',
      'after',
      7,
      'target-1',
      'ssh:target-1'
    )
    expect(response).toMatchObject({
      ok: true,
      result: {
        ok: true,
        revision: revision('after'),
        byteLength: 5
      }
    })
  })

  it('returns a stable conflict without writing stale content', async () => {
    const runtime = fileRuntime('changed')
    const dispatcher = new RpcDispatcher({ runtime, methods: MOBILE_FILE_WRITE_METHODS })
    const response = await dispatcher.dispatch(
      request({
        expectedRevision: revision('before'),
        contentBase64: Buffer.from('after').toString('base64'),
        expectedExecutionHostId: 'local'
      })
    )

    expect(response).toMatchObject({ ok: true, result: { ok: false, code: 'conflict' } })
    expect(runtime.writeFileExplorerFile).not.toHaveBeenCalled()
  })

  it('refuses files that exceed the bounded editable snapshot', async () => {
    const runtime = fileRuntime('before', false)
    const dispatcher = new RpcDispatcher({ runtime, methods: MOBILE_FILE_WRITE_METHODS })
    const response = await dispatcher.dispatch(
      request({
        expectedRevision: revision('before'),
        contentBase64: '',
        expectedExecutionHostId: 'local'
      })
    )

    expect(response).toMatchObject({ ok: true, result: { ok: false, code: 'too_large' } })
    expect(runtime.writeFileExplorerFile).not.toHaveBeenCalled()
  })
})

function fileRuntime(content: string, eof = true) {
  const bytes = Buffer.from(content)
  return {
    getRuntimeId: () => 'test-runtime',
    readFileExplorerChunk: vi.fn().mockResolvedValue({
      contentBase64: bytes.toString('base64'),
      bytesRead: bytes.byteLength,
      eof
    }),
    writeFileExplorerFile: vi.fn().mockResolvedValue({ ok: true })
  } as unknown as OrcaRuntimeService & {
    writeFileExplorerFile: ReturnType<typeof vi.fn>
  }
}

function request(fields: {
  expectedRevision: string
  contentBase64: string
  expectedExecutionHostId: string
  expectedSshTargetId?: string
  expectedSshConnectionGeneration?: number
}): RpcRequest {
  return {
    id: 'req-1',
    authToken: 'tok',
    method: 'files.writeIfUnchanged',
    params: {
      worktree: 'id:repo-1::/workspace',
      relativePath: 'src/index.ts',
      ...fields
    }
  }
}

function revision(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}
