# Phase 0 startup attribution — 2026-07-29

## Scope

This is the durable sanitized summary of the one-run Phase 0 startup capture.
It retains only clock values, derived durations, build deltas, validation, and
limitations. Raw process arguments, executable paths, process identifiers, and
user-directory paths are intentionally excluded.

The fixture was an empty restored state on macOS arm64 with no files, session
tabs, or GitHub repositories. The run used an unpackaged production Electron
build and waited for `renderer-shell-painted`.

## Clock semantics

| Clock       | Meaning |
| ----------- | ------- |
| `harnessMs` | Benchmark-parent milliseconds at complete-line receipt |
| `t`         | Electron main-process `performance.now()` milliseconds |
| `rendererT` | Main-window renderer `performance.now()` milliseconds |

Main-process `t` values can be subtracted from other main-process `t` values.
Renderer `rendererT` values can be subtracted from other renderer values.
Neither renderer values nor parent receipt values are subtracted from the main
clock.

## Observed milestone clocks

| Milestone                    | Main `t` | Renderer `rendererT` | Parent receipt `harnessMs` |
| ---------------------------- | -------: | -------------------: | -------------------------: |
| Bundle enter                 | 257.241709 | — | 1,814.6 |
| Bundle evaluation complete   | 454.719834 | — | 2,011.1 |
| App ready                    | 529.7 | — | 2,086.2 |
| Services initialized         | 815.8 | — | 2,372.3 |
| Renderer first React commit  | 1,101.0 | 194 | 2,657.5 |
| Renderer shell painted       | 1,151.1 | 249 | 2,707.6 |

## Derived phases

All 21 numeric derived phases were non-negative.

| Phase | Milliseconds |
| ----- | -----------: |
| Spawn to bundle-enter receipt | 1,814.6 |
| Synchronous bundle and dependency evaluation | 197.478125 |
| Bundle evaluation complete to app ready | 74.980166 |
| App ready to services initialized | 286.1 |
| Services initialized to first React commit | 285.2 |
| First React commit to shell painted | 55 |
| Total to first React commit | 2,657.5 |
| Total to shell painted | 2,707.6 |
| Startup store load | 1 |
| Spawn to app ready | 2,086.2 |
| App ready to services | 286.1 |
| Services to i18n ready | 2.2 |
| I18n ready to open-window start | 3.2 |
| Daemon initialization | 127 |
| Window created to load start | 5.4 |
| Window created to `did-finish-load` | 173.1 |
| Total to window created | 2,453.2 |
| Total to `did-finish-load` | 2,626.2 |
| `did-finish-load` to workspace ready | 143.1 |
| Total to workspace ready | 2,769.3 |
| Renderer terminal reconnect | 3 |

`startupJsonParseMs`, `aclGrantMs`, and `maxEventLoopStallMs` were unavailable
in this capture and remain unreported rather than being treated as zero.

## Bundle deltas

Against the pre-instrumentation production output:

| Surface              | Raw change | Gzip change |
| -------------------- | ---------: | ----------: |
| Electron main        |       +697 |        +286 |
| Electron preload     |        +29 |          +3 |
| Main renderer        |     +1,464 |        +425 |
| Total                |     +2,190 |        +714 |

No bundle budget was raised.

## Validation

The production build, bundle-budget check, focused 16-test suite, Node and web
typechecks, targeted oxlint and oxfmt checks, max-lines ratchet, and
`git diff --check` passed.

## Limitations

This was one cold macOS iteration from an unpackaged production Electron build,
so it is causal instrumentation evidence rather than a representative latency
baseline. JavaScript cannot time parsing or linking before its first executable
statement; spawn-to-bundle-enter also includes Electron boot, parse and link
work, complete-line delivery, and parent receipt. Main IPC receipt includes
message latency, and the double-animation-frame boundary proves a post-commit
paint opportunity rather than compositor presentation. Packaged launch and
cross-platform macOS, Linux, and Windows timing remain unresolved.
