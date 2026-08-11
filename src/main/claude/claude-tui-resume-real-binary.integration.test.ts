import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import * as pty from 'node-pty'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { resolveClaudeCommand } from '../codex-cli/command'
import { buildClaudeChildProcessEnv } from './claude-child-process-environment'
import { CLAUDE_DEFAULT_SETTING_SOURCES } from './claude-structured-launch-resolution'
import { createClaudeTuiResumeLaunchBuilder } from './claude-tui-resume-launch'
import { proveClaudeTuiResume } from './claude-tui-resume-proof'

const command = resolveClaudeCommand()
const claudeAvailable =
  spawnSync(command, ['--version'], { stdio: 'ignore', timeout: 5_000 }).status === 0
const roots: string[] = []
const transcripts: string[] = []

function shellQuote(value: string): string {
  return process.platform === 'win32'
    ? `"${value.replace(/"/g, '""')}"`
    : `'${value.replace(/'/g, `'"'"'`)}'`
}

async function installCaptureHook(
  root: string
): Promise<{ eventsPath: string; settingsPath: string }> {
  const scriptPath = join(root, 'capture-session-start.cjs')
  const eventsPath = join(root, 'session-start.jsonl')
  const settingsPath = join(root, 'settings.json')
  await writeFile(
    scriptPath,
    [
      "const { appendFileSync } = require('node:fs')",
      "let input = ''",
      "process.stdin.setEncoding('utf8')",
      "process.stdin.on('data', (chunk) => { input += chunk })",
      "process.stdin.on('end', () => {",
      '  const payload = JSON.parse(input)',
      '  payload.launchToken = process.env.ORCA_AGENT_LAUNCH_TOKEN',
      '  appendFileSync(process.argv[2], `${JSON.stringify(payload)}\\n`)',
      '})',
      ''
    ].join('\n')
  )
  await writeFile(
    settingsPath,
    JSON.stringify({
      theme: 'dark',
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: 'command',
                command: [process.execPath, scriptPath, eventsPath].map(shellQuote).join(' ')
              }
            ]
          }
        ]
      }
    })
  )
  return { eventsPath, settingsPath }
}

async function waitForHook(
  eventsPath: string,
  source: 'startup' | 'resume'
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const contents = await readFile(eventsPath, 'utf8').catch(() => '')
    for (const line of contents.split(/\r?\n/)) {
      if (!line.trim()) {
        continue
      }
      const event = JSON.parse(line) as Record<string, unknown>
      if (event.hook_event_name === 'SessionStart' && event.source === source) {
        return event
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Claude did not emit a ${source} SessionStart hook`)
}

type RunningTui = { proc: pty.IPty; exited: Promise<void> }

function spawnTui(args: string[], env: Record<string, string>): RunningTui {
  const proc = pty.spawn(command, args, {
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd: process.cwd(),
    env: { ...env, TERM: 'xterm-256color' }
  })
  return { proc, exited: new Promise<void>((resolve) => proc.onExit(() => resolve())) }
}

async function stopTui(tui: RunningTui): Promise<void> {
  try {
    tui.proc.kill('SIGKILL')
  } catch {
    return
  }
  await Promise.race([
    tui.exited,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error('Claude TUI did not exit after cleanup')), 5_000)
    )
  ])
}

afterEach(async () => {
  await Promise.all(transcripts.splice(0).map((path) => rm(path, { force: true })))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe.skipIf(!claudeAvailable)('real Claude TUI resume proof', () => {
  it('resumes one session id and proves its SessionStart transcript path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-claude-tui-resume-'))
    roots.push(root)
    const { eventsPath, settingsPath } = await installCaptureHook(root)
    const providerSessionId = randomUUID()
    const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
    const settingSources = CLAUDE_DEFAULT_SETTING_SOURCES.join(',')
    const created = spawnTui(
      [
        '--setting-sources',
        settingSources,
        '--settings',
        settingsPath,
        '--session-id',
        providerSessionId
      ],
      buildClaudeChildProcessEnv({
        CLAUDE_CONFIG_DIR: claudeConfigDir,
        ORCA_AGENT_LAUNCH_TOKEN: 'real-create'
      })
    )
    let createdOutput = ''
    created.proc.onData((data) => {
      createdOutput = `${createdOutput}${data}`.slice(-4_000)
    })
    for (const delay of [500, 1_500, 2_500]) {
      setTimeout(() => {
        created.proc.write('\r')
        created.proc.write('\u001b[13u')
      }, delay).unref()
    }
    let resumed: RunningTui | null = null
    try {
      const started = await waitForHook(eventsPath, 'startup').catch((error) => {
        throw new Error(`${String(error)}\nClaude output: ${createdOutput}`)
      })
      expect(started.session_id).toBe(providerSessionId)
      const transcriptPath = String(started.transcript_path)
      transcripts.push(transcriptPath)
      await stopTui(created)
      const fixtureLeafUuid = randomUUID()
      await writeFile(
        transcriptPath,
        `${JSON.stringify({
          parentUuid: null,
          isSidechain: false,
          type: 'user',
          message: { role: 'user', content: 'Orca resume proof fixture' },
          uuid: fixtureLeafUuid,
          timestamp: new Date().toISOString(),
          cwd: process.cwd(),
          sessionId: providerSessionId,
          version: '2.1.220'
        })}\n${JSON.stringify({ type: 'last-prompt', leafUuid: fixtureLeafUuid })}\n`
      )

      const record = {
        sessionId: 'orca-real-claude-resume',
        provider: 'claude',
        location: { workspaceId: 'workspace-real' },
        accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: claudeConfigDir },
        providerHandleChain: [
          {
            linkId: 'created-real',
            handle: { provider: 'claude', sessionId: providerSessionId, leafUuid: null },
            origin: 'created',
            mintedAtFence: 1,
            observedAt: 1
          }
        ]
      } as AgentSessionRecord
      const launch = await createClaudeTuiResumeLaunchBuilder({
        resolveWorkspacePath: async () => process.cwd(),
        resolveCommand: () => command
      })({ record, spawnToken: 'real-resume' })
      resumed = spawnTui([...launch.args, '--settings', settingsPath], launch.env)
      let resumedOutput = ''
      resumed.proc.onData((data) => {
        resumedOutput = `${resumedOutput}${data}`.slice(-4_000)
      })

      await expect(
        proveClaudeTuiResume({
          expectedSessionId: providerSessionId,
          expectedTranscriptPath: transcriptPath,
          expectedLaunchToken: 'real-resume',
          waitForSessionStart: () => waitForHook(eventsPath, 'resume')
        }).catch((error) => {
          throw new Error(`${String(error)}\nClaude output: ${resumedOutput}`)
        })
      ).resolves.toMatchObject({ sessionId: providerSessionId, transcriptPath })
    } finally {
      await stopTui(resumed ?? created)
    }
  }, 30_000)
})
