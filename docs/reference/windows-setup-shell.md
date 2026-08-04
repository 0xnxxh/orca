# Windows setup-runner shell

On native Windows, Orca writes the `orca.yaml` setup script (and the issue command) to a generated
runner file and types a launch command into a terminal. The runner is a **`.cmd` batch file by
default**, exactly as it has been since setup hooks shipped.

A script opts into bash by starting with a `#!` interpreter line:

```yaml
scripts:
  setup: |
    #!/usr/bin/env bash
    [ -f .env ] || cp .env.example .env
    pnpm install
```

Without that line the script keeps running under `cmd.exe`:

```yaml
scripts:
  setup: |
    copy .env.example .env
    xcopy /E assets dist
```

## Why the script declares it, not the terminal preference

`terminalWindowsShell` says which shell *interactive terminals* open in. It says nothing about the
language a project's setup script is written in. Deriving the runner from it had two consequences:

- Windows users with batch-syntax setup scripts silently switched to bash on upgrade, so `copy`,
  `xcopy`, `set VAR=value`, and `if errorlevel 1` stopped working.
- Two people on the same repo got different interpreters for the same `orca.yaml`, so no project
  could write a setup script that worked for all of its Windows contributors.

A `#!` line is per-project, explicit, and identical for everyone who checks the repo out.

## Requirements for the bash runner

A `#!` line only takes effect when Orca can actually launch bash from the configured terminal — the
terminal shell must resolve to Git Bash (`resolveWindowsGitBashShellPath`). The generated runner
uses MSYS `/c/...` paths, which Cygwin and the WSL shim do not accept, and the launch command is
typed into whatever shell the terminal opened with. When Git Bash is not available the script falls
back to the `.cmd` runner; the `#!` line is dropped rather than executed.

WSL worktrees and non-Windows platforms are unaffected: they always use the bash runner. SSH hosts
choose their runner from the remote path format, never from local Windows preferences.
