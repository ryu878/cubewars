// Durable player economy profiles keyed by nickname (EPIC 23).
// Gold mutations are transactional and never leave a negative balance.
// Single-process assumption: better-sqlite3 sync API; do not run multiple
// server processes against the same SQLite file.

import path from "node:path";
import type Database from "better-sqlite3";
import { normalizeNickname } from "@cubewars/shared";
import { openEconomyDatabase, resolveEconomyDbPath } from "./db.js";
import { runMigrations } from "./migrations.js";

export interface EconomyProfile {
  id: number;
  nicknameKey: string;
  nickname: string;
  gold: number;
  createdAt: number;
  updatedAt: number;
}

interface ProfileRow {
  id: number;
  nickname_key: string;
  nickname: string;
  gold: number;
  created_at: number;
  updated_at: number;
}

function rowToProfile(row: ProfileRow): EconomyProfile {
  return {
    id: row.id,
    nicknameKey: row.nickname_key,
    nickname: row.nickname,
    gold: row.gold,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class EconomyStore {
  readonly dbPath: string;

  constructor(
    private db: Database.Database,
    dbPath: string,
  ) {
    this.dbPath = dbPath;
  }

  static open(dbPath: string = resolveEconomyDbPath()): EconomyStore {
    const resolved = path.resolve(dbPath);
    const db = openEconomyDatabase(resolved);
    runMigrations(db);
    console.log(`[economy] database ready: ${resolved}`);
    return new EconomyStore(db, resolved);
  }

  /** Close the underlying SQLite handle (tests / shutdown). */
  close(): void {
    this.db.close();
  }

  getOrCreateProfile(nickname: string): EconomyProfile {
    const normalized = normalizeNickname(nickname);
    if (!normalized.ok) {
      throw new Error(`cannot create economy profile for invalid nickname: ${normalized.reason}`);
    }
    const existing = this.getProfile(normalized.key);
    if (existing) {
      if (existing.nickname !== normalized.nickname) {
        const now = Date.now();
        this.db
          .prepare(
            "UPDATE profiles SET nickname = @nickname, updated_at = @updated_at WHERE nickname_key = @nickname_key",
          )
          .run({
            nickname: normalized.nickname,
            updated_at: now,
            nickname_key: normalized.key,
          });
        return { ...existing, nickname: normalized.nickname, updatedAt: now };
      }
      return existing;
    }

    const now = Date.now();
    const result = this.db
      .prepare(
        `INSERT INTO profiles (nickname_key, nickname, gold, created_at, updated_at)
         VALUES (@nickname_key, @nickname, 0, @created_at, @updated_at)`,
      )
      .run({
        nickname_key: normalized.key,
        nickname: normalized.nickname,
        created_at: now,
        updated_at: now,
      });

    return {
      id: Number(result.lastInsertRowid),
      nicknameKey: normalized.key,
      nickname: normalized.nickname,
      gold: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  getProfile(nicknameKey: string): EconomyProfile | null {
    const row = this.db
      .prepare(
        `SELECT id, nickname_key, nickname, gold, created_at, updated_at
         FROM profiles WHERE nickname_key = ?`,
      )
      .get(nicknameKey) as ProfileRow | undefined;
    return row ? rowToProfile(row) : null;
  }

  getGold(nicknameKey: string): number {
    return this.getProfile(nicknameKey)?.gold ?? 0;
  }

  /**
   * Add gold to a profile (creating it if needed). Rejects non-finite or
   * negative amounts. Returns the updated profile. Gold never goes below 0
   * (CHECK constraint + application reject of negative deltas).
   */
  addGold(nicknameKeyOrNickname: string, amount: number): EconomyProfile {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`addGold amount must be a non-negative finite number, got ${amount}`);
    }
    const amountInt = Math.floor(amount);

    const normalized = normalizeNickname(nicknameKeyOrNickname);
    const key = normalized.ok ? normalized.key : nicknameKeyOrNickname.toLocaleLowerCase();
    const display = normalized.ok ? normalized.nickname : nicknameKeyOrNickname;

    const run = this.db.transaction(() => {
      // Prefer a valid display nickname when we have one; otherwise ensure
      // the key already exists (tests may pass a raw key).
      if (normalized.ok) {
        this.getOrCreateProfile(display);
      } else if (!this.getProfile(key)) {
        throw new Error(`addGold requires an existing profile when nickname is invalid: ${key}`);
      }
      const now = Date.now();
      this.db
        .prepare(
          `UPDATE profiles
           SET gold = gold + @amount, updated_at = @updated_at
           WHERE nickname_key = @nickname_key`,
        )
        .run({ amount: amountInt, updated_at: now, nickname_key: key });
      const profile = this.getProfile(key);
      if (!profile) {
        throw new Error(`profile missing after addGold for key=${key}`);
      }
      return profile;
    });

    return run();
  }
}
