import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readAgentSessionRenamedTitle } from './agent-session-rename-title-read'

let tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })))
  tempRoots = []
})

async function writeTranscript(lines: readonly unknown[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-agent-rename-'))
  tempRoots.push(root)
  const transcriptPath = join(root, 'session.jsonl')
  await writeFile(transcriptPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)
  return transcriptPath
}

describe('readAgentSessionRenamedTitle', () => {
  it('finds the rename recorded after the auto-generated title', async () => {
    const transcriptPath = await writeTranscript([
      { type: 'user', message: { role: 'user', content: 'What is 2+2? Answer in one word.' } },
      { type: 'ai-title', aiTitle: 'Answer simple arithmetic question' },
      { type: 'custom-title', customTitle: 'billing-fix' },
      { type: 'agent-name', agentName: 'billing-fix' }
    ])
    await expect(readAgentSessionRenamedTitle({ transcriptPath })).resolves.toBe('billing-fix')
  })

  it('resolves null for a session with only auto-generated titles', async () => {
    const transcriptPath = await writeTranscript([
      { type: 'ai-title', aiTitle: 'Answer simple arithmetic question' }
    ])
    await expect(readAgentSessionRenamedTitle({ transcriptPath })).resolves.toBeNull()
  })

  it('resolves null instead of rejecting when the transcript is gone', async () => {
    await expect(
      readAgentSessionRenamedTitle({ transcriptPath: join(tmpdir(), 'orca-missing-session.jsonl') })
    ).resolves.toBeNull()
  })

  it('ignores an empty transcript path', async () => {
    await expect(readAgentSessionRenamedTitle({ transcriptPath: '  ' })).resolves.toBeNull()
  })
})
