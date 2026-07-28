import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

if (process.platform !== 'darwin') {
  throw new Error('Packaged hosted iOS WebView automation requires macOS and Xcode.')
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
if (process.env.SKIP_BUILD !== '1') {
  run(pnpm, ['run', 'build:desktop'])
  run(pnpm, ['run', 'ensure:electron-runtime'])
  run(pnpm, [
    'exec',
    'electron-builder',
    '--config',
    'config/electron-builder.config.cjs',
    '--mac',
    '--dir'
  ])
}

const resourcesPath = findPackagedResourcesPath()
run(
  process.execPath,
  ['config/scripts/run-hosted-mobile-webview-ssh-e2e.mjs', ...process.argv.slice(2)],
  {
    ...process.env,
    ORCA_E2E_PACKAGED_MOBILE_WEB_RESOURCES: resourcesPath,
    SKIP_BUILD: '1'
  }
)

function findPackagedResourcesPath() {
  const dist = resolve('dist')
  const candidates = readdirSync(dist, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('mac'))
    .map((entry) => ({
      name: entry.name,
      resourcesPath: join(dist, entry.name, 'Orca.app', 'Contents', 'Resources')
    }))
    .filter(({ resourcesPath }) => existsSync(join(resourcesPath, 'mobile-web', 'manifest.json')))
  const preferredName = process.arch === 'arm64' ? 'mac-arm64' : 'mac'
  const selected =
    candidates.find((candidate) => candidate.name === preferredName) ??
    (candidates.length === 1 ? candidates[0] : null)
  if (!selected) {
    throw new Error(
      `Expected one unpacked macOS package with mobile-web resources; found ${candidates.length}.`
    )
  }
  return selected.resourcesPath
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio: 'inherit'
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
