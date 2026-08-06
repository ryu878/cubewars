import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import {
  BROADCAST_TICK_HZ,
  PROTOCOL_VERSION,
  normalizeNickname,
  type ClientMessage,
  type JoinAcceptedMessage,
  type JoinRejectedMessage,
  type LeaderboardMessage,
  type LobbyStateMessage,
  type WelcomeMessage,
} from "@cubewars/shared";
import { MatchManager } from "./matchManager.js";
import type { Match } from "./match.js";

const PORT = Number(process.env.CUBEWARS_SERVER_PORT ?? 7777);

// Flood guard: bound the total number of ANY client messages (input, fire,
// join, binary, oversized, non-JSON, unrecognized-type — literally anything
// arriving on the socket) accepted per connection within a trailing window,
// independent of what the client claims its own send rate is
// (global-standards.mdc "Rate-limit or debounce client input to prevent
// flooding"). This is a single shared per-connection rolling-window count
// cap across EVERY message shape (see messageTimestamps below): the check
// runs first, before binary/size/JSON-parse/type-dispatch, and a timestamp
// is stamped immediately once a message clears that check — BEFORE we know
// whether it will turn out to be binary, oversized, non-JSON, unknown-type,
// or a valid join/input/fire. That is deliberate: a connection that only
// ever sends garbage of any single shape must still be bounded by this cap
// (EPIC 4 F-001, both Critic REVISE rounds; carried through EPIC 9's match
// refactor — this guard is connection-scoped, not match-scoped, so it
// applies identically whether or not the connection has joined a match
// yet).
//
// EPIC 15 (`docs/tasks/epic-15-fire-input-debounce-fix.md`): this used to be
// a single shared "min interval since the last accepted message of ANY
// shape" debounce (`MIN_INPUT_INTERVAL_MS = 15`). That penalized a real
// client's independently-timed `input` (~30Hz) and `fire` (on click)
// streams for merely interleaving — one arriving inside the other's 15ms
// floor caused it to be dropped even though neither stream, on its own, was
// flooding anything. Replaced with a true sliding-window message-COUNT cap:
// at most MAX_MESSAGES_PER_WINDOW messages (of any shape) accepted per
// connection in the trailing FLOOD_WINDOW_MS. This needs no knowledge of
// message type (still pre-parse, per the constraint above) and no longer
// penalizes legitimate multi-stream traffic, while remaining tighter than
// the 185,800 msgs/sec flood EPIC 4's Critic actually reproduced against
// this exact code path — see the EPIC 15 doc Section 2 for the full
// derivation of these two numbers.
const FLOOD_WINDOW_MS = 1000;
const MAX_MESSAGES_PER_WINDOW = 100;

// Reject oversized payloads outright before attempting to parse JSON.
const MAX_MESSAGE_BYTES = 1024;

// Every "drop this message" path below (flood guard, fire cooldown, not
// joined yet, already joined, binary, oversized, non-JSON, unknown-type,
// malformed-input) logs in aggregate rather than one line per drop (that
// would just be a different flavor of log spam, and — per Critic F-001
// round 2 — synchronous console.warn calls at flood volumes could plausibly
// stall the single-threaded event loop and delay the tick for every player,
// not just the offending connection). Each drop path logs immediately on its
// first hit for a connection (so a flood shows up in the log right away),
// then at most once per this interval thereafter while it continues,
// summarizing how many messages were dropped since the last log line. Normal
// play never hits any drop path, so this produces zero extra log noise under
// normal play (security-baseline.mdc "log anomalous input patterns").
const FLOOD_LOG_INTERVAL_MS = 5000;

// Infosec F1 (EPIC 4 review): ws@8's own default maxPayload is 100 MiB — the
// library would fully buffer any frame up to that size into memory BEFORE
// the app-level MAX_MESSAGE_BYTES check below ever runs, undercutting the
// flood-guard work above (which only bounds message *rate*, not frame
// *size*). Setting maxPayload here makes ws itself reject/close oversized
// frames (code 1009) at the framing layer, before app code ever sees them.
// Reuses MAX_MESSAGE_BYTES rather than introducing a second magic number.
const wss = new WebSocketServer({ port: PORT, maxPayload: MAX_MESSAGE_BYTES });

// EPIC 9 "Bots & Match Modes": the server's game state is now N independent
// match instances (see match.ts / matchManager.ts) instead of one global
// PlayerRegistry/PickupSpawner/tick-interval. This module now only handles
// transport (WS connections, per-connection flood/rate-limit guards,
// message parsing/dispatch, join routing) — never game/simulation logic
// itself (global-standards.mdc: keep game logic separate from transport).
const matchManager = new MatchManager({
  onLeaderboardChanged: () => broadcastLobbyLeaderboard(),
});

// Shared across EVERY message shape a connection can send (join, input,
// fire, binary, oversized, non-JSON, unknown-type, malformed-input —
// literally anything the "message" handler below sees) — this is what the
// FLOOD_WINDOW_MS/MAX_MESSAGES_PER_WINDOW rolling-window count cap
// reads/writes: each connection's array of accepted-message timestamps,
// pruned to the trailing FLOOD_WINDOW_MS on every message (a true sliding
// window, not a fixed/resetting bucket — see EPIC 15 doc Section 2.3 for
// why a resetting bucket would allow a 2x burst at a bucket boundary).
// Bounded to at most MAX_MESSAGES_PER_WINDOW (100) entries per connection at
// any time. Connection-scoped (keyed by connection id, which never changes
// for the lifetime of one WS connection regardless of which match it later
// joins), same as before EPIC 9.
const messageTimestamps = new Map<string, number[]>();
const lastFireAcceptedAt = new Map<string, number>();

/**
 * Aggregate/throttled-logging "drop tracker" for a single drop reason. One
 * line per dropped message would just reproduce the log-spam / event-loop-
 * stall risk this pattern exists to avoid, so instead each reason tracks a
 * per-connection drop count and logs a summary immediately on the first
 * drop, then at most once per FLOOD_LOG_INTERVAL_MS while drops continue.
 */
function createDropTracker(describe: (playerId: string, count: number, extra?: string) => string) {
  const counts = new Map<string, number>();
  const lastLoggedAt = new Map<string, number>();
  return {
    // `extra` is optional free-form context appended by the caller (used by
    // fireCooldownDropTracker below to report the actual weapon-specific
    // cooldown that was exceeded) — every other tracker ignores it.
    record(playerId: string, now: number, extra?: string): void {
      const count = (counts.get(playerId) ?? 0) + 1;
      counts.set(playerId, count);
      const lastLogged = lastLoggedAt.get(playerId) ?? 0;
      if (lastLogged === 0 || now - lastLogged >= FLOOD_LOG_INTERVAL_MS) {
        console.warn(describe(playerId, count, extra));
        lastLoggedAt.set(playerId, now);
        counts.set(playerId, 0);
      }
    },
    clear(playerId: string): void {
      counts.delete(playerId);
      lastLoggedAt.delete(playerId);
    },
  };
}

const floodDropTracker = createDropTracker(
  (playerId, count) =>
    `[server] flood guard: dropped ${count} message(s) from ${playerId} ` +
    `(exceeding ${MAX_MESSAGES_PER_WINDOW} messages / ${FLOOD_WINDOW_MS}ms window)`,
);
const fireCooldownDropTracker = createDropTracker(
  (playerId, count, extra) =>
    `[server] fire rate limit: dropped ${count} fire message(s) from ${playerId} ` +
    `(exceeding ${extra ?? "the equipped weapon's"} cooldown)`,
);
const binaryDropTracker = createDropTracker(
  (playerId, count) => `[server] dropped ${count} binary message(s) from ${playerId}`,
);
const oversizedDropTracker = createDropTracker(
  (playerId, count) =>
    `[server] dropped ${count} oversized message(s) from ${playerId} (limit ${MAX_MESSAGE_BYTES} bytes)`,
);
const nonJsonDropTracker = createDropTracker(
  (playerId, count) => `[server] dropped ${count} malformed (non-JSON) message(s) from ${playerId}`,
);
const unknownTypeDropTracker = createDropTracker(
  (playerId, count) => `[server] dropped ${count} message(s) with unknown type from ${playerId}`,
);
const malformedInputDropTracker = createDropTracker(
  (playerId, count) => `[server] dropped ${count} out-of-range/malformed input message(s) from ${playerId}`,
);
// EPIC 9 Story 9.2 AC: "the player cannot send input/fire/switch_weapon
// before joining a mode" — every gameplay message type is rejected with this
// tracker until this connection's `join` has been processed.
const notJoinedDropTracker = createDropTracker(
  (playerId, count) =>
    `[server] dropped ${count} gameplay message(s) from ${playerId} sent before joining a match`,
);
// A connection can only join once (no mode-switch mid-session, no session
// persistence per EPIC 9 spec Section 2) — a second "join" is dropped and
// logged as an anomaly rather than silently re-spawning/re-parenting the
// connection into a different match.
const alreadyJoinedDropTracker = createDropTracker(
  (playerId, count) => `[server] dropped ${count} duplicate join message(s) from ${playerId} (already joined)`,
);

const lobbySockets = new Set<WebSocket>();

function lobbyStateMessage(): LobbyStateMessage {
  return { type: "lobby_state", matches: matchManager.listPublicMatches() };
}

function leaderboardMessage(): LeaderboardMessage {
  return { type: "leaderboard", entries: matchManager.listLeaderboard() };
}

function sendJson(
  socket: WebSocket,
  message: WelcomeMessage | LobbyStateMessage | LeaderboardMessage | JoinAcceptedMessage | JoinRejectedMessage,
): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function broadcastLobbyState(): void {
  const message = lobbyStateMessage();
  for (const socket of lobbySockets) {
    sendJson(socket, message);
  }
}

function broadcastLobbyLeaderboard(): void {
  const message = leaderboardMessage();
  for (const socket of lobbySockets) {
    sendJson(socket, message);
  }
}

console.log(`[server] cubewars game server listening on ws://localhost:${PORT}`);
console.log(`[server] tick rate: ${BROADCAST_TICK_HZ}Hz (per match — see server/src/match.ts)`);

/** Total currently-open WS connections (joined or not) — ops/logging visibility only, mirrors the pre-EPIC-9 "(${registry.size()} online)" log with a transport-level count now that there is no single global registry. */
let connectionCount = 0;

wss.on("connection", (socket: WebSocket) => {
  const playerId = randomUUID();
  connectionCount += 1;
  console.log(`[server] connection opened: ${playerId} (${connectionCount} connected)`);

  // EPIC 9: this connection is not a member of ANY match until it sends
  // "join" (see the "join" branch below / Match.addHuman()) — every other
  // message type is gated on `match` being non-null. `let`, not const:
  // reassigned exactly once, from null to the joined Match, by the "join"
  // branch below.
  let match: Match | null = null;
  let nickname: string = playerId;
  let nicknameKey: string = playerId.toLocaleLowerCase();
  lobbySockets.add(socket);

  const welcome: WelcomeMessage = {
    type: "welcome",
    protocolVersion: PROTOCOL_VERSION,
    playerId,
    serverTimeMs: Date.now(),
  };
  sendJson(socket, welcome);
  sendJson(socket, lobbyStateMessage());
  sendJson(socket, leaderboardMessage());

  socket.on("message", (data, isBinary) => {
    // Rolling-window count check runs FIRST, before any
    // binary/size/parse/type-dispatch logic, and independent of message
    // shape (EPIC 4 F-001 round 2, preserved by EPIC 15): a connection that
    // has already had MAX_MESSAGES_PER_WINDOW messages accepted within the
    // trailing FLOOD_WINDOW_MS gets this one dropped here regardless of what
    // it would have turned out to be. True sliding window: timestamps older
    // than the trailing window are pruned on every message, so the cap is
    // never gamed by landing exactly on a fixed-bucket boundary (EPIC 15 doc
    // Section 2.3).
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

    if (isBinary) {
      binaryDropTracker.record(playerId, now);
      return;
    }

    const raw = data.toString();
    if (Buffer.byteLength(raw) > MAX_MESSAGE_BYTES) {
      oversizedDropTracker.record(playerId, now);
      return;
    }

    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(raw) as ClientMessage;
    } catch {
      nonJsonDropTracker.record(playerId, now);
      return;
    }

    if (!parsed || typeof parsed !== "object") {
      unknownTypeDropTracker.record(playerId, now);
      return;
    }

    if (parsed.type === "join") {
      if (match) {
        alreadyJoinedDropTracker.record(playerId, now);
        return;
      }
      if (parsed.mode !== "public" && parsed.mode !== "bots") {
        unknownTypeDropTracker.record(playerId, now);
        return;
      }

      const normalized = normalizeNickname(parsed.nickname);
      if (!normalized.ok) {
        sendJson(socket, { type: "join_rejected", reason: "nickname_invalid" });
        return;
      }
      nickname = normalized.nickname;
      nicknameKey = normalized.key;

      if (parsed.mode === "public") {
        const requestedMatch =
          typeof parsed.matchId === "string" && parsed.matchId.length > 0
            ? matchManager.getPublicMatch(parsed.matchId)
            : null;
        const targetMatch = requestedMatch ?? (parsed.matchId ? null : matchManager.findOrCreatePublicMatch());
        if (!targetMatch) {
          sendJson(socket, { type: "join_rejected", reason: "match_not_found" });
          return;
        }
        if (targetMatch.hasNicknameKey(nicknameKey)) {
          sendJson(socket, { type: "join_rejected", reason: "nickname_taken" });
          return;
        }
        if (!targetMatch.canAcceptHuman()) {
          sendJson(socket, { type: "join_rejected", reason: "match_full" });
          return;
        }
        match = targetMatch;
      } else {
        if (nicknameKey === "bot 1" || nicknameKey === "bot 2") {
          sendJson(socket, { type: "join_rejected", reason: "nickname_taken" });
          return;
        }
        match = matchManager.createBotsMatch(playerId);
      }

      lobbySockets.delete(socket);
      match.addHuman(playerId, socket, nickname, nicknameKey);
      const accepted: JoinAcceptedMessage = { type: "join_accepted", matchId: match.id, nickname };
      sendJson(socket, accepted);
      sendJson(socket, leaderboardMessage());
      console.log(
        `[server] player joined match "${match.id}" (mode=${parsed.mode}): ${nickname} (${playerId}) ` +
          `(${match.humanCount()} human(s) in match)`,
      );
      broadcastLobbyState();
      broadcastLobbyLeaderboard();
      return;
    }

    // Every other message type is gameplay-relevant and requires an active
    // match membership first (EPIC 9 Story 9.2 AC / security-baseline.mdc
    // "reject what shouldn't be trusted") — a connection that hasn't sent
    // "join" yet cannot move, fire, or switch weapons in any match.
    if (!match) {
      notJoinedDropTracker.record(playerId, now);
      return;
    }

    if (parsed.type === "input") {
      const accepted = match.registry.applyInput(playerId, parsed);
      if (!accepted) {
        malformedInputDropTracker.record(playerId, now);
        return;
      }
      return;
    }

    if (parsed.type === "fire") {
      // Dead players can't fire (Story 4.2 AC) — not logged as an anomaly,
      // this is an expected race while a client's own respawn state is
      // still in flight.
      if (!match.registry.isAlive(playerId)) return;

      // EPIC 6: the rate-of-fire cap is the shooter's own equipped weapon's
      // cooldown (WEAPON_STATS[...].cooldownMs), read fresh every fire
      // attempt from the server's own authoritative record — never a single
      // fixed constant, and never anything the client asserts.
      const cooldownMs = match.registry.getFireCooldownMs(playerId);
      const lastFire = lastFireAcceptedAt.get(playerId) ?? 0;
      if (now - lastFire < cooldownMs) {
        fireCooldownDropTracker.record(playerId, now, `${cooldownMs}ms`);
        return;
      }
      lastFireAcceptedAt.set(playerId, now);

      // match.resolveFire() performs the actual authoritative hitscan
      // (server/src/combat.ts, via registry.fire()) from the shooter's own
      // server-tracked position/yaw/pitch/equipped-weapon, and broadcasts
      // whatever it resolved to (hit/death/kill) scoped to this match only
      // — nothing here trusts anything the client sent beyond "I fired now"
      // (security-baseline.mdc).
      match.resolveFire(playerId);
      return;
    }

    if (parsed.type === "switch_weapon") {
      // EPIC 6 Story 6.2 "E" key: server-decided "cycle to the next OWNED
      // weapon in tier order" — see registry.cycleWeapon() doc comment for
      // why this carries no client-supplied target weapon. Returns false
      // (no-op, nothing broadcast/logged) if there's nothing to cycle to.
      const changed = match.registry.cycleWeapon(playerId);
      if (changed) {
        match.sendLoadout(playerId);
        const loadout = match.registry.getLoadout(playerId);
        console.log(`[server] [${match.id}] switch: ${playerId} -> ${loadout?.equippedWeapon ?? "?"}`);
      }
      return;
    }

    unknownTypeDropTracker.record(playerId, now);
  });

  socket.on("close", () => {
    // EPIC 9: tears down this connection's match membership (and, for a
    // "bots" match whose last human this was, the whole match — see
    // Match.removeHuman() / MatchManager). No-op if this connection never
    // joined any match.
    if (match) {
      match.removeHuman(playerId);
      broadcastLobbyState();
      broadcastLobbyLeaderboard();
    }
    lobbySockets.delete(socket);
    connectionCount -= 1;
    messageTimestamps.delete(playerId);
    lastFireAcceptedAt.delete(playerId);
    floodDropTracker.clear(playerId);
    fireCooldownDropTracker.clear(playerId);
    binaryDropTracker.clear(playerId);
    oversizedDropTracker.clear(playerId);
    nonJsonDropTracker.clear(playerId);
    unknownTypeDropTracker.clear(playerId);
    malformedInputDropTracker.clear(playerId);
    notJoinedDropTracker.clear(playerId);
    alreadyJoinedDropTracker.clear(playerId);
    console.log(
      `[server] connection closed: ${playerId} (${connectionCount} connected, ${matchManager.size()} live match(es))`,
    );
  });

  socket.on("error", (err) => {
    console.error(`[server] socket error for ${playerId}:`, err);
  });
});

wss.on("error", (err) => {
  console.error("[server] WebSocketServer error:", err);
});

process.on("SIGINT", () => {
  console.log("[server] shutting down");
  wss.close(() => process.exit(0));
});
