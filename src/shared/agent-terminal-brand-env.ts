import type { TuiAgent } from './types'

/**
 * Agents that gate OSC 8 hyperlink emission on a `TERM_PROGRAM` allowlist which
 * has no Orca entry, and whose renderer is xterm.js-compatible.
 *
 * grok resolves a whole capability profile from `TERM_PROGRAM`. `Orca` is not in
 * its table, so the brand falls back to `Unknown`, which is fail-closed: it
 * reports `osc8: Unknown` and suppresses every hyperlink. grok has already
 * computed each link's row, column span, and URL by then — it just discards
 * them, so Orca has to re-derive URLs from raw cell text and gets wrapped ones
 * wrong.
 *
 * `vscode` is the correct claim rather than a convenient one. Of the brands grok
 * treats as OSC 8-native, the VS Code family is the only profile written *for*
 * xterm.js, which is what Orca renders with:
 *
 * - It skips Kitty keyboard protocol negotiation, because xterm.js mis-encodes
 *   shifted printable keys (xtermjs/xterm.js#5823). Claiming a terminal-native
 *   brand such as WezTerm or Ghostty would make grok negotiate KKP against a
 *   renderer that mishandles it — trading a link bug for an input bug.
 * - It is the only native profile setting `native_link_hover`, which tells grok
 *   to stop painting its own modifier-hover highlight and defer to the terminal.
 *   That removes the split where grok highlighted one URL and Orca opened
 *   another.
 * - It enables the OSC 8 `id=` parameter, which is what lets a terminal group a
 *   single link across the rows a TUI wrapped it onto.
 *
 * The KKP skip costs nothing: `Unknown` skips it too, so Shift+Enter already
 * falls back to Alt+Enter today.
 *
 * This is a stopgap. The durable fix is an Orca entry in grok's own brand table;
 * see docs/reference/terminal-hyperlink-brand-advertising.md.
 */
const XTERM_JS_BRAND_AGENTS = new Set<TuiAgent>(['grok'])

const XTERM_JS_TERM_PROGRAM = 'vscode'

/**
 * The `TERM_PROGRAM` to advertise to a launching agent, or `null` to keep
 * Orca's own identity.
 *
 * Scoped per agent on purpose: `TERM_PROGRAM` is read by everything spawned in a
 * terminal, so Orca must not misreport itself process-wide to satisfy one TUI.
 */
export function getAgentTerminalBrandOverride(agent: TuiAgent | null | undefined): string | null {
  return agent && XTERM_JS_BRAND_AGENTS.has(agent) ? XTERM_JS_TERM_PROGRAM : null
}

/**
 * Applies the brand override in place. `ORCA_TERM_PROGRAM` preserves Orca's true
 * identity so tooling that wants it (and Orca's own shell integration) can still
 * tell where it is running.
 */
export function applyAgentTerminalBrandEnv(
  env: Record<string, string>,
  agent: TuiAgent | null | undefined
): void {
  const brand = getAgentTerminalBrandOverride(agent)
  if (!brand) {
    return
  }
  env.ORCA_TERM_PROGRAM = env.TERM_PROGRAM ?? 'Orca'
  env.TERM_PROGRAM = brand
}
