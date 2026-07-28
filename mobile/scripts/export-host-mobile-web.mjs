import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const mobileRoot = path.resolve(import.meta.dirname, '..')
const outputArgument = process.argv.slice(2).find((value) => value !== '--')
const outputDirectory = path.resolve(mobileRoot, outputArgument ?? '../out/mobile-web-rnw-proof')
const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

const child = spawn(
  packageManager,
  ['exec', 'expo', 'export', '--platform', 'web', '--output-dir', outputDirectory],
  {
    cwd: mobileRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      ORCA_EXPO_ROUTER_ROOT: 'host-web-app'
    },
    stdio: 'inherit'
  }
)

child.on('error', (error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Expo web export terminated by ${signal}`)
    process.exitCode = 1
    return
  }
  process.exitCode = code ?? 1
})
