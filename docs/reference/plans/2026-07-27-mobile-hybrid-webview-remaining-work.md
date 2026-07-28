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

The migration is rebased onto `origin/main` at `1fa9ffb5e`. Post-rebase
validation passes 550 mobile files / 3,285 tests with 2 expected skips and
3,769 root files / 39,207 tests with 62 expected skips. All project typechecks,
root/mobile/mobile-web lint, reliability gates, and the max-lines ratchet pass.
The independently verified React Native Web package is
`f852d8525d2b0e20d79262d74ce3ef74bfa73c3e55b95176bfb1b467beafae61`:
49 assets, 9,330,210 raw bytes, and 2,697,838 gzip bytes.

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
