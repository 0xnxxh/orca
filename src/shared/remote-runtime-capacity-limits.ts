export const REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES = 4 * 1024 * 1024
export const REMOTE_RUNTIME_MAX_WEBSOCKET_FRAME_BYTES = 8 * 1024 * 1024 + 64
export const REMOTE_RUNTIME_MAX_SUBSCRIPTIONS = 256
export const REMOTE_RUNTIME_MAX_SUBSCRIPTION_PARAM_BYTES = 1024 * 1024
export const REMOTE_RUNTIME_MAX_RETAINED_SUBSCRIPTION_BYTES = 16 * 1024 * 1024
export const REMOTE_RUNTIME_MAX_PENDING_REQUESTS = 256
export const REMOTE_RUNTIME_MAX_PENDING_RPC_BYTES = 32 * 1024 * 1024
export const REMOTE_RUNTIME_MAX_PREPARED_RPC_BYTES = REMOTE_RUNTIME_MAX_PENDING_RPC_BYTES
export const REMOTE_RUNTIME_MAX_PROCESS_PENDING_REQUESTS = REMOTE_RUNTIME_MAX_PENDING_REQUESTS * 2
export const REMOTE_RUNTIME_MAX_PROCESS_PENDING_RPC_BYTES = REMOTE_RUNTIME_MAX_PENDING_RPC_BYTES * 2
export const REMOTE_RUNTIME_MAX_READY_WAITERS =
  REMOTE_RUNTIME_MAX_PENDING_REQUESTS + REMOTE_RUNTIME_MAX_SUBSCRIPTIONS
export const REMOTE_RUNTIME_MAX_OUTBOUND_BINARY_FRAME_BYTES = 8 * 1024 * 1024
// Why: headroom for everything an RPC reply wraps around its payload — request id, _meta.runtimeId,
// result keys — so a producer that fills its budget still fits inside the outbound JSON limit.
// Measured overhead is 181 B (text) to 243 B (binary with isImage/mimeType); the rest is margin.
// It is deliberately not sized for a pathological client-supplied request id — inbound frames allow
// up to 1 MiB, so no reserve could cover that and the dispatcher backstop owns it instead. Every
// byte here is content that transferred before this cap existed, so keep it tight.
export const REMOTE_RUNTIME_OUTBOUND_ENVELOPE_RESERVE_BYTES = 8 * 1024
export const REMOTE_RUNTIME_MAX_OUTBOUND_CONTENT_BYTES =
  REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES - REMOTE_RUNTIME_OUTBOUND_ENVELOPE_RESERVE_BYTES
