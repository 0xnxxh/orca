#!/usr/bin/env bash
# Runs one Orca CLI launch case and prints a single-line verdict the host script
# parses. Never fails the container itself — the host decides what a status means.
set -uo pipefail

case_name=${1:?launch case is required}
extracted_root=${ORCA_TEST_EXTRACTED_ROOT:-/artifacts/squashfs-root}
launcher="$extracted_root/resources/bin/orca-ide"

if ((EUID == 0)); then
  # Why unprivileged: chrome-sandbox in an extracted tree is not root-owned
  # setuid, which is exactly the state that aborts Chromium startup (#14229).
  exec runuser --user orca --preserve-environment -- "$0" "$@"
fi

# Why assert rather than assume: a container that grants CAP_SYS_ADMIN would
# make AppRun skip its `--no-sandbox` injection, and the #11609 case would pass
# for the wrong reason.
if [[ "$case_name" == userns-* ]]; then
  if unshare -Ur true 2>/dev/null; then
    echo "PRECONDITION_FAILED user namespaces are available; this case needs them restricted"
    exit 90
  fi
fi
if [[ "$case_name" == nofuse-* && -e /dev/fuse ]]; then
  echo "PRECONDITION_FAILED /dev/fuse is present; this case needs it absent"
  exit 90
fi

unset DISPLAY WAYLAND_DISPLAY

case "$case_name" in
  # The registered command's shape after CLI registration: a launcher inside the
  # extracted payload. Must not touch FUSE, AppRun, Chromium, or a display.
  nofuse-userns-registered-help) command=("$launcher" --help) ;;
  nofuse-userns-registered-version) command=("$launcher" --version) ;;
  nofuse-userns-registered-status) command=("$launcher" status) ;;
  nofuse-userns-registered-skills) command=("$launcher" skills --help) ;;
  nofuse-userns-registered-worktree) command=("$launcher" worktree list) ;;
  # Direct launch of the packaged binary with the sandbox explicitly off — the
  # #14229 shape, reduced to the case JavaScript can actually reach. Chromium's
  # own startup must hand off to the CLI before Ozone tries to find a display.
  nofuse-nosandbox-direct-binary-skills)
    command=("$extracted_root/orca-ide" --no-sandbox skills --help)
    ;;
  nofuse-nosandbox-direct-binary-gui)
    command=("$extracted_root/orca-ide" --no-sandbox)
    ;;
  *)
    echo "UNKNOWN_CASE $case_name"
    exit 91
    ;;
esac

output=$("${command[@]}" 2>&1)
status=$?

# Why >= 128: a shell reports a signal death as 128+signum, and Chromium's
# startup aborts arrive as several different signals — SIGSEGV (139) from the
# Ozone display failure, SIGTRAP (133) from the SUID sandbox check, SIGABRT
# (134) elsewhere. Every one of them is the failure this contract exists to
# prevent: a text command dying in Chromium startup instead of running.
if ((status >= 128)); then
  echo "CRASHED status=$status case=$case_name"
  printf '%s\n' "$output" | tail -30
  exit 92
fi

echo "RESULT status=$status case=$case_name"
# Why the whole thing: expectations match against command output, and truncating
# from the top hides the first line of a help screen.
printf '%s\n' "$output" | head -200
exit 0
