// EPIC 34 regression: account register / login / session resume / rate-limit.
// Spawns a real game server against an isolated Redis key prefix.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import type { ServerMessage } from "@cubewars/shared";
import {
  AccountStore,
  LOGIN_MAX_FAILURES_PER_EMAIL,
} from "../server/src/accounts/index.js";
import { ensureRedisRunning } from "./economy-test-helpers.js";
import { resolveRedisUrl } from "../server/src/economy/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const SERVER_PORT = 7794;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;
const KEY_PREFIX = `cw:test:epic34:${randomUUID()}`;

interface Client {
  ws: WebSocket;
  playerId: string;
  messages: ServerMessage[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startServer(): Promise<{ child: ReturnType<typeof spawn>; logs: string[] }> {
  return new Promise((resolve, reject) => {
    const logs: string[] = [];
    const child = spawn(join(REPO_ROOT, "node_modules", ".bin", "tsx"), ["server/src/index.ts"], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        CUBEWARS_SERVER_PORT: String(SERVER_PORT),
        CUBEWARS_REDIS_URL: resolveRedisUrl(),
        // Share the isolated prefix via EconomyStore's default path — AccountStore
        // opens with the same prefix as economy. EconomyStore.open reads keyPrefix
        // only from options, not env; we set a dedicated env consumed below via
        // patching: actually EconomyStore has no env for prefix. Use Redis URL
        // only and a unique email namespace instead for isolation.
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let ready = false;
    const onData = (buf: Buffer) => {
      const text = buf.toString();
      logs.push(text);
      if (!ready && text.includes("cubewars game server listening")) {
        ready = true;
        resolve({ child, logs });
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
    }, 12000);
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
      }, 4000);
    });
    ws.on("error", reject);
  });
}

async function waitFor(
  client: Client,
  before: number,
  predicate: (m: ServerMessage) => boolean,
  label: string,
): Promise<ServerMessage> {
  for (let i = 0; i < 150; i++) {
    const hit = client.messages.slice(before).find(predicate);
    if (hit) return hit;
    await sleep(40);
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function unitStoreChecks(): Promise<void> {
  await ensureRedisRunning();
  const store = await AccountStore.open({
    redisUrl: resolveRedisUrl(),
    keyPrefix: KEY_PREFIX,
  });
  try {
    const email = `unit-${randomUUID().slice(0, 8)}@example.com`;
    const created = await store.register(email);
    assert.equal(created.status, "created");
    if (created.status !== "created") throw new Error("unreachable");
    assert.match(created.code, /^\d{3}-\d{3}$/);
    assert.equal(created.token.length, 64);

    const account = await store.getByEmail(email);
    assert.ok(account);
    assert.ok(!JSON.stringify(account).includes(created.code), "code must not appear in stored account");
    assert.notEqual(account!.codeHash, created.code);

    const exists = await store.register(email);
    assert.equal(exists.status, "exists");

    const bad = await store.login(email, "000-000", "conn-a");
    assert.equal(bad.status, "invalid_credentials");

    const good = await store.login(email, created.code, "conn-b");
    assert.equal(good.status, "ok");
    if (good.status !== "ok") throw new Error("unreachable");

    const resumed = await store.resumeSession(good.token);
    assert.equal(resumed.status, "ok");

    const bogus = await store.resumeSession("deadbeef".repeat(8));
    assert.equal(bogus.status, "invalid_token");

    // Rate limit: burn failures on a fresh email until lockout.
    const rateEmail = `rate-${randomUUID().slice(0, 8)}@example.com`;
    await store.register(rateEmail);
    let limited = false;
    for (let i = 0; i < LOGIN_MAX_FAILURES_PER_EMAIL + 2; i++) {
      const r = await store.login(rateEmail, "111-111", `rate-conn-${i}`);
      if (r.status === "rate_limited") {
        limited = true;
        break;
      }
      assert.equal(r.status, "invalid_credentials");
    }
    assert.ok(limited, "expected rate_limited after repeated failures");
  } finally {
    // Best-effort cleanup of this test prefix.
    const { connectRedis } = await import("../server/src/economy/redis.js");
    const { redis } = await connectRedis({ url: resolveRedisUrl(), keyPrefix: KEY_PREFIX });
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", `${KEY_PREFIX}:*`, "COUNT", 200);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== "0");
    await redis.quit();
    await store.close();
  }
}

async function liveWsChecks(logs: string[]): Promise<void> {
  const email = `live-${randomUUID().slice(0, 8)}@example.com`;
  const client = await connect();

  // Register
  let before = client.messages.length;
  client.ws.send(JSON.stringify({ type: "account_register", email }));
  const created = await waitFor(
    client,
    before,
    (m) => m.type === "account_created" || (m.type === "account_login_result" && !m.ok),
    "account_created",
  );
  assert.equal(created.type, "account_created");
  if (created.type !== "account_created") throw new Error("unreachable");
  assert.equal(created.email, email);
  assert.match(created.code, /^\d{3}-\d{3}$/);
  const token = created.token;
  const code = created.code;

  // Register again from a fresh connection → code_required (not a duplicate account)
  const clientDup = await connect();
  before = clientDup.messages.length;
  clientDup.ws.send(JSON.stringify({ type: "account_register", email }));
  const needsCode = await waitFor(
    clientDup,
    before,
    (m) => m.type === "account_login_result",
    "code_required",
  );
  assert.equal(needsCode.type, "account_login_result");
  if (needsCode.type !== "account_login_result") throw new Error("unreachable");
  assert.equal(needsCode.ok, false);
  assert.equal(needsCode.reason, "code_required");
  clientDup.ws.close();

  // Wrong code
  const client2 = await connect();
  before = client2.messages.length;
  client2.ws.send(JSON.stringify({ type: "account_login", email, code: "999-999" }));
  const wrong = await waitFor(client2, before, (m) => m.type === "account_login_result", "wrong login");
  assert.equal(wrong.type, "account_login_result");
  if (wrong.type !== "account_login_result") throw new Error("unreachable");
  assert.equal(wrong.ok, false);
  assert.equal(wrong.reason, "invalid_credentials");

  // Correct login from "fresh device"
  before = client2.messages.length;
  client2.ws.send(JSON.stringify({ type: "account_login", email, code }));
  const loginOk = await waitFor(client2, before, (m) => m.type === "account_login_result", "login ok");
  assert.equal(loginOk.type, "account_login_result");
  if (loginOk.type !== "account_login_result") throw new Error("unreachable");
  assert.equal(loginOk.ok, true);
  assert.ok(loginOk.token);

  // Session resume
  const client3 = await connect();
  before = client3.messages.length;
  client3.ws.send(JSON.stringify({ type: "account_session_resume", token }));
  const resumed = await waitFor(client3, before, (m) => m.type === "account_session_result", "resume");
  assert.equal(resumed.type, "account_session_result");
  if (resumed.type !== "account_session_result") throw new Error("unreachable");
  assert.equal(resumed.ok, true);
  assert.equal(resumed.email, email);

  // Join still works with nickname (auth does not replace nickname)
  before = client3.messages.length;
  client3.ws.send(JSON.stringify({ type: "join", mode: "bots", nickname: "AuthPlayer" }));
  const joined = await waitFor(
    client3,
    before,
    (m) => m.type === "join_accepted" || m.type === "join_rejected",
    "join",
  );
  assert.equal(joined.type, "join_accepted");

  // Brute-force guard trips (fresh connection + email)
  const rateEmail = `bruteforce-${randomUUID().slice(0, 8)}@example.com`;
  const regClient = await connect();
  before = regClient.messages.length;
  regClient.ws.send(JSON.stringify({ type: "account_register", email: rateEmail }));
  await waitFor(regClient, before, (m) => m.type === "account_created", "rate-email register");
  regClient.ws.close();

  const attacker = await connect();
  let sawRateLimit = false;
  for (let i = 0; i < LOGIN_MAX_FAILURES_PER_EMAIL + 3; i++) {
    before = attacker.messages.length;
    attacker.ws.send(JSON.stringify({ type: "account_login", email: rateEmail, code: "000-000" }));
    const result = await waitFor(attacker, before, (m) => m.type === "account_login_result", `fail ${i}`);
    assert.equal(result.type, "account_login_result");
    if (result.type !== "account_login_result") throw new Error("unreachable");
    if (result.reason === "rate_limited") {
      sawRateLimit = true;
      break;
    }
    assert.equal(result.reason, "invalid_credentials");
  }
  assert.ok(sawRateLimit, "expected WS login rate_limited");

  const joinedLogs = logs.join("\n");
  assert.match(joinedLogs, /login rate_limited|abuse signal|login failed/);
  // Never log the plaintext code or session token.
  assert.ok(!joinedLogs.includes(code), "server must not log plaintext code");
  assert.ok(!joinedLogs.includes(token), "server must not log session token");

  client.ws.close();
  client2.ws.close();
  client3.ws.close();
  attacker.ws.close();
}

async function main(): Promise<void> {
  await unitStoreChecks();
  console.log("[account-auth] unit store checks PASS");

  const { child, logs } = await startServer();
  try {
    await liveWsChecks(logs);
    console.log("[account-auth] live WS checks PASS");
  } finally {
    await stopServer(child);
  }
  console.log("[account-auth] PASS");
}

main().catch((err) => {
  console.error("[account-auth] FAIL", err);
  process.exit(1);
});
