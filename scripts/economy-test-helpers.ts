// Shared Redis bootstrap for economy regressions (EPIC 27).
// Prefer an already-running Redis; if unreachable, try docker compose / docker run.

import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EconomyStore, resolveRedisUrl } from "../server/src/economy/index.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function canConnect(host: string, port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => done(true));
    socket.on("timeout", () => done(false));
    socket.on("error", () => done(false));
  });
}

function parseRedisHostPort(url: string): { host: string; port: number } {
  try {
    const u = new URL(url);
    return { host: u.hostname || "127.0.0.1", port: Number(u.port || 6379) };
  } catch {
    return { host: "127.0.0.1", port: 6379 };
  }
}

/** Ensure Redis is reachable; start via Docker when the host has no redis-server. */
export async function ensureRedisRunning(url: string = resolveRedisUrl()): Promise<void> {
  const { host, port } = parseRedisHostPort(url);
  if (await canConnect(host, port)) return;

  console.warn(`[economy-regression] Redis not reachable at ${host}:${port}; starting Docker…`);
  try {
    execSync("docker compose up -d redis", { cwd: REPO_ROOT, stdio: "inherit" });
  } catch {
    try {
      execSync(
        "docker start cubewars-redis 2>/dev/null || docker run -d --name cubewars-redis -p 6379:6379 redis:7 redis-server --appendonly yes",
        { cwd: REPO_ROOT, stdio: "inherit", shell: "/bin/bash" },
      );
    } catch (err) {
      throw new Error(
        `Redis unavailable at ${url} and Docker start failed. ` +
          `Install/start Redis with AOF, e.g. docker compose up -d redis. (${err})`,
      );
    }
  }

  for (let i = 0; i < 30; i++) {
    if (await canConnect(host, port, 300)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Redis still unreachable at ${url} after Docker start`);
}

/** Open an isolated EconomyStore namespace for one regression run. */
export async function openTestEconomyStore(): Promise<EconomyStore> {
  const url = resolveRedisUrl();
  await ensureRedisRunning(url);
  const store = await EconomyStore.open({
    redisUrl: url,
    keyPrefix: `cw:test:${randomUUID()}`,
    skipSqliteImport: true,
  });
  await store.flushNamespace();
  return store;
}
