// EPIC 42 regression: lobby_bind_nickname → Deathmatch economy_profile without
// joining a match; lobby inventory mutate; drop/trade rejected with match_required.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import type { ClientMessage, ServerMessage } from "@cubewars/shared";
import { ensureRedisRunning } from "./economy-test-helpers.js";
import { resolveRedisUrl } from "../server/src/economy/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const SERVER_PORT = 7795;
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
      env: {
        ...process.env,
        CUBEWARS_SERVER_PORT: String(SERVER_PORT),
        CUBEWARS_REDIS_URL: resolveRedisUrl(),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let ready = false;
    const onData = (buf: Buffer) => {
      const text = buf.toString();
      if (!ready && text.includes("cubewars game server listening")) {
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
    }, 20000);
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
      }, 5000);
    });
    ws.on("error", reject);
  });
}

function send(client: Client, message: ClientMessage): void {
  client.ws.send(JSON.stringify(message));
}

async function waitFor(
  client: Client,
  before: number,
  predicate: (m: ServerMessage) => boolean,
  label: string,
): Promise<ServerMessage> {
  for (let i = 0; i < 200; i++) {
    const hit = client.messages.slice(before).find(predicate);
    if (hit) return hit;
    await sleep(40);
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function main(): Promise<void> {
  await ensureRedisRunning();
  const { child } = await startServer();
  try {
    const client = await connect();
    const nick = `L42${randomUUID().slice(0, 8)}`;

    // Invalid nickname reject
    {
      const before = client.messages.length;
      send(client, { type: "lobby_bind_nickname", nickname: "x" });
      const result = await waitFor(
        client,
        before,
        (m) => m.type === "economy_action_result" && m.action === "lobby_bind",
        "lobby_bind invalid",
      );
      assert.equal(result.type, "economy_action_result");
      if (result.type === "economy_action_result") {
        assert.equal(result.ok, false);
        assert.equal(result.code, "nickname_invalid");
      }
    }

    // Successful bind → Deathmatch profile without join
    {
      const before = client.messages.length;
      send(client, { type: "lobby_bind_nickname", nickname: nick });
      const profile = await waitFor(
        client,
        before,
        (m) => m.type === "economy_profile",
        "economy_profile after lobby bind",
      );
      assert.equal(profile.type, "economy_profile");
      if (profile.type === "economy_profile") {
        assert.equal(profile.nickname, nick);
        assert.equal(profile.economyPool, "deathmatch");
        assert.ok(typeof profile.gold === "number");
      }
      const bindOk = await waitFor(
        client,
        before,
        (m) => m.type === "economy_action_result" && m.action === "lobby_bind" && m.ok,
        "lobby_bind ok",
      );
      assert.equal(bindOk.type, "economy_action_result");
    }

    // No join_accepted should have arrived
    assert.ok(
      !client.messages.some((m) => m.type === "join_accepted"),
      "lobby bind must not join a match",
    );

    // Drop from lobby must be rejected (match_required)
    {
      const before = client.messages.length;
      send(client, {
        type: "economy_drop_item",
        itemType: "gem",
        itemId: 1,
      });
      const result = await waitFor(
        client,
        before,
        (m) => m.type === "economy_action_result" && m.action === "drop_item",
        "drop_item match_required",
      );
      assert.equal(result.type, "economy_action_result");
      if (result.type === "economy_action_result") {
        assert.equal(result.ok, false);
        assert.equal(result.code, "match_required");
      }
    }

    // Trade from lobby must be rejected
    {
      const before = client.messages.length;
      send(client, { type: "economy_trade_open", partnerId: "nobody" });
      const result = await waitFor(
        client,
        before,
        (m) => m.type === "economy_action_result" && m.action === "trade_open",
        "trade_open match_required",
      );
      assert.equal(result.type, "economy_action_result");
      if (result.type === "economy_action_result") {
        assert.equal(result.ok, false);
        assert.equal(result.code, "match_required");
      }
    }

    console.log("regression:lobby-inventory OK");
  } finally {
    await stopServer(child);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
