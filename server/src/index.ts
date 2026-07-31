import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import {
  BROADCAST_TICK_HZ,
  COMBAT,
  PROTOCOL_VERSION,
  type ClientMessage,
  type DeathEvent,
  type HitEvent,
  type RespawnEvent,
  type ServerMessage,
  type WelcomeMessage,
  type WorldStateMessage,
} from "@cubewars/shared";
import { PlayerRegistry } from "./playerRegistry.js";

const PORT = Number(process.env.CUBEWARS_SERVER_PORT ?? 7777);

// Broadcast + physics tick rate. 20 Hz (50ms) is a reasonable balance for a
// small-scale casual multiplayer game: frequent enough that other players'
// movement doesn't look choppy locally, infrequent enough to keep
// bandwidth/CPU low without needing client-side interpolation yet (EPIC 2
// risk note). Revisit if/when the player count or map size grows.
const TICK_HZ = BROADCAST_TICK_HZ;
const TICK_MS = 1000 / TICK_HZ;
const TICK_DT_SECONDS = TICK_MS / 1000;

// Flood guard: reject ANY client message (input, fire, binary, oversized,
// non-JSON, unrecognized-type — literally anything arriving on the socket)
// faster than this per connection, independent of what the client claims
// its own send rate is (global-standards.mdc "Rate-limit or debounce client
// input to prevent flooding"). The client sends at ~30Hz by design (see
// client handoff notes); this cap allows headroom for jitter while still
// bounding worst case. This is a single shared per-connection floor across
// EVERY message shape (see lastAcceptedMessageAt below): the debounce check
// runs first, before binary/size/JSON-parse/type-dispatch, and the
// timestamp is stamped immediately once a message clears that check —
// BEFORE we know whether it will turn out to be binary, oversized,
// non-JSON, unknown-type, or a valid input/fire. That is deliberate: a
// connection that only ever sends garbage of any single shape must still be
// bounded by this floor (EPIC 4 F-001; round 1 fixed this for "fire" only,
// round 2 closes it for every remaining shape).
const MIN_INPUT_INTERVAL_MS = 15;

// Reject oversized payloads outright before attempting to parse JSON.
const MAX_MESSAGE_BYTES = 1024;

// Every "drop this message" path below (flood guard, fire cooldown, binary,
// oversized, non-JSON, unknown-type, malformed-input) logs in aggregate
// rather than one line per drop (that would just be a different flavor of
// log spam, and — per Critic F-001 round 2 — synchronous console.warn calls
// at flood volumes could plausibly stall the single-threaded event loop and
// delay the tick for every player, not just the offending connection). Each
// drop path logs immediately on its first hit for a connection (so a flood
// shows up in the log right away), then at most once per this interval
// thereafter while it continues, summarizing how many messages were dropped
// since the last log line. Normal ~30Hz play never hits any drop path, so
// this produces zero extra log noise under normal play (security-baseline.mdc
// "log anomalous input patterns").
const FLOOD_LOG_INTERVAL_MS = 5000;

// Weapon rate limit (EPIC 4 Story 4.1): a SEPARATE, stricter cooldown from
// the generic MIN_INPUT_INTERVAL_MS anti-flood floor above — that floor
// caps how fast ANY message (input or fire) is accepted per connection at
// all; this one specifically caps how often a "fire" message actually
// resolves to a hitscan attempt, i.e. the weapon's rate of fire.
const FIRE_COOLDOWN_MS = COMBAT.fireCooldownMs;

const wss = new WebSocketServer({ port: PORT });
const registry = new PlayerRegistry();
const sockets = new Map<string, WebSocket>();
// Shared across EVERY message shape a connection can send (input, fire,
// binary, oversized, non-JSON, unknown-type, malformed-input — literally
// anything the "message" handler below sees) — this is what the generic
// MIN_INPUT_INTERVAL_MS debounce reads/writes. Round 1 (EPIC 4 F-001) fixed
// this being updated only from the "input" branch, which let a fire-only
// stream bypass the debounce. Round 2 fixes it being updated only for
// input/fire, which let binary/oversized/non-JSON/unknown-type/malformed
// streams bypass it: the timestamp is now stamped once, right after the
// debounce check itself passes, before any binary/size/parse/type-dispatch
// logic runs — see the "message" handler below.
const lastAcceptedMessageAt = new Map<string, number>();
const lastFireAcceptedAt = new Map<string, number>();

/**
 * Aggregate/throttled-logging "drop tracker" for a single drop reason
 * (flood guard, fire cooldown, binary, oversized, non-JSON, unknown-type,
 * malformed-input — see EPIC 4 F-001 rounds 1 and 2). One line per dropped
 * message would just reproduce the log-spam / event-loop-stall risk this
 * pattern exists to avoid, so instead each reason tracks a per-connection
 * drop count and logs a summary immediately on the first drop, then at most
 * once per FLOOD_LOG_INTERVAL_MS while drops continue.
 */
function createDropTracker(describe: (playerId: string, count: number) => string) {
  const counts = new Map<string, number>();
  const lastLoggedAt = new Map<string, number>();
  return {
    record(playerId: string, now: number): void {
      const count = (counts.get(playerId) ?? 0) + 1;
      counts.set(playerId, count);
      const lastLogged = lastLoggedAt.get(playerId) ?? 0;
      if (lastLogged === 0 || now - lastLogged >= FLOOD_LOG_INTERVAL_MS) {
        console.warn(describe(playerId, count));
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
    `(exceeding ${MIN_INPUT_INTERVAL_MS}ms min interval)`,
);
const fireCooldownDropTracker = createDropTracker(
  (playerId, count) =>
    `[server] fire rate limit: dropped ${count} fire message(s) from ${playerId} ` +
    `(exceeding ${FIRE_COOLDOWN_MS}ms weapon cooldown)`,
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

/** Send a server message to every currently-open connection. */
function broadcast(message: ServerMessage): void {
  const payload = JSON.stringify(message);
  for (const socket of sockets.values()) {
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
    }
  }
}

console.log(`[server] cubewars game server listening on ws://localhost:${PORT}`);
console.log(`[server] tick rate: ${TICK_HZ}Hz (${TICK_MS}ms)`);

wss.on("connection", (socket: WebSocket) => {
  const playerId = randomUUID();
  sockets.set(playerId, socket);
  registry.spawn(playerId);
  console.log(`[server] player connected: ${playerId} (${registry.size()} online)`);

  const welcome: WelcomeMessage = {
    type: "welcome",
    protocolVersion: PROTOCOL_VERSION,
    playerId,
    serverTimeMs: Date.now(),
  };
  socket.send(JSON.stringify(welcome));

  socket.on("message", (data, isBinary) => {
    // Debounce check runs FIRST, before any binary/size/parse/type-dispatch
    // logic, and independent of message shape (EPIC 4 F-001 round 2): a
    // connection already inside the debounce window gets dropped here
    // regardless of whether the message would have been binary, oversized,
    // non-JSON, unknown-type, or a valid input/fire.
    const now = Date.now();
    const last = lastAcceptedMessageAt.get(playerId) ?? 0;
    if (now - last < MIN_INPUT_INTERVAL_MS) {
      floodDropTracker.record(playerId, now);
      return;
    }
    // This message clears the debounce floor: stamp the timestamp
    // immediately, BEFORE we know anything else about it, so that the next
    // message — of ANY shape — is correctly bounded by MIN_INPUT_INTERVAL_MS.
    // This is what actually closes F-001: previously the timestamp was only
    // stamped deep inside the "input"/"fire" branches, so a flood of
    // binary/oversized/non-JSON/unknown-type messages (which never reach
    // those branches) never fed the debounce and bypassed it entirely.
    lastAcceptedMessageAt.set(playerId, now);

    if (isBinary) {
      binaryDropTracker.record(playerId, now);
      return;
    }

    const raw = data.toString();
    if (raw.length > MAX_MESSAGE_BYTES) {
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

    if (parsed.type === "input") {
      const accepted = registry.applyInput(playerId, parsed);
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
      if (!registry.isAlive(playerId)) return;

      const lastFire = lastFireAcceptedAt.get(playerId) ?? 0;
      if (now - lastFire < FIRE_COOLDOWN_MS) {
        fireCooldownDropTracker.record(playerId, now);
        return;
      }
      lastFireAcceptedAt.set(playerId, now);

      // registry.fire() performs the actual authoritative hitscan
      // (server/src/combat.ts) from the shooter's own server-tracked
      // position/yaw/pitch — nothing here trusts anything the client sent
      // beyond "I fired now" (security-baseline.mdc).
      const outcome = registry.fire(playerId);
      if (!outcome.hit) return;

      const hitMessage: HitEvent = {
        type: "hit",
        shooterId: playerId,
        targetId: outcome.targetId,
        damage: outcome.damage,
        targetHealth: outcome.targetHealth,
        point: outcome.point,
      };
      broadcast(hitMessage);
      console.log(
        `[server] hit: ${playerId} -> ${outcome.targetId} (${outcome.damage} dmg, ${outcome.targetHealth} hp left)`,
      );

      if (outcome.killed) {
        const deathMessage: DeathEvent = {
          type: "death",
          playerId: outcome.targetId,
          killerId: playerId,
          respawnAtMs: outcome.respawnAtMs ?? Date.now() + COMBAT.respawnDelayMs,
        };
        broadcast(deathMessage);
        console.log(`[server] death: ${outcome.targetId} killed by ${playerId}`);
      }
      return;
    }

    unknownTypeDropTracker.record(playerId, now);
  });

  socket.on("close", () => {
    registry.remove(playerId);
    sockets.delete(playerId);
    lastAcceptedMessageAt.delete(playerId);
    lastFireAcceptedAt.delete(playerId);
    floodDropTracker.clear(playerId);
    fireCooldownDropTracker.clear(playerId);
    binaryDropTracker.clear(playerId);
    oversizedDropTracker.clear(playerId);
    nonJsonDropTracker.clear(playerId);
    unknownTypeDropTracker.clear(playerId);
    malformedInputDropTracker.clear(playerId);
    console.log(`[server] player disconnected: ${playerId} (${registry.size()} online)`);
  });

  socket.on("error", (err) => {
    console.error(`[server] socket error for ${playerId}:`, err);
  });
});

wss.on("error", (err) => {
  console.error("[server] WebSocketServer error:", err);
});

const tickInterval = setInterval(() => {
  const nowMs = Date.now();
  registry.step(TICK_DT_SECONDS);

  // Respawn is time-driven, not event-driven — check every tick rather than
  // only right after a kill, so respawn happens on schedule even though the
  // kill itself was resolved out-of-band (immediately, in the "fire" message
  // handler above) rather than in this tick loop.
  const respawns = registry.processRespawns(nowMs);
  for (const respawn of respawns) {
    const respawnMessage: RespawnEvent = {
      type: "respawn",
      playerId: respawn.playerId,
      position: respawn.position,
      health: respawn.health,
    };
    broadcast(respawnMessage);
    console.log(
      `[server] respawn: ${respawn.playerId} at (${respawn.position.x.toFixed(1)}, ${respawn.position.z.toFixed(1)})`,
    );
  }

  const worldState: WorldStateMessage = {
    type: "world_state",
    serverTimeMs: nowMs,
    players: registry.toWorldState(),
  };
  broadcast(worldState);
}, TICK_MS);

process.on("SIGINT", () => {
  console.log("[server] shutting down");
  clearInterval(tickInterval);
  wss.close(() => process.exit(0));
});
