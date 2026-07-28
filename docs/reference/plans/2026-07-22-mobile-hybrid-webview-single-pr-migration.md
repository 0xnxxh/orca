# Mobile Hybrid WebView Single-PR Migration

- **Status:** Implementation in progress; cutover gates remain open
- **Date:** July 22, 2026
- **Last updated:** July 28, 2026
- **Target:** One long-lived pull request, gated before cutover
- **Related decision:**
  [`2026-07-13-mobile-ota-update-infrastructure.html`](./2026-07-13-mobile-ota-update-infrastructure.html)
- **Living implementation checklist:**
  [`2026-07-22-mobile-hybrid-webview-implementation-checklist.md`](./2026-07-22-mobile-hybrid-webview-implementation-checklist.md)
- **Active remaining-work tracker:**
  [`2026-07-27-mobile-hybrid-webview-remaining-work.md`](./2026-07-27-mobile-hybrid-webview-remaining-work.md)
- **Feature-parity inventory:**
  [`2026-07-22-mobile-hybrid-webview-parity-inventory.md`](./2026-07-22-mobile-hybrid-webview-parity-inventory.md)

## Decision Summary

Proceed with Option B as a conditional migration: keep a stable React
Native/Expo shell, compile the existing mobile host-workspace UI for the web
runtime, deliver that application with Orca Desktop through the paired
encrypted connection, and render it inside a locked-down WebView.

Option B is preferred over signed React Native OTA updates because it removes
the larger long-term cost. The desktop RPC implementation and the UI consuming
it ship together, so most workspace feature work no longer needs a second React
Native implementation or a broad cross-version mobile/desktop compatibility
layer. Option A accelerates delivery but retains both sources of maintenance.

This is not unconditional approval to merge a full rewrite. The implementation
has established that authenticated package delivery, verified per-host caching,
a narrow native bridge, the real xterm transport, and the unchanged shared
mobile UI are feasible in iOS and Android emulators. It has not established full
feature parity, terminal stress and topology behavior, physical-device
performance, the complete Android feature and lifecycle matrix, security under
attack, or App Store acceptance.

The migration may be implemented in one PR only if the PR remains a draft
through those gates. Its commits must stay independently reviewable, the
existing native workspace UI must remain available during development, and the
final cutover must not occur until the release candidate passes every criterion
in this document.

### UI Preservation Contract

The mobile UI on `origin/main` is the product specification. Because this is a
long-lived PR, that baseline advances whenever the branch rebases: upstream
mobile UI changes must flow through the same shared source and be reconciled
before cutover. Option B changes where host-workspace code is delivered and how
it reaches Desktop authority; it does not authorize a redesign.

- Host-workspace routes must render the existing React Native presentation
  components from shared source through React Native Web. Do not copy their JSX
  into a parallel DOM/shadcn implementation.
- Source/component identity is a cutover requirement: a visually equivalent
  reimplementation does not count as migrated. Screenshot and interaction
  parity verify the shared component graph; they do not permit a second graph.
- Layout, color, typography, spacing, safe areas, navigation, loading and error
  states, gestures, keyboard behavior, accessibility, and phone/tablet
  composition must remain unchanged unless a separately reviewed product change
  explicitly modifies the baseline.
- Platform-specific files may adapt transport, persistence, routing, nested
  WebViews, and native capabilities, but their public component props and
  rendered behavior must remain equivalent.
- Do not change shared presentation solely to make React Native Web easier to
  support. Put runtime differences behind platform files or named adapters;
  review any intentional product UI change separately against both runtimes.
- Keep the native workspace route as the behavior oracle and working fallback
  until the final parity, security, device, and App Store gates pass.
- The current `src/mobile-web/` presentation is a security and transport
  validation harness. Its workspace, session, file, diff, source-control, and
  review components must not become the production UI.
- Automated screenshot comparisons and interaction fixtures against the
  existing mobile routes are merge gates. Functional parity without visual and
  interaction parity is insufficient.

## Expected User Experience

For a healthy paired desktop, the change should feel like an implementation
detail:

- The host, workspace, session, terminal, files, source-control, task, and
  review screens look and behave exactly as they do in the current mobile app.
  Users should not encounter a replacement visual system or a second navigation
  model.
- Pairing, host selection, notifications, camera, audio, pickers, haptics, and
  recovery continue to look and behave like native mobile features.
- Selecting a host opens its workspace UI. After the first verified download,
  later launches use the local cache and should not show a network-dependent
  blank screen.
- A desktop update carries its matching mobile UI. The mobile shell stages the
  new package and activates it atomically on the next host entry or cold launch;
  it never replaces code in a running workspace session.
- Different paired desktops may show different workspace UI versions. This is
  intentional because each UI matches the desktop RPC implementation serving
  it.
- Native capability changes still require an App Store or Play Store update.
  The architecture makes host workspace changes independent of store releases;
  it does not make the entire app remotely updatable.
- While disconnected, the last verified package can render cached UI and an
  accurate offline state. Operations requiring the desktop remain disabled and
  explain that reconnection is required.

Visible regressions such as a routine multi-stage loader, a web-style navigation
stack, lost keyboard behavior, inconsistent safe areas, or a blank screen while
offline are release blockers.

## Findings So Far

### What the prototype proved

The bounded Option B prototype established:

- A content-addressed HTML package served by Desktop over the existing paired
  E2EE RPC connection.
- Measured production build budgets of 2 MiB total, 512 KiB compressed, 1 MiB
  scripts, and 256 KiB styles, plus 48 KiB delivery chunks, per-chunk SHA-256
  verification, and final asset/manifest verification.
- A verified last-known-good cache isolated by paired host.
- A WebView with a hash-based CSP, network/file/storage access disabled, and
  arbitrary navigation blocked.
- A narrow bridge exposing only `workspace.list` and `haptic.selection`.
- An Experimental Settings entry, leaving the existing app unchanged.
- A host-switch guard that prevents a delayed Direct, Relay, or SSH response
  from reaching a newly selected host document.

The simulator exercised paired delivery, cached offline launch, desktop
restart/reconnect, cold launch, background/foreground, rotation, workspace
rendering, and the haptic bridge without a prototype error.

### Production implementation checkpoint

The single-PR migration now has a production-shaped vertical slice beyond the
prototype:

- Desktop emits a deterministic content-addressed multi-asset build and serves
  its manifest and bounded chunks through explicit mobile RPC methods.
- iOS and Android provide a private asset origin, atomic per-host generations,
  active/previous recovery, bounded cache reservation, deterministic eviction,
  and orphan-stage cleanup. The downloader verifies canonical package identity
  before native staging; each native store verifies it again and rejects
  malformed metadata, incomplete/corrupt generations, wrong-host opens, and
  corruption discovered after a session has opened with bounded errors.
- The native shell negotiates only `workspace.snapshot`, `workspace.activate`,
  `session.snapshot`, `session.subscribe`, `session.create`,
  `session.activate`, `session.close`, the eight bounded `terminal.*`
  operations, `file.list`, `file.search`, `file.read`, and
  `native.hapticSelection`. The page has no generic RPC or native invocation
  path.
- The bridge enforces version/build/session envelopes, shared Zod schemas,
  operation-specific byte/concurrency/rate limits, duplicate-ID rejection,
  stable errors, cancellation, monotonic event sequences, serialized delivery,
  and late-result suppression. Duplicate protection uses bounded active/recent
  windows so long-lived sessions do not exhaust request or subscription IDs.
  Desktop client replacement cancels pending work before new authority is
  installed, and native inbox delivery rejects frame-originated messages.
- Gesture-mediated native operations share one shell authority that consumes
  each native-observed touch once, rejects expired or future timestamps, clears
  pending authority whenever native `AppState` leaves foreground, and refuses a
  privileged call while the app is inactive or backgrounded. Leaving foreground
  also cancels an active shell-owned speech session as interrupted, releasing
  recording, wake-lock, subscription, and Desktop dictation authority.
- `workspace.snapshot` maps only to allowlisted `worktree.ps`, then bounds and
  sanitizes the result before page-side schema validation.
- Workspace entry maps only to `worktree.activate` with
  `notifyClients: false` and caller-only navigation. Session reads and live
  updates map only to `session.tabs.list` and `session.tabs.subscribe`; the
  adapter removes terminal handles, absolute paths, browser URLs, and other
  host-only fields.
- Session activation maps only to `session.tabs.activate` with caller-only
  navigation. Terminal creation maps only to `session.tabs.createTerminal`,
  uses the bridge request ID as the host idempotency key, selects only for the
  authenticated caller, and exposes only the created tab ID. Close maps only to
  `session.tabs.close` with explicit `reason: "user"`; reviewed refusal reasons
  are translated to a bounded result and all other host fields are discarded.
- Restore is intentionally not granted. The current Desktop reopen stack is
  renderer-local and there is no explicit paired/headless restore RPC whose
  ownership and authorization semantics the bridge can preserve.
- The first mobile web validation screen uses canonical Orca tokens and approved
  shadcn primitives to show loading, empty, error, connected, and retained
  reconnecting workspace and session states, plus bounded terminal create, tab
  activate, and close controls.
- Those purpose-built screens are a validation harness only. They prove the
  bridge operations and package lifecycle but do not satisfy the UI preservation
  contract and are not eligible for production cutover.
- Direct, Relay, and stable logical RPC clients expose a typed
  `terminal.multiplex` transport. The native broker resolves only workspace and
  tab IDs; terminal handles, cwd, credentials, connection identity, and input
  authority remain native-only.
- The terminal transport provides bounded snapshots and output, monotonic
  sequence/hash validation, ACK translation, a hard outstanding-byte window,
  resync, visibility suspension, serialized input, ordered/coalesced ACK and
  resize requests, and cleanup across page/native/Desktop resources.
- The page renders with the real `@xterm/xterm` engine and fit addon. Runtime
  input-floor and query-reply authority changes revoke or restore page behavior
  without treating the WebView as the terminal owner.
- The file slice exposes 128-entry hierarchical directory pages with
  deterministic revisions, 32-entry path search, exact 128 KiB file chunks,
  cancellation, and a 1 MiB retained-document ceiling. Native maps only to
  allowlisted `files.readDir`, `files.searchPaths`, `files.read`, and
  `files.readChunk`, strips the desktop root, rejects traversal, validates
  decoded lengths and offsets, and suppresses delayed results after a
  host/workspace change. The page preserves split UTF-8 sequences, detects
  binary content, and renders repository content as inert text rather than
  interpreted HTML.
- Complete, nonbinary, nontruncated UTF-8 files up to 128 KiB support bounded
  optimistic editing. The page supplies the SHA-256 revision of the bytes it
  opened; native captures the current local or SSH mutation owner, and Desktop
  re-reads and hashes the file immediately before invoking its existing write
  authority. The response must match the requested workspace, path, expected
  content hash, and byte length. This detects stale edits but is not a
  filesystem-atomic compare-and-swap: another writer could still race between
  Desktop's preflight read and write.
- The provider-neutral source-control slice now exposes bounded status/diff,
  stage/unstage/discard, commit and message generation, branches/history,
  branch and commit comparison, checkout, upstream, fetch, pull, push/publish,
  rebase, and merge/rebase abort operations. It delegates only to existing
  Desktop Git RPCs, carries exact displayed repository state into every write,
  revalidates that state natively, and exposes neither a generic Git bridge nor
  force push.
- Review-note metadata uses a content revision to reject stale page writes
  before `worktree.set`. This is optimistic conflict detection, not an atomic
  compare-and-swap: another Desktop or mobile writer can still win between the
  broker's preflight `worktree.show` and `worktree.set`.

Build `af1fd2c7…` passed the independent package verifier with the real terminal
engine: 871,082 bytes total, 276,344 bytes compressed, 691,556 bytes of scripts,
and 109,250 bytes of styles. The earlier 512 KiB script sub-budget was too small
for xterm; the reviewed four-part budget above retains explicit headroom without
leaving bundle growth unbounded.

On an iPhone 17 Pro simulator over Direct LAN/E2EE, the production package
booted from the private origin, created a terminal, received the host snapshot,
rendered it with xterm, accepted typed shell input, and displayed live output.
The terminal survived rotation and background/foreground recovery by resyncing
from the native-owned state. Closing it released the subscription, and the test
workspace returned to zero temporary terminals.

On a Pixel 9 Pro API 36 Android emulator, the exact Debug APK connected to the
paired Desktop over Direct E2EE, staged the content-addressed package, and
loaded it through the reserved private origin
`https://orca-mobile-web.invalid/<route>#<opaque-session>`. Native intercepts
every request and serves only verified cache assets; `.invalid` cannot resolve
to a public host. Build `8b5c9b64…` retained the unchanged workspace, session,
terminal, and accessory UI with a real bridge-backed terminal tab.

That journey exposed Android-only integration defects now covered by focused
tests:

- An already-created generation parent is valid even though a second
  `mkdirs()` call returns false.
- The entry CSP admits private-origin package assets and React Native Web's
  runtime styles while continuing to deny network loads.
- Expo Router must load the origin root, with the empty request path mapped to
  packaged `index.html`; loading `/index.html` produced an unmatched route.
- Chromium rejects path and query `history.replaceState()` calls on the custom
  scheme, so Android uses reserved HTTPS while iOS retains its private custom
  scheme.
- Android's intercepted main-frame request retains the session fragment even
  when CDP reports the network URL without it. Native admits that fragment only
  for the main frame and only when it equals the active session.
- Expo Router omits the fragment when it writes a new same-origin path. A
  hosted-only History API boundary preserves the immutable session fragment
  across `pushState` and `replaceState`; cross-origin or malformed values remain
  subject to browser and native rejection.
- Expo's Android view-owner injection rejects an untyped view command before
  Kotlin receives its string payload. The public React ref contract is
  unchanged, while Android routes activation, deactivation, and posting through
  a main-thread session-to-view registry. Entries survive focus deactivation,
  retire on view destruction, and stale inactive-session messages are dropped.

The deliberate-red Android isolation harness first proves its ADB-reversed
sentinel is reachable, then cold-launches the exact APK. Fetch, XHR, WebSocket,
image, popup, redirect-frame, download, service-worker, and external-scheme
attempts retained the routed private document with zero final sentinel
observations. The URL kept its `/h/.../session/...` route and exact opaque
fragment, the bridge loaded the real tab snapshot, and fresh logcat contained
no bridge rejection, Kotlin conversion/cast failure, fatal process error, or
prior storage, History API, or intercepted-response exception.

Residual shared-session persistence now stays shell-owned. The hosted export
uses an inert AsyncStorage platform adapter, while terminal preferences,
accessory layout, and custom shortcut reads/writes cross named bounded bridge
operations. The independent package verifier rejects executable
`localStorage` operations. Focused page-to-native round trips cover shortcut
reads, gesture-gated updates, and the unchanged session adapter.

This proves the core Android Debug emulator and deliberate isolation slices.
The separate locally signed Release gate now passes on a production `user`
image; physical-device behavior, the full route/permission/accessibility
matrix, production store signing, independent adversarial review, and
production cutover remain open.

Focused validation covers the real page/runtime path in 12 files and 42 tests,
and the Expo broker/transport path in 7 files and 27 tests. A simulator-only
failure also exposed that React Native's `buffer` polyfill does not implement
`toString("base64url")`; snapshot IDs now use ordinary base64 with explicit
URL-safe substitutions and a regression assertion for the 22-character
identifier.

The subsequent hierarchical and chunked file checkpoint produced verified build
`4e324f8a…`: 890,447 bytes total and 281,331 bytes compressed, including about
710.29 KiB of scripts and 109.89 KiB of styles. Contract, broker, UI,
stale-host, chunk-integrity, type, lint, and production-package checks pass.
The bounded page viewport scrolls the directory and preview instead of growing
beyond the device screen, and the mobile search field preserves literal
lowercase paths by disabling capitalization, autocorrect, and spellcheck.

On the iPhone 17 Pro simulator, the production page navigated real directory
breadcrumbs, loaded one and two 128 KiB chunks, kept Load more available, and
opened an exact `mobile/pnpm-lock.yaml` result from a paired Desktop without
ripgrep in its launch `PATH`. The Desktop search sentinel now stays inside the
10,000-file fallback scan budget rather than failing the whole request. Rich
previews, writes, and source-control mutations remain separate gates.

The next production checkpoint produced verified build `a29bf25a…`: 922,836
bytes total and 289,718 bytes compressed, including about 741.19 KiB of scripts
and 111.37 KiB of styles. It adds provider-neutral read-only Git status and
revision-checked paged diffs through the existing host-scoped `git.status` and
`git.diff` paths. Native sanitization rejects unsafe paths and host-only fields;
the page receives bounded numbered rows rather than raw original/modified
content. Status responses retain at most 64 entries, diff responses carry at
most 96 rows, and the page stops at 4,000 rows or 1,000,000 retained
characters. Continuation requests must present the previous revision, so a
changed document fails as a stable conflict instead of mixing versions.

On the same simulator over paired Direct LAN/E2EE, the real `mobile-rearch`
workspace reported 181 changes while rendering the bounded first 64. A
`mobile/package.json` diff showed numbered context and added rows. A
`mobile/src/transport/rpc-client.ts` diff reported 2,291 rows; seven
continuation pages increased retained state from 96 to 672 rows, and scrolling
showed numbered deleted rows while the accessibility tree retained only the
visible row window plus overscan. This proves the first real virtualized-diff
slice, but not the 4,000-row, low-memory, physical-device, binary, or
adversarial-content gates.

Verified build `8c384169…` adds host-scoped source-control invalidation without
exposing host paths to the page. The native broker subscribes through the
existing authenticated connection and forwards only `changed`, `overflow`, or
`unavailable`; cancellation-before-ready retains cleanup authority until the
late watcher is unwatched. The visible page refreshes immediately and polls
every 10 seconds as a bounded fallback for `.git` changes intentionally excluded
from the recursive filesystem watcher. Focused validation passes in 27 root
files / 115 tests and 18 Expo files / 61 tests. On the paired iPhone 17 Pro
simulator, adding and removing a root probe changed the visible status count
187 → 188 → 187 without pressing Refresh. The probe was removed after the run.
The verified package remains 924,176 bytes total and 290,096 bytes compressed,
including 742.53 KiB of scripts and 111.37 KiB of styles.

Verified build `56b1c586…` extends that slice with provider-neutral stage,
unstage, and discard. Mutation payloads carry at most 32 unique paths plus the
observed HEAD and exact status-entry identities. The native broker obtains a
fresh Desktop status snapshot, rejects a changed HEAD, missing or changed
entries, duplicates, and unresolved conflicts, then invokes only the existing
allowlisted `git.stage`, `git.unstage`, `git.discard`, or bounded bulk variants.
The page validates ordered result identity, cancels work on client/workspace
replacement, and requires an explicit modal confirmation before discard.

The first live confirmation exposed that the isolated Tailwind boundary had not
scanned the canonical dialog primitive, leaving its fixed-position utilities
out of the production package. The boundary now includes the canonical dialog
and input sources, and the independent build verifier requires the dialog's
fixed overlay, centered translations, width bound, and z-index utilities. On
the paired iPhone 17 Pro simulator, a dedicated disposable repository passed
tracked and untracked single operations plus 32-path stage, unstage, and
confirmed discard; it returned to zero changes and no migration file entered a
bulk operation. The current package is 975,337 bytes total and 304,666 bytes
compressed, including 784,215 bytes of scripts and 120,846 bytes of styles.

Verified build `373fc360…` adds bounded commit and generated commit-message
behavior. Both operations require the current full HEAD and exact staged-entry
snapshot. The native broker re-reads provider-neutral Desktop status before
work, rejects changed HEAD, capped status, missing or changed staged entries,
and unresolved conflicts, and invokes only the existing `git.commit`,
`git.generateCommitMessage`, and `git.cancelGenerateCommitMessage` RPCs.
Generation rechecks the staged snapshot before returning a draft, and pending
work is cancelled on request cancellation, broker disposal, or Desktop client
replacement. Inputs and errors are bounded, the page disables competing
source-control mutations while work is active, and a successful commit is not
misreported as failed if only the follow-up HEAD refresh fails.

Post-split validation passes in 6 root files / 33 tests and 4 Expo files / 24
tests, along with Node, mobile-web, and Expo typechecks, both lints, focused
formatting, the 12-test import boundary, and the max-lines ratchet. The
independent package verifier reports 982,269 bytes total and 306,392 bytes
compressed, including 790,840 bytes of scripts and 121,150 bytes of styles.
On the paired iPhone 17 Pro simulator, the WebView staged a disposable file and
committed `Test(mobile): verify hybrid commit bridge`; Git advanced the isolated
repository from `51f4b079…` to `e7e38a5d…`, and both Git and the WebView
returned to zero changes. The live generator entered its cancellable state and
recovered to an interactive UI, but the temporary Desktop's configured Claude
CLI is not logged in, so a successful live generated draft remains an explicit
environment-dependent rerun. Automated tests cover generation success,
post-generation stale-snapshot rejection, explicit cancellation, and Desktop
client replacement.

The terminal query-reply path now also has paired end-to-end evidence. A
disposable PTY probe in the isolated repository emitted `ESC [ 5 n`; xterm
classified its `ESC [ 0 n` response as a query reply, the native broker
preserved the dedicated opcode, Desktop revalidated the elected mobile query
authority, and the PTY printed `QUERY_REPLY_OK 1b5b306e`. The reply did not
claim the ordinary mobile input floor, and the disposable probe was removed
with the repository clean.

Verified build `45b4c1f4…` adds provider-neutral local branches, sanitized
history, branch comparison, and full-object-ID commit comparison. The page can
retain at most 128 branches, 100 commits, or 128 compare entries; aggregate
history and comparison payloads remain below 192 KiB. The native broker rejects
option-like branch references, requires 40- or 64-character commit object IDs,
strips author email, absolute host paths, and raw host errors, and invokes only
the existing `git.localBranches`, `git.history`, `git.branchCompare`, and
`git.commitCompare` Desktop RPCs. Pending reads are cancelled when the request,
workspace, or Desktop client changes.

The build reproduces at 1,011,440 bytes total and 313,071 bytes compressed and
passes the independent manifest, content hash, CSP, generated-code, isolated
style, and budget verifier. Focused validation passes in 12 root files / 70
tests, the full Expo suite passes in 336 files / 2,376 tests with 2 skipped, and
Node, mobile-web, and Expo typechecks plus both lints, max-lines, and diff
hygiene pass. Over paired Direct LAN/E2EE on an iPhone 17 Pro simulator, the
disposable repository rendered two commits, refreshed from one to two branches,
reported the temporary ancestor branch as one commit ahead with one changed
file, and rendered the selected commit's one-file comparison. The temporary
branch was removed with a non-forced merged-branch delete and the repository
remained clean.

Verified build `db652e2d…` completes the bounded core Git synchronization
slice. Checkout is restricted to a freshly listed local branch. Remote
mutations carry the displayed full HEAD, branch, and upstream snapshot; native
re-reads repository state and rejects stale identity, graph, strategy, remote,
or configured-base assumptions before invoking an existing Desktop RPC.
Behind-only pulls use `git.fastForward`, observed divergence uses `git.pull`,
push and explicit publish use `git.push` without exposing force-with-lease,
rebase is limited to Orca's freshly resolved configured base, and abort is
limited to the freshly observed merge or rebase operation. Host paths, remote
URLs, credentials, and raw host errors do not cross the bridge. Request,
workspace, and Desktop-client replacement cancel pending work, while a
successful write remains successful if only its follow-up refresh fails.

All Node, CLI, renderer, mobile-web, and Expo typechecks pass. Source-control
focused tests, both lints, formatting, import/style boundaries, max-lines, and
diff hygiene pass. The complete root suite passes in 3,317 files with 35,009
tests passed and 59 skipped; the complete Expo suite passes in 337 files with
2,388 tests passed and 2 skipped. The independent package verifier reports
1,022,864 bytes total and 315,999 bytes compressed.

Over paired Direct LAN/E2EE on the iPhone 17 Pro simulator, a disposable local
repository and bare/working remote fixture passed confirmed checkout, fetch of
a new remote ref, explicit publish with upstream establishment, fast-forward
pull, non-force push, rebase of divergent local commits onto `origin/main`, and
abort of a controlled merge conflict. Git state was independently inspected
after every action; the lab ended clean on `main`. This is strong evidence for
the Direct simulator path, but Relay, SSH/WSL, physical devices, provider
reviews, and adversarial topology remain separate gates.

Verified builds `84d8f13e…` and `331b7c43…` add the first provider-neutral
hosted-review slices. The page can discover a review for the exact displayed
HEAD and branch, render a bounded sanitized summary, and load GitHub or GitLab
details and at most 32 retained conversation or inline comments. Bitbucket,
Azure DevOps, and Gitea currently degrade to summary-only data. Provider URLs,
avatars, tokens, native repository targets, absolute paths, raw host errors,
and unrecognized fields do not cross the bridge.

GitHub and GitLab can add bounded top-level comments. Retained GitHub inline
threads can receive replies, and retained GitHub or GitLab threads can be
resolved or reopened. Native re-reads repository identity, hosted-review
summary, and provider details immediately before every mutation, then validates
the exact provider, review number, comment, thread, and allowed action. GitHub
`prRepo` and GitLab `projectRef` stay native-only. Resolve/reopen is idempotent
when the provider already reports the requested state; replies and comments are
externally non-idempotent, so the page does not claim failure implies no write.
No generic provider capability was added.

Build `e0db84d6…` adds bounded inline creation. The page receives at most 48
sanitized changed-file records, 256 commentable modified-side lines per file,
and 2,048 lines across the review. Raw patches, GitHub `prRepo`, GitLab
`projectRef`, and GitLab base/start diff refs remain native-only. Immediately
before posting, native re-reads the review and requires the exact current review
head, retained safe relative path, and retained line. GitHub posts with that
head as `commitId`; GitLab adds its freshly re-read base/start/head refs.

Build `dc69b8ff…` adds a separate review-diff contract instead of reusing the
working-tree diff as if it were the hosted review. Every page binds the current
repository HEAD and branch to the exact provider, review number, review head,
and retained safe path, then native re-reads all of that identity before
loading content. GitHub file contents are fetched with native-only `prRepo`,
base, and head refs. GitLab raw patches are scanned natively. Neither raw
contents, patches, provider targets, nor diff refs cross the bridge.

The page receives at most 96 rows at a time, retains no more than 4,000 rows and
1,000,000 characters, truncates individual lines at 1,024 characters, and
requires the previous SHA-256 revision for continuation. An inline thread maps
only to its retained safe path and modified-side line; the initial response is
anchored around that exact line and the virtualized renderer focuses it.

Build `219c0e44…` adds bounded queued review state and submission. The page
retains at most 32 inline comments, 8,192 characters per comment, 8,192
characters in the summary, and 65,536 aggregate characters. Drafts survive
transient null status or review refreshes, but a workspace, repository
HEAD/branch, or review-head change clears them. An ambiguous or partially
completed provider result blocks replay until the page refreshes the hosted
review, because the UI cannot safely infer that an external write did not
occur.

Immediately before submission, native re-reads repository identity, review
summary, and provider details, then requires the exact provider, review number,
review head, allowed action, retained file, and commentable line. GitHub
supports comment, approve, and request-changes through its review submission
adapter. GitLab explicitly exposes comment-only submission and keeps its
project target and base/start/head refs native-only. The broker validates the
provider action and submitted-comment count before returning a stable result;
raw provider failures, targets, URLs, refs, and partial-write details never
reach the page. Shared review-state reads now live outside the operations
dispatcher, removing the Metro operations/submission require cycle.

The submission-focused root suite passes in 4 files / 12 tests, and the complete
Expo suite passes in 366 files with 2,610 tests passed and 2 skipped. Expo and
mobile-web typechecks, full Expo and mobile-web lints, formatting, diff hygiene,
and the independent package verifier pass. The verifier reports build
`219c0e44…` at 1,118,291 bytes total and 342,457 bytes compressed across four
assets.

Through paired Direct LAN/E2EE on the iPhone 17 Pro simulator, Host 21 activated
`219c0e44…` and opened the real `mobile-rearch` workspace. This fresh host has
no previous generation yet. The branch still has no hosted review, so this
deliberately does not claim live review-diff reads, comments, replies,
resolve/reopen, inline mutations, or queued submission evidence; those require
disposable provider reviews.

The subsequent bounded file-editing checkpoint produced verified build
`63311929…`: 1,123,835 bytes total and 344,029 bytes compressed. The full Expo
suite passes in 367 files with 2,613 tests passed and 2 skipped; root,
mobile-web, and Expo typechecks, focused lints, formatting, the max-lines
ratchet, diff hygiene, and the Desktop Electron build also pass. Through paired
Host 22, the iOS Simulator saved a 41-byte UTF-8 file and an independent disk
read matched exactly. After Desktop changed the same open file, the retained
mobile draft received a stable conflict, stayed visible for recovery, and did
not replace the newer 34-byte Desktop content. The temporary test file was
removed after the run.

The next preview checkpoint renders GFM Markdown as bounded inert React nodes
with an exact source toggle. Rendered mode drops raw HTML, never creates an
anchor from repository content, replaces Markdown images with non-fetching
placeholders, parses at most 128 Ki characters, and mounts at most 4,000 token
nodes. It does not use `dangerouslySetInnerHTML`. The first dependency choice
exceeded the fixed 1 MiB script budget and was replaced rather than raising the
budget; verified build `3c089956…` is 1,172,284 bytes total and 359,093 bytes
compressed, with a 965,640-byte script. Host 22 activated that build, retained
`63311929…` as its previous generation, rendered the real repository README,
and showed its raw HTML only as selectable source.

The syntax checkpoint adds curated lowlight grammars for Bash, CSS,
JavaScript/JSX, JSON/JSONC, Markdown, Python, TypeScript/TSX, XML/HTML/SVG, and
YAML. Unsupported extensions deterministically remain plaintext. Highlighting
processes at most 48,000 characters and 3,000 typed text segments; the complete
loaded source is retained, with any remainder rendered as plaintext. The HAST
output is flattened to React text spans and never inserted as highlighted HTML.
Verified build `9a69302d…` is 1,240,012 bytes total and 380,067 bytes
compressed, with a 1,032,740-byte script that remains under the fixed 1 MiB
script ceiling. Host 22 activated that build, retained `3c089956…` as its
previous healthy generation, and rendered a real TypeScript configuration file
with visibly distinct keywords, strings, identifiers, and comments.

The raster checkpoint accepts only PNG, JPEG, GIF, WebP, BMP, and ICO paths and
requires the loaded magic bytes to agree with the extension-derived MIME type.
SVG never enters the image path. Images stream through the existing
authenticated 128 KiB file-chunk grant, require EOF before display, and stop at
2 MiB. Complete validated bytes become a private in-memory `blob:` URL; the URL
contains no repository path and is revoked when the file, workspace, client, or
component changes. The production CSP permits image `blob:` sources without
changing `connect-src 'none'`, and browser decode failure becomes an inert
error state.

Verified build `bcc7b5d2…` is 1,244,853 bytes total and 381,646 bytes compressed,
with a 1,037,485-byte script below the fixed 1 MiB ceiling. The full root suite
passes in 3,612 files with 36,701 tests passed, 7 files skipped, and 59 tests
skipped. Host 22 activated the build, retained `9a69302d…` as its previous
healthy generation, visibly rendered a real 1,278-byte repository PNG, and
assembled and decoded the 329,737-byte README JPEG across three bounded reads.
Common README HTML normalization and terminal artifacts remain open.

The authoritative UI checkpoint replaces the purpose-built page presentation
with direct imports of the existing React Native `HostScreen`, New Workspace
component graph, session route, and terminal pane through React Native Web.
Native and web implementations now sit behind named workspace, shell,
workspace-creation, session-tab, and terminal-operation interfaces; the
rendered JSX, styles, controls, labels, and interaction model remain the
`origin/main` mobile source. Opaque shell-session workspace and repository
handles prevent absolute host paths and durable native identifiers from
crossing that boundary.

Build `abd43c62…` packages that shared route as 49 content-addressed assets,
7,201,072 bytes raw and 1,537,245 bytes with gzip. This is a production,
minified Metro bundle, not a debug artifact. The earlier 2 MiB / 512 KiB
ceiling remains appropriate for the purpose-built infrastructure fixture, but
it cannot hold the complete authoritative mobile route graph without removing
features or reintroducing a parallel UI. That checkpoint introduced an 8 MiB
total / 2 MiB gzip / 7.5 MiB script RNW ceiling. The later locally bundled
Mermaid engine required the reviewed current ceiling of 10 MiB total, 3 MiB
gzip, 9.5 MiB of scripts, 256 KiB of styles, and 64 assets. The verifier
independently rechecks canonical build identity, content hashes and paths, the
declared file set, CSP, relative-only document assets, and absence of runtime
code generation.

On the paired iPhone 17 Pro simulator, the unchanged hosted workspace opened a
real terminal, created a second terminal from the existing New Tab sheet,
accepted independent input on both tabs, switched between them, and closed one
through the existing long-press action sheet. Both host PTYs remained connected
and writable. The route then passed back/reopen, portrait/landscape rotation,
and background/foreground recovery. The earlier one-off white WebView did not
recur; a hosted-route error boundary now reports only a bounded failure category
if a React render failure occurs, without exposing raw errors or host data.
This is useful simulator evidence, not a substitute for deterministic
native-versus-hosted fixtures, repeated-loss rollback, low-memory physical
devices, or sustained multi-terminal stress.

The next terminal-parity checkpoint preserves the existing long-press action
sheet while routing display-mode, Rename, and Clear through the strict hosted
terminal boundary. Display-mode changes no longer trigger an infinite
resubscribe loop, desktop-mode snapshots do not force the phone viewport,
Rename waits for the action sheet to close before opening its existing input
surface, and Clear retains the existing success toast. All three passed through
the unchanged shared React Native presentation on the iPhone 17 Pro simulator.

Rename also exposed a shell-document issue rather than a presentation defect:
iOS automatically zoomed the RNW input and retained the shifted page after the
keyboard closed. The content-addressed document now disables input auto-zoom at
the viewport boundary. No shared component style or layout changed, and a
second Rename run returned the hosted session header and tab strip to their
exact pre-keyboard accessibility coordinates after Save.

A forced iOS WebContent process loss initially proved that the native shell
remounted a healthy package without a blank screen, but it restarted at the
workspace list. The shell now retains a strict recovery route scoped to the
current shell session. The page can report only the workspace list or a session
identified by an opaque workspace handle already issued by native authority,
plus a bounded display name. Host paths, durable IDs, credentials, and
arbitrary URLs are rejected or never represented. On remount the Expo Router
entry consumes that route once, then the unchanged session screen reopens and
resubscribes from native-owned terminal state.

Verified build `3f546e32…` packages this checkpoint as 49 assets, 7,204,112
bytes raw and 1,538,161 bytes with gzip. Killing the simulator WebContent
process while the real `mobile-rearch` Terminal tab was open restored that
exact session and a live Terminal tab beneath the native hybrid shell. This
closes the isolated-process-loss route gap on iOS Simulator; repeated-loss
rollback, reconnect and cold restore, Android, physical devices, text zoom, and
broader resize/reflow remain explicit gates.

The next exact-source checkpoint moves session-owned device effects behind
`HostSessionDeviceOperations` without changing the shared session JSX, styles,
or interaction model. Native keeps the current haptic implementation, Expo
clipboard write, platform URL opening, and terminal preference storage. The
hosted adapter can request only named, schema-validated operations. Clipboard
writes are capped at 128 KiB; external URLs are restricted to HTTP(S); text
scale is restricted to the existing presets; and clipboard writes, platform URL
opening, and scale persistence consume a recent native-observed gesture.

Build `0d6266a0…` packages this checkpoint as 49 assets, 7,493,967 bytes raw and
1,615,751 bytes with gzip. After a clean app process restart cleared a stale
in-memory rejected-build entry, Host 32 passed health and rendered the unchanged
workspace, session, Terminal, and README surfaces. Long-press selected the exact
terminal marker `SELECT_ME_COPY`; the existing Copy action showed `Copied`; and
the simulator clipboard contained the exact marker through the shell-owned
write. Tapping the adjacent HTTPS link opened the existing Orca browser tab and
loaded Example Domain. Selecting the existing Phone browser preference routed
the same terminal link through the shell-owned platform operation and opened
Example Domain in iOS Safari; the default preference was restored afterward.
Persisted pinch text scale, broader resize/reflow, and physical-device haptic
evidence remain open.

The next native-capability checkpoint keeps the existing Paste and Attach
controls unchanged while moving privileged input into the shell. Hosted code
can probe only whether text or image clipboard content exists. An explicit,
recent native-observed gesture lets the shell read clipboard content or open
the Photos/document picker, resize and upload image bytes through the existing
bounded upload RPCs, and inject the resulting bracketed path through the
authoritative terminal stream. Page JavaScript receives only
`accepted`/`empty`/`cancelled`/permission/size status; clipboard bytes, cache
paths, SSH connection identity, and host temp paths never cross the bridge.
The broker and page scheduler both serialize these operations with ordinary
terminal input and revoke the live stream target before any delayed result can
send.

Build `8b80e6a3…` packages this checkpoint as 49 assets, 7,507,462 bytes raw
and 1,618,365 bytes with gzip. On iPhone 17 Pro Simulator, the unchanged
Attach button opened Orca's native photo permission prompt and the system
Photos picker, then returned cleanly on Cancel. A later run selected a seeded
photo and created a 2,808,983-byte shell-owned host temp PNG through the same
unchanged hosted control. Two focused files / 9 tests cover accepted,
cancelled, permission-denied, too-large, floating-workspace, and SSH execution
authority. Terminal Enter execution after the live upload was not observable,
so it is not claimed. Live text/image paste, document selection, camera,
denial/revocation, background interruption, Android, and physical-device
evidence remain open. Long-pressing the same unchanged control opened the
native iOS document picker and Cancel returned cleanly; selected-document
upload remains open.

The following persistence checkpoint leaves the existing native-chat composer
unchanged and injects `HostSessionChatDraftOperations` below it. Native and
hosted routes both use the same hook. The hosted adapter sends only opaque
workspace/tab IDs; the broker resolves those IDs to the current host workspace
and tab before shell storage is touched. Storage keys hash paired-host, exact
mobile-web build, resolved workspace, and tab identity. Drafts hydrate without
overwriting an edit that wins the load race, coalesce writes, flush on
tab/route teardown, clear after accepted delivery, and remain bounded to the
existing 4,096-character hosted send limit.

Accepted optimistic messages now use a separate shell-owned pending-delivery
store without changing the composer or message-list presentation. The page
supplies only opaque workspace and native-chat handles. Before a read or write,
the broker freshly verifies their exact native workspace, tab, terminal,
agent, provider-session, and transcript binding. Storage keys hash paired host,
exact mobile-web build, resolved host workspace, host tab, and provider
session; no page handle or presentation-only pending ID is durable. The store
retains at most 16 records with 4,096 characters each. Focused tests cover
hydration, transcript-occurrence reconciliation, duplicate text, a send that
settles after a tab switch, corrupt records, hard bounds, and isolation across
every authority component.

Focused storage, authority, adapter, and hook validation passes alongside the
root bridge contract. The iPhone 17 Pro Simulator retained an exact unsent
hosted draft through forced termination of every simulator WebContent child,
restoring the same session route and chat tab. A full app terminate/launch
opened the native host list, but manual Host 37/session re-entry rehydrated the
same draft.

The follow-up cold-route checkpoint persists only bounded paired-host and
host-workspace identity in the native shell. It never persists the page's
opaque workspace handle. Pairing deep links take startup priority. On ordinary
launch the shell validates that the paired host remains present, selects it,
and resolves the stored native workspace identity through a fresh current
`worktree.ps` before minting a new shell-session-scoped opaque handle. A
missing workspace clears the stale route and falls back to the workspace list.
Explicit host-list navigation and host removal clear the route before leaving
or revoking paired-host authority.

The iPhone 17 Pro Simulator then passed a full app terminate/launch: Orca
bypassed the host picker and restored Host 37 plus the unchanged
`mobile-rearch` session, while the exact draft remained under its hashed
host/build/workspace/tab key. Live WebContent-loss, cold-start draft recovery,
and automatic cold route restoration therefore pass. Verified build
`8596775d…` also restored the unchanged hosted session after the pending-store
change. Live forced-loss recovery with an in-flight optimistic message and
migrations remain open, so the broader session persistence gate is still
partial.

The Markdown checkpoint also preserves the existing presentation. Native and
hosted routes share the same `SessionScreen` and inject native/default/web
implementations of `HostSessionMarkdownOperations`; no Markdown JSX, styles,
layout, or editing behavior was copied or redesigned. Strict `markdownRead`
and `markdownSave` operations freshly call `session.tabs.list`, then verify the
exact host workspace, tab, `markdown` type, and relative path before reading
or writing. Content is base64 encoded and bounded to the existing 256 KiB
Markdown limit. Host paths and raw host errors never cross the page boundary.
Save carries a document base version for conflict detection. When the Desktop
renderer is unavailable, reads preserve the existing disk/read-only fallback;
only that fallback may return an empty base version.

Draft persistence is shell-owned through strict `markdownDraftRead` and
`markdownDraftWrite` operations. Storage keys hash paired host, exact web
build, host workspace, host tab, and relative path, and never persist an
opaque page handle. Writes are debounced and serialized. A late hydration
cannot replace a user edit, and a draft restored against older content retains
its old base version plus stale state so Save conflicts instead of overwriting
newer Desktop content. Drafts clear after Save, confirmed discard, successful
close, and Copy/Discard-and-leave.

Deterministic broker, client, round-trip, storage, coordinator, and import
tests cover malformed and oversized requests, authority isolation, stale-base
restoration, hydration/edit races, serialized cleanup, and the headless
read-only fallback. The full mobile suite passes 466 files / 2,906 tests with
2 expected skips. Root, mobile-web, and mobile typechecks, both lints,
max-lines, diff hygiene, and RNW import/build verification pass. Verified
build `2348cef32f978be858a374e406ecfc198eb398e427876094d794f9444867a3bb`
contains 49 assets and measures 7,837,165 raw bytes / 1,684,893 gzip bytes.

A later Host 37 run supplied the missing live editable-Markdown evidence
without replacing the existing editor. The first hosted attempt could not use
the native `react-native-webview` implementation inside React Native Web, so a
platform adapter now mounts the same editor document and controller in a
sandboxed iframe on web while native mode keeps its current WebView. The iframe
has `sandbox="allow-scripts"` without `allow-same-origin`; its random frame
token travels through `window.name`, keeping the editor script byte-stable for
CSP hashing. This is a host-surface substitution, not copied Markdown UI,
layout, formatting, or editing behavior.

The integration exposed two WebKit-specific boundaries. Native navigation
delegates originally rejected the editor's `data:` subframe, and the native
response CSP originally rejected that frame and its inline runtime. Allowing
only `data:` subframes was insufficient because the packaged entry document's
meta CSP still intersected with the native response CSP as
`script-src 'self'`. Both policies now allow the single centralized
`MOBILE_RICH_MARKDOWN_EDITOR_SCRIPT_CSP_HASH`; arbitrary inline script remains
blocked. The controller also re-sends current content and editability on every
`ready` message so WebKit cannot lose initialization when the iframe posts
before the parent listener is attached.

On iPhone 17 Pro Simulator, the unchanged editor rendered host content, made a
live edit, exposed the existing Save action, and wrote the marker to the host
file. A second unsaved mobile edit followed by an independent host-file change
returned a stable `conflict`, displayed `Changed on desktop`, kept Copy,
Discard, and Save available, and did not overwrite the newer host content. A
full app terminate/launch restored that exact unsaved mobile draft with stale
base state; confirmed discard reloaded the newer host content, and a second
terminate/launch proved the persisted draft was cleared. The disposable probe
file was then removed.

The exact-source package for this checkpoint is
`2d48c18c0e016e1514bdf60e170fd687911e5250111eafeed295f5d830023d86`:
49 assets, 7,842,295 raw bytes, and 1,686,671 gzip bytes. Full mobile
validation passes 469 files / 2,916 tests with 2 expected skips. Root, mobile,
and mobile-web typechecks, both lints, max-lines, mobile formatting, the RNW
package verifier, signed iOS build, and live package activation pass. Relay/SSH
hosted persistence, Android runtime, physical-device persistence, and the
broader topology matrices remain required.

The pending native-chat checkpoint now also passes full-process recovery. The
test stopped the owning shell and Codex process, sent a unique optimistic
message, verified its bounded AsyncStorage record, terminated Orca, and cold
restored Host 37 plus the unchanged session. The exact message reappeared as
`Queued` before the provider process resumed. After terminal input resumed, the
original Codex transcript recorded the message and response; the hosted chat
removed `Queued`, and the persisted record was gone.

That run exposed a request-accounting defect rather than a presentation defect:
`nativeChat.subscribe` was granted and implemented, but the bridge's
subscription classifier did not include the `nativeChat` namespace. Valid
restored-session subscriptions therefore failed as `unsupported_capability`.
The classifier now includes `nativeChat`. A production-grant invariant and a
full broker/client restored-session round trip cover opaque authority
resolution, subscription readiness, sanitized transcript events, and teardown.
No chat JSX, styles, or behavior were replaced.

The hosted mutation adapter also preserves uncertainty at the page-to-native
hop. Once a typed request is posted, a timeout, bridge teardown, invalid reply,
or internal reply cannot prove the shell or Desktop did not already accept the
terminal write. Send, response, and stop therefore return `unknown` for those
failures, allowing the existing composer to keep its draft and reconcile
against transcript evidence. Proven pre-dispatch failures such as
`not_connected` remain `rejected`. Six focused tests pass, and exact-source RNW
build `302dc4b3ef244a782e85fa50afeca186d700a5fd1a17b2b9d35a3ac3fa1746b9`
verifies at 49 assets, 7,842,485 raw bytes, and 1,686,749 gzip bytes.

A Direct iOS Simulator run now proves the live ambiguous-delivery path through
the production shell and unchanged React Native Web chat UI. An E2E-only seam,
enabled solely by
`EXPO_PUBLIC_ORCA_E2E_MOBILE_WEB_DROP_RESPONSE_ONCE=nativeChat.sendMessage`,
observed one page request, allowed the broker and Desktop terminal write to
complete, and discarded only that request's shell response. The terminal
received `Reply exactly ACK_LOSS_E2E_20260724_0102` once and produced one
response. At 500 ms the composer still held the exact draft with no failure; at
3.5 seconds the transcript echo was visible while the draft remained held; at
18 and 23 seconds reconciliation had cleared the draft with no automatic
resend, `Message not sent`, or `Delivery unconfirmed` state. The seam is inert
in ordinary builds and does not affect events, subscriptions, or unrelated
operations. Cloud Relay ambiguity remains a separate topology gate.

The Tasks checkpoint preserves the same contract. The host-only router imports
the existing `mobile/app/h/[hostId]/tasks.tsx` route and injects named native or
web operations; no Tasks JSX, styles, layout, provider drawer, connection
drawer, search field, or error UI was copied or redesigned. Explicit
bootstrap, repository, and GitHub result projections discard unsupported Jira
and unrelated Desktop settings, host-only repository fields, origin
candidates, and classified error metadata before page schema validation.

Host 34 on the iPhone 17 Pro Simulator fetched and activated the verified
desktop package, opened the unchanged workspace and Tasks screens, issued a
real filtered GitHub query, and rendered the existing retry/authentication
error because the disposable Desktop lacked `gh` authentication. The provider
picker, Linear disconnected/setup drawer, back navigation, portrait/landscape
rotation, and background/foreground paths also passed without the earlier
`invalid_request` failure. Full mobile validation now passes 441 files and
2,819 tests with 2 expected skips; mobile and mobile-web lint, mobile, Node, and
mobile-web typechecks, max-lines, diff hygiene, touched-file formatting, and
the package verifier pass. Build `898b3a82…` contains 49 assets and measures
7,810,220 bytes raw / 1,678,528 bytes gzip.

The native-chat checkpoint preserves the same session, overlay, chat view,
composer, message, permission-card, and question-card source in native and
hosted modes. Those components now consume
`HostSessionNativeChatOperations`; native and web implementations provide
history, live transcript frames, readability, sends, responses, stop, file
search, and file opening without changing presentation. Session snapshots
carry only bounded agent/tool/prompt/last-message state and an opaque
chat-session handle. Pane keys, terminal handles, workspace and connection IDs,
orchestration state, provider session IDs, and transcript paths do not cross
the page boundary.

Native maps each opaque chat handle to the exact workspace, tab, terminal,
agent, provider session, and transcript. The map is synchronized with session
snapshots and revoked on disappearance, identity change, authenticated client
replacement, broker disposal, or shell replacement. Every mutation reloads
`session.tabs.list` and revalidates that complete identity before Desktop
authority can run; stale authority is revoked before terminal mutation.
Delivery remains explicitly `accepted`, `rejected`, or `unknown`. Both
physical acknowledgement loss and a logical Relay-to-Direct cutover produce
`unknown`, preventing unsafe automatic replay.

The existing stop controller still issues two Escape operations 80 ms apart
and now cancels the delayed step on input-lease loss, route/session change,
operation replacement, or unmount. Native file search retains the preferred
`files.searchPaths` path plus its capped legacy `files.list` fallback; hosted
search uses the bounded server-side operation. Projection, authority,
subscription, operation, adapter, source-binding, type, lint, max-lines, and
package tests pass. Host 37 then served build `895357c5…` to the iPhone 17 Pro
Simulator. The unchanged chat view replayed history, sent a prompt through
opaque authority, streamed the reply, delivered stop, searched and selected a
file mention, preserved state across tab and app lifecycle changes, and
reconnected after a cold app restart. The transcript recorded
`Conversation interrupted`, while the hook-derived `Agent is working`
indicator remained visible. The follow-up repair validates and carries explicit
working/completed/interrupted transcript lifecycle through the strict bridge,
retains it in the shared session hook, and compares terminal timestamps with
the projected hook turn start. Equal-or-newer completed/interrupted evidence
suppresses a stale working hook; older or undated evidence cannot suppress a
newer turn. Build
`64ae13e9f3b04b58c5ddc821779cc1d8245edee1045827a68c8654a7fb162025`
passed a cold-start Host 37 replay: a new long-running Codex turn displayed the
unchanged working state, then `Conversation interrupted` cleared it after the
equivalent two-Escape sequence. The package has 49 assets and 7,819,415 bytes
raw / 1,680,432 bytes gzip. The same Host 37 fixture then rendered a real Claude
`AskUserQuestion` through the unchanged structured card, selected Beta, and
delivered `RECEIVED Beta` to the agent. Structured asks now suppress heuristic
permission/question fallbacks while their status remains present, preventing a
duplicate card after an accepted answer. Package
`87b61d1b6ee32a729181ff79d085d6eff9ed423972b92923a7a50bf2061b6734`
contains that deterministic repair and verifies at 49 assets, 7,819,430 bytes
raw / 1,680,439 bytes gzip.

The subsequent SSH audit found that native-chat transcript reads still used
Desktop's local `node:fs` path even for classic SSH-provider terminals. That
violated execution-host authority and could both fail to find a real remote
transcript and accidentally read an unrelated local file with the same path.
The reader and watcher now depend on a `TranscriptFileSource`: local sessions
retain the existing bounded local implementation, while SSH sessions use exact
provider-backed `stat`, `open`, and range reads capped at 64 KiB. Existing
decoders, retention, pagination, lifecycle reconciliation, and UI source are
unchanged. Remote subscriptions use bounded reconciliation because a native
Desktop filesystem watch cannot observe the SSH host.

The runtime now resolves the current runtime-issued terminal handle to its
worktree, SSH connection, agent, provider session, and transcript path. Both
authority fields must match before a provider is selected, and the provider is
reacquired after reconnect. Disconnect remains explicitly unavailable; it
cannot fall back to Desktop's filesystem. A real Docker SSH E2E launched an
isolated Electron Orca, installed and invoked the remote Claude hook, paired an
independent runtime client, and exercised both raw runtime calls and the
production `MobileWebCapabilityBroker`/`MobileWebBridgeClient` contract. The
hosted path discovered only a sanitized SSH workspace, obtained opaque
native-chat authority, read the remote transcript, returned stable
`host_error` on disconnect, reacquired authority after reconnect, and read the
appended assistant message. This proves the SSH provider and relay subprocess
plus hosted data/authority contract. A follow-up iPhone 17 Pro Simulator run
paired the production shell to the isolated Electron/Docker SSH fixture as Host 38. Its actual WebView rendered the unchanged repository, workspace, session,
and terminal UI. Terminal input through that hosted UI created
`/tmp/orca-ssh-webview-proof` on the remote container with the exact content
`SSH_WEBVIEW_FILE_OK`.

That presentation path is now durable automation. Running
`SKIP_BUILD=1 pnpm run test:e2e:hosted-mobile-webview:ssh` launches the isolated
Electron/Docker SSH fixture, pairs the shell to the exact new public identity,
opens the actual `orca-mobile-web://` WKWebView, navigates the unchanged
workspace/session UI, uses its existing buffered command control, captures the
command plus carriage return through `OrcaNative`, and verifies the proof file
inside the remote container. The same journey publishes a real remote Claude
transcript, switches the existing terminal surface to its unchanged chat view,
retains that chat with `Reconnecting…` while the SSH provider is unavailable,
reattaches the existing PTY/provider, and renders the appended
`remote recovered` assistant message. A separate repeatable Direct harness starts an
isolated paired runtime and Metro, selects that exact host by public identity,
enters the existing hybrid route, and uses debug-only WebKit CDP to assert that
the visible hosted document contains the unchanged workspace UI and interactive
controls. These simulator paths do not prove mobile cloud Relay. Separately, a
deterministic protocol-compatible local relay cell now carries production
hosted workspace and session requests, a native-chat transcript read, and the
production mobile package download through the real mobile Relay RPC session,
NaCl E2EE v2, and Desktop `CloudRelayTransport`. The hosted request path also
uses the capability broker/page client, while package delivery uses the
production package asset provider and real downloader. The page receives
opaque workspace and native-chat authority, not Desktop identifiers, provider
sessions, or transcript paths. The package path verifies a canonical
document/script manifest, multi-chunk offsets and hashes, byte-for-byte staging,
and commit only after all assets finish. This proves the in-repo Relay
composition, not the production cloud service, realistic internet
latency/reconnect, or an actual Relay-backed WebView. The exact-source RNW
verifier passes build
`31e01f5747fe4a703a724dd744de949f6d82e5d7ce651489c0204abacb8bfde0`
at 49 assets, 7,819,381 bytes raw / 1,680,417 bytes gzip after the hosted
call-site update.
Live ambiguous-delivery, cloud Relay, Android, and physical-device validation
remain open. Full-process pending-message recovery now passes on iOS Simulator.
Photo attachment selection and host upload now also pass through
the unchanged hosted UI on iPhone Simulator: native owns the selected bytes,
execution-host resolution, bounded upload, and terminal-ordered injection, while
the page receives only bounded status. Document selection, camera,
denial/revocation, and physical-device evidence remain. On the Pixel 9 Pro API
36 emulator, the unchanged Attach control opens Android's real Photos picker.
Backgrounding through Home and returning to Orca cancels the pending picker,
retains the exact hosted session, and exposes no selected path or bytes to the
page. Accepted selection also passes: the native shell uploaded the selected
579-byte PNG to a shell-owned host temp path, injected that path through the
existing terminal flow, and an independent SHA-256 check matched the source
exactly. Hosted JavaScript received neither the selected path nor the bytes.

The July 27 native-chat attachment checkpoint extends that same unchanged
composer rather than creating a web-only presentation. A recent shell-observed
gesture opens the picker; the shell keeps the selected bytes, cache path,
execution-host path, and upload authority. Hosted JavaScript receives only a
session-scoped `native_chat_image_*` reference and a bounded JPEG thumbnail.
References are capped, workspace/session scoped, explicitly releasable, and
revoked when their authenticated client, shell session, or authority ends.
Attach, clipboard paste, retry, ambiguous-delivery retention, reconciliation,
healing, and cleanup all continue through the existing composer hooks.

Native-chat mutations now use one absolute deadline across page, bridge, shell,
connection, and terminal RPC. Requests without enough remaining budget fail
before a host call. Terminal writes carry the mobile client identity and count
connection establishment against that budget; commit preparation first clears
stale terminal input with Ctrl+U. The standalone React Native Web packager reads
the protocol version from a browser-pure shared module, and the bridge protocol
is version 2.

Current validation passes mobile and mobile-web typechecks and lints, mobile
formatting, max-lines and diff hygiene, 517 mobile files / 3,150 tests with 2
expected skips, Android native unit/Debug/Release compilation, and the
independent RNW verifier. The most recent full root run passes 3,548 files /
37,404 tests with 60 skips. Focused package/session/broker faults pass 43 mobile
tests; bridge/channel faults pass 52 root tests; the Swift cache executable and
all 16 Android native store tests pass. Production package
`bb86b378f0aa0285b07793558d27647411bf61185b12af8b10682df23969c97e`
contains 49 assets and verifies at 9,179,679 raw bytes / 2,663,276 gzip bytes.
Full root lint reaches only an unrelated baseline localization-coverage failure
for six unchanged `Ghostty` search keywords; migration-owned lint is green.
This evidence does not close the complete Android matrix, physical-device,
independent-security, performance, signed release-package, physical/final
rollback, cloud Relay, or App Review gates.

The earlier `77708ed1…` checkpoint also proved that a host-created terminal
appeared through the subscription and disappeared after close without a refresh,
and that the page retained version 2 while the paired runtime was reconnecting.

The mobile presentation checkpoint remains simulator-only; the separate Docker
journey proves native-chat transcript authority and reconnect through the
production hosted broker/page client over a real SSH provider. The same
topology now has durable actual-iOS-WKWebView presentation, remote terminal
mutation, reconnect retention, and appended native-chat transcript coverage,
alongside the durable Direct presentation command. The real mobile
Relay/hosted-bridge composition passes through a local
protocol-compatible cell. Production cloud Relay end-to-end, realistic Relay
latency/reconnect, WSL, query replies and file writes on other topologies,
physical-device WebView process loss, cold restore, sustained and multi-pane
terminal stress,
terminal-artifact previews, common README HTML normalization, atomic
filesystem compare-and-swap if later required, safe live provider
reads/mutations, review creation if required, authenticated destructive Tasks
mutations, remaining Android runtime behavior, native device low-storage,
physical devices, release runtime, security review, and App Review are still
open.

### Performance evidence

A subsequent simulator lab delivered a 330 KiB package in seven verified chunks
and repeated the following workload ten times:

- 120 display-cadenced terminal-style DOM updates completed in 1.98–2.00
  seconds. Longest frames were 17–33 ms, with at most one frame over 24 ms.
- A synthetic 4,000-row diff layout completed in 68–78 ms.
- No progressive slowdown or WebView process loss was observed.
- The final verified package cold-started from cache and ran while Desktop was
  offline.

This is encouraging but not a production performance result. The later
production checkpoint now uses Orca's real xterm engine and PTY byte transport,
but the synthetic lab did not use the diff parser, syntax rendering, mobile
keyboard/IME path, or a physical device.

### What remains unproven

- Sustained and multi-pane real terminal output, query replies beyond paired
  Direct iOS Simulator, reconnect, repeated physical-device WebView process
  restoration, and physical-device performance.
- Large real diffs and files under low-memory iOS and Android conditions.
- Touch, keyboard, IME, selection, screen-reader, reduced-motion, tablet, and
  rotation behavior across supported devices.
- Direct, Relay, and SSH-backed workflows under latency, interruption, host
  removal, and credential repair.
- Resistance to XSS, asset substitution, cache confusion, bridge fuzzing,
  navigation attempts, and cross-host response races.
- App Store acceptance of the production-shaped hybrid companion.

## Option A Compared With Option B

| Concern             | Option A: signed React Native OTA                                                                 | Option B: desktop-served hybrid UI                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Feature maintenance | Keeps separate desktop and mobile feature UIs                                                     | One desktop-built mobile web UI owns host workspace features                              |
| Compatibility       | Runtime versions reduce risk but broad RPC skew remains                                           | Desktop and its mobile web UI release together; only the narrow shell bridge is versioned |
| Infrastructure      | Cloud Run, GCS/CDN, Firestore, KMS, CI approval, monitoring                                       | Uses paired Desktop and local cache; no central update control plane                      |
| Security center     | Signed manifests and centrally controlled releases                                                | Paired-host trust, E2EE delivery, verified cache, isolated WebView, capability bridge     |
| Performance         | Native React Native surfaces; current terminal still embeds a WebView                             | More UI runs in WebView; terminal and large-diff gates are mandatory                      |
| Rollback            | Republish known-good content with a newer identity or use a signed rollback-to-embedded directive | Revert per-host activation to a verified prior package or ship a matching Desktop fix     |
| Store risk          | Established Expo update model, still subject to Apple rules                                       | Meaningful minimum-functionality and remotely delivered functionality risk                |
| Long-term cost      | Faster TS/TSX delivery but duplicated implementation remains                                      | Lower expected feature and protocol maintenance if bridge stays narrow                    |

Option A remains the fallback if any mandatory Option B gate fails. Moving an
OTA channel pointer to an older update is only containment for clients that have
not installed the bad release; it is not a reliable downgrade for clients that
already selected the newer update.

## Goals

- Make the desktop-built mobile web app the complete host workspace experience.
- Release each desktop RPC implementation and its matching mobile UI as one
  artifact.
- Keep pairing credentials, E2EE transport, and long-lived secrets outside the
  WebView.
- Keep native-only capabilities behind a narrow, typed, versioned,
  capability-negotiated bridge.
- Support Direct, Relay, SSH-backed workspaces, offline cached launch,
  reconnect, host switch, and pairing removal.
- Make package activation atomic and recover automatically from a bad package
  or WebView process loss.
- Preserve mobile-quality interaction, accessibility, and performance.
- Complete code, tests, review evidence, release-candidate validation, and
  cutover within one PR.

## Non-Goals

- Do not expose the existing full desktop renderer in a phone-sized WebView.
  The target is a separately built React Native Web application that imports the
  existing mobile screen, component, style, and view-model source. Route and
  platform adapters may change; presentation and interaction behavior may not.
- Do not put pairing credentials, device tokens, or durable bearer tokens in a
  URL, DOM, JavaScript global, Web Storage, IndexedDB, or page-accessible cookie.
- Do not allow the page to open a generic desktop RPC tunnel or arbitrary native
  method dispatcher.
- Do not make notifications, pairing recovery, credential repair, audio session
  ownership, or store-delivered native code depend on downloaded web content.
- Do not operate Option A and Option B together in production by default.
- Do not claim App Store acceptance from TestFlight, simulator behavior, or a
  review of an empty wrapper.

## Definition of a Full Migration

The migration is functionally complete when every host-specific workspace flow
uses the desktop-built mobile web app by default:

| Product area                                                      | Target owner                                             |
| ----------------------------------------------------------------- | -------------------------------------------------------- |
| Pairing, QR scan, paired-host list, credential repair             | Native shell                                             |
| Connection state, incompatible-host UI, cache recovery            | Native shell                                             |
| Notifications and deep-link intake                                | Native shell; typed route forwarded after host selection |
| Microphone, two-way audio, photo/file picker, clipboard, haptics  | Native shell through capabilities                        |
| Native app, notification, voice, privacy, and diagnostic settings | Native shell                                             |
| Worktree/workspace navigation                                     | Mobile web app                                           |
| Sessions, tabs, agents, and native chat workspace UI              | Mobile web app                                           |
| Terminal rendering and interaction                                | Mobile web app; native brokers the paired stream         |
| Files, previews, editing, diffs, and review comments              | Mobile web app                                           |
| Source control and provider-neutral review flows                  | Mobile web app                                           |
| Tasks, accounts tied to a host, and browser workspace controls    | Mobile web app                                           |

The existing React Native workspace presentation remains the product source
through development and after cutover; React Native Web renders that same
source. Only the superseded native route wrappers and direct runtime bindings
may be removed in the final cutover commit after parity, security,
physical-device, and store gates pass. Native pairing and recovery screens are
not legacy fallback; they are a permanent part of the target architecture.

## Target Architecture

```text
Desktop release
  ├─ runtime/RPC implementation
  └─ content-addressed mobile web build
             │ manifest + verified chunks over paired E2EE RPC
             ▼
Native mobile shell
  ├─ paired identity and encrypted host client
  ├─ per-host staged/active/previous package cache
  ├─ native-only asset origin and locked WebView
  ├─ typed capability broker
  └─ native pairing, recovery, notifications, audio, and pickers
             │ capability messages; no durable credential
             ▼
Desktop-built mobile web app
  ├─ existing mobile workspace UI rendered through React Native Web
  ├─ source control, files, diffs, tasks, and sessions
  └─ terminal view with sequenced, bounded stream frames
```

The mobile web app does not connect to Desktop directly. The native shell owns
the authenticated host client and brokers explicitly allowed requests and
subscriptions. A direct short-lived page channel may be reconsidered only if
physical-device terminal measurements prove the native broker inadequate; it
is not part of this design.

For SSH workspaces, the phone remains paired to Orca Desktop. Desktop executes
the operation against the SSH target and returns the result through the same
paired connection. The web page never receives an SSH credential or assumes
the repository is local to Desktop.

## Trust Boundaries and Threat Model

### Trusted components

- Store-installed native shell and its embedded bridge schemas.
- The paired desktop identity selected by the user.
- The E2EE session established from the native secure credential.
- Web assets that arrived over that session, matched the manifest, and were
  activated from the host-isolated verified cache.

### Untrusted inputs

- Every manifest, asset name, size, MIME type, and chunk before validation.
- Every page-to-native message and every desktop RPC response.
- Repository content, terminal output, diffs, Markdown, image metadata, task
  content, and provider content rendered by the page.
- Navigation attempts, redirects, subframes, popups, downloads, and external
  URLs.
- Cached files before their hash and host namespace are revalidated.

### Paired desktop authority

A paired desktop is intentionally allowed to supply its workspace UI, but it
does not inherit all phone authority. A compromised paired desktop must not be
able to read arbitrary photos/files, silently start audio, extract clipboard
history, alter notification permissions, navigate the WebView to another
origin, or invoke a capability not granted by the shell. User-mediated native
pickers and permission prompts remain authoritative.

The desktop runtime must continue authorization after bridge validation. The
bridge is defense in depth, not a replacement for the mobile RPC allowlist,
workspace scoping, input leases, provider checks, or filesystem boundaries.

## Mobile Web Build and Package Protocol

### Build output

Use the dedicated host-only Expo Router entry to export the existing mobile
presentation through React Native Web, then post-process it into
`out/mobile-web-rnw/` as part of every desktop build and release. The separate
Vite entry under `src/mobile-web/` remains an infrastructure fixture until its
bridge/package tests have migrated and the shared presentation passes cutover.
Development fallback, `build:mobile-web`, and Electron's macOS/Linux/Windows
resource mapping now select `out/mobile-web-rnw/` without an environment
override. `ORCA_MOBILE_WEB_PACKAGE_ROOT` remains an explicit diagnostic/test
override. The Vite build is available only as `build:mobile-web-fixture`; it
must not become the runtime or release presentation.
Electron `afterPack` now runs the production package verifier against the
copied `<resources>/mobile-web` tree, so a missing, corrupt, non-content-
addressed, over-budget, or CSP-invalid resource fails packaging rather than
surviving until runtime. An actual unpacked macOS arm64 package verified build
`c24ff987…` from `Orca.app/Contents/Resources/mobile-web` with 49 assets,
7,878,100 raw bytes, and 1,695,710 gzip bytes. That run was unsigned and lacked
the unrelated optional macOS notification-status helper; Linux, Windows,
headless, and signed-release artifacts remain open.
A separate packaged-topology gate replaces the Desktop test process's
`process.resourcesPath` and cwd with that unpacked app `Resources` directory,
leaving no checkout output fallback. The authenticated mobile package RPC
returned `c24ff987…`, after which the actual iOS WKWebView rendered the
unchanged Docker SSH workspace, mutated the remote terminal, retained native
chat through provider loss, and rendered the recovered remote transcript. This
closes packaged Desktop-to-SSH lookup on unpacked macOS without claiming
Linux, Windows, headless, signed-release, Android, or physical-device evidence.
Production shell, package, page, and shared-contract sources now use only
production module names and `mobileWeb.package.*` RPC methods. A recursive
source-boundary test rejects prototype imports, symbols, contracts, or RPC
names in those roots. The isolated experimental route still registers its
legacy single-document delivery contract and reuses the production host picker;
that fixture remains removable only at the final cutover gate.
The production build must:

- Use relative, content-addressed asset paths.
- Disable runtime code download, `eval`, `new Function`, and remote source maps.
- Fail closed if the known Metro or dependency runtime-code-generation shapes
  drift instead of emitting a package with unreviewed executable behavior.
- Emit a deterministic manifest after all assets are finalized.
- Fail CI if an executable asset is not covered by the generated CSP or if the
  package exceeds measured, reviewed hard limits.
- Include the mobile web build in macOS, Linux, Windows, headless, and SSH-hosted
  Orca distributions.

The mobile app should not import the full desktop renderer entry. Shared code
must be extracted only when it is platform-neutral and does not pull Electron,
Node, desktop windowing, or desktop-only persistence into the mobile bundle.

### Manifest

Replace the prototype's single HTML manifest with a versioned multi-asset
manifest similar to:

```ts
type MobileWebManifest = {
  schemaVersion: 1
  buildId: string
  bridge: { minimum: number; testedThrough: number }
  entrypoint: string
  totalBytes: number
  assets: Array<{
    path: string
    sha256: string
    byteLength: number
    contentType: string
    role: 'document' | 'script' | 'style' | 'font' | 'image' | 'wasm'
  }>
}
```

`buildId` is the SHA-256 of a canonical serialization of the manifest excluding
the `buildId` field. Asset paths are normalized POSIX-relative paths with no
empty, dot, parent, encoded-separator, backslash, query, or fragment component.
The manifest rejects duplicate paths, duplicate entrypoints, unsupported MIME
types, unknown roles, non-integer lengths, excess file counts, and packages
over the hard total-size cap. The page downloader recomputes the canonical
identity before calling native `beginStage`; Swift and Kotlin recompute it again
before creating any staging directory.

Keep the proven 48 KiB RPC chunk size initially because it remains comfortably
below the encrypted WebSocket frame limit after JSON and base64 overhead. Set
the production per-asset, file-count, and total-package caps from the measured
release bundle plus explicit headroom; no path may be unbounded. CI records
compressed and uncompressed sizes so bundle growth is visible in review.

### Native asset origin

Production assets must load from a native-owned non-network origin, not plain
HTTP, a loopback server, `file://`, or a desktop URL. Add a small Expo native
module, tentatively `@orca/expo-mobile-web-shell`, that owns a private
`orca-mobile-web://` scheme on iOS and Android and serves only the active
verified generation for the selected paired identity.

The module must:

- Map an opaque, shell-created session identifier to one active host/build.
- Serve exact manifest paths and MIME types from read-only cache files.
- Reject range/path tricks, missing hashes, inactive generations, and requests
  for another session.
- Attach the strict CSP to the entry document and prevent service workers,
  downloads, external schemes, popups, and subframes.
- Expose lifecycle and navigation events to React Native without exposing cache
  filesystem paths to JavaScript.

Using a purpose-built native view also keeps origin enforcement, request
interception, and bridge source checks in the stable shell rather than relying
only on React Native callbacks. The PR must prove the implementation uses public
platform APIs and survives Expo prebuild on both platforms. If that cannot be
done safely, the migration gate fails; a local HTTP server is not the fallback.

### Download, verification, and activation

1. Native connects to the selected paired identity and requests its manifest.
2. The downloader and native store independently validate canonical identity,
   manifest bounds, and the bridge range before requesting or staging assets.
3. Assets already present under the same host identity and hash are reused.
4. Missing assets download into a staging generation using bounded sequential
   or low-concurrency chunks.
5. Native validates every chunk offset, length, and hash, then validates each
   completed asset and the canonical manifest/build ID.
6. Native fsyncs/commits the complete generation, marks it staged, and launches
   it in a new WebView session.
7. The page must send `ready` and a health acknowledgement before the activation
   record changes atomically.
8. Native keeps the prior healthy generation for recovery and garbage-collects
   older, unreferenced generations within a global and per-host storage budget.

A host switch aborts all in-flight downloads, bridge requests, subscriptions,
and health timers before a new session is created. Host identity comes from the
paired cryptographic record, never a display name, IP address, Relay URL, or SSH
target string.

The cross-platform native fault harnesses now cover exact staging/open/read,
malformed identity/path/MIME/totals, host isolation, orphan-stage cleanup on
store restart, incomplete and corrupt generations, corruption discovered after
session open, deterministic low-space rejection, per-host eviction that
preserves an active generation, cross-host global eviction, selected-host
removal, active/previous activation, and previous-generation recovery. The page
downloader separately covers chunk and aggregate hashes, every native stage
failure, abort-cleanup failure, and cancellation. Real process termination now
passes for both stores through separate Swift and JVM child processes killed
after stage creation, partial chunk write, asset sync, generation rename, and
atomic activation replacement. Fresh stores remove orphan stages, preserve the
baseline before activation, and recover it as the previous generation after
activation. Cached cold opens on both platforms now validate the active
generation before use; if it is invalid or bridge-incompatible, native
atomically promotes a compatible verified previous generation and removes the
invalid generation once unprotected. Explicit build opens continue to fail
closed rather than silently selecting different content. Device storage
pressure plus physical-device and final release-candidate rollback remain
release gates.

The exact Pixel 9 Pro API 36 Debug app now covers the first repeated-loss device
drill. A bounded CDP harness requires one active/previous cache pair, crashes
three distinct Chromium renderer processes through `Page.crash`, waits for the
real native `onRenderProcessGone` remount after each loss, and requires the whole
sequence to stay inside the production one-minute window. The first two losses
retained native package session `E_AO…`; the third opened session `ScXR…`.
Native `activation.json` atomically moved from active `bb86b378…` with previous
`800db4d5…` to active `800db4d5…` with no previous generation, while the
unchanged terminal UI remained visible. This closes the Android Debug emulator
crash-loop slice only.

The exact iPhone 17 Pro simulator Debug app now covers the matching iOS
repeated-loss drill. Because WebKit inspection does not implement
`Page.crash`, the bounded harness resolves the selected simulator's
`launchd_sim` manager, requires exactly one child
`com.apple.WebKit.WebContent` process, and sends `SIGKILL` only to that PID. It
killed three distinct WebContent PIDs in 11.9 seconds and observed four distinct
inspectable targets while the Orca app process remained alive. The first two
losses remounted the same package session; the third opened a new session and
atomically changed `activation.json` from active `bb86b378…` with previous
`800db4d5…` to active `800db4d5…` with no previous generation. The unchanged
terminal UI remained visible. Physical devices and the final signed release
candidate remain mandatory on both platforms.

The same iOS Simulator app now passes the native manual-recovery slice. A real
WebContent loss exposed the retained warning, simulator accessibility activated
**Use previous**, and native atomically promoted `800db4d5…`. **Clear cache**
then removed the selected host cache, redownloaded current `bb86b378…`, and
reopened the unchanged hosted terminal. Health acknowledgement no longer erases
an unresolved recovery warning; successful retry or refresh still clears it.
The accessible native recovery surface exposes Retry, Use previous, Clear cache,
and Switch hosts without moving feature UI out of the shared React Native
source.

The exact Android Debug app now passes the matching manual recovery actions.
Emulator accessibility activated **Use previous**, then **Clear cache**;
native promoted the verified prior generation, removed only the selected host
cache, redownloaded the current package, and reopened the unchanged hosted UI.

An offline corruption drill rebuilt and installed the exact iOS Debug app
without deleting its data, then truncated active
`485316166296c311…/index.html`. With the paired Desktop unavailable, cold-open
validation atomically changed the cache to sole active `bb86b378f0aa0285…`,
removed the corrupt generation, and rendered the visible, bridge-enabled
private-origin cached reconnect UI. The durable Android harness forged and
activated a corrupt `ffff…` generation, cold-opened with Desktop unavailable,
restored verified `485316166296c311…`, removed the forged generation, and
retained visible `Orca Desktop`, Filter, Recent, and repository content in a
bridge-ready private document. Physical devices and signed final release
candidates remain mandatory.

## Content Security and Navigation Policy

The generated entry document uses the narrowest CSP supported by the final
shared RNW bundle. The implemented policy is:

```text
default-src 'none';
script-src 'self' <generated sha256 hashes>;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'none';
media-src 'none';
object-src 'none';
frame-src data:;
child-src data:;
worker-src 'none';
base-uri 'none';
form-action 'none';
frame-ancestors 'none'
```

Android serves that policy as an intercepted response header from
`https://orca-mobile-web.invalid`; the generated document also contains the
same meta policy. Native requires the exact HTTPS scheme, reserved host, no
port or user info, and the active opaque fragment. `blockNetworkLoads`, file
and content access denial, CSP, request interception, navigation rejection, and
the bridge's origin/build/session envelope remain independent layers. iOS keeps
the equivalent `orca-mobile-web://<session>/` private origin.

The two relaxations preserve the existing mobile UI rather than create new page
authority. React Native Web emits runtime style elements and attributes, so the
outer document currently requires inline styles. The shared rich Markdown
editor runs in a `data:` iframe with `sandbox="allow-scripts"` and no
same-origin grant; its own CSP permits only the reviewed script hash, inline
editor styles, and `data:` images while denying connections, frames, objects,
media, forms, and base URLs. The frame exchanges token-bound typed editor
messages with its parent. No arbitrary network or private-origin subframe is
allowed. The native copy of this same editor document now receives the identical
CSP rather than a looser native-only policy. Its Markdown renderer accepts only
HTTP(S) links and base64 raster `data:` images; script, raw HTML, SVG,
event-handler, and active-scheme corpus cases remain inert. The rest of the
repository-content corpus remains a merge gate.

Remote provider avatars are not an exception to the network policy. GitHub task
list, detail, assignable-user, review, comment, Project-assignee, and
Project-user-field result schemas accept their native schema-valid inputs but
replace avatar URLs with `null` or `undefined` before page state. The unchanged
mobile presentation therefore uses its existing initials or empty-avatar
fallback. A future richer avatar path must deliver verified raster bytes through
shell-owned authority; it must not add provider origins to `img-src` or expose a
durable credential to the page.

The existing HTML artifact Preview/Source controls are also shared unchanged
between native and RNW. Preview mode no longer executes repository markup
directly. A fixed, hash-authorized sanitizer script decodes the raw file from a
base64 textarea, walks at most 20,000 nodes to depth 64, and copies only an
allowlist of inert presentation elements and attributes into a separate preview
root. It drops scripts, frames, forms, SVG, MathML, media, objects, event
handlers, remote image sources, active CSS and non-HTTP(S) links. The nested
document denies network, frames, workers, forms, objects and base authority by
CSP; hosted mode additionally uses a `data:` iframe with
`sandbox="allow-scripts"` and no same-origin grant. A random frame token and
exact `event.source` check bind hosted link messages to that frame. Both paths
route a validated HTTP(S) request through `HostSessionDeviceOperations` rather
than opening it from repository-controlled content.

Read-only Markdown remains the existing bounded React renderer: normalized
README HTML, Markdown text, code, tables and links become React Native
presentation elements rather than interpreted HTML. Its script, frame, SVG and
image corpus therefore creates no executable DOM element. Link targets pass
through the same 4,096-character HTTP(S)-only normalizer used by the native
capability contract; `javascript:`, `data:`, `file:` and `mailto:` are inert.
Session chat, task descriptions/comments, and file previews inject their
existing native/hosted device capability instead of calling `Linking` from the
renderer. This changes only authority routing, not the shared mobile
presentation.

The existing Mermaid diagram and raw-source fallback presentation is also
shared unchanged. Its nested native WebView previously downloaded executable
Mermaid code from jsDelivr, accepted every origin, and could not render in
hosted mode once the outer page correctly denied that CDN request. Native and
RNW now use one fixed runner and a locally bundled Mermaid/DOMPurify engine.
Native embeds that verified engine in its isolated document. Hosted WebKit
starts a small opaque `srcdoc`, posts a typed token-bound `ready` message, and
accepts the exact compressed engine only from its exact parent. This split is
required because simulator WebKit truncated or skipped the runner when the
1.26 MiB compressed engine was embedded in a `data:` URL or `srcdoc`. The
document hash-authorizes only the fixed runner and exact engine, so altered
parent-supplied code cannot execute. It denies connections, frames, workers,
objects, media, forms and base authority, uses Mermaid
`securityLevel: strict` with top-level `htmlLabels: false`, and sanitizes the
generated SVG while forbidding anchors, `foreignObject`, and scripts.
Repository source is bounded and base64 encoded; the hosted frame has script
permission but no same-origin grant, and both directions require the exact
frame plus a random token. Unsupported decompression or render failure
preserves the existing raw-source fallback.

A temporary local wrapper exercised that exact hosted opaque-frame document in
iPhone 17 Pro Simulator WebKit. A normal diagram rendered visible `Start` and
`Done` labels. A malicious Mermaid `click` directive created no accessible link
and produced zero loopback sentinel requests. Invalid source returned the typed
error consumed by the unchanged fallback presentation. This is useful
document-level WebKit evidence, not proof of the exact Orca app route, the
native nested component, Android, a physical device, Release behavior, or an
independent adversarial review.

Any further relaxation requires a concrete product need and security test.
Repository HTML and Markdown are sanitized even though network access is
blocked. External links are parsed by native code, displayed to the user when
appropriate, and opened through the platform only after an explicit gesture;
they never navigate the privileged WebView.

Static tests cover the generated CSP and native navigation/origin controls, but
they are not sufficient to close the runtime network-isolation gate. The
debug-only WebKit inspector reliably identifies and reads the actual hosted
document, but its proxy does not execute evaluation expressions containing
network attempts. The iOS harness therefore injects a DEBUG-only document-start
probe from simulator-scoped launch values. The gate builds the exact current
native Debug target into worktree-scoped DerivedData with normal Xcode ad-hoc
simulator signing, installs that `.app`, pairs it through an isolated
authenticated Desktop runtime, and opens the actual private-origin WKWebView.
It attempts fetch, XHR, WebSocket, image loading, a popup, an external redirect
subframe, a download, service-worker registration, and external-scheme
main-frame navigation. The exact document remains active, popup and worker
attempts are rejected, and an independent loopback HTTP/WebSocket sentinel
observes zero requests.

iOS also cancels download navigation, rejects responses that cannot be
displayed, permits only the exact active private document in the main frame, and
limits subframe responses to displayable `data:` documents. Android matches the
RNW CSP, disables platform network loads, rejects non-active-origin requests and
popup windows, and installs a reporting no-op download listener. Its probe is
guarded by both `BuildConfig.DEBUG` and the debuggable application flag, accepts
only a validated loopback port and canonical UUID token, and is installed for
`orca-mobile-web://` with the AndroidX document-start API. Execution waits for
the hosted bridge-ready marker: an external-scheme main-frame attempt at the
earliest document-start instant interrupted Chromium's React Native Web
bootstrap even though native policy rejected the navigation.

The repeatable Pixel 9 Pro API 36 gate installs the exact arm64 Debug APK, uses
ADB reverse for an independent HTTP/WebSocket/TCP sentinel, deliberately proves
emulator-to-sentinel reachability, and clears that red observation before cold
launch. The actual private-origin WebView then completes fetch, XHR, WebSocket,
image, popup, redirect-subframe, download, service-worker, and external-scheme
attempts. The private document remains active, popup and worker attempts are
blocked, and the sentinel records zero final observations. The harness removes
its inspector and probe forwarding afterward.

The Android Release inspector gate uses a separate production-shaped device
contract. The first locally signed Release run had no `DEBUGGABLE` package flag,
but remained inspectable on the existing `userdebug` emulator. Chromium WebView
133 explains that result: `BuildInfo.isDebugAndroidOrApp()` treats `eng` and
`userdebug` Android builds as debug Android, enables Web Contents debugging
unconditionally during WebView initialization, and ignores the public disable
call. A `userdebug` emulator is therefore useful for the Debug adversarial
harness but cannot prove Release inspector isolation.

Every packaged app-controlled enable path now also requires
`ApplicationInfo.FLAG_DEBUGGABLE`: the Orca shell, Expo LogBox, Expo DOM
WebView, and both React Native WebView creation and property paths. The durable
Release verifier rejects any device whose build type is not `user`, requires
`ro.debuggable=0` and a `:user/` fingerprint, rejects an installed package with
the `DEBUGGABLE` flag, force-stops and cold-launches the app, waits for an
expected hosted UI marker, and then requires both the process DevTools socket
and forwarded `/json/list` endpoint to remain unavailable.

The exact post-hardening APK built successfully across 944 Gradle tasks and has
SHA-256
`cf20884424663170342cd9b38072f8dc47666e878489f148a0926f11e52c170f`.
On an API 36 Google Play `user/release-keys` image it paired over Direct E2EE,
rendered the unchanged `mobile-rearch` workspace, retained that route after a
force-stop/cold launch, exposed no inspector socket or discovery endpoint, and
emitted no fatal mobile-WebView logs. This APK is signed by the local Android
debug certificate, not production Play signing. Physical devices, the
production-store-signed final candidate, and independent adversarial evidence
remain required.

## Native Capability Bridge

### Contract

Replace the prototype union with a generated, versioned contract shared by the
web build and native shell. Every request includes:

- Protocol version.
- Shell-created session ID.
- Unique request or subscription ID.
- Named capability and operation.
- Schema-validated parameters.
- Optional cancellation or sequence metadata.

Every response echoes the session and request IDs and returns a typed result or
stable error code. Native rejects malformed JSON, unknown fields, unsupported
versions, oversized messages, duplicate IDs, excess concurrent requests, stale
sessions, and capabilities not negotiated for the active host/build.

Active and recently retired request/subscription IDs remain protected in
bounded replay windows; IDs outside the window can be reused so a long-lived
session does not permanently exhaust itself. A subscription's request ID and
subscription ID must differ. Missing protocol versions are invalid messages,
while explicit out-of-range versions remain unsupported-version errors.
Native-to-page inbox messages require a native event source (`event.source ===
null`), so a child frame cannot spoof the shell transport.

The production transport accepts at most a 640 KiB serialized bridge envelope.
Each negotiated request or response payload is capped at 600 KiB, reserving
40 KiB for the version, build, shell-session, operation, request, status, and
error envelope. The shared contract, production grants, and both native
WebView implementations use those same ceilings. Source-drift tests fail if
the Swift or Kotlin transport diverges from the shared limit, and grant tests
exercise the largest production payloads before they reach a native allocator.
This alignment is required because a broker-valid Tasks file-content response
can approach 600 KiB; the earlier 256 KiB native transport ceiling could
silently reject it at the final hop.

Package compatibility is checked in both directions before asset staging and
again inside the native cache before a session or rollback generation can
open. The shell bridge version must be at least the manifest `minimum` and no
greater than `testedThrough`. Swift and Kotlin retain that range in their
verified manifest records and retain the opening shell version in the native
session so recovery cannot silently select an incompatible cached page. This
prevents a store-installed bridge upgrade from loading an older cached page
into a health-timeout loop. Capability grants still provide feature-level
degradation within a compatible bridge protocol range.

There is no `rpc.call(method, params)` or `native.invoke(name, value)` escape
hatch. Capabilities are concrete domain contracts such as
`workspace.snapshot`, `terminal.subscribe`, `file.pick`, or
`haptic.selection`.

### Capability classes

| Class                | Examples                                                         | Rule                                                                                               |
| -------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Host read            | workspace/session snapshots, files, git status, tasks            | Broker to explicit mobile-allowlisted RPC with limits and host scope                               |
| Host mutation        | terminal input, file write, stage, commit, task update           | Revalidate target and authorization on Desktop; preserve existing input leases and provider checks |
| Native harmless      | selection haptic, safe-area/theme state                          | May execute after schema, rate, session, and origin checks                                         |
| Native user-mediated | photo/file picker, microphone/audio, clipboard read              | Requires visible native UI, platform permission, and a recent explicit user gesture                |
| Native-owned         | pairing credential, notification enrollment, secure-store repair | Never returned to or controlled by the page                                                        |

Capability negotiation returns the shell bridge version, exact capabilities,
per-operation limits, and optional feature flags. A newer web build must hide or
degrade a feature when an older shell lacks its capability. A newer shell must
reject unknown older-page behavior safely. Bridge changes remain store-release
work and require compatibility tests across every supported shell range. The
implemented manifest/cache range guard fails closed outside the tested range;
the final release matrix must still exercise real older/newer store binaries
and desktop packages.

### Lifecycle

- Backgrounding pauses high-volume subscriptions and preserves only bounded
  state.
- Foregrounding revalidates the active session and requests fresh snapshots
  where ordering cannot be proven.
- WebView termination cancels native and desktop resources before restoring the
  last healthy package.
- Host removal deletes its credentials, cached packages, pending native grants,
  and bridge session together.
- Notification/deep-link routes are buffered natively until the intended host
  is selected, connected, and running a compatible healthy package.
  A paired-host storage read failure rejects the notification rather than
  bypassing host validation, and a newer tap invalidates any older destination
  whose asynchronous host read finishes later.
  The native shell must then revalidate the destination and translate any
  Desktop worktree identity to the current shell-session opaque workspace
  handle before emitting a typed shell-to-page navigation event. Raw worktree
  IDs must not be placed in the hosted URL or page message.

## Terminal Transport

Terminal behavior is the highest performance and correctness risk. Do not send
one native-to-page message per PTY chunk.

The production bridge must provide:

- `terminal.subscribe` returning an opaque stream ID, initial geometry, bounded
  serialized snapshot, and starting sequence number.
- Display-cadenced or size-bounded output batches with monotonic byte sequence
  ranges.
- Acknowledgements and a bounded outstanding-byte window so native and page
  memory cannot grow without limit.
- Explicit `input`, `queryReply`, `resize`, `visibility`, `resync`, and `cancel`
  operations.
- Preservation of current mobile terminal floor ownership, query-reply
  validation, delayed input ordering, SSH routing, and connection identity.
- Snapshot/resync after gaps, reconnect, foreground recovery, WebView process
  loss, or an overflow. Never guess that missing output can be skipped.
- Immediate cleanup on pane close, host switch, disconnect, or session expiry.

Reuse the existing host-owned terminal model as the recovery source where it is
available. The mobile web terminal is a view, not the durable owner of terminal
state. Keep base64/text bridge expansion in the memory budget and measure it on
physical devices under sustained output, hidden panes, large scrollback, IME,
dictation, accessory keys, links, selection, and rotation.

## Existing Mobile UI in the Web Runtime

Build the desktop-served application from the existing mobile presentation
source instead of creating a second UI under `src/mobile-web/`.

Expo Router route files should become thin native entry adapters where needed.
The screen components, view models, styles, lists, drawers, dialogs, headers,
empty/loading/error states, and responsive composition remain shared. The web
entry supplies web-runtime implementations for:

- navigation and deep-link dispatch while preserving the same route semantics;
- named domain-operation adapters backed by the typed capability bridge;
- storage and preference access with the same keys and migration behavior;
- native capabilities such as haptics, clipboard, pickers, audio, and external
  links through explicit shell adapters; and
- nested native WebView surfaces such as terminal, browser, Markdown editor, and
  previews through web implementations with the same component contracts and
  visible behavior.

No adapter may expose a generic RPC or native invocation path. Sharing the UI
does not weaken the bridge boundary: the existing screen requests still map to
named, schema-validated operations with the established limits and
authorization checks.

The page also must not receive Orca's native `worktreeId`: that identifier
embeds the absolute host path. The native broker issues shell-session-scoped
opaque workspace and repository handles, resolves them before each named host
operation, revokes removed or switched-host mappings, and rejects stale or
unknown handles. Folder rows receive only a bounded basename for the existing
presentation contract. Agent pane keys are likewise replaced with
snapshot-local opaque row IDs before crossing the bridge.

The current implementation applies that authority to workspace and session
operations, file reads and writes, terminal streams and terminal artifacts,
source-control reads/mutations/synchronization/subscriptions, commit-message
generation and cancellation, and provider-review reads/diffs/mutations and
submission. Workspace repository presentation, view-settings reads/writes,
pin, sleep, remove, activate, and invalidation subscriptions now use strict
named operations. Authenticated Desktop client replacement clears the
authority and retires client-bound workspace, session, source-control, and
terminal subscriptions. The focused mobile web suite passes 132 tests across
29 files, together with Expo typechecking and max-lines lint. These checks
establish the identifier boundary; they do not close the independent
adversarial-security, topology, or physical-device gates.

The existing `HostScreen` now accepts the named `HostWorkspaceOperations` and
`HostScreenHostState` boundaries. Native constructs adapters over its existing
transport, paired-host store, workspace/repository caches, pin preferences, and
last-connected state. The host-only React Native Web entry supplies bridge
operations plus shell-owned identity and intentionally has no page persistence.
Platform-resolved defaults prevent the web build from importing native host
storage or transport merely because the shared screen retains a native
fallback. This changes runtime ownership without copying or changing the
screen's JSX, styles, layout, gestures, safe areas, drawers, dialogs, or visible
states.

The same extraction now covers workspace creation. The existing
`NewWorktreeModalController`, `NewWorktreeModal`, Smart source drawer,
setup-trust prompt, and their view models now consume the named
`HostWorkspaceCreationOperations` interface instead of `RpcClient`. Native
maps those operations to the existing repository, SSH/Relay, provider,
settings, trust, and create RPC behavior. This is a dependency-boundary change,
not a presentation rewrite. The first page-side slice now gives repository,
settings, trust, provider availability, SSH state/connect, agent detection,
repo hooks, and runtime capabilities strict named schemas and grants.
Repository and SSH identities are shell-session-scoped opaque handles; host
paths, remote identities, real SSH target IDs, raw SSH errors, and configured
agent commands do not cross the bridge. Source searches, exact lookups, hosted
base resolution, and create use strict named contracts. Creation consumes a
recent native-observed gesture, resolves opaque repository authority, repeats
GitHub/GitLab/Linear identity and PR/MR base resolution natively, derives
idempotency support from native runtime state, resolves configured agent launch
commands only in native, and returns an opaque created-workspace handle. The
complete web adapter is injected explicitly into the shared hosted route.
Focused page-client-to-schema-to-broker tests pass; emulator visual,
interaction, focus, and IME parity are still required before the flow can count
as migrated.

The Tasks workspace-creation tail now uses this same boundary. Linear
connection, workspace selection, state updates, comments, issue reads, and
top-level/subissue creation cross bounded named operations; GitHub/GitLab issue
creation receives opaque repository authority. Sparse-preset list/save and
final creation no longer call RPC from the presentation. Before creation, the
shell reloads GitHub/GitLab/Linear identity, resolves PR/MR base and fork push
targets, derives agent commands and runtime idempotency support natively, and
preserves sparse checkout plus host warnings. Only the new opaque workspace
handle returns to the page.

The dedicated Files route now follows the same source-sharing rule. Native and
hosted entries mount the existing `MobileFileExplorerPanel`; the presentation
receives a named directory/reconnect interface instead of calling transport
directly. Native preserves the current `files.readDir` behavior and its
old-Desktop `files.list` fallback. Hosted reads the existing bounded
`file.directory` operation with the opaque workspace handle and asks the native
shell to reconnect through the gesture-gated navigation capability. The route
adds no copied file-tree JSX, styles, row behavior, or navigation presentation.
The dedicated Preview route likewise mounts the existing
`MobileFilePreviewScreen` with a named native/web operations boundary.
Workspace files retain their existing text, Markdown, HTML, and image
presentation while hosted reads carry only an opaque workspace handle and
relative path. Reconnect and external links remain native-shell capabilities.
Absolute host paths and native terminal-artifact grants are rejected before
bridge dispatch; terminal artifacts opened from a hosted session already use
the session's opaque file authority. The dedicated Source Control and Review
routes now mount their same existing presentations through strict hosted
adapters, and provider-neutral History/PR compatibility redirects are present.
The iPhone 17 Pro Simulator passes Session-origin changed-file handoff and
standalone Review. The exact Pixel 9 Pro API 36 arm64 Debug APK now passes the
same unchanged Source Control, second Session diff-tab, and standalone Review
journey after a fresh native build/install. Android accessibility drives the
real controls, the deliberate-red isolation corpus records zero escaped
traffic, and fresh logcat contains no bridge rejection, Kotlin conversion/cast
failure, or fatal process error. The final post-rebase run uses independently
verified build
`f852d8525d2b0e20d79262d74ce3ef74bfa73c3e55b95176bfb1b467beafae61`.

The host-only router now imports the existing
`mobile/app/h/[hostId]/session/[worktreeId].tsx` route directly; a
source-identity test prevents that wrapper from growing copied presentation.
The complete unchanged session dependency graph first exported through React
Native Web at 3,878 modules. That source-mount checkpoint intentionally
preceded the named session, terminal, browser, dictation, device, file, and
native-chat operation boundaries described below.

The first shared-session runtime boundary is now active.
`HostSessionTabOperations` maps the existing screen's tab snapshot,
subscription, blank-terminal creation, activation, and explicit close behavior
to native or hosted adapters. Native preserves the current caller-local Desktop
RPC semantics. The hosted adapter uses only `session.snapshot`,
`session.subscribe`, `session.create`, `session.activate`, and `session.close`,
maps ready terminal tabs to page-local tab keys, supplies no host path or
terminal handle, and preserves close refusal instead of optimistically removing
the tab. The existing empty-session auto-create and explicit blank-terminal
action now use that boundary.

Agent and saved Quick Command creation now use the same presentation-preserving
boundary. The page requests a bounded agent ID or saved-command ID; the shell
reloads current settings, detected agents, and saved commands before admitting
the mutation. Quick Command snapshots expose only global/current-repository
rows, replace durable repository identity with the opaque workspace handle, and
retain the authoritative total count without exposing other-repository rows.
Targeted mutations reject guessed cross-repository delete or upsert IDs.
Executable commands use host shell-ready delivery, while insert-only text is
returned as a bounded value and sent through the existing ordered terminal
adapter only after the new subscription is ready. Configured command text and
agent launch commands are never accepted from hosted JavaScript. Terminal
interaction/recovery parity and nonterminal content/native capabilities remain
open.

The next shared-session boundary now connects that unchanged terminal
controller to `HostSessionTerminalOperations`. Native maps it to the existing
binary terminal subscription and `terminal.send` behavior. Web maps the opaque
page-local tab key to the bounded `terminal.subscribe`, ACK, input, query-reply,
resize, visibility, resync, and cancel protocol. The existing
`TerminalPaneView` remains shared; only its `TerminalWebView` implementation is
platform-resolved so the hosted build runs xterm directly instead of nesting a
second WebView. Snapshots and output reach the same imperative `init`/`write`
contract, and the page releases output credit only from the surface's parsed
callback. Buffered, live, accessory, and validated gesture input now use the
named operation boundary. Host handles, paths, durable client IDs, and raw host
errors do not enter the page.

This is a functional stream boundary, not completed terminal parity.
Display-mode toggles, foreground recovery, file taps, selection/copy, and
both terminal link destination policies now pass on the iOS Simulator through
the unchanged route. Full resize/reflow, persisted pinch text zoom, clipboard
paste end-to-end evidence, native-chat emulator parity, WebGL fallback, and
physical-device performance evidence remain open. Clipboard and picker
execution now stays in the shell behind typed, terminal-ordered operations;
the system Photos picker opens from the unchanged Attach control. The existing
terminal JSX, styles, tab composition, input affordances, and view models were
not replaced.

Dictation follows the same presentation-preserving boundary. The existing mic
controls, setup drawer, model list, transcript routing, toasts, haptics,
toggle/hold behavior, and composer remain shared. Hosted code calls a narrow
`HostSessionDictationOperations` interface for setup reads/mutations,
download/delete, start/stop/cancel, and a typed lifecycle subscription. The
native shell owns permission, keep-awake, `@orca/expo-two-way-audio`, PCM,
backpressure, and the Desktop speech session. PCM goes directly from shell to
Desktop and never enters hosted JavaScript; the page receives only bounded
setup metadata, status/reason events, and a bounded final transcript.

The paired iPhone 17 Pro Simulator passes the complete local speech checkpoint:
the unchanged mic control exercised native permission, routed
`voice_dictation_disabled` into the existing setup drawer, loaded and mutated
Desktop setup state, downloaded and selected Whisper Tiny, recorded through
the native shell, processed on Desktop, and inserted the returned transcript
into the existing composer. The simulator cannot safely instantiate the iOS
voice-processing unit or accept a forced 16 kHz input tap, so simulator capture
uses CoreAudio's native format and reports its real sample rate for existing
Desktop resampling. Real-device voice processing remains unchanged.

The Pixel 9 Pro API 36 emulator now passes the corresponding Android shell
checkpoint. With an existing grant, the shell reads permission without opening
the permission controller, records sustained 16 kHz mono PCM, reaches the
unchanged `Listening` state, and stops back to idle. From a revoked state, the
real Android permission activity can grant access and return directly into the
same recording flow; denial returns to the unchanged idle UI. The permission
activity exposed a foreground-lifecycle defect: the blanket background
interruption invalidated the start that owned the prompt. The speech authority
now exempts only its in-flight shell permission transition, waits for the app
to become active, and revalidates the exact generation before initializing
audio. Disconnect, client replacement, and later background transitions still
cancel normally.

Android terminates the application process when `RECORD_AUDIO` is revoked
during active capture. A real mid-record revocation therefore exercised process
loss rather than an in-process callback: cold launch restored the verified
package and exact hosted session, and a subsequent recording succeeded,
proving the disconnected Desktop speech authority was released. These emulator
results now also cover an ordinary Home transition during active capture:
speech stopped, the same hosted session and process remained, and a second
recording started and stopped after foreground return.

The Android output half of two-way audio now has exact native evidence too.
The first linked-module probe exposed two loss paths in the existing engine:
positive partial `AudioTrack.write()` results discarded their unwritten tails,
and pausing an in-flight write returned zero, which also ended the sample. The
writer now drains partial results and uses an active playback gate to wait
across Pause/Resume, retry zero progress, and wake on resume or cancellation.
Kotlin tests cover partial draining, pause progress, cancellation, zero/error,
and oversized results. The rebuilt exact Debug app queued 64,000 PCM bytes,
paused and resumed, wrote all 64,000 bytes across two native writes, emitted
nonzero output volume with a 0.6661 peak, logged Stop, and reported
`isPlaying=false`. Debug assembly and Release Kotlin compilation pass. This is
emulator output evidence; simultaneous real-device capture/playback,
real-device voice processing, physical-device, security, and performance gates
remain open.

The browser migration follows the same preservation rule. The existing
`MobileBrowserPane` remains the rendered component and now accepts named
native/hosted operations without changing its JSX, styles, gestures, address
field, dialogs, or control layout. The hosted path exposes only
shell-session-scoped opaque page handles, assembles bounded 128 KiB screencast
frame chunks, and supports typed pointer, scroll, keyboard, dialog, navigate,
reload, Back, and Forward operations. Browser URLs and raw Desktop page IDs do
not become bridge authority. Native and hosted event sanitizers admit only the
bounded event union, including navigation state. CDP navigation history and
Electron main-frame navigation triggers update `canGoBack` and `canGoForward`.
Focused browser tests pass, including the main-frame navigation event path.

The iOS Simulator now passes the browser control checkpoint against one current
pairing server. The unchanged hosted UI created and enumerated an offscreen
browser tab, navigated from blank to two HTTPS pages, enabled Back and Forward
from authoritative history, returned in both directions, reloaded, survived
portrait/landscape rotation, closed and reopened, inserted text into a focused
page form field, and moved focus with the existing Tab key. CLI tab state and
page evaluation matched the hosted UI without exposing the raw page ID to page
JavaScript.

An earlier false failure came from five leftover development pairing servers
advertising the same LAN address: the simulator held connections to two stale
builds while CLI commands targeted the newest runtime. Browser/device fixtures
must therefore prove a single selected runtime ID and connection before
interpreting cross-surface state. Android, physical-device, Relay/SSH/WSL,
performance, and adversarial browser evidence remain open.

The latest raw export produces a 7,145,787-byte script (1,506,128 bytes gzip)
plus 4,622 bytes of xterm CSS, compared with 4,839,155 bytes (893,065 bytes
gzip) before the session route import. The production post-processor now turns
that export into 49 relative, content-addressed assets totaling 7,198,343 bytes.
Two consecutive runs produced build
`3d164ad8dc3cc30e1feac7802199a292c14e9f2d1f8c7398ab09b074e3b4358b`.
The package is accepted by `MobileWebPackageAssets`, contains no remaining
`eval` or `new Function`, and fails if any of the three reviewed Metro/runtime
code-generation transforms stop matching.

The authoritative route now has a separately reviewed ceiling of 10 MiB total,
3 MiB gzip, 9.5 MiB scripts, 256 KiB styles, and 64 assets. The ceiling grew
from 8 MiB / 2 MiB / 7.5 MiB only after the legacy Mermaid CDN executable was
replaced by the locally bundled, network-denied engine needed by both native
and RNW without forking the existing UI. Boundary tests reject every
measurement above its ceiling. The current 49-asset package is 9,328,523 bytes
/ 2,697,136 bytes gzip and build
`4b7df7d47a9b949b788c9f88bac5f68e8b18eb1ea7c615e16ebc4be126c8d07d`.
`build:mobile-web` and release resource mapping therefore select the RNW
package; the original 2 MiB ceiling continues to govern only the isolated Vite
infrastructure fixture. Workspace snapshots now page through
opaque single-use cursors:
each page is capped at 200 rows and 120 KiB, the stable native-only source
snapshot is capped at 10,000 rows and 8 MiB, and lifecycle cleanup revokes every
continuation. New Workspace emulator parity, native-chat
prompt-card/topology parity,
notification/deep-link lifecycle evidence, and remaining native-capability
adapters remain cutover gates.

The 10 MiB per-asset ceiling is enforced by the shared schema, Desktop package
provider, Swift store, and Kotlin store. A source-contract regression checks
both native values against the shared constant. This alignment became a runtime
requirement when the locally bundled Mermaid engine made the entry script
larger than the former 8 MiB native ceiling: the stale limit produced
`staging_failed` and silently retained a previous healthy generation. After
aligning the stores and rebuilding the CLI, Electron runtime, and exact
ad-hoc-signed Debug app, a fresh iPhone 17 Pro Simulator pairing staged the
current package without fallback and passed the existing network/navigation
isolation gate. The launcher now also resolves the accessible `Pair` control
instead of assuming a normalized coordinate, preventing an existing simulator
profile from making the gate target the wrong host.

The shell connection envelope also carries only the bounded retry count and
last-connected timestamp needed by the existing mobile connection classifier.
The hosted screen therefore preserves the current escalation from
“Reconnecting…” to “Can’t connect,” including the never-connected case, without
receiving an endpoint, credential, or durable host identifier.

`HostScreen` also receives a `HostScreenShellOperations` boundary for leaving a
host, internal route navigation, reconnect, pairing repair, and paired-host
removal. The native adapter preserves the existing Expo Router and host-store
behavior. The web adapter keeps workspace routes page-local and sends only
named `navigation.route`, `navigation.reconnect`, and
`navigation.removeHost` intents to the native broker. Removal accepts neither a
host ID nor a public key from the page; the broker resolves the selected host,
requires a recent native-observed WebView touch, consumes that gesture once,
and runs the existing cache/credential/client cleanup lifecycle.

Agent Session History now follows the same exact-source rule. Native and hosted
controllers render one shared copy of the existing panel/list presentation.
The hosted controller requests filtered history through 64-row, single-use
opaque pages and loads at most five bounded preview turns only when a row is
expanded. The shell owns the current native sessions behind random handles;
cwd, transcript paths, provider session IDs, execution-host identity, raw scan
issues, settings, and commands never enter the page result.

Resume consumes one recent native-observed gesture. The shell freshly resolves
worktrees, repositories, project/folder metadata, host platform, and resume
settings, prepares legacy sessions where required, generates the provider
command, and performs idempotent terminal creation/input. The page receives
only a blocked presentation message or the opaque target workspace/name needed
for page-local navigation. Client replacement, host switch, and broker teardown
revoke session handles and pending pagination. Focused production
broker/client/resume tests and verified RNW package `c24ff987…` pass. The
actual iOS WKWebView now passes the unchanged Agent History route, all three
scopes, deterministic lazy preview, search/no-match/clear, native rejection of
an untrusted synthetic Resume, a native accessibility-tree touch Resume that
creates a second terminal and navigates to the Session route, and verified Back
navigation. A fresh-profile run also stopped and relaunched the paired Desktop
runtime on the same endpoint. The hosted bridge moved through `recovering`,
failed retries, and `connected` while the exact Agent History route and fixture
remained rendered; native Resume and Back still passed after recovery. The
unchanged Agent History presentation intentionally gained no reconnect banner.
The populated portrait route now also has an automated native-versus-hosted
screenshot gate on the iPhone 17 Pro / iOS 26.5 Simulator. It masks only the
changing status bar and observed 2.2677% changed pixels against a 3% budget,
mean channel difference 2.5663 against 4, and vertical shared-header landmark
delta 0.00075 against 0.005. Horizontal accessibility centers remain
diagnostic-only because native iOS reports a full-width text frame while RNW
reports the glyph-width frame. The disposable E2E pairing profile now captures
its own daemon PID and awaits targeted shutdown at final teardown; the passing
profile left no runtime or daemon process. This is one populated portrait
and landscape fixture; landscape observed 2.4386% changed pixels and mean
channel difference 2.8236 within the same budgets. Rotated WKWebView did not
expose the hosted title through native AX, so landscape is pixel-only and that
accessibility finding remains open. This is not completion of the phone/tablet,
shell-state, route,
screen-reader, or physical-device matrix.

The Pixel 9 Pro API 36 emulator now exercises that same hosted Agent History
presentation in a freshly installed paired app. Workspace/Project/All scopes,
lazy preview, search/no-match/clear, synthetic privileged-resume rejection, and
native-touch resume into a second Session tab pass. The same authenticated
WebView then opens Source Control, a changed file as a third Session tab, and
standalone Review before passing the network/navigation isolation probes and
fresh Android bridge-log audit.

Native route ownership now has exact-app lifecycle evidence too. A
gesture-gated request from the unchanged hosted Session records only a
request-scoped Terminal Settings intent, posts the broker success response, and
then awaits a view-scoped native command before pushing the existing Expo Router
screen. Swift and Kotlin synchronously stop loading, clear the active private
session, hide the WebView, and remove it from the native hierarchy before the
Promise resolves. This avoids a blurred `react-native-screens` route retaining
WKWebView above native shell UI. Focus explicitly reactivates the same package
session; it does not download, reopen, or replace the hosted application.

A fresh iPhone 17 Pro / iOS 26.5 Simulator build and the full exact-app Direct
journey now pass hosted Session → native Terminal Settings → Back to the
identical hosted route. The same run also passes native onboarding,
network/navigation isolation, populated Agent History portrait and landscape
budgets, Desktop restart/E2EE recovery, synthetic-gesture rejection,
native-touch Resume, and return to Session. Source-ownership tests keep
settings, onboarding, privacy, about, and diagnostics out of the desktop-served
route graph. The remaining native destinations, broader Android feature matrix,
accessibility, physical devices, and permission lifecycle matrix remain gates.

Migration work is complete only when the app covers:

1. Host home, worktree list, active state, workspace entry, and reconnect state.
2. Session/tab creation, switching, closing, persistence, agent state, prompts,
   approvals, and questions.
3. Real terminal attach/spawn/input/output/resize/recovery and mobile input
   affordances.
4. File tree, search, preview, editing, Markdown, images, terminal artifacts,
   and bounded chunked reads/writes.
5. Git status, stage/unstage/discard, commit, branch/history, pull/push/rebase,
   diff/review, and provider-neutral review behavior including GitLab paths.
6. Tasks, host account selection, browser controls, and other host-specific
   workspace surfaces currently exposed by mobile.
7. Native chat/session flows, attachments, dictation, audio, picker, clipboard,
   haptic, notification, and deep-link integration through capabilities.
8. Empty, loading, offline, incompatible, permission, partial-data, and error
   states for every surface.

The existing mobile styles and `mobile/src/theme/mobile-theme.ts` remain the
rendering source of truth. `docs/STYLEGUIDE.md` still governs later product
changes, but this migration must not restyle the current UI to use desktop
tokens or shadcn primitives. React Native Web output must preserve the computed
mobile values and accessibility semantics.

## Native Shell Responsibilities

The native shell remains a useful product rather than a generic browser
wrapper. It permanently owns:

- Onboarding, QR scanning, pair confirmation, host selection, secure-store
  credentials, E2EE connectivity, Relay/direct endpoint management, and
  connection diagnostics.
- Notification enrollment, presentation, actions, and deep-link intake.
- Microphone/audio session lifecycle and `@orca/expo-two-way-audio`.
- Camera, photo/file pickers, clipboard mediation, haptics, safe areas, and
  platform permission prompts.
- Package download, verified cache, activation, crash-loop detection,
  compatibility UI, WebView process recovery, and storage cleanup.
- Native settings, privacy/about screens, troubleshooting, and an accessible
  App Review/demo path.

The shell must render connection and recovery UI without loading a desktop
package. A corrupt cache, missing desktop, incompatible bridge, or terminated
WebView must never strand the user on an uncloseable blank surface.

## Offline, Reconnect, and Host-Switch Semantics

| Event                          | Required behavior                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Cold launch, desktop reachable | Validate persisted host/workspace identity, render active verified cache, then freshly resolve route |
| Cold launch, desktop offline   | Render last healthy package with native offline state; defer route resolution until connected        |
| No verified cache and offline  | Show native connection/retry/host-switch UI; never render unverified bytes                           |
| Connection interrupted         | Preserve bounded view state, disable mutations, reconnect native transport, then refresh/resubscribe |
| Desktop build changed          | Finish and verify complete generation; activate only at a safe navigation boundary                   |
| Host switched                  | Revoke old bridge session and streams before mounting the new host/build                             |
| Pairing removed                | Clear resume route, close WebView, cancel resources, then delete credentials and host cache          |
| WebView process lost           | Cancel streams, relaunch last healthy generation, restore from desktop snapshots                     |
| New generation crash-loops     | Mark it unhealthy and atomically reactivate the previous verified generation                         |

### Shell presentation and accessibility contract

Shell rendering is a small explicit state machine, independent of feature UI:

1. no selected paired host renders the host picker;
2. a selected host without an active session renders first-package loading or
   package-unavailable recovery;
3. an active verified session always keeps the hosted interface mounted,
   including while refresh, offline, reconnect, and retained-cache warnings are
   present.

Host-picker loading, failed, empty, and ready states are resolved separately.
Package refresh errors are classified before presentation. In particular, an
incompatible package has dedicated copy for retained-cache and no-cache cases;
an asynchronous cache-open failure is only a fallback hint and cannot overwrite
the more authoritative refresh result.

These shell states preserve the existing visible composition. The only
migration-specific semantic additions are explicit button names/roles for shell
navigation and host recovery, polite live-region announcements for loading,
and alert semantics for failures and warnings. Feature-level semantics remain
owned by the exact shared React Native screen/component source.

The complete UX-state and accessibility/input ownership matrices live in the
feature-parity inventory. Their completion freezes required behavior; it does
not close live VoiceOver/TalkBack, software/hardware keyboard, IME, dictation,
gesture, selection, reduced-motion, Dynamic Type/zoom, tablet, Android, or
physical-device gates.

Offline cached UI is not offline workspace data synchronization. Repository
content may remain in bounded page memory for continuity, but the page must not
present stale mutable operations as current or queue destructive mutations for
later replay.

## Proposed Repository Layout

Names may move during implementation, but responsibilities must stay separated:

```text
mobile/host-web-app/
  _layout.tsx                  host-only Expo Router composition
  index.tsx                    bridge-selected host entry
mobile/src/
  components/                  shared native and React Native Web presentation
  files/                       shared file presentation and view models
  session/                     shared session presentation and view models
  source-control/              shared source-control presentation and view models
  mobile-web-runtime/          page-side typed adapters and capability client
src/shared/mobile-web/
  manifest-contract.ts         package schema and limits
  bridge-contract.ts           request/response/capability schemas
  terminal-stream-contract.ts  sequencing and backpressure contract
src/main/runtime/rpc/
  mobile-web-package-store.ts  bundled artifact lookup and chunk reads
  methods/mobile-web.ts        manifest/asset RPC methods
mobile/src/hybrid-shell/
  package-download.ts          bounded download and verification
  package-cache.ts             per-host generations and activation
  bridge-broker.ts             capability dispatch and lifecycle
  bridge-capabilities/         concrete native/host adapters
  HybridWorkspaceScreen.tsx    native recovery chrome and WebView owner
mobile/packages/expo-mobile-web-shell/
                               private asset origin and locked native WebView
config/
  mobile-web-package.ts        deterministic Expo Web package post-processing
```

The existing `src/mobile-web/` DOM presentation is a temporary infrastructure
validation harness. Remove it when its bridge consumers have moved behind the
shared React Native presentation adapters.

Production names must drop `prototype`. Do not leave production behavior split
between the experimental screen and a second implementation.

## Single-PR Implementation Plan

The PR is one integration boundary, not one undifferentiated commit. Keep it in
draft and land the following commits in dependency order. Every commit must
typecheck and pass its focused tests so reviewers can inspect contracts before
feature UI.

### 1. Freeze contracts and parity inventory

- Record every current mobile route, RPC, subscription, native capability,
  loading/error state, analytics event, and accessibility behavior.
- Add production manifest, bridge, stream, compatibility, and error-code
  schemas with contract tests.
- Document hard resource limits and the supported shell bridge range.

### 2. Add the deterministic mobile web build

- Add the dedicated host-only Expo Router entry, React Native Web
  lint/typecheck/test setup, deterministic package post-processing,
  manifest generator, bundle-size report, and packaging in every desktop
  distribution.
- Verify macOS, Linux, Windows, headless, and SSH-served release layouts use
  path-safe lookup and do not depend on the source checkout.

### 3. Replace prototype delivery with production package RPC

- Serve the manifest and content-addressed assets through bounded chunk RPCs.
- Preserve the mobile RPC allowlist and register every method explicitly.
- Add concurrency, offset, size, cancellation, disconnect, and build-change
  handling.

### 4. Add native asset origin and generation cache

- Implement the Expo native WebView/asset module on iOS and Android.
- Add host-isolated staging, verification, atomic activation, two-generation
  recovery, crash-loop detection, quotas, and pairing-removal cleanup.
- Migrate the proven prototype cache tests to production contracts and add
  corrupt-cache, partial-write, process-kill, and low-storage tests.

### 5. Add the production bridge broker

- Generate page and native types from the same schemas.
- Implement capability negotiation, origin/session checks, rate/size limits,
  cancellation, subscription cleanup, user-gesture grants, and stable errors.
- Map host operations to explicit mobile-allowlisted RPCs without a generic
  passthrough.

### 6. Share the existing mobile presentation with the web runtime

- Extract route wrappers from presentation only where required; render the same
  screen components through React Native and React Native Web.
- Add routing, transport, persistence, nested-view, and native-capability
  adapters without changing public screen/component behavior.
- Keep `HostWorkspaceOperations` as the first shared boundary: native and web
  adapters now cover workspace/repository snapshots, view settings,
  activate/pin/sleep/remove, invalidations, and bounded continuation pagination.
  Add the remaining host-screen dependencies before claiming workspace-list
  parity.
- Keep `HostWorkspaceCreationOperations` as the existing New Workspace UI
  boundary. Map each read, search, trust, SSH, base-resolution, and create
  action to a strict named bridge operation; never add `sendRequest`, a host
  method-name field, a durable repository/connection ID, or a raw host error to
  the page contract.
- Keep paired identity, last-connected history, native list caches, and local
  pin persistence behind `HostScreenHostState`. The hosted page receives
  shell-supplied identity and no-op page persistence; it must never own or
  overwrite those native records.
- Add deterministic native-versus-web screenshot and interaction fixtures for
  phone, tablet, portrait, landscape, loading, offline, error, and populated
  states. Populated Agent History portrait now passes the first calibrated
  pixel and vertical safe-area fixture; the remainder of the matrix stays open.
- After every rebase, reconcile upstream mobile presentation changes through
  the shared source and rerun the parity fixtures; do not preserve an older
  forked snapshot for the web runtime.
- Remove the purpose-built `src/mobile-web/` presentation as each shared screen
  reaches parity; keep only the web entry, bridge client, and runtime adapters.

### 7. Adapt workspace and session surfaces

- Reuse the existing worktree, session/tab, agent-state, prompt,
  approval/question, native-chat, attachment, and persistence presentation.
- Replace direct transport/native dependencies behind the shared adapter
  contracts without replacing the UI.
- Verify stale responses and subscriptions cannot cross workspace or host
  boundaries.

### 8. Migrate and gate the real terminal

- Integrate the actual xterm engine and production stream contract.
- Preserve all current mobile keyboard, IME, dictation, accessory, input-floor,
  query-reply, file-link, WebGL recovery, and foreground recovery behavior.
- Run sustained Direct, Relay, and SSH benchmarks before continuing to cutover.

### 9. Adapt files, diffs, and source control

- Reuse the existing file explorer, previews, diff review, source-control hub,
  comments, staging, commits, branches/history, sync/rebase, and
  provider-neutral review presentation.
- Route their existing actions through bounded web-runtime adapters rather than
  maintaining the parallel prototype components.
- Preserve Git 2.25 compatibility because execution remains on native, WSL, or
  SSH hosts with different Git versions.

Current progress covers bounded hierarchical reads, inert text previews,
revision-checked virtualized diffs, live Git status, and bounded optimistic
editing of complete UTF-8 files up to 128 KiB. Writes capture native/SSH
execution ownership, require the SHA-256 revision of the opened bytes, re-read
immediately before existing Desktop write authority, and validate exact result
identity; this is conflict detection rather than a filesystem-atomic
compare-and-swap. The source-control slice includes revision-bound single and
32-path stage/unstage/discard plus exact-snapshot commit and generated
commit-message behavior through existing Desktop RPC authority. It also covers
bounded local branches, sanitized history, branch/commit comparisons, strict
checkout and synchronization, provider-neutral hosted-review discovery,
GitHub/GitLab details and top-level comments, GitHub inline replies, and
GitHub/GitLab thread resolve/reopen. Bounded inline creation now validates the
fresh review head plus a retained safe path and modified-side line while keeping
raw patches, provider targets, and GitLab diff refs native-only. Dedicated,
revision-checked review diff pages and exact retained-thread navigation now use
the same bounded row renderer without conflating hosted and working-tree state.
Bounded queued drafts now submit GitHub comments/verdicts or GitLab comment-only
reviews after exact repository/review/action/line preflight, and ambiguous
outcomes require refresh before replay. Rich previews, review creation if
required, remaining-provider contracts, safe live provider reads/mutations,
topology coverage, a successful live AI-generated draft, and adversarial
validation remain gates. The exact iPhone 17 Pro Simulator app now opens the
unchanged Source Control hub from Session, sends a changed file through the
headless Desktop review capability into a second Session diff tab, and
independently renders standalone Review with its existing controls. The same
run passes private-origin network and navigation isolation. The exact Pixel 9
Pro API 36 arm64 Debug APK passes the matching route journey and isolation
corpus after a fresh build/install, with a clean native bridge log audit.

### 10. Adapt remaining host features and native capabilities

- Reuse the existing tasks, accounts, browser, and session presentation while
  adapting clipboard, pickers, haptics, audio, notification routing, and any
  parity-inventory remainder behind platform contracts.
- The Tasks route remains the presentation source. Its first extraction moves
  clipboard writes, medium-impact haptics, and external URL opening behind a
  named native/web device boundary. Typed read and preference adapters now
  cover bootstrap state, repositories, Linear context, GitHub repository
  identity, resume/default/project preferences, and setup trust. The broker
  projects bounded data and translates opaque repository handles. Branch
  search, SSH state/connect, agent detection, and repository-hook reads reuse
  the existing strict New Workspace operations. GitHub work-item list/count,
  GitLab work-item list/todos, and Linear issue list/search now cross named,
  bounded provider operations; real repository IDs remain shell-only. The same
  boundary now covers GitHub labels/users/details, GitLab details, and Linear
  issue/comments. GitLab host/path targets are retained behind revocable opaque
  handles and cleared with the shell session. GitHub Project discovery, view
  listing, pasted-reference resolution, table snapshots, row details, labels,
  assignable users, and issue types also use named bounded reads. Native
  validates and retains the stable table snapshot; the hosted adapter
  reconstructs the existing presentation model from 50-row, approximately
  180 KiB pages behind opaque single-use continuations. Project item
  title/body/state, issue comments, labels/assignees, fields, and issue types
  now cross named mutations using opaque row targets. Before every write, the
  shell reloads the authoritative table and revalidates the row identity and,
  for field writes, current field membership. Project PR thread resolution,
  replies, conversation comments, reviewer requests, check reruns, and merge
  also require the opaque Orca repository handle to resolve to the same fresh
  row slug. Project check refresh, viewed-file state, file contents, and inline
  comments now cross a separate named boundary with the same row/repository
  revalidation. File content is capped at 256 KiB per side and 600 KiB per
  response, and page authority fields are stripped before Desktop RPC.
  Non-Project GitHub/GitLab status and metadata writes now receive only
  revocable opaque item targets; the shell re-fetches current provider details
  before invoking the existing Desktop mutation. Top-level comments, reviewer
  requests, thread resolve/reopen, inline replies, and merge use the same
  target model. Non-Project check refresh/reruns, viewed-file state, file
  contents, and inline comments now use a separate named boundary. The page
  never supplies repository, PR number, SHA, pull-request-node, old-path, or
  file-status identity; the shell reloads current PR details, validates exact
  file membership, and derives those values before Desktop RPC. File contents
  retain the 256 KiB-per-side and 600 KiB-response bounds. Linear
  setup/mutations and GitHub/GitLab issue creation now cross strict named
  projections with fresh native provider authority. Sparse-preset list/save and
  final workspace creation reuse the New Workspace domain contract, including
  native PR/MR/Linear revalidation, sparse checkout, warning propagation, and
  opaque created-workspace results. The hosted router now injects those
  adapters into the unchanged route. Host 34 passed real workspace/Tasks entry,
  GitHub query/error recovery, provider/Linear setup surfaces, back navigation,
  rotation, and background/foreground on iOS Simulator. Provider-authenticated
  destructive mutations, Android, physical devices, topology, accessibility,
  and adversarial evidence remain cross-cutting gates.
- The existing Accounts screen now runs unchanged on native and hosted routes.
  Its strict snapshot/select/subscribe boundary exposes only bounded
  presentation state, gesture-gates selection, and retires subscriptions on
  every client and route lifecycle edge.
- Treat the existing browser pane as the source of truth. Its named operation
  adapter, opaque page authority, bounded frame transport, and typed input,
  dialog, and navigation events are implemented; iOS Simulator history,
  rotation, close/reopen, and page keyboard behavior pass. Android,
  physical-device, topology, performance, and adversarial validation remain
  gates.
- Treat the existing dictation controls and setup drawer as the source of
  truth. The shell-owned PCM and Desktop speech bridge now pass the iOS
  Simulator lifecycle plus Android permission, recording, stop, denial, and
  revocation/process-loss recovery. Android also passes ordinary background
  interruption and byte-exact pause/resume output playback. Finish simultaneous
  real-device capture/playback, voice processing, physical-device, and
  adversarial evidence.
- Require native confirmation or permission for privileged capabilities.

### 11. Complete adversarial, integration, and device validation

- Run all matrices below, capture benchmark artifacts, resolve security review,
  and test the production package rather than prototype HTML.
- Submit the production-shaped build from the PR branch to App Review with the
  accessible review host and accurate notes.

### 12. Cut over and remove duplicate workspace UI

- Make the hybrid workspace route the default only after every gate passes.
- Remove the experimental entry and the parallel `src/mobile-web/`
  presentation. Retain the shared React Native screen/component source used by
  React Native Web; remove only superseded route/runtime adapters.
- Keep native pairing, recovery, permissions, settings, and diagnostics.
- Build the final exact release candidate, rerun smoke/performance/security
  checks, and resubmit if the binary materially differs from the accepted
  review build.

### 13. Final documentation and release evidence

- Update architecture, support, privacy, App Review, diagnostics, and developer
  documentation.
- Attach feature-parity results, physical-device benchmarks, security findings,
  screenshots, review notes, and rollback drill output to the PR.

## Testing Matrix

### Automated

- Manifest canonicalization, traversal/encoding rejection, all limits, hash
  mismatch, build change, chunk order, cancellation, and concurrent downloads.
- Cache partial writes, atomic activation, host isolation, corruption on read,
  quota eviction, previous-generation recovery, and pairing removal. Automated
  cross-platform fixtures now cover host isolation, interrupted-stage cleanup,
  incomplete/corrupt generations, corruption after open, low-space rejection,
  safe per-host/global eviction, selected-host removal, previous recovery, and
  corrupt-active cold fallback. Real process-kill store tests and exact
  iOS/Android simulator crash-loop rollback pass. iOS Simulator manual previous,
  cache-clear/redownload, and offline corrupt-active recovery pass; the Android
  emulator passes the same manual and corrupt-active recovery slices.
  Physical-device storage-pressure and final-candidate rollback drills remain.
- Bridge schemas, compatibility ranges, unknown capability, stale session,
  origin mismatch, message/concurrency/rate limits, cancellation, and
  gesture-bound capability expiry. Automated faults now also cover bounded
  replay rollover, retired subscriptions, distinct subscription/request IDs,
  malformed version envelopes, frame spoofing, client replacement, and delayed
  retired-client results.
- Terminal sequence gaps, duplicate frames, ACK window, overflow/resync,
  input/query/resize ordering, hidden/foreground recovery, disconnect, WebView
  loss, and host switch.
- Every migrated feature's view models, RPC adapters, mutations, optimistic
  state, provider branches, and failure states.
- CSP snapshot, XSS corpus, external navigation, iframe/popup/download/service
  worker attempts, malicious Markdown, and bridge fuzzing.
- Mobile web unit/component tests, native shell tests, main RPC tests, desktop
  package tests, end-to-end paired tests, typechecks, lint, max-lines ratchet,
  format check, and release builds.

### Platforms and topology

| Dimension           | Required coverage                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| iOS                 | Oldest supported low-memory phone, current phone, current tablet, current simulator                                     |
| Android             | Oldest supported low-memory device/API, current phone, current tablet/emulator                                          |
| Desktop             | macOS Intel/Apple Silicon as supported, Windows, Linux, headless Linux                                                  |
| Connectivity        | Direct LAN, Relay, high latency, packet interruption, offline launch, reconnect                                         |
| Execution           | Native host, WSL where applicable, SSH workspace, SSH disconnect/reconnect                                              |
| Lifecycle           | Fresh pair, multiple hosts/versions, cold/warm launch, background, rotation, process loss, host removal                 |
| Input/accessibility | Hardware/software keyboard, IME including composition, dictation, VoiceOver/TalkBack, Dynamic Type/zoom, reduced motion |

### Feature journeys

- Pair, select a host, switch between two hosts on different desktop versions,
  remove one, and verify no state or response crosses hosts.
- Create/open a workspace and session; handle approval/question; attach a photo
  or file; use dictation/audio; receive and follow a notification.
- Spawn/attach a terminal, run sustained and bursty output, type during output,
  resize/rotate/background, disconnect/reconnect, and recover after WebView loss.
- Browse/edit files, render Markdown/image/large files, inspect a large diff,
  comment, stage/unstage/discard, commit, pull/push/rebase, and exercise both
  GitHub and GitLab review branches.
- Cold-launch each host from verified cache while Desktop is offline, then
  reconnect and stage a new desktop-matched package without replacing the
  running page.
- Corrupt the staged and active packages, exhaust the package quota, interrupt
  writes, and prove native recovery remains usable.

## Performance Acceptance

Record the current native app on the same devices before setting final budgets.
At minimum, the release candidate must meet all of these:

- Cached host entry is no more than 20% slower than the current native route and
  reaches an interactive frame within two seconds on the lowest supported test
  device.
- Package refresh never blocks launch when a healthy cache exists and never
  activates partially.
- Terminal output has zero dropped, duplicated, or reordered bytes; input
  latency and frame pacing remain usable under the existing terminal stress
  fixtures and a real high-output command.
- The terminal bridge has a measured hard memory bound under foreground,
  background, and disconnected floods.
- A real 4,000-row diff scrolls and interacts without repeated long tasks,
  progressive memory growth, or WebView process loss.
- Ten repeated host/session/terminal/diff cycles show no progressive slowdown;
  a 30-minute sustained session remains within the recorded memory budget.
- First package download, hash verification, cache read, and activation are
  separately measured over Direct and Relay paths.
- Battery, thermal behavior, and WebView GPU fallback are acceptable on at
  least one low-end physical iOS and Android device.

The simulator numbers in this document are a baseline for investigation, not
the pass threshold for the real app.

## Security Acceptance

- No long-lived secret appears in page-readable state, URL, cache asset, log,
  crash report, screenshot fixture, analytics event, or external request.
- The WebView makes no network request and cannot navigate, frame, pop up,
  download, register a worker, or execute unmanifested code.
- Cache namespace and bridge session are bound to paired cryptographic identity;
  delayed results cannot cross host, build, workspace, or session boundaries.
- Asset and manifest limits are enforced before allocation and again during
  assembly; malformed input fails closed without retaining partial state.
- Repository-controlled content cannot execute script or invoke a native
  capability through HTML, Markdown, terminal links, diffs, SVG, or filenames.
- Privileged native operations require the intended capability, active origin,
  current session, valid schema, and where needed a recent user gesture and
  native permission UI.
- Desktop repeats authorization for mutations and preserves filesystem,
  terminal input-floor, SSH, provider, and mobile-RPC restrictions.
- An independent reviewer completes threat-model and adversarial testing with no
  unresolved high-severity finding.

## App Store Gate

App Review is a product gate. The PR must provide:

- A stable internet-accessible review Desktop with representative workspaces,
  durable credentials, a sample QR code, and exact pairing instructions.
- A production-shaped app with meaningful native pairing, secure connectivity,
  notifications, camera/picker, audio, permission, recovery, and diagnostic
  behavior—not an empty WebView wrapper.
- Accurate notes explaining that host-specific workspace UI is supplied by the
  user's paired Orca Desktop, how it is authenticated, and which capabilities
  remain native.
- A record of the submitted commit/build, reviewer questions, requested
  changes, accepted behavior, and final notes.

TestFlight is useful device coverage but does not satisfy this gate. The PR
must not cut over or remove native workspace screens until a real production
submission has been accepted. If the final cutover changes the reviewed binary
materially, submit that exact release candidate again before merge. Rejection,
required architectural redesign, or unresolved permission is a failed Option B
gate and returns the project to Option A.

Approval is evidence, not a permanent exemption. Later native bridge expansion
or material changes to remotely delivered functionality require a fresh review
assessment.

## Rollout and Rollback

### Before cutover

- Keep the new route behind an explicit development/release-candidate flag.
- Maintain the current native workspace UI while parity and review are in
  progress.
- Allow internal and reviewer builds to choose the hybrid route and report the
  active host/build/bridge versions in diagnostics.

### Cutover

- Cut over only from the reviewed PR commit after every acceptance gate passes.
- Use phased store rollout and watch native recovery, WebView termination,
  package verification, activation, bridge compatibility, and terminal resync
  rates.
- Do not add a central server solely as a kill switch. The stable native shell
  must be able to recover locally.

### Web-package rollback

- Retain active and previous healthy generations per host.
- If a newly staged generation fails readiness or crash-loops, mark it unhealthy
  and atomically reactivate the previous generation.
- Provide native recovery UI to retry current, use previous, clear the host
  cache, reconnect, or switch hosts.
- Keep recovery warnings visible until the user successfully retries or a
  refresh succeeds; page health alone does not resolve the native recovery
  condition.
- On an implicit cached cold open, reject an invalid active generation and
  atomically promote a compatible verified previous generation. Explicit build
  opens remain fail-closed.
- For a functional regression that does not crash, ship known-good web assets
  in a new Desktop release or revert the Desktop release. The matching package
  then stages normally.

### Native-shell rollback

A defect in the asset origin, credential broker, native bridge, audio/picker
module, or store-installed recovery UI cannot be fixed by desktop-served web
assets. Halt the phased store rollout, use the store's supported release
controls, and submit a corrected native build. This residual store dependency is
part of Option B.

## Observability and Diagnostics

Native diagnostics should record bounded, privacy-safe events for:

- Manifest request/result, byte counts, duration, and stable validation errors.
- Cache hit, staged build, activation, fallback, eviction, and corruption.
- Bridge version/capability negotiation and rejected-message reason counts.
- WebView ready/health timing, process termination, crash-loop fallback, and
  recovery outcome.
- Terminal batch sizes, ACK lag, outstanding bytes, gaps, resyncs, and cleanup.
- Connection topology and state transitions without endpoints, credentials,
  repository content, terminal bytes, filenames, or page message payloads.

Use a short build ID prefix and a non-reversible local host correlation ID in
support bundles. The recovery screen must expose enough version and status data
for a user to copy diagnostics without opening WebView developer tools.

The existing native Connection Log copy action now reads an in-memory,
host-scoped hybrid snapshot. It reports the bridge version, 12-character build
prefix, verified-cache or desktop-refresh source, package and health states,
recovery count, and stable failure code. It omits the host display name, paired
endpoint, raw connection-entry detail, shell session ID, cache path, full build
ID, and page data. The snapshot now also records bounded cache/refresh
activation duration, total terminal resyncs, the last stable resync reason, and
flow-overflow count. Those counters are host scoped, saturate at fixed bounds,
and contain no stream, terminal, workspace, or payload identity. Cumulative
terminal ACK spans now measure bounded end-to-end ACK lag, and the same
host-scoped snapshot retains only maximum lag and the outstanding-byte
high-water mark. A 5,000-line hosted Android terminal workload exported 87 ms
maximum ACK lag, a 29,057-byte outstanding high-water mark, zero resyncs, and
zero flow overflows through the existing native Copy action. Physical-device,
sustained, hidden, disconnected, and multi-stream benchmarks, crash-report
review, and the final support-bundle audit remain open.

## Merge Gates and Definition of Done

The single PR may merge only when all boxes are true:

- [ ] Production mobile web build ships in every supported Desktop artifact.
- [ ] Manifest, native asset origin, verified cache, activation, previous-build
      recovery, and cleanup pass on iOS and Android.
- [ ] Typed bridge has no generic passthrough and passes compatibility,
      lifecycle, rate/size, user-gesture, and host-isolation tests.
- [ ] Workspace, sessions, real terminal, files/diffs, source control/reviews,
      tasks, accounts/browser, and native capability parity is signed off.
- [ ] Direct, Relay, native, WSL, and SSH-relevant paths pass without assuming a
      local repository or one Git/provider implementation.
- [ ] Physical-device performance and lifecycle budgets pass on low-end and
      current iOS and Android hardware.
- [ ] Accessibility and mobile interaction review passes.
- [ ] Security review has no unresolved high-severity finding.
- [ ] Production App Store submission of a production-shaped build is accepted.
- [ ] The final exact release candidate is resubmitted if cutover materially
      changes the reviewed binary.
- [ ] Rollback drills recover from a bad package, corrupt cache, WebView loss,
      disconnected desktop, incompatible bridge, and bad native rollout.
- [ ] Prototype paths and duplicate native workspace feature screens are removed
      after all gates; native pairing/recovery remains.
- [ ] CI, release builds, focused and full tests, lint, format, max-lines ratchet,
      and `git diff --check` pass apart from documented unrelated baseline
      failures.
- [ ] PR contains parity inventory, test matrix results, benchmark artifacts,
      security record, App Review record, screenshots, and support/runbook docs.

If a mandatory gate fails, do not weaken the criterion to preserve the one-PR
goal. Stop Option B, retain the current mobile implementation, and implement the
signed Option A design separately.

## Questions the PR Must Resolve Before Cutover

- What measured bundle size and cache quotas cover xterm, fonts, localization,
  and review UI on the lowest-storage supported devices?
- Which pure models and components can be shared without coupling the mobile
  build to Electron or desktop window assumptions?
- What bridge version range will the first production shell support, and how
  long will Desktop continue building packages for that floor?
- Does the native-broker terminal path meet physical-device latency and battery
  budgets, including Relay and SSH? A negative answer fails this design rather
  than silently adding a durable credential to the page.
- Which cached view data, if any, is safe and useful offline beyond the verified
  application package?
- What exact native gestures and confirmation UI gate clipboard, picker, audio,
  external-link, and notification operations?
- What review host, account lifecycle, sample data, and operational owner keep
  future App Review submissions continuously accessible?

## Recommendation

Open one draft migration PR and implement it in the staged order above. Treat
the existing prototype as evidence and reusable test logic, not production
architecture. The first irreversible step—removing the duplicate native
workspace implementation—comes last, after real workloads, physical devices,
security review, and App Store acceptance.

If those gates pass, Option B should materially reduce Orca's long-term mobile
feature duplication, central update infrastructure, and desktop/mobile protocol
skew. If they do not, Option A remains a viable, already-designed way to improve
React Native update delivery without accepting the hybrid architecture's
security, performance, or store risk.
