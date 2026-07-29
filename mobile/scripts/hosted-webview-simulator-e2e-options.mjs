import process from 'node:process'

const usage =
  'Usage: node scripts/run-hosted-webview-simulator-e2e.mjs [--device <name|udid>] [--timeout-ms <ms>] [--accounts-only] [--security-only] [--isolation-only] [--clipboard-image-only] [--photos-revocation-only] [--files-preview-only] [--native-settings-only] [--source-control-only] [--skip-native-build]'

export function parseHostedWebViewSimulatorE2eOptions(args) {
  const parsed = {
    accountsOnly: false,
    clipboardImageOnly: false,
    device: 'iPhone 17 Pro',
    filesPreviewOnly: false,
    isolationOnly: false,
    nativeSettingsOnly: false,
    photosRevocationOnly: false,
    securityOnly: false,
    skipNativeBuild: false,
    sourceControlOnly: false,
    timeoutMs: 180_000
  }
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--') {
      continue
    } else if (args[index] === '--device' && args[index + 1]) {
      parsed.device = args[++index]
    } else if (args[index] === '--timeout-ms' && args[index + 1]) {
      parsed.timeoutMs = Number(args[++index])
    } else if (args[index] === '--accounts-only') {
      parsed.accountsOnly = true
    } else if (args[index] === '--security-only') {
      parsed.securityOnly = true
    } else if (args[index] === '--isolation-only') {
      parsed.isolationOnly = true
    } else if (args[index] === '--clipboard-image-only') {
      parsed.clipboardImageOnly = true
    } else if (args[index] === '--photos-revocation-only') {
      parsed.photosRevocationOnly = true
    } else if (args[index] === '--files-preview-only') {
      parsed.filesPreviewOnly = true
    } else if (args[index] === '--native-settings-only') {
      parsed.nativeSettingsOnly = true
    } else if (args[index] === '--source-control-only') {
      parsed.sourceControlOnly = true
    } else if (args[index] === '--skip-native-build') {
      parsed.skipNativeBuild = true
    } else if (args[index] === '--help' || args[index] === '-h') {
      console.log(usage)
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${args[index]}`)
    }
  }
  if (!Number.isInteger(parsed.timeoutMs) || parsed.timeoutMs < 10_000) {
    throw new Error('--timeout-ms must be an integer of at least 10000')
  }
  if (
    [
      parsed.accountsOnly,
      parsed.clipboardImageOnly,
      parsed.isolationOnly,
      parsed.securityOnly,
      parsed.filesPreviewOnly,
      parsed.nativeSettingsOnly,
      parsed.photosRevocationOnly,
      parsed.sourceControlOnly
    ].filter(Boolean).length > 1
  ) {
    throw new Error('Focused journey options are mutually exclusive')
  }
  parsed.securityOnly ||=
    parsed.clipboardImageOnly || parsed.isolationOnly || parsed.photosRevocationOnly
  return parsed
}
