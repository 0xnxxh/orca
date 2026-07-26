import { net, session } from 'electron'
import { ensureElectronProxyFromEnvironment } from '../network/proxy-settings'
import { withSpan, type ActiveSpan } from '../observability/tracer'

/**
 * Bounded categories for a cloud request that never reached an HTTP status.
 * Global fetch collapses every one of these into `TypeError: fetch failed`
 * (orca#10758), which left Windows sign-in failures undiagnosable.
 */
export type OrcaCloudTransportFailure =
  | 'dns'
  | 'tls'
  | 'proxy'
  | 'offline'
  | 'timeout'
  | 'redirect'
  | 'connection-lost'
  | 'unknown'

const FAILURE_REASON: Record<OrcaCloudTransportFailure, string> = {
  dns: 'the Orca Cloud hostname could not be resolved',
  tls: 'the TLS handshake failed — a proxy or security tool may be intercepting HTTPS',
  proxy: 'the configured HTTP proxy refused the connection',
  offline: 'this machine has no working network connection',
  timeout: 'Orca Cloud did not respond in time',
  redirect:
    'Orca Cloud redirected the request, and Orca never follows redirects on token endpoints',
  'connection-lost': 'the connection closed before a response arrived',
  unknown: 'the connection failed'
}

export class OrcaCloudTransportError extends Error {
  constructor(
    public readonly failure: OrcaCloudTransportFailure,
    public readonly operation: string,
    public readonly detail: string,
    options?: { cause?: unknown }
  ) {
    super(`Could not reach Orca Cloud: ${FAILURE_REASON[failure]} (${detail})`, options)
    this.name = 'OrcaCloudTransportError'
  }
}

type ErrorFacts = { names: string[]; codes: string[]; messages: string[] }

type ErrorLike = { name?: unknown; message?: unknown; code?: unknown; cause?: unknown }

// Structural, not `instanceof Error`: DOMException timeouts and Chromium's
// rejection objects both carry name/message without a stable prototype here.
function isErrorLike(value: unknown): value is ErrorLike {
  return typeof value === 'object' && value !== null && ('message' in value || 'name' in value)
}

// Undici nests the real error one or two `cause` levels down; Chromium reports
// `net::ERR_*` in the message. Both chains are walked so classification does
// not depend on which transport produced the failure.
function collectErrorFacts(error: unknown): ErrorFacts {
  const facts: ErrorFacts = { names: [], codes: [], messages: [] }
  let current: unknown = error
  for (let depth = 0; depth < 5 && isErrorLike(current); depth += 1) {
    if (typeof current.name === 'string') {
      facts.names.push(current.name)
    }
    if (typeof current.message === 'string') {
      facts.messages.push(current.message)
    }
    if (typeof current.code === 'string') {
      facts.codes.push(current.code)
    }
    current = current.cause
  }
  return facts
}

function classifyTransportFailure(facts: ErrorFacts): OrcaCloudTransportFailure {
  const haystack = [...facts.codes, ...facts.messages].join(' | ').toLowerCase()
  const matches = (pattern: RegExp): boolean => pattern.test(haystack)

  if (facts.names.includes('TimeoutError') || facts.names.includes('AbortError')) {
    return 'timeout'
  }
  if (matches(/etimedout|und_err_(connect_|headers_|body_)?timeout|err_(connection_)?timed_out/)) {
    return 'timeout'
  }
  if (matches(/unexpected redirect|redirect (mode|policy|count)|err_(unsafe_|too_many_)redirect/)) {
    return 'redirect'
  }
  if (matches(/enotfound|eai_again|err_name_not_resolved|err_name_resolution_failed/)) {
    return 'dns'
  }
  if (matches(/err_cert|err_ssl|err_tls|_cert_|certificate|self.signed|unable_to_verify|eproto/)) {
    return 'tls'
  }
  if (matches(/err_proxy|err_tunnel_connection_failed|proxy_auth/)) {
    return 'proxy'
  }
  if (matches(/err_internet_disconnected|err_network_changed|enetunreach|enetdown|ehostunreach/)) {
    return 'offline'
  }
  if (
    matches(
      /econnreset|econnrefused|econnaborted|epipe|und_err_socket|err_connection_|err_empty_response/
    )
  ) {
    return 'connection-lost'
  }
  return 'unknown'
}

// Transport-level text only (errno, net:: code, host) — never request bodies,
// so authorization codes, verifiers, nonces, and tokens cannot leak here.
function describeErrorChain(facts: ErrorFacts): string {
  const deepest = facts.messages.at(-1) ?? 'unknown error'
  const code = facts.codes.at(-1)
  return code ? `${code}: ${deepest}` : deepest
}

function recordTransportFailure(
  span: ActiveSpan,
  operation: string,
  error: unknown
): OrcaCloudTransportError {
  const facts = collectErrorFacts(error)
  const failure = classifyTransportFailure(facts)
  const detail = describeErrorChain(facts)
  span.setAttribute('orcaCloud.transportFailure', failure)
  span.setAttribute('orcaCloud.transportErrorName', facts.names.join(' <- ') || typeof error)
  span.setAttribute('orcaCloud.transportErrorDetail', detail)
  return new OrcaCloudTransportError(failure, operation, detail, { cause: error })
}

/**
 * Issue a first-party Orca Cloud request. Why net.fetch: Chromium's stack uses
 * the OS certificate and proxy configuration and its own socket pool, so the
 * call survives Windows TLS interception and undici's stale keep-alive sockets
 * that global fetch could only report as `fetch failed` (orca#10758).
 */
export async function orcaCloudFetch(
  operation: string,
  url: string,
  init: RequestInit
): Promise<Response> {
  return withSpan(
    'orcaCloud.request',
    async (span) => {
      span.setAttribute('orcaCloud.operation', operation)
      span.setAttribute('orcaCloud.origin', new URL(url).origin)
      await ensureElectronProxyFromEnvironment({
        proxySession: session.defaultSession,
        probeUrl: url
      }).catch((error: unknown) => {
        span.addEvent('orcaCloud.proxySetupFailed', {
          errorMessage: error instanceof Error ? error.message : String(error)
        })
      })
      try {
        // Why the explicit defaults: Chromium would otherwise attach default-
        // session cookies and consult the HTTP cache, neither of which the
        // previous undici path did. Token endpoints authenticate from the body
        // or the Bearer header, so ambient session state stays out of it.
        const response = await net.fetch(url, {
          credentials: 'omit',
          cache: 'no-store',
          ...init
        })
        span.setAttribute('orcaCloud.status', response.status)
        return response
      } catch (error) {
        throw recordTransportFailure(span, operation, error)
      }
    },
    { kind: 'client' }
  )
}
