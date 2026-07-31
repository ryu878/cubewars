# Tester re-verify — EPIC 4, Infosec F1 fix (commit `f44bf4d`)

## Scope confirmation

Only `server/src/index.ts` changed (+9/-2): `maxPayload: MAX_MESSAGE_BYTES` added to `WebSocketServer` constructor; size check switched to `Buffer.byteLength(raw)`.

## Independent re-verification

- Oversized frame (~2MiB): connection closed code 1009. Server log shows rejection inside `ws`'s own `Receiver.haveLength` (`RangeError: Max payload size exceeded`, `WS_ERR_UNSUPPORTED_MESSAGE_LENGTH`) via `socket.on("error")` — never reaches the app's message handler, no oversized-drop log line. Confirms rejection at the framing layer, before app code.
- Frame just under limit (1004 bytes): accepted normally, connection stays open.
- Legit input/fire traffic: 39 world_state broadcasts in 2s at 20Hz, position updates correctly, no false-positive rejection.
- F-001 flood-guard regression check: 500-message 0-delay burst still debounced correctly (connection stays open, drop logged), unaffected by this change — independent code paths (maxPayload is a `ws` constructor option, debounce runs inside the message handler).

## Build/typecheck

Both clean.

## Outcome

**PASS.** F1 fixed, confirmed via server-side error log inspection (not just client-observed close code), no regressions. Ready for Critic (fresh pass on this small change, not Judge).
