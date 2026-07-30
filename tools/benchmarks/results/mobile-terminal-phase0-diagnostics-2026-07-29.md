# Mobile terminal Phase 0 diagnostics evidence

## Observable events

Development builds emit bounded records under `[terminal-diagnostic]`.

- `webview-count-snapshot`: `boundary`, `mountedWebViewCount`,
  `activeMountedWebViewCount`, `inactiveMountedWebViewCount`,
  `terminalRecordCount`, `terminalTabCount`, and `tabCount`.
- `process-memory-snapshot`: `platform`, `supportStatus`, `processRole`, `pid`,
  `metric`, `bytes`, `byteUnit`, `sampledAtMs`,
  `webContentProcessAttribution`, `limitation`, and `errorKind`.

WebView boundaries are `mount`, `unmount`, `activity-change`,
`session-snapshot`, and `route-reset`. Counts use one development-only map
keyed by opaque per-pane mount identity; no terminal handles enter that map or
its aggregate records. Exact setup-cleanup-setup replay remains idempotent,
active transitions do not change the mounted total, and a late pre-reset
unmount cannot remove a post-reset pane with the same handle.
`terminalRecordCount` comes from the reconciled terminal records actually
rendered, `terminalTabCount` includes all terminal tabs (including pending
handles), and `tabCount` includes every tab. Disabled diagnostics allocate no
WebView identity map and never load the native memory module.

Synthetic fixtures established these terminal-count records:

```text
10 terminals: mounted=10 active=1 inactive=9 terminalRecords=10 terminalTabs=10 tabs=12
50 terminals: mounted=50 active=1 inactive=49 terminalRecords=50 terminalTabs=50 tabs=52
divergent snapshot: terminalRecords=3 terminalTabs=2 tabs=3
```

## Process attribution

- iOS reports the Orca app process's `TASK_VM_INFO.phys_footprint` in bytes as
  `metric=physical-footprint`.
- Android reports the Orca app process's `Debug.MemoryInfo.totalPss`, normalized
  from KiB to bytes, as `metric=proportional-set-size`.
- Both include the app-process role, ephemeral PID, native sample timestamp,
  platform, and support status. Neither value is JS heap or device-wide memory.
- The one-shot sample starts only after terminal records load and at least one
  terminal pane has committed; effect replay cannot load or sample it twice.
- Public iOS and Android sandbox APIs do not provide per-WKWebView/WebView
  renderer-process memory attribution. Every snapshot therefore reports
  `webContentProcessAttribution=unsupported-unattributed` and
  `limitation=public-sandbox-api-unavailable`; app-process memory must not be
  interpreted as total WebContent cost.

Synthetic normalization evidence was 12,345 iOS footprint bytes and 2,048
Android PSS KiB = 2,097,152 bytes. Tests also cover unsupported platforms,
wrong-platform native metrics, invalid values, and native exceptions without
copying exception messages.

## Files

- `mobile/app/h/[hostId]/session/[worktreeId].tsx`
- `mobile/src/session/TerminalPaneView.tsx`
- `mobile/src/session/mobile-terminal-diagnostics.ts`
- `mobile/src/session/mobile-terminal-process-memory-diagnostics.ts`
- `mobile/src/session/mobile-terminal-webview-count-diagnostics.ts`
- `mobile/src/diagnostics/mobile-process-memory-diagnostics.ts`
- Their three focused TypeScript test files
- `mobile/packages/expo-process-memory/` (local iOS/Android Expo module)
- `mobile/package.json` and `mobile/pnpm-lock.yaml`

The local Expo-module layout has no native unit-test target; adding one would
require generated Xcode/Gradle test projects. Native module discovery was
instead verified through Expo autolinking on both platforms, while unit and
normalization behavior is covered in TypeScript.

## Verification

- `pnpm --dir mobile test`: 356 files passed, 2,617 tests passed, 2
  skipped.
- `pnpm --dir mobile typecheck`: passed.
- Targeted `oxlint` and `oxfmt --check`: passed.
- iOS and Android `expo-modules-autolinking resolve`: both found
  `@orca/expo-process-memory`.
- `pnpm check:max-lines-ratchet`: passed with no new bypass.
- `git diff --check`: passed.

An iOS 26.1 simulator was available, but the non-interactive smoke stalled in
CocoaPods' automatic project-update retry before native compilation. Android
had no connected device and no configured AVD. Reproduce on provisioned
environments with:

```bash
pnpm --dir mobile exec expo run:ios --device "iPhone 17 Pro" --no-bundler
pnpm --dir mobile exec expo run:android --device <adb-serial> --no-bundler
```

Open a 10- or 50-terminal session in a development build and filter Metro/device
logs for `[terminal-diagnostic]`. Physical-device validation remains required
for representative iOS physical-footprint and Android PSS values.
