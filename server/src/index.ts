import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import {
  BROADCAST_TICK_HZ,
  COMBAT,
  PICKUP_RADIUS,
  PROTOCOL_VERSION,
  type ClientMessage,
  type DeathEvent,
  type HitEvent,
  type KillEvent,
  type LoadoutMessage,
  type PickupStateMessage,
  type RespawnEvent,
  type ScoreboardMessage,
  type ServerMessage,
  type WelcomeMessage,
  type WorldStateMessage,
} from "@cubewars/shared";
import { PlayerRegistry } from "./playerRegistry.js";
import { PickupSpawner } from "./pickupSpawner.js";

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

// Weapon rate limit (EPIC 4 Story 4.1, made per-weapon by EPIC 6): a
// SEPARATE, stricter cooldown from the generic MIN_INPUT_INTERVAL_MS
// anti-flood floor above — that floor caps how fast ANY message (input or
// fire) is accepted per connection at all; this one specifically caps how
// often a "fire" message actually resolves to a hitscan attempt, i.e. the
// weapon's rate of fire. EPIC 6 replaces the single fixed constant that used
// to live here with `registry.getFireCooldownMs(playerId)`, read fresh on
// every fire attempt from the shooter's own server-tracked equipped weapon
// (WEAPON_STATS[...].cooldownMs, shared/src/weapons.ts) — see the "fire"
// branch of the message handler below.

// Infosec F1 (EPIC 4 review): ws@8's own default maxPayload is 100 MiB — the
// library would fully buffer any frame up to that size into memory BEFORE
// the app-level MAX_MESSAGE_BYTES check below ever runs, undercutting the
// flood-guard work above (which only bounds message *rate*, not frame
// *size*). Setting maxPayload here makes ws itself reject/close oversized
// frames (code 1009) at the framing layer, before app code ever sees them.
// Reuses MAX_MESSAGE_BYTES rather than introducing a second magic number.
const wss = new WebSocketServer({ port: PORT, maxPayload: MAX_MESSAGE_BYTES });
const registry = new PlayerRegistry();
// EPIC 6 Story 6.1: player-count source is a callback into the registry's
// own live alive-player list, not a captured snapshot — see PickupSpawner's
// constructor doc comment for why this stays instantiable-per-match rather
// than a module-level singleton (EPIC 9 compatibility note).
const pickupSpawner = new PickupSpawner(() => registry.alivePlayerPositions().length);
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
function createDropTracker(describe: (playerId: string, count: number, extra?: string) => string) {
  const counts = new Map<string, number>();
  const lastLoggedAt = new Map<string, number>();
  return {
    // `extra` is optional free-form context appended by the caller (used by
    // fireCooldownDropTracker below to report the actual weapon-specific
    // cooldown that was exceeded, since EPIC 6 made that value per-weapon
    // instead of one fixed constant) — every other tracker ignores it.
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
    `(exceeding ${MIN_INPUT_INTERVAL_MS}ms min interval)`,
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

/** Send a server message to every currently-open connection. */
function broadcast(message: ServerMessage): void {
  const payload = JSON.stringify(message);
  for (const socket of sockets.values()) {
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
    }
  }
}

/**
 * Broadcast the full current scoreboard (EPIC 5 Story 5.2) to every
 * connected client, including whoever just triggered the change — called on
 * join, leave, and kill, so a newly-joined client always sees a correct,
 * complete list (itself at 0 kills) rather than only future deltas.
 */
function broadcastScoreboard(): void {
  const scoreboard: ScoreboardMessage = {
    type: "scoreboard",
    players: registry.getScores(),
  };
  broadcast(scoreboard);
}

/**
 * Broadcast the full current pickup on/off state (EPIC 6 Story 6.1) to every
 * connected client — same "always the full list" convention as
 * broadcastScoreboard() above, and for the same reason (a newly-joined or
 * momentarily-missed-a-message client is still correct from the very next
 * broadcast). Called on connect, on any pickup consumed, and on any pickup
 * respawn.
 */
function broadcastPickupState(): void {
  const message: PickupStateMessage = {
    type: "pickup_state",
    pickups: pickupSpawner.list().map((item) => ({ id: item.id, active: item.active })),
  };
  broadcast(message);
}

/**
 * Send `playerId`'s current weapon loadout (equipped weapon, remaining
 * ammo, owned weapons) to THEIR socket only — never broadcast (EPIC 6 spec
 * risk note / security-baseline.mdc: don't leak one player's ammo/inventory
 * to opponents who have no gameplay need to see it). No-op if the player or
 * socket is no longer around (e.g. a race with a just-processed disconnect).
 */
function sendLoadout(playerId: string): void {
  const loadout = registry.getLoadout(playerId);
  if (!loadout) return;
  const socket = sockets.get(playerId);
  if (!socket || socket.readyState !== socket.OPEN) return;
  const message: LoadoutMessage = { type: "loadout", ...loadout };
  socket.send(JSON.stringify(message));
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
  // EPIC 5 Story 5.2 AC: "a newly-joined player appears in the list at 0
  // kills" — broadcast to everyone (including this new connection, already
  // in `sockets` above) so the just-joined client also gets the full,
  // correct list immediately instead of waiting for someone else's next kill.
  broadcastScoreboard();
  // EPIC 6: this player's starting loadout (pistol only) — private, this
  // socket only. Broadcasting current pickup on/off state to everyone
  // (including this new connection) mirrors broadcastScoreboard() above so a
  // freshly-joined client immediately sees which world pickups are already
  // taken, instead of waiting for the next consume/respawn.
  sendLoadout(playerId);
  broadcastPickupState();

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

      // EPIC 6: the rate-of-fire cap is now the shooter's own equipped
      // weapon's cooldown (WEAPON_STATS[...].cooldownMs), read fresh every
      // fire attempt from the server's own authoritative record — never a
      // single fixed constant, and never anything the client asserts.
      const cooldownMs = registry.getFireCooldownMs(playerId);
      const lastFire = lastFireAcceptedAt.get(playerId) ?? 0;
      if (now - lastFire < cooldownMs) {
        fireCooldownDropTracker.record(playerId, now, `${cooldownMs}ms`);
        return;
      }
      lastFireAcceptedAt.set(playerId, now);

      // registry.fire() performs the actual authoritative hitscan
      // (server/src/combat.ts) from the shooter's own server-tracked
      // position/yaw/pitch/equipped-weapon — nothing here trusts anything
      // the client sent beyond "I fired now" (security-baseline.mdc). It
      // also decrements ammo server-side for non-pistol weapons, so the
      // loadout (ammo count) may have changed regardless of hit/miss/dry —
      // resend it so the shooter's own HUD stays accurate.
      const outcome = registry.fire(playerId);
      sendLoadout(playerId);

      if (!outcome.hit) {
        if (outcome.dry) {
          // EPIC 6 Story 6.3 "dry weapon" rule: 0 ammo, no damage, nothing
          // further decremented. Logged distinctly from an ordinary aim-miss
          // (which stays silent, as before EPIC 6) so Tester/ops can find
          // "ammo ran out" events in the log.
          console.log(`[server] ammo depleted: ${playerId} tried to fire with 0 ammo`);
        }
        return;
      }

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

        // EPIC 5 Story 5.1: additive to the DeathEvent above (same
        // registry.fire() resolution, not a second death system) — a
        // dedicated event purely to drive kill-feed UI on every connected
        // client, not just attacker/victim.
        const killMessage: KillEvent = {
          type: "kill",
          attackerId: playerId,
          victimId: outcome.targetId,
        };
        broadcast(killMessage);
        // Story 5.2: kill count changed, refresh every client's scoreboard.
        broadcastScoreboard();
      }
      return;
    }

    if (parsed.type === "switch_weapon") {
      // EPIC 6 Story 6.2 "E" key: server-decided "cycle to the next OWNED
      // weapon in tier order" — see registry.cycleWeapon() doc comment for
      // why this carries no client-supplied target weapon. Returns false
      // (and this stays a no-op, nothing broadcast/logged) if there's
      // nothing to cycle to (only the pistol owned) — matches the AC
      // "pressing E with only the pistol owned does nothing".
      const changed = registry.cycleWeapon(playerId);
      if (changed) {
        sendLoadout(playerId);
        const loadout = registry.getLoadout(playerId);
        console.log(`[server] switch: ${playerId} -> ${loadout?.equippedWeapon ?? "?"}`);
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
    // Story 5.2 AC: "a disconnected player is removed" from every remaining
    // client's scoreboard.
    broadcastScoreboard();
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
    // EPIC 6 (Critic non-blocking recommendation, folded in before merge):
    // processRespawns() resets this player's loadout back to pistol-only —
    // resend their private LoadoutMessage so their own HUD reflects that
    // immediately, rather than only on their next fire/switch/pickup.
    sendLoadout(respawn.playerId);
    console.log(
      `[server] respawn: ${respawn.playerId} at (${respawn.position.x.toFixed(1)}, ${respawn.position.z.toFixed(1)})`,
    );
  }

  // EPIC 6 Story 6.2: server-authoritative pickup-on-proximity, checked
  // every tick against every currently ALIVE player's own server-tracked
  // position (never a client-asserted "I picked this up" — security-
  // baseline.mdc). Each alive player consumes at most the single nearest
  // active pickup within range per tick; a pickup that would have no
  // benefit (already owned at max ammo) is intentionally left untouched by
  // registry.applyPickup() (EPIC 6 pickup-consumption rule), so it is never
  // passed to pickupSpawner.consume() and stays for someone else.
  let pickupStateChanged = false;
  for (const { id, position } of registry.alivePlayerPositions()) {
    const nearby = pickupSpawner.findNearby(position, PICKUP_RADIUS);
    if (!nearby) continue;

    const { applied } = registry.applyPickup(id, nearby.weapon);
    if (!applied) continue;

    pickupSpawner.consume(nearby.id, nowMs);
    pickupStateChanged = true;
    sendLoadout(id);
    console.log(`[server] pickup: ${id} picked up ${nearby.category} "${nearby.id}" (${nearby.weapon})`);
  }

  // Pickup respawns are time-driven, same pattern as player respawns above.
  const pickupRespawns = pickupSpawner.processRespawns(nowMs);
  for (const item of pickupRespawns) {
    pickupStateChanged = true;
    console.log(`[server] pickup respawn: "${item.id}" (${item.category} ${item.weapon}) is available again`);
  }

  if (pickupStateChanged) {
    broadcastPickupState();
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
