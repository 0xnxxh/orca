// Must be imported before anything that touches async fs: libuv reads this when it
// lazily creates the pool, and the size is fixed from then on.
//
// Measured on macOS with FIFOs standing in for a hung mount: at exactly poolSize
// concurrent stalled fs ops, every other async fs call app-wide stops making
// progress (the event loop itself stays responsive either way). The default of 4
// is reached by a handful of unlucky reads on one dead network mount; 16 is not a
// bound, just enough headroom that a single stalled path cannot starve the rest.
if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = '16'
}

export {}
