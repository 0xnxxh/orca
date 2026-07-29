# Mobile Hybrid WebView Remaining Work

- **Status:** Core implementation complete; validation and gated cutover remain
- **Last updated:** July 29, 2026
- **Detailed evidence archive:**
  [`2026-07-22-mobile-hybrid-webview-implementation-checklist.md`](./2026-07-22-mobile-hybrid-webview-implementation-checklist.md)
- **Migration design:**
  [`2026-07-22-mobile-hybrid-webview-single-pr-migration.md`](./2026-07-22-mobile-hybrid-webview-single-pr-migration.md)
- **Parity inventory:**
  [`2026-07-22-mobile-hybrid-webview-parity-inventory.md`](./2026-07-22-mobile-hybrid-webview-parity-inventory.md)

This is the active tracker. It contains only work that remains. Remove an item
when it is completed and record its evidence in the detailed checklist.

## Current Checkpoint

The production package, verified cache, private WebView origin, typed bridge,
workspace/session/terminal/files/tasks/accounts/browser/dictation/native-chat,
Agent History, Source Control, and Review foundations exist. The hosted routes
reuse the current React Native presentation through React Native Web; there is
no replacement product UI.

Hosted feature implementation is complete. Broad validation, independent
security review, physical-device performance, and App Store acceptance remain
open. The native workspace route remains the fallback until those gates pass.

The gated cutover seam now routes Home host selection, exact-session resume,
Tasks, Accounts, New Workspace, pairing completion, onboarding completion,
notification navigation, and cold resume into the production hybrid shell when
`EXPO_PUBLIC_ORCA_MOBILE_WEB_DEFAULT=1`. Without the flag, the unchanged native
routes remain the default. Transient shell destinations are not persisted as
cold-resume state.

The obsolete `hybrid-prototype` route, prototype package/cache/bridge
implementation, prototype RPC methods and allowlist entries, shared prototype
contract, and their fixtures are removed. The production `/hybrid` route,
production bridge clients, Experimental Settings entry, and native workspace
fallback remain intentionally.

The exact iPhone 17 Pro Simulator app now passes the hosted Source Control and
Review journey. The unchanged Session-origin flow opens a changed file as a
second Session diff tab, while standalone Review is verified separately with
its existing Back and review-actions controls. The same run passes the private
origin network and navigation isolation probes.

The exact Pixel 9 Pro API 36 arm64 Debug APK now passes the same journey after a
fresh native build and install. Android accessibility enters the unchanged
Source Control UI, opens a changed file as a second Session diff tab, and
verifies standalone Review. The deliberate-red network/navigation isolation
probe records zero escaped traffic, and the embedded log audit records no Expo
bridge rejection, Kotlin conversion/cast error, or fatal process error.

The Android route gate now also seeds a disposable Agent History fixture and
verifies the unchanged screen's Workspace/Project/All scopes, lazy preview,
search/no-match/clear flow, rejection of synthetic privileged activation, and
native-touch resume into a second Session tab before continuing through Source
Control and Review.

The iPhone 17 Pro / iOS 26.5 Simulator now captures the unchanged native and
hosted Tasks and Session screens from one disposable Desktop runtime. Tasks
passes at 0.022% changed pixels, 0.084 mean channel difference, and 0.000016
vertical-title delta. Session passes at 0.800%, 1.693, and 0.000366
respectively, within the 3%, 4, and 0.005 budgets. The same fresh exact-app run
passes Agent History portrait/landscape parity, Desktop restart and recovery,
native-touch resume, a third Session diff tab, standalone Review, and both
isolation probes.

The existing non-embedded Tasks toolbar icon has no native accessibility label.
The fixture locates its unchanged row from the accessible Filter control and
uses the existing icon position. This is recorded as an accessibility finding,
not treated as a reason to change product UI inside the migration.

The same exact-app iOS gate now covers the unchanged Files route and a real
Preview navigation through `Casks/orca.rb`. Files passes at 0.030% changed
pixels and 0.128 mean channel difference; Preview passes at 0.061% and 0.274.
Both cached-app and fresh Xcode build/install journeys pass the complete route,
recovery, review, and isolation matrix. Equivalent hosted route values no
longer restart Preview loads, and RNW preserves the native iOS font fallback.

The unchanged Accounts screen now also passes deterministic iOS
native-versus-hosted parity at 0.050% changed pixels, 0.099 mean channel
difference, and 0.000544 vertical-title delta, within the 3% / 4 / 0.005
budgets. Its existing non-embedded toolbar icon has no native accessibility
label, so the fixture uses the unchanged icon position and leaves the semantic
gap for the broader VoiceOver review. The complete cached-app journey passes
with Accounts inserted before Tasks, Session, Files/Preview, Agent History,
Desktop restart/recovery, Source Control, Review, and both isolation probes.

The base workspace screen now has the same deterministic proof. Native and
hosted mount the unchanged `HostScreen` and pass at 0.879% changed pixels,
1.876 mean channel difference, and 0.000395 vertical landmark delta against the
3% / 4 / 0.005 budgets. The complete journey captures this screen before
Accounts and the rest of the route matrix.

The unchanged Source Control and Review screens now also have scale-correct
parity evidence against the real 1,294-file branch comparison. The Desktop
serves revision-consistent pages of at most 128 entries with a 4,000-entry
aggregate ceiling, and the hosted adapter assembles those pages without
changing the presentation. Native and hosted both show `0/1294 reviewed`, the
same first file, and the same diff. Source Control passes at 0.736% changed
pixels and 0.910 mean channel difference; Review passes at 2.134% and 1.947,
within the 3% / 4 budgets. The packaged document opts into native safe-area
insets, and nested syntax text retains the native effective font behavior.

The migration is based on `origin/main` at `0660ad9d6` with the final rebase
pending after this validation batch. Post-rebase validation passes 570 mobile
files / 3,418 tests with 2 expected skips and 3,817 root files / 39,966 tests
with 62 expected skips. The earlier load-sensitive root timeouts do not recur
in the latest complete run. All project typechecks,
root/mobile/mobile-web lint and code-quality audits, 55 reliability gates,
changed-file and full-mobile formatting, localization, the max-lines ratchet,
and diff hygiene pass. React Doctor reports zero blocking errors across the
migration without suppressions. The independently verified React Native Web
package is
`072e5f3cc1bd508e02efe8e0f3706d061fed561ed71e4af640b821d863716aef`:
50 assets, 9,290,968 raw bytes, and 2,688,498 gzip bytes.

That exact package now passes the unpacked macOS arm64 → Docker SSH → actual
iOS WKWebView journey in 2.1 minutes. Authenticated RPC returned the packaged
build with no checkout-output fallback; the unchanged mobile UI mutated the
remote terminal, rendered a remote native-chat transcript, retained it during
provider loss, and rendered the appended assistant message after reconnect.
The harness seeds the pasteboard before Session snapshots clipboard
availability, uses the existing opaque clipboard-paste capability and Enter
accessory, and retries one bounded serve-sim accessibility timeout. It does not
depend on or change the simulator's keyboard layout.

The latest native-authority audit keeps the unchanged UI but removes hosted
fallback access to Expo clipboard, image/document pickers, haptics, and direct
external-link opening. Native routes receive platform-resolved adapters;
hosted routes fail closed or use the gesture-gated capability bridge.
Native-chat tool input is normalized before schema parsing and delivery to a
4,000-character, 100-node, 20-item, five-level budget. A deterministic
adversarial corpus now covers filenames, diff lines, task/provider fields,
bounded errors, terminal-link policy, and the remaining intentional sanitized
HTML/Markdown/Mermaid sinks.

The worktree-local dev runtime now passes a fresh exact-app iPhone 17 Pro
security rerun without the production-runtime `host_forbidden` mismatch. The
same exact cached app seeds the simulator pasteboard, enters the unchanged
Session UI, activates its existing Paste control through a native accessibility
tap, accepts the real iOS paste privacy prompt, and requires the exact
`ORCA_HOSTED_CLIPBOARD_TEXT_PASTE` marker in the temporary Desktop terminal.
The successful run used two bounded activation attempts and then passed the
private-origin network and navigation isolation probes.

The same gate now resets only Orca's Photos permission before launch and denies
the real iOS prompt from the unchanged Attach control. The existing
`Photo permission denied` toast appears, the exact hosted Session stays active,
Desktop terminal output remains unchanged, no image data or `orca-paste-` path
marker appears in hosted page text, and both isolation probes pass. Focused
contract tests separately require the bridge result to contain status only.
The same exact-app journey now long-presses unchanged Attach, opens Files,
selects a deterministic 123-byte PNG, and requires the shell-owned host upload
to inject its temp path through the terminal stream. Independent size and
SHA-256 checks match the source; the filename, bytes, digest, and host path are
absent from hosted page state. The picker uses native touch plus the existing
React Native Web responder because physical WebKit touch alone does not
reliably dispatch the shared long-press handler on iOS 26.5.

Post-grant Photos revocation now passes in a focused exact-app journey. iOS
terminates Orca after the grant and again after revocation; the harness
re-enters through the existing native Settings handoff and requires the same
semantic Session/workspace after each restart. The private WebView origin and
shell-issued opaque workspace authority rotate both times. After revocation,
unchanged Attach shows `Photo permission denied`, Desktop terminal output stays
unchanged, no privileged marker enters page text, and the network/navigation
isolation probes pass.

The same focused journey now covers picker interruption. Sending the real
Photos picker to Home and foregrounding Orca resumes that picker rather than
cancelling it. Explicit Cancel returns to the same hosted Session with the
private origin and opaque workspace authority retained. The journey then
completes revocation with unchanged terminal output, no privileged page marker,
and both isolation probes passing.

A focused exact-app iPhone 17 Pro / iOS 26.5 run now also copies the existing
48×48 PNG through Photos, accepts the real iOS paste privacy prompt from the
unchanged Paste control, and requires a shell-owned host temp path in the
Desktop terminal. The 411-byte Photos encoding matches the source RGBA SHA-256
`a2773eaed936229595e49669b8705cb179a6a004a48a4d8304d6ee2710ab26b9`.
The filename, path, pixel digest, encoded prefix, and `data:image/` marker stay
out of hosted page text, and both isolation probes pass.

Fresh exact-app iOS and Android emulator gates now prove that the active
manifest-declared content-addressed RNW script loads while a mutated undeclared
same-origin script is rejected by the native manifest store. The hosted
document remains intact, both platforms retain network/navigation isolation,
and Android records zero sentinel observations plus a clean native bridge log.
Manifest and package-RPC schemas now share one exact asset-path predicate. A
mirrored TypeScript, Swift, and Kotlin corpus rejects empty, absolute,
traversal, repeated-separator, percent-encoded, query, fragment, backslash,
non-ASCII, overlong, and trailing-newline paths.
Shared application SHA-256, Git object ID, bridge/session ID, domain token, and
base64 schemas now require full-string matches through one protocol-token
contract. The directly loaded manifest applies the same exact hash rule
locally, and the mirrored native SHA corpus enforces it on Swift and Kotlin.
The manifest now exports the exact extension/MIME/role map. Source-parity tests
require both native maps to match, and all three runtimes pass the same eight
valid and eight mutated metadata cases.
Both native stores now read persisted manifests with the 256 KiB ceiling,
activation metadata with a 1 KiB ceiling, and assets with their exact declared
length plus one overflow byte. Oversized files fail with the existing stable
generation or activation error before whole-file allocation; mirrored Swift
and Kotlin fault suites pass.
The obsolete standalone `src/mobile-web/` presentation and Vite-only package
path are removed. The directory now contains only production bridge clients,
transport state, and focused tests consumed by the real React Native Web route
graph. A source boundary prevents the duplicate renderer-based UI from
returning, and the production package remains build `b17ead7a…`.
Post-removal validation passes 568 mobile files / 3,375 tests with 2 expected
skips and 3,752 root files / 39,218 tests with 62 expected skips. Root, mobile,
and mobile-web lint; node, mobile, and mobile-web typechecks; reliability,
localization, max-lines, formatting, package verification, and diff hygiene
pass. The packaged-resource fixture now includes the same required safe-area
viewport contract as the production document.
The first production bridge policy is now frozen: packages and the shell use
the exact v2 protocol, additive features use capability negotiation instead of
version bumps, and Desktop must retain a bridge floor for at least two stable
mobile releases containing its replacement before the supported shell minimum
can advance. Packaging consumes the shared policy directly.
The production rollback runbook now separates Desktop package incidents from
native-shell/store incidents, requires corrected verified release artifacts,
maps every host-scoped recovery action, forbids manual cache mutation, and
defines privacy-safe support evidence. Final physical-device and store-signed
rollback drills remain open below.
Post-runbook validation passes 569 mobile files / 3,378 tests with 2 expected
skips. Mobile and mobile-web typechecks/lints, reliability, max-lines,
formatting, diff hygiene, and the unchanged `b17ead7a…` package verification
pass.
Native activation metadata now consumes one exact object on both platforms.
The mirrored two-valid/twelve-invalid corpus closes unknown fields, null and
non-string hashes, identical active/previous generations, duplicate keys, and
trailing tokens.
The iOS native fault executable, Android Debug unit/Release Kotlin gates, and
the same broader validation pass.
Persisted native cache reads now require a regular descendant of the cache
root before opening staged assets, manifests, activation metadata, or committed
assets. Mirrored Swift/Kotlin faults reject outside-root, symlinked,
non-regular, and missing paths with a stable error. Mutation and cleanup fuzzing
remains open below.
Primary/canonical manifests and activation metadata now pass the same exact
JSON grammar before platform parsing. Literal and escaped-equivalent duplicate
keys, nested duplicates, trailing tokens, malformed scalars, and nesting beyond
32 levels fail consistently in the mirrored native corpora.
Cache cleanup now uses a cache-root-boundary deletion path on Android instead
of `File.deleteRecursively()`, which followed a staged directory symlink during
the fault probe and removed an external sentinel. Cleanup, abort, duplicate
commit, unused-generation removal, quota eviction, host removal, and activation
temp cleanup no longer follow linked trees. Quota accounting and eviction also
ignore linked generations. Mirrored iOS/Android faults cover direct and nested
orphan links, live stages replaced by links, host-subtree links, and dangling
host links; the dangling probe also closed an iOS `fileExists` removal skip.
The iOS native fault executable, Android Debug unit/Release Kotlin gates,
569-file mobile suite, mobile/mobile-web typechecks and lints, reliability,
max-lines, focused formatting, diff hygiene, and unchanged `b17ead7a…` package
verification pass after the cleanup repair.
Native cache writes now use the same no-link boundary before opening staged
assets or an activation host tree. Mirrored mutation faults replace an asset,
activation file, and whole host tree with symlinks. Staged and host-tree writes
fail with stable errors, while atomic activation replacement removes the
in-cache link rather than modifying its external target.
The 569-file mobile suite, mobile/mobile-web typechecks and lints, reliability,
max-lines, focused formatting, diff hygiene, and unchanged `b17ead7a…` package
verification also pass after the write-boundary repair.
The exact native JSON grammar now validates Unicode surrogate pairing before
Foundation or `org.json` parsing. Escaped pairs and raw supplementary
characters pass, while lone, reversed, or high/high surrogate escapes fail in
keys and values. Mirrored corpora also prove the exact 32-level acceptance and
33-level rejection boundary.
The 569-file mobile suite, typechecks, lints, reliability, max-lines, focused
formatting, diff hygiene, and unchanged `b17ead7a…` package verification remain
green after the parser repair.
The remaining security work below is release-app corpus testing, fuzzing,
cross-scope races, privacy/authorization audit, and independent review.

## 1. Production Cutover and Cleanup

- [ ] Make the production hybrid route the default from the reviewed release
      candidate after the security, device, performance, and App Store gates
      pass.
- [ ] Remove the Experimental Settings entry at the gated cutover.

## 2. Automated Integration Gates

- [ ] Run packaged Desktop delivery on macOS, Windows, Linux, and headless
      runtimes.
- [ ] Update the design, architecture, mobile developer, support, privacy,
      troubleshooting, and recovery documentation.

## 3. Security Gates

- [ ] Run the deterministic filename, diff, terminal-link, provider/task,
      bounded-error, HTML, SVG, Markdown, and Mermaid corpus through the exact
      release app on both platforms and complete independent live interaction
      testing.
- [ ] Fuzz manifests, chunks, paths, MIME types, CSP, cache metadata, bridge
      envelopes, limits, ordering, cancellation, and subscriptions. The
      ten-case TypeScript/Swift/Kotlin quoted/Boolean numeric manifest corpus
      passes after removing Android `JSONObject.optInt` string coercion and iOS
      `NSNumber`/`CFBoolean` integer bridging. Chunk base64 is capped at 65,536
      characters in the shared schema and both native stores before decode; its
      bounded request/chunk mutation corpus passes. Native activation metadata
      accepts only exact `active` and optional distinct `previous` string
      hashes. Its mirrored missing/null/Boolean/numeric/array/uppercase/
      duplicate/unknown/trailing-token corpus fails with the same stable error
      on both platforms. Both native stores cap each raw manifest at 256 KiB
      before JSON parsing. Android now requires the exact root document URL and rejects
      percent-encoded or query-bearing asset requests. One document-CSP contract
      now drives packaging/verification and exact native source parity.
      Manifest and package RPC reuse one exact path predicate, and the same
      18-case path corpus passes in TypeScript, Swift, and Kotlin. All shared
      hash, Git object, bridge/session ID, domain token, and base64 schemas also
      require exact full-string matches; native Swift/Kotlin SHA corpora pass. A
      shared extension/MIME/role map now has exact native source parity and
      mirrored valid/mutated coverage. Persisted primary/canonical manifests,
      activation metadata, and assets now use bounded `limit + 1` readers on
      both platforms, with mirrored oversized-file faults and stable errors.
      Every cache read also rejects outside-root files, file or ancestor
      symlinks, directories, and missing files before opening bytes. A fresh
      exact-JSON preflight also rejects duplicate decoded keys, trailing
      tokens, malformed scalars, and more than 32 nesting levels across primary
      manifests, canonical manifests, and activation metadata. Native cleanup
      faults now reject direct, nested, host-subtree, generation, and dangling
      symlink traversal without touching external sentinels; Android quota
      accounting ignores linked external bytes. Staged-asset and activation
      writes also reject linked parents, while atomic activation replacement
      preserves an external file behind an in-cache link. Exact JSON now rejects
      unpaired Unicode surrogate escapes and has explicit depth-edge coverage.
      A fresh exact-app rerun, further generated mutation, concurrent cache
      mutation, and the other listed boundaries remain.
- [ ] Attempt cross-host, cross-build, cross-workspace, cross-session, replay,
      reconnect, process-loss, and host-removal races.
- [ ] Verify no credential or privileged host identity reaches URLs, DOM state,
      page storage, cache assets, logs, diagnostics, analytics, or fixtures.
- [ ] Verify Desktop reauthorizes every mutation and all resource limits apply
      before allocation and during assembly. Persisted native manifests,
      activation metadata, and assets now have pre-allocation read ceilings;
      bridge and full generated allocation fuzzing remain.
- [ ] Complete an independent threat-model and adversarial review.
- [ ] Resolve every high-severity security finding.

## 4. Device, Topology, Accessibility, and Performance Gates

- [ ] Test low-memory and current physical iPhone and Android phones.
- [ ] Test supported iPad and Android tablet layouts.
- [ ] Test Direct, realistic cloud Relay, native, folder workspace, SSH, WSL,
      reconnect, endpoint change, and two differently versioned desktops.
- [ ] Test software and hardware keyboards, IME, dictation, gestures,
      VoiceOver, TalkBack, Dynamic Type/zoom, and reduced motion.
- [ ] Compare cached entry, terminal input/output, large diffs, memory, battery,
      thermals, and lifecycle behavior against the current native app.
- [ ] Pass a 30-minute sustained-use run and repeated
      host/session/terminal/diff lifecycle loops without progressive
      degradation.
- [ ] Record the device, topology, accessibility, and benchmark artifacts.

## 5. App Store and Final Release Gates

- [ ] Provision an internet-accessible review Desktop with durable credentials,
      representative data, a sample QR code, and exact pairing instructions.
- [ ] Prepare accurate App Review notes covering the desktop-served workspace UI
      and meaningful native features.
- [ ] Submit a production-shaped build through App Review; TestFlight does not
      complete this gate.
- [ ] Record reviewer questions, requested changes, and the final disposition.
- [ ] Obtain acceptance before deleting the duplicate native workspace
      fallback.
- [ ] Drill automatic rollback, manual previous-generation recovery, cache
      clearing, corruption, incompatible bridge, disconnection, pairing
      removal, and WebView loss on the final release candidate.
- [ ] Run final CI, packaged release builds, signing, and store-build
      verification.
- [ ] Attach parity, tests, device benchmarks, security review, App Review,
      rollback, screenshots, and final release evidence to the PR.

## Merge Definition

- [ ] Every item above is complete or explicitly removed by an approved design
      change.
- [ ] The final code, design, parity inventory, and release evidence describe
      the same architecture.
- [ ] The production App Store, security, physical-device, performance,
      rollback, CI, and packaged-build gates all pass.
