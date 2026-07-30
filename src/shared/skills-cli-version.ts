// Why: `skills` floats to npm latest at spawn time, and its parser silently
// drops flags it does not recognize — an upstream --agent rename would revive
// the ~75-agent fan-out install with exit 0 (#11593). Pinning freezes the argv
// contract (published npm versions are immutable), and CI re-proves --agent
// scoping against this exact version, so a bump that breaks scoping goes red.
export const SKILLS_CLI_VERSION = '1.5.21'

// Why: an exact spec, never a range — `^` is cmd.exe's escape character, so a
// caret range inside a pasteable Settings command would be silently mangled.
export const SKILLS_CLI_PACKAGE_SPEC = `skills@${SKILLS_CLI_VERSION}`
