## ELI5

<!-- Explain this change like the reader has never seen the codebase. Plain language, no jargon — what broke or was missing, what you did, and what users notice now. A short paragraph is fine; the PR title is the one-liner. -->

## What Changed

<!-- Describe the change clearly and keep scope tight. -->

## Why

<!-- What problem does this solve, and why is this approach right? -->

## Linked Issue

<!-- Link the issue this PR addresses, if any. -->

- Fixes #

## Screenshots (required for UI / behavior changes)

**Before and after are mandatory** for any user-visible or UI change. Do not open a UI PR with only a description.

- Attach a **before** screenshot (or short recording of the old behavior).
- Attach an **after** screenshot (or short recording of the new behavior).
- Side-by-side or labeled before/after is preferred.
- For motion, transitions, or interactions, include a short **before and after** video (or one video that clearly shows both).
- If there is truly no visual or interaction change, write exactly: `No visual change` and briefly say why.

### Before

<!-- Attach before image/video -->

### After

<!-- Attach after image/video -->

## How to test

<!-- How did you verify this? Steps a reviewer can follow. Which platforms did you actually test (macOS / Linux / Windows / SSH)? -->

- [ ] I manually tested these changes locally
- [ ] Automated tests added/updated, or explained why not below

## Checklist

- [ ] This PR is small and focused
- [ ] I explained what changed and why (including ELI5)
- [ ] Before/after screenshots or videos attached for UI changes, or `No visual change` with reason
- [ ] Self-reviewed for correctness, security, and performance
- [ ] Cross-platform, SSH/remote, and path/shortcut impact considered (or N/A)
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass (or CI will cover; local preferred)

## AI assistance

- [ ] This PR was created or substantially assisted by an AI coding agent (optional disclosure)
- [ ] I reviewed the full diff, understand every change, and can explain it in review

## AI Review Report

Summarize the code review you ran with your AI coding agent. Include the main risks it checked, what it flagged, and what you changed or verified as a result.
Confirm that the review explicitly checked cross-platform compatibility for macOS, Linux, and Windows, including shortcuts, labels, paths, shell behavior, and any Electron-specific platform differences touched by this PR.

## Security Audit

Provide a basic security audit summary from your AI coding agent. Call out any input handling, command execution, path handling, auth, secrets, dependency, or IPC risks that were reviewed, plus any follow-up needed.

## Notes

Call out any platform-specific behavior, risks, or follow-up work.

## Author

- X / Twitter: @your_handle
  <!-- Optional but appreciated — we shout out contributors when we merge features on [@orca_build](https://x.com/orca_build). -->
