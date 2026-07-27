import { describe, expect, it, vi } from 'vitest'
import { prepareCodexSessionResume } from './codex-session-resume-preparation'

const SESSION_ID = '019f81b9-19a9-7651-a8d1-352d9420bd11'
const ORIGIN_HOME = '/managed/origin/home'
const ORIGIN_ROLLOUT = `${ORIGIN_HOME}/sessions/2026/07/20/rollout-2026-07-20T12-00-00-${SESSION_ID}.jsonl`

function prepare(args: {
  transcriptPath: string | undefined
  trustedCodexHomes: readonly string[]
  resolveVerifiedResumeHome?: (source: { homePath: string }) => Promise<string>
}) {
  return prepareCodexSessionResume({
    sessionId: SESSION_ID,
    transcriptPath: args.transcriptPath,
    trustedCodexHomes: args.trustedCodexHomes,
    fileIsRegular: () => true,
    resolveVerifiedResumeHome: args.resolveVerifiedResumeHome ?? (async (source) => source.homePath)
  })
}

describe('prepareCodexSessionResume', () => {
  it('pins the verified origin home the caller resolved', async () => {
    const resolveVerifiedResumeHome = vi.fn(async () => '/managed/migrated/home')

    await expect(
      prepare({
        transcriptPath: ORIGIN_ROLLOUT,
        trustedCodexHomes: [ORIGIN_HOME],
        resolveVerifiedResumeHome
      })
    ).resolves.toEqual({ outcome: 'resume', codexHomePath: '/managed/migrated/home' })
    expect(resolveVerifiedResumeHome).toHaveBeenCalledWith({
      homePath: ORIGIN_HOME,
      transcriptPath: ORIGIN_ROLLOUT
    })
  })

  it('falls back to a fresh session when the rollout home is not trusted', async () => {
    // Why: returning `resume` here is exactly the #10793 bug — the pane would resume
    // under whichever account is selected now.
    const resolveVerifiedResumeHome = vi.fn(async (source: { homePath: string }) => source.homePath)

    await expect(
      prepare({
        transcriptPath: ORIGIN_ROLLOUT,
        trustedCodexHomes: ['/managed/other/home'],
        resolveVerifiedResumeHome
      })
    ).resolves.toEqual({ outcome: 'fresh', claimedCodexProvenance: true })
    // Migration, project trust and hook repair must not run without a verified home.
    expect(resolveVerifiedResumeHome).not.toHaveBeenCalled()
  })

  it('marks cross-agent metadata as never having claimed Codex provenance', async () => {
    await expect(
      prepare({
        transcriptPath: '/Users/example/.claude/projects/repo/x.jsonl',
        trustedCodexHomes: [ORIGIN_HOME]
      })
    ).resolves.toEqual({ outcome: 'fresh', claimedCodexProvenance: false })
  })

  it('marks a resume with no transcript path as unclaimed but still fresh', async () => {
    await expect(
      prepare({ transcriptPath: undefined, trustedCodexHomes: [ORIGIN_HOME] })
    ).resolves.toEqual({ outcome: 'fresh', claimedCodexProvenance: false })
  })
})
