import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import {
  BROADCAST_TICK_HZ,
  PROTOCOL_VERSION,
  type ClientMessage,
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

const wss = new WebSocketServer({ port: PORT });
const registry = new PlayerRegistry();
const sockets = new Map<string, WebSocket>();
const lastInputAcceptedAt = new Map<string, number>();

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
      // Silently debounce — this is expected under normal jitter, not
      // necessarily an attack, so it doesn't warrant a log line every time.
      return;
    }

    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(raw) as ClientMessage;
    } catch {
      console.warn(`[server] dropped malformed (non-JSON) message from ${playerId}`);
      return;
    }

    if (!parsed || typeof parsed !== "object" || parsed.type !== "input") {
      console.warn(`[server] dropped message with unknown type from ${playerId}`);
      return;
    }

    const accepted = registry.applyInput(playerId, parsed);
    if (!accepted) {
      console.warn(`[server] dropped out-of-range/malformed input from ${playerId}`);
      return;
    }
    lastInputAcceptedAt.set(playerId, now);
  });

  socket.on("close", () => {
    registry.remove(playerId);
    sockets.delete(playerId);
    lastInputAcceptedAt.delete(playerId);
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
  registry.step(TICK_DT_SECONDS);

  const worldState: WorldStateMessage = {
    type: "world_state",
    serverTimeMs: Date.now(),
    players: registry.toWorldState(),
  };
  const payload = JSON.stringify(worldState);

  for (const socket of sockets.values()) {
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
    }
  }
}, TICK_MS);

process.on("SIGINT", () => {
  console.log("[server] shutting down");
  clearInterval(tickInterval);
  wss.close(() => process.exit(0));
});
