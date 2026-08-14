/**
 * One shape for "this title PRESENTS agent X", shared by every consumer that
 * turns an OSC title into agent identity.
 *
 * Why a registry and not another per-agent predicate: an identity frame is the
 * agent's own name plus, at most, one status word. That shape was already
 * hand-copied per agent (Claude here, Pi/OMP in pi-compatible-synthetic-title,
 * Cursor's closed literal set in agent-title-core), so every new runtime meant a
 * new regex threaded through five call sites. Declaring the names instead keeps
 * the next runtime a one-row change.
 *
 * Why frames and not name tokens: a name inside free-form task text is a
 * mention, not identity, and must never take a pane away from its owner
 * (#8940). Anchoring the whole title is what separates the two.
 */
import { stripLeadingAgentTitleDecorationOrEmpty } from './agent-title-decoration'
import { getWrapperTitleSegments } from './terminal-title-wrapper-segments'
import type { TuiAgent } from './tui-agent'

/** The status words agents append to their own name — Orca's synthetic titles
 *  use the same vocabulary (synthetic-agent-title.ts), so a frame must accept both. */
const IDENTITY_STATUS_WORDS = ['ready', 'idle', 'done', 'working', 'thinking', 'running'] as const

// Why: Windows titles can surface the launcher process name (`cline.cmd`).
const EXECUTABLE_SUFFIX = String.raw`(?:\.(?:exe|cmd|bat|ps1))?`

export type AgentIdentityFrameSpec = {
  /** Lowercase names the agent presents itself under, longest first. */
  names: readonly string[]
  /** Accept a Windows launcher extension after the name. */
  executableSuffix?: boolean
}

export function buildAgentIdentityFrameRe(spec: AgentIdentityFrameSpec): RegExp {
  const names = spec.names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const suffix = spec.executableSuffix ? EXECUTABLE_SUFFIX : ''
  return new RegExp(
    `^(?:${names})${suffix}(?:\\s+(?:${IDENTITY_STATUS_WORDS.join('|')}))?(?:\\s*-\\s*action required)?$`
  )
}

/**
 * Agents identified by the title they write about themselves. Only add a runtime
 * here once its CLI is observed emitting the title — an unobserved name widens
 * the false-positive surface for every ordinary shell title.
 */
export const AGENT_IDENTITY_FRAMES: Partial<Record<TuiAgent, AgentIdentityFrameSpec>> = {
  claude: { names: ['claude code', 'claude'] },
  // Verified against cline 3.0.55: it emits OSC 0 `Cline` and never varies it,
  // so Orca sees identity but no status transitions (STA-3906).
  cline: { names: ['cline'], executableSuffix: true }
}

const IDENTITY_FRAME_RES = new Map<TuiAgent, RegExp>(
  Object.entries(AGENT_IDENTITY_FRAMES).map(([agent, spec]) => [
    agent as TuiAgent,
    buildAgentIdentityFrameRe(spec)
  ])
)

/**
 * Whether `title` presents `agent`, once multiplexer prefixes and leading status
 * decoration are stripped.
 *
 * Why segments: a multiplexer prefix (`zsh | ⠋ Claude Code`) would otherwise read
 * as task text and cost a genuine agent pane its identity.
 */
export function isAgentIdentityFrameTitleFor(
  title: string | null | undefined,
  agent: TuiAgent
): boolean {
  const re = IDENTITY_FRAME_RES.get(agent)
  if (!re || typeof title !== 'string') {
    return false
  }
  return getWrapperTitleSegments(title).some((segment) =>
    re.test(stripLeadingAgentTitleDecorationOrEmpty(segment).trim().toLowerCase())
  )
}

/** The agent a title presents, or null when the title is task text, a path, or a bare shell title. */
export function resolveAgentIdentityFrameType(title: string | null | undefined): TuiAgent | null {
  if (typeof title !== 'string') {
    return null
  }
  for (const agent of IDENTITY_FRAME_RES.keys()) {
    if (isAgentIdentityFrameTitleFor(title, agent)) {
      return agent
    }
  }
  return null
}
