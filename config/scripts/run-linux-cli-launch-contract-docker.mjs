#!/usr/bin/env node
/**
 * Packaged-artifact contract for the Linux CLI: every CLI command must exit
 * with its own status and never die in Chromium startup.
 *
 * Why a container matrix rather than unit tests: the four failures this guards
 * (#11609, #12530, #13719, #14229) are all environmental. They need a host with
 * no /dev/fuse, no display, unprivileged user namespaces restricted, and a
 * chrome-sandbox that is not root-owned setuid. A default Docker container is
 * all four at once, which is why none of them were caught before shipping.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const commandArgs = process.argv.slice(2)
const appImageArg = valueAfter('--appimage')
if (!appImageArg) {
  fail('Usage: run-linux-cli-launch-contract-docker.mjs --appimage /path/to/orca-linux.AppImage')
}
const appImage = resolve(appImageArg)
if (!existsSync(appImage)) {
  fail(`AppImage not found: ${appImage}`)
}

const suffix = `${process.pid}-${Date.now()}`
const artifactVolume = `orca-cli-contract-artifact-${suffix}`
const tag = 'orca-cli-launch-contract:ubuntu-24.04'
const base = 'ubuntu@sha256:4fbb8e6a8395de5a7550b33509421a2bafbc0aab6c06ba2cef9ebffbc7092d90'
const containers = new Set()

// Why each expectation is an exact status: "did not crash" is too weak — a
// command that silently prints nothing and exits 0 would pass that.
const CASES = [
  {
    name: 'nofuse-userns-registered-help',
    expectStatus: 0,
    expectOutput: 'Usage: orca <command>',
    why: 'The registered command must run with no FUSE, no display, and userns restricted (#11609, #12530).'
  },
  {
    name: 'nofuse-userns-registered-version',
    expectStatus: 0,
    expectOutput: /^\d+\.\d+\.\d+/m,
    why: 'A deployment must be able to read the installed version without a display (#13719).'
  },
  {
    name: 'nofuse-userns-registered-status',
    // Why non-zero: no runtime is running in the container. What matters is
    // that the CLI reports that itself rather than the process dying.
    expectStatus: 1,
    expectOutput: 'appRunning',
    why: 'A command that needs the runtime must report its absence, not abort.'
  },
  {
    name: 'nofuse-userns-registered-skills',
    expectStatus: 0,
    expectOutput: 'skills',
    why: 'skills is a pure-text command that must never need Chromium (#14229).'
  },
  {
    name: 'nofuse-userns-registered-worktree',
    expectStatus: 1,
    expectOutput: 'Orca',
    why: 'A runtime-dependent command must report the missing runtime, not abort.'
  },
  {
    name: 'nofuse-nosandbox-direct-binary-skills',
    expectStatus: 0,
    expectOutput: 'skills',
    why: 'A direct binary launch that reaches JavaScript must run the command, not boot a GUI (#14229).'
  },
  {
    name: 'nofuse-nosandbox-direct-binary-gui',
    // Why 1: there is no display, so the app genuinely cannot start. The
    // contract is that it says so — before the fix this was SIGSEGV 139.
    expectStatus: 1,
    expectOutput: 'needs a display server',
    why: 'A desktop launch with no display must diagnose it instead of dying in uv_close (#13719).'
  }
]

try {
  docker(['volume', 'create', artifactVolume])
  buildImage()
  stageArtifacts()
  runContract()
  console.log('\nLinux CLI launch contract passed.')
} finally {
  for (const container of containers) {
    docker(['rm', '-f', container], { allowFailure: true })
  }
  docker(['volume', 'rm', artifactVolume], { allowFailure: true })
}

function runContract() {
  const failures = []
  for (const testCase of CASES) {
    const output = runCase(testCase.name)
    const statusMatch = /^RESULT status=(\d+)/m.exec(output)
    if (!statusMatch) {
      failures.push(`${testCase.name}: ${firstLine(output)}\n    ${testCase.why}`)
      console.log(`  FAIL ${testCase.name} — ${firstLine(output)}`)
      continue
    }
    const status = Number(statusMatch[1])
    const matchesOutput =
      typeof testCase.expectOutput === 'string'
        ? output.includes(testCase.expectOutput)
        : testCase.expectOutput.test(output)
    if (status !== testCase.expectStatus || !matchesOutput) {
      failures.push(
        `${testCase.name}: expected status ${testCase.expectStatus} and ${testCase.expectOutput}, ` +
          `got status ${status}\n    ${testCase.why}`
      )
      console.log(`  FAIL ${testCase.name} — status ${status}`)
      continue
    }
    console.log(`  ok   ${testCase.name} (status ${status})`)
  }
  if (failures.length > 0) {
    fail(`Linux CLI launch contract failed:\n  - ${failures.join('\n  - ')}`)
  }
}

function runCase(caseName) {
  const container = `orca-cli-contract-${caseName}-${suffix}`
  containers.add(container)
  // Why no --device /dev/fuse and no added capabilities: the absent device and
  // the unavailable user namespace ARE the test conditions.
  return docker(
    ['run', '--name', container, '--rm', '-v', `${artifactVolume}:/artifacts`, tag, caseName],
    { allowFailure: true, capture: true }
  )
}

function buildImage() {
  console.log(`Building ${tag}…`)
  docker([
    'build',
    '--build-arg',
    `BASE_IMAGE=${base}`,
    '-f',
    'config/docker/cli-launch-contract/Dockerfile',
    '-t',
    tag,
    '.'
  ])
}

/**
 * Extracts the payload as the unprivileged `orca` user, which reproduces the
 * install shape that matters: a tree whose chrome-sandbox is not root-owned
 * setuid, reached with no FUSE device present.
 */
function stageArtifacts() {
  console.log('Staging the AppImage payload…')
  const container = `orca-cli-contract-stage-${suffix}`
  containers.add(container)
  docker([
    'run',
    '--name',
    container,
    '--rm',
    '-v',
    `${artifactVolume}:/artifacts`,
    '-v',
    `${appImage}:/input/orca-linux.AppImage:ro`,
    '--entrypoint',
    'bash',
    tag,
    '-lc',
    [
      'set -euo pipefail',
      'cp /input/orca-linux.AppImage /artifacts/orca-linux.AppImage',
      'chmod +x /artifacts/orca-linux.AppImage',
      'chown -R orca:orca /artifacts',
      // --appimage-extract is the AppImage runtime's own no-FUSE path.
      'cd /artifacts && runuser --user orca -- ./orca-linux.AppImage --appimage-extract >/dev/null',
      'test -x /artifacts/squashfs-root/resources/bin/orca-ide'
    ].join(' && ')
  ])
}

function docker(args, options = {}) {
  try {
    const output = execFileSync('docker', args, {
      encoding: 'utf8',
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
    })
    return output ?? ''
  } catch (error) {
    if (!options.allowFailure) {
      fail(
        `docker ${args.join(' ')} failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    return `${error?.stdout ?? ''}${error?.stderr ?? ''}`
  }
}

function firstLine(value) {
  return (value ?? '').trim().split('\n')[0] || '(no output)'
}

function valueAfter(flag) {
  const index = commandArgs.indexOf(flag)
  return index === -1 ? null : (commandArgs[index + 1] ?? null)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
