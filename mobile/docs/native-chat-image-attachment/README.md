# Native (rich) chat image attachment — proof

Fix: in the mobile **native/rich chat** (not the terminal chat), attaching an image
now shows the photo — as a removable composer chip while composing, and as a
thumbnail in the sent user bubble after sending (desktop parity).

## `native-chat-image-proof.png` — end-to-end

Three states of the real components rendered via `react-native-web`:

1. **BEFORE fix** — attaching produced nothing in the composer; Send stayed disabled.
2. **AFTER attach** — the image appears as a composer chip (with a remove ✕); Send enabled.
3. **AFTER sent** — the sent user message shows the photo thumbnail in the conversation
   (rendered by the real `MobileNativeChatMessage` image-ref path).

## `composer-before-after.png` — composer detail

Side-by-side of the real `MobileNativeChatComposer`: empty on attach (old behavior)
vs. showing the attached-image chip (new behavior).

## How these were produced

The actual, unchanged component code (`MobileNativeChatComposer`,
`MobileNativeChatMessage`) was mounted under `react-native-web` with mock props and
screenshotted in a headless browser. A full on-device run additionally requires a
paired desktop runtime and a live agent session; the fix's send/echo/reconciliation
logic is covered by unit tests.
