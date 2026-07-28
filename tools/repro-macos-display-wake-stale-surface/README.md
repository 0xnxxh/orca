# macOS display-wake stale-surface reproduction

This headful Electron harness distinguishes a live renderer from a stale macOS presentation
surface. Every cycle:

1. turns the display off with `pmset displaysleepnow`;
2. wakes it with synthetic user activity;
3. advances a full-window renderer sentinel;
4. runs Orca's selected reveal repaint path;
5. compares Chromium `capturePage()` pixels with the macOS desktop-capture surface.

The reproduction passes only when renderer state and Chromium pixels advance while the
WindowServer-facing surface remains unchanged.

Run the current Orca macOS 26 repaint path:

```sh
pnpm run repro:macos-display-wake-surface
```

Compare it with the pre-`v1.4.156` native frame jiggle:

```sh
pnpm run repro:macos-display-wake-surface -- --repaint=frame-jiggle
```

Useful options:

```text
--cycles=20
--display-off-ms=5000
--wake-settle-ms=1500
--unlock-timeout-ms=43200000
--lock-hold-ms=0
--webgl-contexts=15
--repaint=device-emulation|frame-jiggle|invalidate
--trigger=lock-screen|display-sleep
```

The default lock-screen trigger matches the field incident. Press `Control+Command+Q` when
the harness asks, then unlock with Touch ID or your password. `--trigger=display-sleep`
instead blanks and automatically wakes the physical display once per cycle.

Screen Recording permission is required so Electron can sample the WindowServer-facing
window surface.
