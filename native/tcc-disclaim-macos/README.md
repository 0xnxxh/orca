# orca-tcc-disclaim-exec

Tiny macOS exec shim that runs `<command> [args...]` in place with the
"responsible process" responsibility disclaimed
(`responsibility_spawnattrs_setdisclaim` + `POSIX_SPAWN_SETEXEC`). tccd then
attributes the command's protected-resource access (and its children's) to the
shim's own signed code identity instead of collapsing everything into the Orca
app bundle, so per-tool TCC grants persist across launches (#9756, #6996).

The build embeds a dedicated, stable `CFBundleIdentifier`
(`com.stablyai.orca.tcc-disclaim-exec`) as a `__TEXT,__info_plist` section so
every `codesign --force` pass derives the same code identifier — that
identifier is what TCC keys grants to, so it must stay deterministic across
releases and distinct from the app bundle id.

Build: `pnpm run build:tcc-disclaim-macos` (add `--single-arch` for a
host-arch-only dev build). Output:
`.build/release/orca-tcc-disclaim-exec`; packaged builds ship it at
`Orca.app/Contents/MacOS/orca-tcc-disclaim-exec`.

Runtime wiring is flag-gated behind `ORCA_MACOS_TCC_DISCLAIM` (default off —
the login(1) wrap in `src/main/providers/macos-tcc-login-shell.ts` remains the
live path). See `src/main/providers/macos-tcc-disclaim-exec.ts`.
