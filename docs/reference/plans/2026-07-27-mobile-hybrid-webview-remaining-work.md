# Mobile Hybrid WebView Remaining Work

- **Status:** Implementation tail in progress
- **Last updated:** July 28, 2026
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

The active implementation tail is final parity closure and production cutover.
Broad validation, independent security review, physical-device performance, and
App Store acceptance remain open.

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

The migration is rebased onto `origin/main` at `0404f27b3`. Current post-rebase
validation passes 552 mobile files / 3,291 tests with 2 expected skips and
3,770 root files / 39,212 tests with 62 expected skips. All project typechecks,
root/mobile/mobile-web lint, reliability gates, changed-file and full-mobile
formatting, localization, and the max-lines ratchet pass.
The independently verified React Native Web package is
`9ed8c7f7d9be87c85b2431ece4eac3365a73e62bebf409846dea0ce72c9d1dde`:
49 assets, 9,280,463 raw bytes, and 2,684,481 gzip bytes. The current mobile
suite passes 568 files / 3,373 tests with 2 expected skips. Mobile and
mobile-web typechecks and lints, changed-file formatting, max-lines, package
verification, and diff hygiene pass. The repository-wide formatter still
reports 19 unrelated baseline files, so changed-file formatting is the
migration-owned gate.

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
The remaining security work below is release-app corpus testing, fuzzing,
cross-scope races, privacy/authorization audit, and independent review.

## 1. Finish Hosted Feature Parity

- [ ] Close every remaining route and action in the parity inventory.

## 2. Production Cutover and Cleanup

- [ ] Keep the native workspace route available as the fallback until the
      security, device, and App Store gates pass.
- [ ] Make the production hybrid route the default from the reviewed release
      candidate.
- [ ] Remove the Experimental Settings entry and `hybrid-prototype` route.
- [ ] Remove superseded prototype contracts, package generation, RPC names,
      cache, bridge code, and fixtures.
- [ ] Remove the purpose-built `src/mobile-web/` validation presentation while
      retaining the shared React Native components rendered through React
      Native Web.
- [ ] Confirm production source and imports contain no `prototype` names.
- [ ] Document Desktop web-package rollback and native store-rollout rollback.

## 3. Automated Integration Gates

- [ ] Run packaged Desktop delivery on macOS, Windows, Linux, and headless
      runtimes.
- [ ] Update the design, architecture, mobile developer, support, privacy,
      troubleshooting, and recovery documentation.

## 4. Security Gates

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
      rejects numeric active/previous hashes with the same stable error on both
      platforms. Android now requires the exact root document URL and rejects
      percent-encoded or query-bearing asset requests; a fresh exact-app rerun,
      generated mutation, and the other listed boundaries remain.
- [ ] Attempt cross-host, cross-build, cross-workspace, cross-session, replay,
      reconnect, process-loss, and host-removal races.
- [ ] Verify no credential or privileged host identity reaches URLs, DOM state,
      page storage, cache assets, logs, diagnostics, analytics, or fixtures.
- [ ] Verify Desktop reauthorizes every mutation and all resource limits apply
      before allocation and during assembly.
- [ ] Complete an independent threat-model and adversarial review.
- [ ] Resolve every high-severity security finding.

## 5. Device, Topology, Accessibility, and Performance Gates

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

## 6. App Store and Final Release Gates

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
