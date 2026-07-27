import { globSync, readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const workflow = parse(readFileSync('.github/workflows/pr.yml', 'utf8'))
const dependencyAction = parse(
  readFileSync('.github/actions/install-node-dependencies/action.yml', 'utf8')
)
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const shellContractFiles = [
  'src/main/daemon/shell-ready.test.ts',
  'src/main/providers/local-pty-shell-ready.test.ts',
  'src/main/providers/__tests__/shell-ready-framework-example.test.ts',
  'src/shared/posix-command-path-lookup.test.ts'
]
const patchedNodePtyContractFiles = [
  'src/main/daemon/node-pty-fd-leak.test.ts',
  'src/main/pty/omp-shell-wrapper.node-pty.test.ts'
]
const nativeShellContractFiles = [...shellContractFiles, ...patchedNodePtyContractFiles]
const testFilePatterns = [
  'config/**/*.{test,spec}.{js,cjs,mjs,ts,tsx}',
  'src/**/*.{test,spec}.{js,cjs,mjs,ts,tsx}',
  'tests/**/*.{test,spec}.{js,cjs,mjs,ts,tsx}',
  'tools/**/*.{test,spec}.{js,cjs,mjs,ts,tsx}'
]
const realZshUsage =
  /(?:spawnSync|execFileSync|spawn)\(\s*['"](?:\/(?:usr\/)?bin\/)?zsh['"]|spawnSync\(\s*['"]which['"]\s*,\s*\[\s*['"]zsh['"]|name:\s*['"]zsh['"]\s*,\s*path:\s*executablePath/

describe('PR workflow parallelism', () => {
  it('cancels superseded runs for the same pull request', () => {
    expect(workflow.concurrency.group).toBe('pr-checks-${{ github.event.pull_request.number }}')
    expect(workflow.concurrency['cancel-in-progress']).toBe(true)
  })

  it('shards the general test suite across sixteen runners', () => {
    expect(workflow.jobs.test.strategy.matrix.shard).toEqual(
      Array.from({ length: 16 }, (_, index) => index + 1)
    )
    const testStep = workflow.jobs.test.steps.find((step) => step.name === 'Test shard')

    expect(testStep.run).toContain('--shard=${{ matrix.shard }}/${{ strategy.job-total }}')
    for (const testFile of nativeShellContractFiles) {
      expect(testStep.run).toContain(`--exclude=${testFile}`)
    }
  })

  it('runs real-zsh coverage once outside the general shards', () => {
    const shellStep = workflow.jobs.shell_contracts.steps.find(
      (step) => step.name === 'Test real shell contracts'
    )

    expect(workflow.jobs.test.steps.some((step) => step.name === 'Install zsh')).toBe(false)
    expect(workflow.jobs.shell_contracts.steps.some((step) => step.name === 'Install zsh')).toBe(
      true
    )
    for (const testFile of nativeShellContractFiles) {
      expect(shellStep.run).toContain(testFile)
    }
    expect(shellStep.run).toContain('ensure-native-runtime.mjs --runtime=node')
  })

  it('keeps every real-zsh test in the dedicated shell lane', () => {
    const discoveredFiles = globSync(testFilePatterns)
      .filter((testFile) => realZshUsage.test(readFileSync(testFile, 'utf8')))
      .sort()

    expect(discoveredFiles).toEqual([...shellContractFiles].sort())
  })

  it('overlaps bundles with independent output directories', () => {
    const buildStep = workflow.jobs.package.steps.find(
      (step) => step.name === 'Build package inputs'
    )

    expect(buildStep.run).toContain('scripts=(build:relay build:electron-vite:parallel)')
    expect(buildStep.run).toContain('pnpm run ensure:electron-runtime &')
    expect(buildStep.run).toContain('pnpm run "$script" &')
    expect(
      workflow.jobs.package.steps.find(
        (step) => step.name === 'Project web client from renderer build'
      ).run
    ).toBe('pnpm run build:web-from-renderer')
    expect(packageJson.scripts['build:desktop']).toContain('pnpm run build:web-from-renderer')
    expect(packageJson.scripts['build:release']).toContain('pnpm run build:web-from-renderer')
  })

  it('restores the pnpm store before dependency installation', () => {
    const steps = dependencyAction.runs.steps
    const pnpmIndex = steps.findIndex((step) => step.name === 'Setup pnpm')
    const nodeIndex = steps.findIndex((step) => step.name === 'Setup Node.js')

    expect(pnpmIndex).toBeLessThan(nodeIndex)
    expect(steps[nodeIndex].with.cache).toBe('pnpm')
  })

  it('skips lifecycle scripts outside native-runtime test setup', () => {
    for (const jobName of [
      'static_analysis',
      'typecheck',
      'git_compatibility',
      'test',
      'package'
    ]) {
      const installStep = workflow.jobs[jobName].steps.find(
        (step) => step.uses === './.github/actions/install-node-dependencies'
      )
      expect(installStep.with['ignore-scripts'], jobName).toBe('true')
    }

    const shellInstall = workflow.jobs.shell_contracts.steps.find(
      (step) => step.uses === './.github/actions/install-node-dependencies'
    )
    expect(shellInstall.with).toBeUndefined()
    expect(
      dependencyAction.runs.steps.find((step) => step.name === 'Use external node-gyp').if
    ).toBe("inputs.ignore-scripts != 'true'")
    const dependencyInstall = dependencyAction.runs.steps.find(
      (step) => step.name === 'Install dependencies'
    )
    expect(dependencyInstall.env.IGNORE_SCRIPTS).toBe('${{ inputs.ignore-scripts }}')
    expect(dependencyInstall.run).toContain(
      '--no-frozen-lockfile --prefer-frozen-lockfile=false --os=current --os=win32 --cpu=current'
    )
    expect(dependencyInstall.run).toContain('install_args+=(--ignore-scripts)')
    expect(workflow.jobs.test.steps.find((step) => step.name === 'Test shard').run).not.toContain(
      'ensure-native-runtime'
    )
  })

  it('reuses native preparation only after the concurrent runtime gate', () => {
    const buildStep = workflow.jobs.package.steps.find(
      (step) => step.name === 'Build package inputs'
    )
    const packageStep = workflow.jobs.package.steps.find(
      (step) => step.name === 'Package unpacked app'
    )

    expect(buildStep.run).toContain('pnpm run ensure:electron-runtime &')
    expect(packageStep.env.ORCA_REUSE_PREPARED_NATIVE_RUNTIME).toBe('1')
  })

  it('keeps verify as the aggregate required check', () => {
    expect(workflow.jobs.verify.needs).toEqual([
      'static_analysis',
      'typecheck',
      'git_compatibility',
      'shell_contracts',
      'test',
      'package'
    ])
  })
})
