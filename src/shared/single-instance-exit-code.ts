// Why: stable "another process owns this profile" contract that systemd RestartPreventExitStatus= keys off; changing it silently un-fixes #11935.
// Why here: the CLI refuses a duplicate `serve` before spawning Electron, so it needs the same
// number the main process exits with, without importing a main-process module.
export const SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE = 3
