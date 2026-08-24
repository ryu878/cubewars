// Legacy SQLite path resolution for one-shot Redis import only (EPIC 27).
// Runtime economy storage is Redis — see redis.ts / store.ts.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_RELATIVE_DB = path.join("data", "economy.sqlite");

/** Resolve the legacy economy SQLite file path from env or the server package default. */
export function resolveEconomyDbPath(envValue: string | undefined = process.env.CUBEWARS_ECONOMY_DB): string {
  if (envValue && envValue.trim().length > 0) {
    return path.resolve(envValue.trim());
  }
  return path.join(SERVER_ROOT, DEFAULT_RELATIVE_DB);
}

/** Open (or create) a legacy SQLite economy database — import / migrations only. */
export function openEconomyDatabase(dbPath: string = resolveEconomyDbPath()): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}
