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

The migration is rebased onto `origin/main` at `0404f27b3`. Current post-rebase
validation passes 552 mobile files / 3,291 tests with 2 expected skips and
3,770 root files / 39,212 tests with 62 expected skips. All project typechecks,
root/mobile/mobile-web lint, reliability gates, changed-file and full-mobile
formatting, localization, and the max-lines ratchet pass.
The independently verified React Native Web package is
`9e5e807523e8b917fef68f221cc1fd2e1a16dbe07d7077e717238eed17003b52`:
49 assets, 9,330,604 raw bytes, and 2,697,919 gzip bytes. The current mobile
suite passes 555 files / 3,301 tests with 2 expected skips; all project
typechecks and repository-wide quality gates pass. A fresh root-suite attempt
hit an unrelated 30-second timeout in
`project-view-wrapper-source-context-boundary.test.ts` and was interrupted
under concurrent test load; that exact file passes alone, so the prior complete
root-suite checkpoint above remains authoritative.

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

- [ ] Complete the remaining XSS corpus across filenames, diffs, terminal
      links, provider/task fields, errors, HTML, SVG, Markdown, and Mermaid.
- [ ] Fuzz manifests, chunks, paths, MIME types, CSP, cache metadata, bridge
      envelopes, limits, ordering, cancellation, and subscriptions.
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
