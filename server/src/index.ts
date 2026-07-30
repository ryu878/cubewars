import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { PROTOCOL_VERSION, type WelcomeMessage } from "@cubewars/shared";

const PORT = Number(process.env.CUBEWARS_SERVER_PORT ?? 7777);

const wss = new WebSocketServer({ port: PORT });

console.log(`[server] cubewars game server listening on ws://localhost:${PORT}`);

wss.on("connection", (socket: WebSocket) => {
  const playerId = randomUUID();
  console.log(`[server] player connected: ${playerId}`);

  const welcome: WelcomeMessage = {
    type: "welcome",
    protocolVersion: PROTOCOL_VERSION,
    playerId,
    serverTimeMs: Date.now(),
  };
  socket.send(JSON.stringify(welcome));

  socket.on("close", () => {
    console.log(`[server] player disconnected: ${playerId}`);
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
