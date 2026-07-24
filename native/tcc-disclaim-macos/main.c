// orca-tcc-disclaim-exec — exec a target command in place with the macOS
// "responsible process" responsibility disclaimed, so tccd attributes the
// child's protected-resource access to this shim's own code identity instead
// of collapsing into the launching app bundle. Drop-in for /usr/bin/login at
// the terminal spawn seam (wrapShellSpawnForMacosTccAttribution).
//
// macOS-only. On any non-macOS build this file is never compiled or shipped.
#include <spawn.h>
#include <dlfcn.h>
#include <unistd.h>
#include <stdio.h>
#include <errno.h>
#include <string.h>

extern char **environ;

typedef int (*orca_setdisclaim_fn)(posix_spawnattr_t *, int);

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: %s <command> [args...]\n", argv[0]);
    return 2;
  }
  char **target_argv = &argv[1];

  // Why: private SPI — resolve dynamically so the shim still runs (degrading
  // to a plain exec) on any macOS release where the symbol is absent.
  orca_setdisclaim_fn set_disclaim =
      (orca_setdisclaim_fn)dlsym(RTLD_DEFAULT, "responsibility_spawnattrs_setdisclaim");

  if (set_disclaim != NULL) {
    posix_spawnattr_t attr;
    if (posix_spawnattr_init(&attr) == 0) {
      // Why: SETEXEC replaces this process in place — one exec, no fork, so
      // the PTY keeps the same child PID it would get from a direct spawn.
      posix_spawnattr_setflags(&attr, POSIX_SPAWN_SETEXEC);
      set_disclaim(&attr, 1);
      posix_spawn(NULL, target_argv[0], NULL, &attr, target_argv, environ);
      posix_spawnattr_destroy(&attr);
    }
  }

  // Why: attribution is best-effort — a missing SPI or failed spawn must still
  // start the user's shell rather than kill the terminal.
  execv(target_argv[0], target_argv);
  fprintf(stderr, "orca-tcc-disclaim-exec: exec %s failed: %s\n", target_argv[0],
          strerror(errno));
  return 127;
}
