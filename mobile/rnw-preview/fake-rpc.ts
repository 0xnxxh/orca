// A fake of the paired-host RPC socket: the ONLY faked boundary. It answers the
// exact methods the real upload + send pipeline calls, so the real hooks run
// unmodified. clipboard.startImageUpload returns method_not_found so the pipeline
// takes its single-frame fallback (saveImageAsTempFile), exactly as against a host.
type Response =
  | { id: string; ok: true; result: unknown; _meta: { runtimeId: string } }
  | {
      id: string
      ok: false
      error: { code: string; message: string }
      _meta: { runtimeId: string }
    }

export const calls: Array<{ method: string; params: unknown }> = []

export const fakeClient = {
  async sendRequest(method: string, params?: unknown): Promise<Response> {
    calls.push({ method, params })
    const meta = { runtimeId: 'mock' as const }
    if (method === 'clipboard.startImageUpload') {
      return { id: 'x', ok: false, error: { code: 'method_not_found', message: 'no' }, _meta: meta }
    }
    if (method === 'clipboard.saveImageAsTempFile') {
      return { id: 'x', ok: true, result: '/host/tmp/orca-attach-42.png', _meta: meta }
    }
    if (method === 'terminal.send') {
      return { id: 'x', ok: true, result: { send: { accepted: true } }, _meta: meta }
    }
    return { id: 'x', ok: true, result: {}, _meta: meta }
  }
}
