// EPIC 27 Critic F-001 / F-002 regressions:
// - Auto SQLite import must not clobber live Redis gold (999 stays 999 when SQLite has 1).
// - Marker set when SQLite missing prevents later surprise import.
// - Failed Redis write throws; durable Redis gold unchanged (no cache-ahead ghost).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import {
  EconomyStore,
  openEconomyDatabase,
  runMigrations,
} from "../server/src/economy/index.js";
import { openTestEconomyStore, ensureRedisRunning } from "./economy-test-helpers.js";

function seedLegacySqlite(dbPath: string, nickname: string, gold: number): void {
  const db = openEconomyDatabase(dbPath);
  runMigrations(db);
  const now = Date.now();
  const key = nickname.toLocaleLowerCase();
  db.prepare(
    `INSERT INTO profiles (id, nickname_key, nickname, gold, created_at, updated_at)
     VALUES (1, ?, ?, ?, ?, ?)`,
  ).run(key, nickname, gold, now, now);
  db.close();
}

type StoreWithRedis = EconomyStore & { redis: Redis };

async function assertImportDoesNotClobber(): Promise<void> {
  const store = await openTestEconomyStore();
  const redisUrl = store.redisUrl;
  const keyPrefix = store.keyPrefix;

  await store.getOrCreateProfile("Ghost");
  await store.addGold("Ghost", 999);
  assert.equal((await store.getOrCreateProfile("Ghost")).gold, 999);
  await store.close();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cubewars-f001-"));
  const dbPath = path.join(tmpDir, "stale-economy.sqlite");
  seedLegacySqlite(dbPath, "Ghost", 1);

  const prevDb = process.env.CUBEWARS_ECONOMY_DB;
  const prevImport = process.env.CUBEWARS_SQLITE_IMPORT;
  process.env.CUBEWARS_ECONOMY_DB = dbPath;
  delete process.env.CUBEWARS_SQLITE_IMPORT;

  try {
    const imported = await EconomyStore.open({
      redisUrl,
      keyPrefix,
      skipSqliteImport: false,
    });
    const gold = (await imported.getOrCreateProfile("Ghost")).gold;
    assert.equal(gold, 999, "auto-import must not clobber Redis gold 999 with SQLite gold 1");
    await imported.flushNamespace();
    await imported.close();
  } finally {
    if (prevDb === undefined) delete process.env.CUBEWARS_ECONOMY_DB;
    else process.env.CUBEWARS_ECONOMY_DB = prevDb;
    if (prevImport === undefined) delete process.env.CUBEWARS_SQLITE_IMPORT;
    else process.env.CUBEWARS_SQLITE_IMPORT = prevImport;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function assertMissingSqliteSetsMarker(): Promise<void> {
  await ensureRedisRunning();
  const redisUrl = process.env.CUBEWARS_REDIS_URL ?? "redis://127.0.0.1:6379";
  const keyPrefix = `cw:test:f001-marker:${randomUUID()}`;
  const missingPath = path.join(
    os.tmpdir(),
    `cubewars-missing-sqlite-${randomUUID()}`,
    "nope.sqlite",
  );

  const prevDb = process.env.CUBEWARS_ECONOMY_DB;
  const prevImport = process.env.CUBEWARS_SQLITE_IMPORT;
  process.env.CUBEWARS_ECONOMY_DB = missingPath;
  delete process.env.CUBEWARS_SQLITE_IMPORT;

  try {
    const store = await EconomyStore.open({
      redisUrl,
      keyPrefix,
      skipSqliteImport: false,
    });
    const marker = await (store as StoreWithRedis).redis.get(`${keyPrefix}:meta:sqlite_imported`);
    assert.ok(marker, "marker must be set when SQLite file is missing");

    await store.getOrCreateProfile("LaterGhost");
    await store.addGold("LaterGhost", 999);
    assert.equal((await store.getOrCreateProfile("LaterGhost")).gold, 999);
    await store.close();

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cubewars-f001-later-"));
    const dbPath = path.join(tmpDir, "late-economy.sqlite");
    seedLegacySqlite(dbPath, "LaterGhost", 1);
    process.env.CUBEWARS_ECONOMY_DB = dbPath;

    const reopened = await EconomyStore.open({
      redisUrl,
      keyPrefix,
      skipSqliteImport: false,
    });
    assert.equal(
      (await reopened.getOrCreateProfile("LaterGhost")).gold,
      999,
      "SQLite appearing after marker must not clobber Redis",
    );
    await reopened.flushNamespace();
    await reopened.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } finally {
    if (prevDb === undefined) delete process.env.CUBEWARS_ECONOMY_DB;
    else process.env.CUBEWARS_ECONOMY_DB = prevDb;
    if (prevImport === undefined) delete process.env.CUBEWARS_SQLITE_IMPORT;
    else process.env.CUBEWARS_SQLITE_IMPORT = prevImport;
  }
}

async function assertWriteFailureDoesNotAdvanceCache(): Promise<void> {
  const store = await openTestEconomyStore();
  const redisUrl = store.redisUrl;
  const keyPrefix = store.keyPrefix;

  await store.getOrCreateProfile("Ghost");
  await store.addGold("Ghost", 100);
  assert.equal((await store.getOrCreateProfile("Ghost")).gold, 100);

  // Quit the store's Redis connection while leaving warm cache (F-002 repro).
  await (store as StoreWithRedis).redis.quit();

  await assert.rejects(
    () => store.addGold("Ghost", 50),
    /./,
    "addGold must throw when Redis write fails",
  );

  const probe = await EconomyStore.open({
    redisUrl,
    keyPrefix,
    skipSqliteImport: true,
  });
  assert.equal(
    (await probe.getOrCreateProfile("Ghost")).gold,
    100,
    "Redis must stay at 100 after failed write (not cache ghost 150)",
  );
  await probe.flushNamespace();
  await probe.close();
}

async function main(): Promise<void> {
  await assertImportDoesNotClobber();
  await assertMissingSqliteSetsMarker();
  await assertWriteFailureDoesNotAdvanceCache();
  console.log("[economy-redis-safety] PASS (F-001, F-002)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
