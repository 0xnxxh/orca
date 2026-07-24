(() => {
  // Read the render-loop trace buffer and compute the longest render streak
  // (max consecutive-render run) plus the layout-effect breakdown across it.
  const trace = window.__ACTIVITY_185_TRACE || [];
  const snaps = window.__ACTIVITY_185_SNAPSHOTS || [];
  const errs = window.__REACT185_ERRORS || [];
  // A "run" is a maximal sub-sequence where n strictly increases (resets to 1
  // when >50ms gap). Find the run containing the max n and tally its fx values.
  let bestEnd = -1, bestMax = 0;
  for (let i = 0; i < trace.length; i++) {
    if ((trace[i].n || 0) > bestMax) { bestMax = trace[i].n; bestEnd = i; }
  }
  let fxCounts = {}, streakSpanMs = null, runStart = null;
  if (bestEnd >= 0) {
    // Walk back from bestEnd while n decreases by ~1 to find the run start.
    let s = bestEnd;
    while (s > 0 && (trace[s - 1].n || 0) === (trace[s].n || 0) - 1) s--;
    runStart = s;
    for (let i = s; i <= bestEnd; i++) {
      const fx = trace[i].fx || 'none';
      fxCounts[fx] = (fxCounts[fx] || 0) + 1;
    }
    streakSpanMs = (trace[bestEnd].t || 0) - (trace[s].t || 0);
  }
  return JSON.stringify({
    traceLen: trace.length,
    longestStreak: bestMax,
    streakSpanMs,
    fxCounts,
    detectorSnapshots: snaps.length,
    react185Errors: errs.length,
    react185Text: errs[0]?.text?.slice(0, 160) || null,
    boundaryTripped: /hit an error/i.test(document.body.textContent || ''),
    lastRun: bestEnd >= 0 ? trace.slice(runStart, bestEnd + 1).slice(-6) : []
  });
})()
