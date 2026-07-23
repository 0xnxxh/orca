# Native (rich) chat image attachment — proof

Fix: in the mobile **native/rich chat** (not the terminal chat), attaching an image
now shows the photo — as a removable composer chip while composing, and as a
thumbnail in the sent user bubble after sending (desktop parity).

## How the proof was produced (interactive, not hand-fed)

A harness (`mobile/rnw-preview/`) mounts the **real** production code —
`MobileNativeChatComposer`, `MobileNativeChatMessage`, and the real hooks
`useMobileNativeChatImageAttachments` + `useMobileNativeChatDrafts` (via a tiny
stand-in for the controller's `handleNativeChatSend`) — under `react-native-web`.
The **only** faked things are the two OS boundaries the app can't reach in a
browser/CI:

- the native photo picker (`picker-stub.ts`) — returns a canned image, and
- the paired-host RPC socket (`fake-rpc.ts`) — answers the exact methods the real
  upload + send pipeline calls (`clipboard.startImageUpload` → `method_not_found`
  so it takes the single-frame `clipboard.saveImageAsTempFile` fallback, and
  `terminal.send` → accepted), and records every call.

Every state below is **produced by the real code reacting to real clicks**, not by
props I set. The bottom panel prints the actual bytes the real send pipeline wrote
to the (faked) socket.

Reproduce:

```
cd mobile && npx vite --config rnw-preview/vite.config.ts   # then open http://localhost:5199
```

## The flow

1. `flow-1-initial.png` — empty composer, **Send disabled**, `terminal.send calls (0)`.
2. `flow-2-attached.png` — after **clicking Attach**: the real upload pipeline runs
   and a **thumbnail chip** appears, Send enables — and `terminal.send calls (0)`,
   i.e. the image is held, **not** pasted early.
3. `flow-3-sent.png` — after typing a caption and **clicking Send**: the sent user
   bubble shows the **photo thumbnail**, the composer clears, and the trace shows the
   exact ride-along the real code emitted:
   1. `""` (Ctrl+U clear), `enter=false`
   2. `"[200~/host/tmp/orca-attach-42.png[201~"` (bracketed image paste), `enter=false`
   3. `"Here is the layout bug"`, `enter=true`

## Not covered here

A fully on-device run (real iOS/Android app, live agent transcript) additionally
needs a paired desktop runtime + a live agent and can't be driven headlessly (the
native photo-picker modal isn't automatable), so it isn't part of this automated
proof. The send/echo/reconciliation logic is also covered by unit tests.
