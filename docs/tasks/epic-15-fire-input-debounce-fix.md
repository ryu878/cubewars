# EPIC 15: Fire/Input Debounce Cross-Type Interference Fix

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

**Origin:** not a user report. Internally discovered by Critic during EPIC 14's review — `docs/tasks/epic-14-critic-review.md`, finding F-001 ("critical in effect, but out of scope" for EPIC 14's own diff, with an explicit recommendation to file an urgent follow-up). This EPIC is that follow-up. Urgent bugfix, full pipeline including a mandatory Infosec pass given this exact code path's review history.

---

## 1. EPIC

| Field | Description |
|-------|-------------|
| **Name** | Fire/Input Debounce Cross-Type Interference Fix |
| **System goal** | Fix a severe, silent, pre-existing (EPIC-4-era) defect: the server's per-connection anti-flood debounce (`MIN_INPUT_INTERVAL_MS = 15`, `server/src/index.ts`) uses one shared "last accepted message" timestamp across **every** message shape (`join`/`input`/`fire`/`switch_weapon`/binary/oversized/non-JSON/unknown-type), applied pre-parse. Because a real client's `input` stream (~30Hz, independent `setInterval`) and its `fire` messages (async, on click) are two genuinely independent, uncorrelated timing sources, they collide inside the shared 15ms floor constantly under normal play — Critic measured **39–56% of fire attempts silently dropped** against the live server using a script that mirrors the real client's actual architecture, closely matching the ~45% theoretical prediction (15/33). Replace the flawed "min interval between ANY two messages of ANY shape" rule with a **rolling-window message-count cap** (same pre-parse placement, same aggregate-flood-bounding intent) that no longer penalizes a connection for legitimately interleaving independently-timed message streams a normal player produces, while preserving (and, on measured worst case, tightening) the anti-flood/DoS protection this code path exists for — see `docs/tasks/epic-04-critic-review.md` (two REVISE rounds fought specifically over flood-guard gaps in this exact code) and `docs/tasks/epic-04-infosec-findings.md` (F1, `maxPayload`, already fixed and untouched by this EPIC). |
| **Business/gameplay problem** | The game's single most important verb — "shoot" — silently fails for a large, non-noise fraction of real attempts, with **zero client-visible feedback** (no ack, no retry, no error before EPIC 14; after EPIC 14 merged, actively misleading, since the client now plays a confident gunshot sound on every click regardless of whether the server ever received/processed it). This has existed since EPIC 4 and affects every player, every match, at combat-defining scale. |
| **Architectural role** | server (authoritative transport/flood-guard layer — `server/src/index.ts` only; no game/simulation logic touched) |
| **Main components** | `server/`, `scripts/`, `docs/` |
| **Stack** | Fixed project stack, no deviation. Pure TypeScript logic change inside the existing Node.js/`ws` transport layer — no new dependency, no protocol/`shared/` change (no new message type, no client change required or made). |
| **Interaction with other components** | Touches only `server/src/index.ts`'s message-dispatch flood guard (the `socket.on("message", ...)` handler's opening debounce check, `lastAcceptedMessageAt`, and the `floodDropTracker`'s log wording). Does **not** touch: the existing per-weapon fire-cooldown gate (`lastFireAcceptedAt`, `WEAPON_STATS[...].cooldownMs`, lines ~244-260 — that gate is separately correct and out of scope, confirmed by re-reading it: it's not the bug); `MAX_MESSAGE_BYTES`/`wss`'s `maxPayload` (Infosec F1, already fixed, line 52, untouched); any client file (`client/src/fpsController.ts`'s 33ms input loop and click-driven fire handler are read-only inputs to this EPIC's derivation, not modified); any game/simulation logic (`playerRegistry.ts`, `combat.ts`, `match.ts`) — this is a transport-layer-only fix, consistent with `global-standards.mdc`'s "keep game/simulation logic separate from transport/networking code." |

---

## 2. Design decision: rolling-window message-count cap (fixed by Team Lead)

### 2.1 Why not just delete/narrow the check

`docs/tasks/epic-04-critic-review.md` records **two** Critic `REVISE` rounds fought specifically over gaps in this flood guard:

- **Round 1**: a fire-only stream never updated the shared timestamp (only the `input` branch did), so a connection sending nothing but `fire` bypassed the floor entirely.
- **Round 2**: binary, oversized, non-JSON, and unknown-type/malformed-`input` messages *also* never updated the timestamp, bypassing the floor and logging at unbounded per-message rate (185,800 unknown-type msgs/sec reproduced, zero flood-guard hits).

Both rounds converged on the same design requirement, still valid today: **the debounce must run pre-parse, before the server knows the message's shape**, and must be updated on receipt of literally anything that clears the binary/size check — so a connection flooding garbage of any single shape is still bounded. `docs/tasks/epic-04-infosec-findings.md` separately flagged (and got fixed) `maxPayload` framing, and raised the synchronous-logging-under-flood risk that the existing aggregate/throttled `createDropTracker` pattern (`FLOOD_LOG_INTERVAL_MS = 5000`) already mitigates and this EPIC leaves untouched. **This EPIC does not weaken or remove pre-parse placement, uniform coverage across all message shapes, or the aggregate-logging pattern — it only changes the accept/reject rule evaluated at that same pre-parse point**, from "was the single most recent accepted message (of any shape) less than 15ms ago" to "have fewer than K messages (of any shape) been accepted from this connection in the trailing M ms."

### 2.2 Why a rolling-window count, not a per-type sub-bucket

An alternative would be per-type sub-buckets inside the pre-parse gate (e.g., a separate cheap counter for "looks like an input-shaped message" vs. "looks like a fire-shaped message"). Rejected: the server does not know a message's type until *after* `JSON.parse` (confirmed by reading the current dispatch order — binary/size checks, then `JSON.parse`, then `parsed.type` dispatch, in that order) — any pre-parse type-awareness would require either parsing twice (defeats the "reject before the expensive work" intent that made this pre-parse in the first place) or a fragile heuristic sniff of the raw bytes. A rolling-window **count** cap needs no type knowledge at all, correctly bounds aggregate volume/rate regardless of shape (preserving the exact EPIC-4 security intent — a garbage flood of one shape is still bounded, satisfying both EPIC-4 REVISE rounds), and is a well-understood, easily-verified rate-limiting primitive. This is the recommended and adopted direction.

### 2.3 Derivation of K (message count) and M (window, ms)

Inputs, all confirmed by reading the real client code (not assumed):

1. **`input` stream**: `client/src/main.ts` `INPUT_SEND_INTERVAL_MS = 33` (line 360), a fixed `setInterval` — deterministic, ~30.3 msgs/sec, not bursty.
2. **`fire` stream**: `client/src/fpsController.ts:95-103` — fired from a real DOM `"click"` event (not a held-`mousedown` auto-repeat), so its rate is bounded by actual human clicking, uncorrelated with the input timer's phase. A generous sustained ceiling for a very fast human clicker: **12 clicks/sec** (well above typical sustained competitive click rates of 6-10 CPS; short 14-16 CPS bursts exist but are not sustainable for more than a fraction of a second).
3. **`switch_weapon` stream**: sent on a discrete `E` keydown edge (`event.repeat`-guarded, confirmed by reading the keydown handler pattern used elsewhere in `fpsController.ts`), bounded by keyboard mashing. Generous ceiling: **8/sec**.
4. **`join`**: once per connection lifetime — negligible.

**Combined absolute worst-case single-connection legitimate load** (all three streams mashed simultaneously — physically implausible for a real player to sustain mouse-click-mashing, keyboard-mashing, and normal movement all at once, but used here as a deliberately generous upper bound, not the realistic case):

```
30.3 (input) + 12 (fire, fast-clicker ceiling) + 8 (switch_weapon, mashing ceiling) ≈ 50.3 msgs/sec
```

**Chosen cap:** `FLOOD_WINDOW_MS = 1000`, `MAX_MESSAGES_PER_WINDOW = 100` → a sustained ceiling of **100 msgs/sec per connection**.

- **Headroom over legitimate traffic:** ~2x the 50.3/sec extreme combined-mash estimate, and ~3.3x the realistic normal-play combined rate (input + occasional, non-mashed fire/switch — well under 40/sec in practice). Comfortably absorbs any event-loop scheduling jitter/clustering (e.g. an `input` tick and a `fire` click landing in the same tick) without ever operating close to the cap under real play.
- **Comparison to the old regime:** the old `MIN_INPUT_INTERVAL_MS = 15` capped absolute worst-case throughput at `1000/15 ≈ 66.7` msgs/sec (before accounting for the cross-type bug that made real throughput *worse* than that for legitimate multi-type traffic). The new 100/sec cap is the same order of magnitude — not a material loosening of the aggregate anti-flood bound — while being **1,858x tighter** than the 185,800 msgs/sec flood rate Critic actually reproduced against this exact code path in EPIC 4's review, and orders of magnitude tighter than any "hundreds/thousands of messages/sec" flood scenario.
- **Reaction speed against true floods:** implemented as a true **sliding window** (a per-connection timestamp log, pruned to the trailing `FLOOD_WINDOW_MS` on every message — not a fixed/resetting bucket, which would allow a 2x burst at a bucket boundary). A flood is throttled as soon as `MAX_MESSAGES_PER_WINDOW` messages have been accepted within the trailing window — e.g. at a 1,000 msgs/sec flood rate, throttling begins within ~100ms of the flood starting; at the 185,800 msgs/sec rate Critic reproduced, within a fraction of a millisecond. After that point, sustained accepted throughput is capped at `K/M = 100/sec` for as long as the flood continues, regardless of how fast the attacker actually sends — this is a **tighter** aggregate bound under sustained flood than the old per-message-interval rule provided in practice (which never actually achieved its theoretical 66.7/sec ceiling for cross-type floods either, for the same reason it hurt legitimate traffic).

### 2.4 Implementation shape (Programmer finalizes exact code, this is the required behavior)

Replace `lastAcceptedMessageAt: Map<string, number>` with a per-connection sliding-window timestamp log:

```ts
const FLOOD_WINDOW_MS = 1000;
const MAX_MESSAGES_PER_WINDOW = 100;
const messageTimestamps = new Map<string, number[]>();
```

At the same pre-parse point the old check ran (before binary/size/JSON-parse/type-dispatch):

```ts
const now = Date.now();
const timestamps = messageTimestamps.get(playerId) ?? [];
const windowStart = now - FLOOD_WINDOW_MS;
while (timestamps.length > 0 && timestamps[0] < windowStart) timestamps.shift();
if (timestamps.length >= MAX_MESSAGES_PER_WINDOW) {
  floodDropTracker.record(playerId, now);
  return;
}
timestamps.push(now);
messageTimestamps.set(playerId, timestamps);
```

- `timestamps` is bounded to at most `MAX_MESSAGES_PER_WINDOW` (100) entries per connection at any time — trivial memory, same order as the old single-timestamp map.
- Cleared on `close` exactly like the old `lastAcceptedMessageAt.delete(playerId)` — `messageTimestamps.delete(playerId)`.
- `floodDropTracker`'s log message must be updated from "`(exceeding ${MIN_INPUT_INTERVAL_MS}ms min interval)`" to something reflecting the new rule, e.g. "`(exceeding ${MAX_MESSAGES_PER_WINDOW} messages / ${FLOOD_WINDOW_MS}ms window)`" — the aggregate/throttled logging pattern (`createDropTracker`, `FLOOD_LOG_INTERVAL_MS`) itself is unchanged.
- All the comments at lines 9-25 and 62-69 explaining the pre-parse, uniform-across-shapes design intent must be updated to describe the new rolling-window-count rule (referencing this EPIC 15 doc and the EPIC-4 history the same way the current comments do) — the *intent* they describe (uniform, pre-parse, bounds any single shape) is unchanged, only the *mechanism* changes from "min interval" to "window count."
- Do **not** touch `lastFireAcceptedAt` / the per-weapon cooldown gate (lines ~244-260) — separately correct, out of scope.
- Do **not** touch `wss`'s `maxPayload` (Infosec F1 fix, line 52) or `MAX_MESSAGE_BYTES`.

---

## 3. Story 15.1 — Replace the shared min-interval debounce with the rolling-window count cap (server)

**As a** player **I want** my independent `input` and `fire` message streams to stop silently colliding with each other **so that** my shots actually reach the server at the rate I send them, without reopening the EPIC-4 flood-guard gaps.

- Implement per Section 2.4 in `server/src/index.ts`.
- **Constraints:** pre-parse placement preserved; uniform coverage across every message shape preserved (join/input/fire/switch_weapon/binary/oversized/non-JSON/unknown-type all still go through the same gate before any type-specific logic); aggregate/throttled logging pattern preserved; per-weapon fire-cooldown gate untouched; `maxPayload` untouched; no new dependency; no client change.
- **Acceptance criteria:**
  - [ ] `MIN_INPUT_INTERVAL_MS` and `lastAcceptedMessageAt` are removed, replaced by `FLOOD_WINDOW_MS = 1000`, `MAX_MESSAGES_PER_WINDOW = 100`, and `messageTimestamps: Map<string, number[]>` (or an equivalent true sliding-window implementation — no fixed/resetting bucket that allows a boundary double-burst).
  - [ ] The check still runs before binary/size/JSON-parse/type-dispatch (same position as today), and still stamps a timestamp on receipt of *any* message shape that clears the binary/size gate — closing, not reopening, both EPIC-4 Critic `REVISE` rounds' gaps.
  - [ ] `messageTimestamps` entry is cleared on `close`, same as the old map.
  - [ ] `floodDropTracker`'s log wording reflects the new rule.
  - [ ] Updated in-line comments describing the new mechanism, referencing this EPIC's doc.
  - [ ] `npm run typecheck` / `npm run build` clean.

---

## 4. Story 15.2 — Reproduce Critic's live drop-rate measurement, before and after (regression evidence)

**As a** developer **I want** the exact drop-rate measurement methodology Critic used to discover this defect re-run against both the old and new code **so that** the fix is proven with real numbers, not just code review, and the anti-flood protection is proven still intact with real numbers too.

- New script under `scripts/` (style/rigor matching existing regression scripts, e.g. `scripts/regression-bot-aim-miss-rate.ts`, and the live-WS self-check scripts under `scripts/qa-epic14-*.mjs`) that **faithfully mirrors the real client's architecture**, per `docs/tasks/epic-14-critic-review.md` F-001's own method:
  - An independent `setInterval` sending `input` every 33ms (matching `client/src/main.ts` `INPUT_SEND_INTERVAL_MS`), uncorrelated with...
  - ...`fire` messages sent on a separate, independently-timed clock (matching the real click handler's lack of synchronization with the input loop), with gaps large enough (≥350ms) that the separate per-weapon cooldown gate is never the limiting factor being measured.
  - Against a real running server (`public` mode, no bots, to avoid a death confound — same precaution Critic used).
  - Reports the **actual observed drop rate** (fire attempts sent vs. `fire_broadcast` echoes received), not just pass/fail.
- **Minimum coverage:**
  1. **Control** (fire-only, no competing input stream): confirm ~0% drop, same as Critic's control — proves the harness itself is sound.
  2. **Real-architecture simulation** (competing 33ms input timer + independently-timed fire clicks): run against the **current `master` code (pre-fix)** first, to reproduce Critic's 39-56% finding on this exact codebase state as a documented "before" baseline — then run again against the fix, expecting the drop rate to fall to ~0% (allowing for ordinary network/scheduling noise, not a hard mathematical zero).
  3. **True flood check** (the other half of the requirement — this fix must not weaken anti-flood protection): a tight loop sending hundreds of messages/sec of a single shape (e.g. `input`, and separately one of the previously-EPIC-4-round-2-vulnerable shapes — unknown-type or non-JSON) against the fixed code, confirming messages are still dropped/bounded once `MAX_MESSAGES_PER_WINDOW` is exceeded within `FLOOD_WINDOW_MS`, and that the aggregate/throttled log pattern still produces O(1) log lines, not O(message count).
- **Acceptance criteria:**
  - [ ] Script committed, re-runnable, reports real observed numbers (attempts sent, echoes received, computed drop rate) for each case — not just assertions with no detail shown.
  - [ ] "Before" run (pre-fix code, e.g. checked out at `8cbe78e` or via a stashed diff) reproduces a drop rate in the same range Critic measured (roughly 39-56%), documented as the baseline.
  - [ ] "After" run (fixed code) shows drop rate at or near 0% for the real-architecture simulation.
  - [ ] True-flood case confirms messages are still dropped/bounded past the new cap, with aggregate (not per-message) logging.
  - [ ] Exits non-zero if the "after" drop rate exceeds a small, documented tolerance (e.g. 2%), or if the true-flood case fails to bound (i.e. accepts unbounded throughput).

---

## 5. Story 15.3 — Docs

**As a** developer reading `README.md`/`docs/backlog.md` **I want** this fix recorded in the project's running EPIC history **so that** the defect's origin (EPIC 4), discovery (EPIC 14 Critic F-001), and resolution (EPIC 15) are traceable.

- `README.md`: add an EPIC 15 section following the established EPIC-list format/placement (see EPIC 13/14 entries for style), summarizing the defect, the measured before/after drop rates, and the rolling-window-count fix.
- **Acceptance criteria:**
  - [ ] `README.md` has an EPIC 15 entry in the established style/location with the actual measured numbers.

---

## 6. Tasks

| # | Task | Expected result | Place in code | Completion criterion |
|---|------|------------------|----------------|----------------------|
| 1 | Replace `MIN_INPUT_INTERVAL_MS` shared-timestamp debounce with `FLOOD_WINDOW_MS`/`MAX_MESSAGES_PER_WINDOW` sliding-window count cap | Story 15.1 | `server/src/index.ts` | Story 15.1 acceptance criteria |
| 2 | Regression/evidence script reproducing Critic's live drop-rate methodology, before + after + true-flood check | Story 15.2 | `scripts/` | Story 15.2 acceptance criteria |
| 3 | Docs: `README.md` EPIC 15 section | Story 15.3 | `README.md` | Story 15.3 acceptance criteria |

---

## 7. Acceptance Criteria (EPIC-level, Definition of Done)

- [ ] `server/src/index.ts`'s flood guard is a rolling-window message-count cap (`FLOOD_WINDOW_MS = 1000`, `MAX_MESSAGES_PER_WINDOW = 100`, true sliding window — not a fixed/resetting bucket), replacing the old single shared min-interval timestamp.
- [ ] Pre-parse placement and uniform coverage across every message shape (join/input/fire/switch_weapon/binary/oversized/non-JSON/unknown-type) preserved — both EPIC-4 Critic `REVISE` round gaps (fire-only bypass; binary/oversized/non-JSON/unknown-type bypass) remain closed, verified by explicit re-test, not assumed.
- [ ] Per-weapon fire-cooldown gate (`lastFireAcceptedAt`), `maxPayload`/`MAX_MESSAGE_BYTES` (Infosec F1), aggregate/throttled logging pattern — all untouched and still functioning.
- [ ] Measured, documented before/after fire-attempt drop rate under realistic concurrent traffic (independent 33ms input timer + independently-timed fire clicks): before ≈ Critic's 39-56% range (reproduced on pre-fix code as a baseline), after ≈ 0% (small documented tolerance).
- [ ] Measured, documented confirmation that a true flood (hundreds of messages/sec, single shape, including at least one of the EPIC-4-round-2 shapes) is still dropped/bounded post-fix, with O(1) aggregate log lines.
- [ ] No game/simulation logic touched; no new dependency; no client change; no new protocol/`shared/` message type.
- [ ] `npm run typecheck` / `npm run build` clean.
- [ ] `README.md` EPIC 15 entry with actual measured numbers.
- [ ] Full pipeline: Programmer → Tester → Critic → **Infosec** (mandatory, given this code path's two-round EPIC-4 Critic history + EPIC-4 Infosec findings) → Judge only on genuine `REVISE` → Team Lead final checks → merge.

---

## 8. Risks

- **Regressing either EPIC-4 Critic `REVISE` round**: mitigated by Story 15.1's explicit constraint (pre-parse, uniform coverage preserved) and Story 15.2's explicit re-test of both the fire-only case and the four round-2 message shapes.
- **Weakening the anti-flood/DoS bound**: mitigated by the derivation in Section 2.3 (new cap is the same order of magnitude as the old theoretical ceiling, and 1,858x tighter than the actual flood rate Critic reproduced) and Story 15.2's explicit true-flood regression case.
- **Sliding-window array growth/perf**: bounded — at most `MAX_MESSAGES_PER_WINDOW` (100) timestamps per connection at any time, pruned on every message; negligible memory/CPU versus the old single-timestamp map.
- **"Before" baseline reproduction flakiness**: live-network timing measurements have inherent variance (Critic's own three runs ranged 39.2-56.0%) — Story 15.2 requires the baseline fall in the same broad range, not an exact match, and requires the "after" result to be unambiguously near 0% by comparison, which is the actual claim being proven.
- **Infosec re-opening a new finding**: given this exact code's history (two Critic REVISE rounds + one Infosec release-blocker in EPIC 4), Infosec review is mandatory in this EPIC's pipeline (not optional/skippable) specifically to catch anything Critic's review alone might miss on a second pass over security-sensitive transport code.

---

## 9. Process (mandatory for this EPIC)

Full pipeline, no shortcuts, given the security-sensitive history of this exact code path:

```
Team Lead (spec, this doc)
  -> Programmer (implementation, branch feature/fix-fire-input-debounce)
  -> Tester (QA checklist + reproduces Story 15.2's before/after/true-flood measurement)
  -> Critic (diff + Tester PASS review)
  -> Infosec (mandatory security pass on this specific change, given epic-04-critic-review.md's two REVISE rounds + epic-04-infosec-findings.md F1 on this exact file)
  -> Judge (only if Critic returns REVISE, after Programmer fix + Tester re-verify)
  -> Team Lead (final checks: typecheck/build/secret scan; merge --no-ff to master; push; delete local branch)
  -> User (final report, with actual measured before/after drop-rate numbers)
```

No PR is opened/pushed for this task per this repository's established local-merge convention (see recent EPIC 11-14 merge commits) — branch is local-only, deleted after merge; if it is ever accidentally pushed to `origin`, it must be deleted there too (per EPIC 14's cleanup precedent).

---

## Sign-off

- **Specification (author):** Team Lead (Tusya)
- **Approval (Team Lead):** Tusya — approved for assignment, urgent priority
- **Assignee:** Programmer (Pusya)
