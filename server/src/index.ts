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

// Flood guard: reject input messages arriving faster than this per
// connection, independent of what the client claims its own send rate is
// (global-standards.mdc "Rate-limit or debounce client input to prevent
// flooding"). The client sends at ~30Hz by design (see client handoff notes);
// this cap allows headroom for jitter while still bounding worst case.
const MIN_INPUT_INTERVAL_MS = 15;

// Reject oversized payloads outright before attempting to parse JSON.
const MAX_MESSAGE_BYTES = 1024;

// Flood-guard drops are logged in aggregate rather than one line per drop
// (that would just be a different flavor of log spam). We log immediately
// on the first debounce hit for a connection (so a flood shows up in the
// log right away), then at most once per this interval thereafter while
// the flood continues, summarizing how many messages were dropped since
// the last log line. Normal ~30Hz play never hits the debounce path, so
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
const lastInputAcceptedAt = new Map<string, number>();
const lastFireAcceptedAt = new Map<string, number>();
const floodDropCounts = new Map<string, number>();
const floodDropLastLoggedAt = new Map<string, number>();

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
    if (isBinary) {
      console.warn(`[server] dropped binary message from ${playerId}`);
      return;
    }

    const raw = data.toString();
    if (raw.length > MAX_MESSAGE_BYTES) {
      console.warn(`[server] dropped oversized message from ${playerId}: ${raw.length} bytes`);
      return;
    }

    const now = Date.now();
    const last = lastInputAcceptedAt.get(playerId) ?? 0;
    if (now - last < MIN_INPUT_INTERVAL_MS) {
      // Debounce the input, but don't debounce out of visibility entirely:
      // a sustained flood is a possible abuse pattern and should leave a
      // trace in the log (see FLOOD_LOG_INTERVAL_MS comment above), just
      // not one line per dropped message.
      const dropCount = (floodDropCounts.get(playerId) ?? 0) + 1;
      floodDropCounts.set(playerId, dropCount);
      const lastLoggedAt = floodDropLastLoggedAt.get(playerId) ?? 0;
      if (lastLoggedAt === 0 || now - lastLoggedAt >= FLOOD_LOG_INTERVAL_MS) {
        console.warn(
          `[server] flood guard: dropped ${dropCount} input message(s) from ${playerId} ` +
            `(exceeding ${MIN_INPUT_INTERVAL_MS}ms min interval)`
        );
        floodDropLastLoggedAt.set(playerId, now);
        floodDropCounts.set(playerId, 0);
      }
      return;
    }

    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(raw) as ClientMessage;
    } catch {
      console.warn(`[server] dropped malformed (non-JSON) message from ${playerId}`);
      return;
    }

    if (!parsed || typeof parsed !== "object") {
      console.warn(`[server] dropped message with unknown type from ${playerId}`);
      return;
    }

    if (parsed.type === "input") {
      const accepted = registry.applyInput(playerId, parsed);
      if (!accepted) {
        console.warn(`[server] dropped out-of-range/malformed input from ${playerId}`);
        return;
      }
      lastInputAcceptedAt.set(playerId, now);
      // Do NOT reset floodDropCounts here: the debounce gate lets some
      // messages through periodically even during a sustained flood, so
      // resetting on every accepted input wipes the in-progress count before
      // it can build up to a representative total. The counter is only
      // reset where a summary is actually logged (the debounce-hit branch
      // above, immediate first-hit log and periodic ~FLOOD_LOG_INTERVAL_MS
      // log) and on disconnect below.
      return;
    }

    if (parsed.type === "fire") {
      // Dead players can't fire (Story 4.2 AC) — not logged as an anomaly,
      // this is an expected race while a client's own respawn state is
      // still in flight.
      if (!registry.isAlive(playerId)) return;

      const lastFire = lastFireAcceptedAt.get(playerId) ?? 0;
      if (now - lastFire < FIRE_COOLDOWN_MS) {
        console.warn(`[server] fire rate limit: dropped fire from ${playerId} (weapon cooldown)`);
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

    console.warn(`[server] dropped message with unknown type from ${playerId}`);
  });

  socket.on("close", () => {
    registry.remove(playerId);
    sockets.delete(playerId);
    lastInputAcceptedAt.delete(playerId);
    lastFireAcceptedAt.delete(playerId);
    floodDropCounts.delete(playerId);
    floodDropLastLoggedAt.delete(playerId);
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
