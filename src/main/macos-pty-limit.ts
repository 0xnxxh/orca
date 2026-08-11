import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  MACOS_PTY_LIMIT_DEFAULT,
  MACOS_PTY_LIMIT_MAXIMUM,
  type MacosPtyLimitAvailableStatus,
  type MacosPtyLimitIncreaseResult,
  type MacosPtyLimitStatus
} from '../shared/macos-pty-limit'

const execFileAsync = promisify(execFile)
const PTY_LIMIT_SYSCTL = 'kern.tty.ptmx_max'
const SYSCTL_PATH = '/usr/sbin/sysctl'
const OSASCRIPT_PATH = '/usr/bin/osascript'
const INCREASE_SCRIPT =
  'do shell script "/usr/sbin/sysctl -w kern.tty.ptmx_max=999" with administrator privileges'

type CommandResult = { stdout: string; stderr: string }
type CommandRunner = (file: string, args: readonly string[]) => Promise<CommandResult>

type MacosPtyLimitServiceOptions = {
  platform?: NodeJS.Platform
  runCommand?: CommandRunner
  logger?: Pick<Console, 'warn'>
}

async function runCommand(file: string, args: readonly string[]): Promise<CommandResult> {
  const result = await execFileAsync(file, [...args], { encoding: 'utf8' })
  return { stdout: result.stdout, stderr: result.stderr }
}

function availableStatus(currentLimit: number): MacosPtyLimitAvailableStatus {
  return {
    state: 'available',
    currentLimit,
    defaultLimit: MACOS_PTY_LIMIT_DEFAULT,
    maximumLimit: MACOS_PTY_LIMIT_MAXIMUM
  }
}

function isAdministratorPromptCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  const stderr =
    'stderr' in error && typeof (error as { stderr?: unknown }).stderr === 'string'
      ? (error as { stderr: string }).stderr
      : ''
  return `${error.message}\n${stderr}`.includes('(-128)')
}

export class MacosPtyLimitService {
  private readonly platform: NodeJS.Platform
  private readonly runCommand: CommandRunner
  private readonly logger: Pick<Console, 'warn'>
  private increaseInFlight: Promise<MacosPtyLimitIncreaseResult> | null = null

  constructor(options: MacosPtyLimitServiceOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.runCommand = options.runCommand ?? runCommand
    this.logger = options.logger ?? console
  }

  async getStatus(): Promise<MacosPtyLimitStatus> {
    if (this.platform !== 'darwin') {
      return { state: 'unsupported' }
    }
    try {
      const { stdout } = await this.runCommand(SYSCTL_PATH, ['-n', PTY_LIMIT_SYSCTL])
      const currentLimit = Number(stdout.trim())
      if (!Number.isInteger(currentLimit) || currentLimit < 1) {
        throw new Error(`Unexpected PTY limit: ${stdout.trim()}`)
      }
      return availableStatus(currentLimit)
    } catch (error) {
      this.logger.warn('[macos-pty-limit] failed to read system PTY limit', { error })
      return { state: 'unavailable' }
    }
  }

  increaseToMaximum(): Promise<MacosPtyLimitIncreaseResult> {
    if (this.increaseInFlight) {
      return this.increaseInFlight
    }
    this.increaseInFlight = this.performIncrease().finally(() => {
      this.increaseInFlight = null
    })
    return this.increaseInFlight
  }

  private async performIncrease(): Promise<MacosPtyLimitIncreaseResult> {
    if (this.platform !== 'darwin') {
      return { outcome: 'unsupported' }
    }
    const currentStatus = await this.getStatus()
    if (currentStatus.state !== 'available') {
      return { outcome: 'failed' }
    }
    if (currentStatus.currentLimit >= MACOS_PTY_LIMIT_MAXIMUM) {
      return { outcome: 'already-maximum', status: currentStatus }
    }

    try {
      await this.runCommand(OSASCRIPT_PATH, ['-e', INCREASE_SCRIPT])
    } catch (error) {
      if (isAdministratorPromptCancellation(error)) {
        return { outcome: 'cancelled' }
      }
      this.logger.warn('[macos-pty-limit] administrator command failed', { error })
      return { outcome: 'failed' }
    }

    const verifiedStatus = await this.getStatus()
    if (
      verifiedStatus.state !== 'available' ||
      verifiedStatus.currentLimit !== MACOS_PTY_LIMIT_MAXIMUM
    ) {
      this.logger.warn('[macos-pty-limit] system PTY limit verification failed', {
        verifiedStatus
      })
      return { outcome: 'failed' }
    }
    return { outcome: 'increased', status: verifiedStatus }
  }
}
