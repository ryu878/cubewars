// EPIC 42/45 regression: dual-pool lobby_bind_nickname, lobby inventory
// mutations scoped to the bound pool only, lobby auction without join,
// drop/trade still match_required.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import type { ClientMessage, ServerMessage } from "@cubewars/shared";
import { ensureRedisRunning } from "./economy-test-helpers.js";
import { EconomyStore, resolveRedisUrl } from "../server/src/economy/index.js";

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
      detached: true,
    });
    let ready = false;
    const onData = (buf: Buffer) => {
      const text = buf.toString();
      if (!ready && text.includes("cubewars game server listening")) {
        ready = true;
        resolve({ child });
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
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
    const done = () => resolve();
    child.once("exit", done);
    try {
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // already dead
      }
    }
    setTimeout(done, 2000);
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

/** Send a raw JSON object (for invalid-pool probes bypassing typed ClientMessage). */
function sendRaw(client: Client, message: Record<string, unknown>): void {
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
  const seedStore = await EconomyStore.open({
    redisUrl: resolveRedisUrl(),
    skipSqliteImport: true,
  });
  const { child } = await startServer();
  try {
    const client = await connect();
    const nick = `L45${randomUUID().slice(0, 8)}`;
    const now = Date.now();

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

    // Invalid economyPool reject
    {
      const before = client.messages.length;
      sendRaw(client, {
        type: "lobby_bind_nickname",
        nickname: nick,
        economyPool: "not_a_pool",
      });
      const result = await waitFor(
        client,
        before,
        (m) => m.type === "economy_action_result" && m.action === "lobby_bind",
        "lobby_bind pool_invalid",
      );
      assert.equal(result.type, "economy_action_result");
      if (result.type === "economy_action_result") {
        assert.equal(result.ok, false);
        assert.equal(result.code, "pool_invalid");
      }
    }

    // Seed both pools BEFORE any successful bind so the server's write-through
    // cache cannot hide Redis writes from a second EconomyStore connection.
    const dmGem = await seedStore.grantGem(nick, "health", 41, now, undefined, "deathmatch");
    const sbGem = await seedStore.grantGem(nick, "armor", 42, now, undefined, "sandbox");

    // Omitted pool → Deathmatch (backward compatible)
    {
      const before = client.messages.length;
      send(client, { type: "lobby_bind_nickname", nickname: nick });
      const profile = await waitFor(
        client,
        before,
        (m) => m.type === "economy_profile",
        "economy_profile after default lobby bind",
      );
      assert.equal(profile.type, "economy_profile");
      if (profile.type === "economy_profile") {
        assert.equal(profile.nickname, nick);
        assert.equal(profile.economyPool, "deathmatch");
        assert.ok(
          profile.gems.some((g) => g.id === dmGem.id),
          "deathmatch bind must see pre-seeded DM gem",
        );
      }
      await waitFor(
        client,
        before,
        (m) => m.type === "economy_action_result" && m.action === "lobby_bind" && m.ok,
        "lobby_bind ok default",
      );
    }

    // Explicit Deathmatch bind
    {
      const before = client.messages.length;
      send(client, {
        type: "lobby_bind_nickname",
        nickname: nick,
        economyPool: "deathmatch",
      });
      const profile = await waitFor(
        client,
        before,
        (m) => m.type === "economy_profile" && m.economyPool === "deathmatch",
        "deathmatch economy_profile",
      );
      assert.equal(profile.type, "economy_profile");
    }

    // Sandbox / Bots bind
    {
      const before = client.messages.length;
      send(client, {
        type: "lobby_bind_nickname",
        nickname: nick,
        economyPool: "sandbox",
      });
      const profile = await waitFor(
        client,
        before,
        (m) => m.type === "economy_profile" && m.economyPool === "sandbox",
        "sandbox economy_profile",
      );
      assert.equal(profile.type, "economy_profile");
      if (profile.type === "economy_profile") {
        assert.equal(profile.nickname, nick);
        assert.equal(profile.economyPool, "sandbox");
        assert.ok(
          profile.gems.some((g) => g.id === sbGem.id),
          "sandbox bind must see pre-seeded sandbox gem",
        );
        assert.ok(
          !profile.gems.some((g) => g.id === dmGem.id && g.gemType === "health"),
          "sandbox profile must not include deathmatch-only gem identity bleed",
        );
      }
    }

    assert.ok(
      !client.messages.some((m) => m.type === "join_accepted"),
      "lobby bind must not join a match",
    );

    // Bound to sandbox: discard sandbox gem; deathmatch gem must remain.
    let sandboxGemCountAfterSbDiscard = -1;
    {
      // Already bound to sandbox from previous step.
      const discardBefore = client.messages.length;
      send(client, {
        type: "economy_discard_item",
        itemType: "gem",
        itemId: sbGem.id,
      });
      const discardResult = await waitFor(
        client,
        discardBefore,
        (m) => m.type === "economy_action_result" && m.action === "discard_item",
        "discard sandbox gem",
      );
      assert.equal(discardResult.type, "economy_action_result");
      if (discardResult.type === "economy_action_result") {
        assert.equal(
          discardResult.ok,
          true,
          `sandbox discard failed: code=${discardResult.code} gemId=${sbGem.id}`,
        );
      }
      const sbProfile = await waitFor(
        client,
        discardBefore,
        (m) => m.type === "economy_profile" && m.economyPool === "sandbox",
        "sandbox profile after discard",
      );
      assert.equal(sbProfile.type, "economy_profile");
      if (sbProfile.type === "economy_profile") {
        assert.equal(
          sbProfile.gems.find((g) => g.id === sbGem.id),
          undefined,
          "sandbox gem must be discarded",
        );
        sandboxGemCountAfterSbDiscard = sbProfile.gems.length;
      }

      const dmBefore = client.messages.length;
      send(client, {
        type: "lobby_bind_nickname",
        nickname: nick,
        economyPool: "deathmatch",
      });
      const dmProfile = await waitFor(
        client,
        dmBefore,
        (m) => m.type === "economy_profile" && m.economyPool === "deathmatch",
        "deathmatch profile after sandbox discard",
      );
      assert.equal(dmProfile.type, "economy_profile");
      if (dmProfile.type === "economy_profile") {
        assert.ok(
          dmProfile.gems.some((g) => g.id === dmGem.id),
          "deathmatch gem must survive sandbox discard",
        );
      }
    }

    // Bound to deathmatch: discard deathmatch gem; sandbox gem count unchanged.
    {
      const discardBefore = client.messages.length;
      send(client, {
        type: "economy_discard_item",
        itemType: "gem",
        itemId: dmGem.id,
      });
      const discardResult = await waitFor(
        client,
        discardBefore,
        (m) => m.type === "economy_action_result" && m.action === "discard_item",
        "discard deathmatch gem",
      );
      assert.equal(discardResult.type, "economy_action_result");
      if (discardResult.type === "economy_action_result") {
        assert.equal(discardResult.ok, true);
      }
      const dmProfile = await waitFor(
        client,
        discardBefore,
        (m) => m.type === "economy_profile" && m.economyPool === "deathmatch",
        "deathmatch profile after discard",
      );
      assert.equal(dmProfile.type, "economy_profile");
      if (dmProfile.type === "economy_profile") {
        assert.equal(
          dmProfile.gems.find((g) => g.id === dmGem.id),
          undefined,
          "deathmatch gem must be discarded",
        );
      }

      const sbBefore = client.messages.length;
      send(client, {
        type: "lobby_bind_nickname",
        nickname: nick,
        economyPool: "sandbox",
      });
      const sbProfile = await waitFor(
        client,
        sbBefore,
        (m) => m.type === "economy_profile" && m.economyPool === "sandbox",
        "sandbox profile after deathmatch discard",
      );
      assert.equal(sbProfile.type, "economy_profile");
      if (sbProfile.type === "economy_profile") {
        assert.equal(
          sbProfile.gems.length,
          sandboxGemCountAfterSbDiscard,
          "sandbox gem count must not change on deathmatch discard",
        );
      }
    }

    // Lobby auction browse without join (Deathmatch only)
    {
      const before = client.messages.length;
      send(client, { type: "economy_auction_browse" });
      const browseOk = await waitFor(
        client,
        before,
        (m) => m.type === "economy_action_result" && m.action === "auction_browse" && m.ok,
        "auction_browse ok from lobby",
      );
      assert.equal(browseOk.type, "economy_action_result");
      const state = await waitFor(
        client,
        before,
        (m) => m.type === "economy_auction_state",
        "economy_auction_state from lobby",
      );
      assert.equal(state.type, "economy_auction_state");
    }

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
    await seedStore.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
