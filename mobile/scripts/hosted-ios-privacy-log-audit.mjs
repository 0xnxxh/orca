import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const markerPatterns = {
  privilegedField: /\b(?:deviceToken|publicKeyB64|hostIdentity|credential-secret)\b/gi,
  tokenStorage: /orca(?:\.host-token\.|:web-host-token:)/gi,
  nativeAuthority:
    /(?:openHostLogicalClient|scheduleHostCredentialCleanup|resolvePairingHostIdentity)/g,
  privateOriginUrl: /orca-mobile-web:\/\/[A-Za-z0-9_-]{20,}/g,
  webSocketUrl: /wss?:\/\/[^\s"'<>]+/gi,
  fixtureMarker: /\b(?:EXPO_PUBLIC_)?ORCA_E2E_[A-Z0-9_]+\b/g
}

export async function verifyHostedIosPrivacyLogs({ deviceUdid, startedAt }) {
  const { stdout } = await execFileAsync(
    'xcrun',
    [
      'simctl',
      'spawn',
      deviceUdid,
      'log',
      'show',
      '--start',
      hostedIosLogStartTime(startedAt),
      '--style',
      'compact',
      '--predicate',
      'process == "Orca"'
    ],
    {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 30_000
    }
  )
  return hostedIosPrivacyLogEvidence(stdout)
}

export function hostedIosLogStartTime(value) {
  const date = new Date(value)
  const part = (number) => String(number).padStart(2, '0')
  return `${[date.getFullYear(), part(date.getMonth() + 1), part(date.getDate())].join('-')} ${part(
    date.getHours()
  )}:${part(date.getMinutes())}:${part(date.getSeconds())}`
}

export function hostedIosPrivacyLogEvidence(source) {
  const counts = Object.fromEntries(
    Object.entries(markerPatterns).map(([name, pattern]) => [
      name,
      source.match(pattern)?.length ?? 0
    ])
  )
  if (Object.values(counts).some((count) => count > 0)) {
    throw new Error(`Hosted iOS privacy log audit failed: ${JSON.stringify(counts)}`)
  }
  return { logBytes: Buffer.byteLength(source), counts }
}
