#!/usr/bin/env bash
# Keeps the headless Orca runtime (port 16770 on Xvfb :95) alive for the blocker pipeline.
# Only ever touches display :95 and brennan-owned processes — :78/:79 belong to other users.
set -uo pipefail

PORT=16770
DISP=:95
LOG=/tmp/runtime-watchdog.log

log() { echo "[$(date '+%F %T')] $*" >>"$LOG"; }

runtime_up() {
  [ "$(curl -s -m 4 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/" 2>/dev/null)" = "200" ]
}

ensure_xvfb() {
  pgrep -f "Xvfb ${DISP} " >/dev/null && return 0
  # A crashed Xvfb leaves a lock that blocks restart; clear only our own.
  if [ -e "/tmp/.X${DISP#:}-lock" ]; then
    local pid
    pid=$(tr -d ' ' <"/tmp/.X${DISP#:}-lock" 2>/dev/null)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then return 0; fi
    rm -f "/tmp/.X${DISP#:}-lock" "/tmp/.X11-unix/X${DISP#:}"
    log "cleared stale ${DISP} lock (dead pid ${pid:-?})"
  fi
  # -extension GLX is required: the nvidia EGL path aborts without it.
  nohup Xvfb "$DISP" -screen 0 1920x1080x24 -extension GLX >/tmp/xvfb95.log 2>&1 &
  sleep 3
  log "restarted Xvfb ${DISP}"
}

restart_runtime() {
  ensure_xvfb
  DISPLAY=$DISP nohup /home/brennan/.local/bin/orca serve --port "$PORT" \
    >>/tmp/orca-serve-watchdog.log 2>&1 &
  for _ in $(seq 1 24); do
    sleep 5
    runtime_up && { log "runtime back up on ${PORT}"; return 0; }
  done
  log "RUNTIME RESTART FAILED — see /tmp/orca-serve-watchdog.log"
  return 1
}

log "watchdog started (pid $$)"
fails=0
while true; do
  if runtime_up; then
    fails=0
  else
    fails=$((fails + 1))
    # Two consecutive misses before acting, so a busy runtime is not mistaken for a dead one.
    if [ "$fails" -ge 2 ]; then
      log "runtime unreachable (${fails} checks) — restarting"
      restart_runtime
      fails=0
    fi
  fi
  sleep 30
done
