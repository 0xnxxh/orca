/**
 * Mixed-version compat for `worktree.create` params that name an agent Orca has
 * since retired. Clients and hosts update independently, so an old client keeps
 * sending the retired id — and, when it quotes its own launch, the command that
 * would run the binary this host no longer ships.
 */

/** Agent ids Orca no longer ships but a mixed-version client can still send. */
const RETIRED_STARTUP_AGENTS: readonly unknown[] = ['gemini']

/** Launch binaries of the retired agents above, matched against a prebuilt command. */
const RETIRED_AGENT_LAUNCH_BINARIES: readonly string[] = ['gemini']

/** Every caller-supplied field that together forms one prebuilt agent launch. */
const CALLER_LAUNCH_BUNDLE_KEYS = [
  'startupCommand',
  'startupEnv',
  'startupLaunchConfig',
  'startupCommandDelivery',
  'createdWithAgent'
] as const

/** First bare token of a launch command, without directory, extension, or case. */
function launchBinaryName(command: string): string {
  const token = command.trim().split(/\s+/, 1)[0] ?? ''
  const base = token.split(/[/\\]/).pop() ?? ''
  return base.replace(/\.(?:exe|cmd|bat|ps1)$/i, '').toLowerCase()
}

function namesRetiredAgent(command: unknown): boolean {
  return (
    typeof command === 'string' && RETIRED_AGENT_LAUNCH_BINARIES.includes(launchBinaryName(command))
  )
}

/**
 * Why: an old desktop client quotes its own launch command, so `startupAgent` is
 * absent and only `createdWithAgent` plus the command name identify the agent.
 * `createdWithAgent` is dropped by its own transform while the command survives,
 * which is enough to spawn the retired binary on a host that no longer ships it.
 */
function hasRetiredLaunchBundle(params: Record<string, unknown>): boolean {
  if (RETIRED_STARTUP_AGENTS.includes(params.createdWithAgent)) {
    return true
  }
  if (namesRetiredAgent(params.startupCommand)) {
    return true
  }
  const launchConfig = params.startupLaunchConfig
  return (
    !!launchConfig &&
    typeof launchConfig === 'object' &&
    namesRetiredAgent((launchConfig as Record<string, unknown>).agentCommand)
  )
}

/**
 * Why: `startupPrompt` only travels with a `startupAgent`, so dropping a retired
 * agent orphans its prompt — it would trip the "startupPrompt requires
 * startupAgent" refinement, and dropping both silently discarded the user's task
 * text into a plain shell. Rehome the prompt as `startupDraft` instead: the host
 * then picks the default/detected agent and drafts the text into it rather than
 * auto-submitting to an agent the client never chose.
 */
export function rehomeRetiredStartupAgent(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }
  const params = value as Record<string, unknown>
  const retiredAgent = RETIRED_STARTUP_AGENTS.includes(params.startupAgent)
  const retiredBundle = hasRetiredLaunchBundle(params)
  if (!retiredAgent && !retiredBundle) {
    return value
  }

  const rest = { ...params }
  let rehomedDraft = params.startupDraft
  if (retiredAgent) {
    delete rest.startupAgent
    delete rest.startupPrompt
    // An explicit draft wins; the prompt only fills an empty draft slot.
    rehomedDraft = rehomedDraft || params.startupPrompt
  }
  if (retiredBundle) {
    // Why: the command, its env, and its launch config are one launch, so a
    // partial strip would leave a runnable `gemini …` the host cannot recover
    // an agent choice from. The prompt is quoted inside that command and cannot
    // be unquoted per shell, so this create degrades to the draft path instead.
    for (const key of CALLER_LAUNCH_BUNDLE_KEYS) {
      delete rest[key]
    }
  }
  if (rehomedDraft === undefined) {
    delete rest.startupDraft
  } else {
    rest.startupDraft = rehomedDraft
  }
  return rest
}
