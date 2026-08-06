// EPIC 20 regression: public matches are capped at 4 humans, quick-join
// creates a new public match when full, and duplicate nicknames are rejected
// only inside the selected match.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import type { ServerMessage } from "@cubewars/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const SERVER_PORT = 7782;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;

interface Client {
  ws: WebSocket;
  playerId: string;
  messages: ServerMessage[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startServer(): Promise<{ child: ReturnType<typeof spawn> }> {
  return new Promise((resolve, reject) => {
    const child = spawn(join(REPO_ROOT, "node_modules", ".bin", "tsx"), ["server/src/index.ts"], {
      cwd: REPO_ROOT,
      env: { ...process.env, CUBEWARS_SERVER_PORT: String(SERVER_PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let ready = false;
    const onData = (buf: Buffer) => {
      if (!ready && buf.toString().includes("cubewars game server listening")) {
        ready = true;
        resolve({ child });
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!ready) reject(new Error(`server exited before ready (${code})`));
    });
    setTimeout(() => {
      if (!ready) reject(new Error("server did not become ready"));
    }, 8000);
  });
}

function stopServer(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGINT");
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already dead
      }
      resolve();
    }, 3000);
  });
}

function connect(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const messages: ServerMessage[] = [];
    let playerId = "";
    ws.on("message", (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      messages.push(message);
      if (message.type === "welcome") playerId = message.playerId;
    });
    ws.on("open", () => {
      const timer = setInterval(() => {
        if (playerId) {
          clearInterval(timer);
          resolve({ ws, playerId, messages });
        }
      }, 20);
      setTimeout(() => {
        clearInterval(timer);
        reject(new Error("missing welcome"));
      }, 3000);
    });
    ws.on("error", reject);
  });
}

async function joinPublicClient(client: Client, nickname: string, matchId?: string): Promise<ServerMessage> {
  const before = client.messages.length;
  client.ws.send(JSON.stringify({ type: "join", mode: "public", nickname, matchId }));
  for (let i = 0; i < 100; i++) {
    const message = client.messages.slice(before).find((item) => item.type === "join_accepted" || item.type === "join_rejected");
    if (message) return message;
    await sleep(30);
  }
  throw new Error(`join timed out for ${nickname}`);
}

async function main(): Promise<void> {
  const { child } = await startServer();
  const clients: Client[] = [];
  try {
    for (let i = 1; i <= 4; i++) {
      const client = await connect();
      clients.push(client);
      const accepted = await joinPublicClient(client, `Player ${i}`);
      assert.equal(accepted.type, "join_accepted");
      if (accepted.type !== "join_accepted") throw new Error("unreachable");
      assert.equal(accepted.matchId, "public");
    }

    const fifth = await connect();
    clients.push(fifth);
    const fifthJoin = await joinPublicClient(fifth, "Player 5");
    assert.equal(fifthJoin.type, "join_accepted");
    if (fifthJoin.type !== "join_accepted") throw new Error("unreachable");
    assert.equal(fifthJoin.matchId, "public-2", "5th quick-join player should create/join public-2");

    const duplicateInPublic = await connect();
    clients.push(duplicateInPublic);
    const duplicateRejected = await joinPublicClient(duplicateInPublic, "player 1", "public");
    assert.equal(duplicateRejected.type, "join_rejected");
    if (duplicateRejected.type !== "join_rejected") throw new Error("unreachable");
    assert.equal(duplicateRejected.reason, "nickname_taken");

    const duplicateInOtherMatch = await connect();
    clients.push(duplicateInOtherMatch);
    const duplicateAccepted = await joinPublicClient(duplicateInOtherMatch, "Player 1", "public-2");
    assert.equal(duplicateAccepted.type, "join_accepted");
    if (duplicateAccepted.type !== "join_accepted") throw new Error("unreachable");
    assert.equal(duplicateAccepted.matchId, "public-2");

    const lobbyViewer = await connect();
    clients.push(lobbyViewer);
    await sleep(100);
    const lobby = [...lobbyViewer.messages].reverse().find((message) => message.type === "lobby_state");
    assert.ok(lobby && lobby.type === "lobby_state", "lobby_state should be broadcast");
    if (!lobby || lobby.type !== "lobby_state") throw new Error("unreachable");
    assert.deepEqual(
      lobby.matches.map((match) => [match.id, match.players, match.maxPlayers]),
      [
        ["public", 4, 4],
        ["public-2", 2, 4],
      ],
    );

    console.log("[lobby-nicknames] PASS");
  } finally {
    for (const client of clients) client.ws.close();
    await stopServer(child);
  }
}

main().catch((err) => {
  console.error("[lobby-nicknames] FAIL", err);
  process.exit(1);
});
