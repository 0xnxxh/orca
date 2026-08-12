// Why: OpenCode abbreviates native OSC session titles as `OC | <task>` (no
// agent-name token). Optional single-token multiplexer prefix covers SSH/tmux
// frames like `tmux | OC | …`. Case-sensitive `OC` avoids ordinary lowercase
// "oc" lookalikes; require non-whitespace after the marker so bare `OC |` is not
// identity. The separator is the literal ` | ` OpenCode emits — an unspaced `OC|x`
// is some other tool's pipe-delimited title, not a send target. Used for both
// display-title preservation and tab-agent identity.
// Leading `\s*` stands in for a trim(): one OSC frame fans this predicate out
// across status, identity, agent-type and tab-title resolution, so the trimmed
// copy was pure allocation. Trailing space never mattered — nothing anchors $.
const OPENCODE_NATIVE_TITLE_RE = /^\s*(?:[^|\s]+ \| )?OC \| \S/u

export function isOpenCodeNativeTitle(title: string | null | undefined): boolean {
  return title ? OPENCODE_NATIVE_TITLE_RE.test(title) : false
}

export function isMeaningfulOpenCodeTerminalTitle(title: string | null | undefined): boolean {
  return isOpenCodeNativeTitle(title)
}
