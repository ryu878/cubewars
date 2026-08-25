// EPIC 34: Redis-backed account + session store.
// Separate key namespace from EconomyStore / AvatarProfileStore.
// Login codes are hashed with bcryptjs (never stored or logged in cleartext).
// Session bearer tokens are stored as SHA-256 digests.

import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import bcrypt from "bcryptjs";
import { connectRedis, resolveRedisUrl } from "../economy/redis.js";

const SCHEMA_VERSION = 1;
const BCRYPT_ROUNDS = 10;

/** Generous safety-net TTL; refreshed on each successful use (EPIC 34 judgment call). */
export const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;

/** Failed login attempts per email before lockout within the rolling window. */
export const LOGIN_MAX_FAILURES_PER_EMAIL = 5;
/** Failed login attempts per connection before lockout within the rolling window. */
export const LOGIN_MAX_FAILURES_PER_CONNECTION = 10;
/** Rolling window for login failure counters. */
export const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;

const EMAIL_MAX_LEN = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AccountRecord {
  accountId: string;
  email: string;
  codeHash: string;
  createdAtMs: number;
}

export interface SessionRecord {
  accountId: string;
  email: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface AccountStoreOpenOptions {
  redisUrl?: string;
  keyPrefix?: string;
  /** Share an existing Redis client. Caller still owns quit(). */
  redis?: Redis;
}

export type RegisterResult =
  | { status: "created"; account: AccountRecord; code: string; token: string }
  | { status: "exists" }
  | { status: "invalid_email" };

export type LoginResult =
  | { status: "ok"; account: AccountRecord; token: string }
  | { status: "invalid_credentials" }
  | { status: "rate_limited" }
  | { status: "invalid_email" };

export type ResumeResult =
  | { status: "ok"; account: AccountRecord; token: string }
  | { status: "invalid_token" };

interface AccountDocument {
  v: number;
  accountId: string;
  email: string;
  codeHash: string;
  createdAtMs: number;
}

interface SessionDocument {
  v: number;
  accountId: string;
  email: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export class AccountStore {
  readonly redisUrl: string;
  readonly keyPrefix: string;

  private readonly redis: Redis;
  private readonly ownsRedis: boolean;
  /** In-memory failed-login windows keyed by email / connection id. */
  private readonly emailFailures = new Map<string, number[]>();
  private readonly connectionFailures = new Map<string, number[]>();

  private constructor(redis: Redis, redisUrl: string, keyPrefix: string, ownsRedis: boolean) {
    this.redis = redis;
    this.redisUrl = redisUrl;
    this.keyPrefix = keyPrefix;
    this.ownsRedis = ownsRedis;
  }

  static async open(options: AccountStoreOpenOptions = {}): Promise<AccountStore> {
    if (options.redis) {
      const keyPrefix = options.keyPrefix?.replace(/:$/, "") ?? "cw";
      const url = options.redisUrl ?? resolveRedisUrl();
      return new AccountStore(options.redis, url, keyPrefix, false);
    }
    const { redis, url, keyPrefix } = await connectRedis({
      url: options.redisUrl ?? resolveRedisUrl(),
      keyPrefix: options.keyPrefix,
    });
    console.log(`[accounts] redis ready: ${url} (prefix=${keyPrefix})`);
    return new AccountStore(redis, url, keyPrefix, true);
  }

  async close(): Promise<void> {
    this.emailFailures.clear();
    this.connectionFailures.clear();
    if (this.ownsRedis) {
      await this.redis.quit();
    }
  }

  /** Normalize + validate email. Returns null when invalid. */
  normalizeEmail(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const email = raw.trim().toLowerCase();
    if (email.length < 3 || email.length > EMAIL_MAX_LEN) return null;
    if (!EMAIL_RE.test(email)) return null;
    return email;
  }

  /** Normalize login code input: accept with or without the middle dash. */
  normalizeCode(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const digits = raw.replace(/[\s-]/g, "");
    if (!/^\d{6}$/.test(digits)) return null;
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }

  async register(emailRaw: unknown): Promise<RegisterResult> {
    const email = this.normalizeEmail(emailRaw);
    if (!email) return { status: "invalid_email" };

    const existing = await this.getByEmail(email);
    if (existing) return { status: "exists" };

    const accountId = randomUUID();
    const code = generateDisplayCode();
    const codeHash = await bcrypt.hash(code, BCRYPT_ROUNDS);
    const createdAtMs = Date.now();
    const account: AccountRecord = { accountId, email, codeHash, createdAtMs };

    const doc: AccountDocument = {
      v: SCHEMA_VERSION,
      accountId,
      email,
      codeHash,
      createdAtMs,
    };

    // SET NX so a concurrent register for the same email cannot overwrite.
    const setOk = await this.redis.set(this.emailKey(email), JSON.stringify(doc), "NX");
    if (setOk !== "OK") {
      return { status: "exists" };
    }
    await this.redis.set(this.idKey(accountId), email);

    const token = await this.issueSession(account);
    console.log(`[accounts] registered accountId=${accountId} email=${redactEmail(email)}`);
    return { status: "created", account, code, token };
  }

  async login(emailRaw: unknown, codeRaw: unknown, connectionId: string): Promise<LoginResult> {
    const email = this.normalizeEmail(emailRaw);
    if (!email) return { status: "invalid_email" };

    if (this.isRateLimited(email, connectionId)) {
      console.warn(
        `[accounts] login rate_limited email=${redactEmail(email)} connection=${connectionId}`,
      );
      return { status: "rate_limited" };
    }

    const code = this.normalizeCode(codeRaw);
    const account = await this.getByEmail(email);

    // Constant-ish path: always run a bcrypt compare when possible so timing
    // does not trivially reveal whether the email exists. On missing account
    // or malformed code, still record a failure and return the same reason.
    let ok = false;
    if (account && code) {
      ok = await bcrypt.compare(code, account.codeHash);
    } else if (!account) {
      // Dummy compare against a fixed hash shape so missing emails still pay
      // a bcrypt cost (hash of "000-000" at the same cost factor).
      await bcrypt.compare(code ?? "000-000", DUMMY_CODE_HASH);
    }

    if (!ok || !account) {
      this.recordFailure(email, connectionId);
      console.warn(
        `[accounts] login failed (invalid_credentials) email=${redactEmail(email)} connection=${connectionId}`,
      );
      return { status: "invalid_credentials" };
    }

    this.clearFailures(email, connectionId);
    const token = await this.issueSession(account);
    console.log(`[accounts] login ok accountId=${account.accountId} email=${redactEmail(email)}`);
    return { status: "ok", account, token };
  }

  async resumeSession(tokenRaw: unknown): Promise<ResumeResult> {
    if (typeof tokenRaw !== "string" || tokenRaw.length < 32 || tokenRaw.length > 128) {
      return { status: "invalid_token" };
    }
    // Hex tokens only (what we issue); reject anything else without logging it.
    if (!/^[0-9a-f]+$/i.test(tokenRaw)) {
      return { status: "invalid_token" };
    }

    const tokenHash = hashToken(tokenRaw);
    const raw = await this.redis.get(this.sessionKey(tokenHash));
    if (!raw) return { status: "invalid_token" };

    let doc: SessionDocument;
    try {
      doc = JSON.parse(raw) as SessionDocument;
    } catch {
      await this.redis.del(this.sessionKey(tokenHash));
      return { status: "invalid_token" };
    }

    const now = Date.now();
    if (!doc?.accountId || !doc.email || typeof doc.expiresAtMs !== "number" || doc.expiresAtMs <= now) {
      await this.redis.del(this.sessionKey(tokenHash));
      return { status: "invalid_token" };
    }

    const account = await this.getByEmail(doc.email);
    if (!account || account.accountId !== doc.accountId) {
      await this.redis.del(this.sessionKey(tokenHash));
      return { status: "invalid_token" };
    }

    // Refresh TTL on successful use (sliding window).
    const expiresAtMs = now + SESSION_TTL_MS;
    const refreshed: SessionDocument = {
      v: SCHEMA_VERSION,
      accountId: account.accountId,
      email: account.email,
      createdAtMs: doc.createdAtMs,
      expiresAtMs,
    };
    const ttlSeconds = Math.ceil(SESSION_TTL_MS / 1000);
    await this.redis.set(this.sessionKey(tokenHash), JSON.stringify(refreshed), "EX", ttlSeconds);

    console.log(`[accounts] session resume ok accountId=${account.accountId}`);
    return { status: "ok", account, token: tokenRaw };
  }

  /** Test helper: read raw account document (never returns code plaintext). */
  async getByEmail(email: string): Promise<AccountRecord | null> {
    const raw = await this.redis.get(this.emailKey(email));
    if (!raw) return null;
    try {
      const doc = JSON.parse(raw) as AccountDocument;
      if (!doc?.accountId || !doc.email || !doc.codeHash) return null;
      return {
        accountId: doc.accountId,
        email: doc.email,
        codeHash: doc.codeHash,
        createdAtMs: doc.createdAtMs,
      };
    } catch {
      return null;
    }
  }

  /** Whether login is currently locked for this email and/or connection. */
  isRateLimited(email: string, connectionId: string): boolean {
    const now = Date.now();
    this.pruneFailures(this.emailFailures, email, now);
    this.pruneFailures(this.connectionFailures, connectionId, now);
    const emailCount = this.emailFailures.get(email)?.length ?? 0;
    const connCount = this.connectionFailures.get(connectionId)?.length ?? 0;
    return emailCount >= LOGIN_MAX_FAILURES_PER_EMAIL || connCount >= LOGIN_MAX_FAILURES_PER_CONNECTION;
  }

  private recordFailure(email: string, connectionId: string): void {
    const now = Date.now();
    this.pushFailure(this.emailFailures, email, now);
    this.pushFailure(this.connectionFailures, connectionId, now);
    const emailCount = this.emailFailures.get(email)?.length ?? 0;
    if (emailCount >= LOGIN_MAX_FAILURES_PER_EMAIL) {
      console.warn(
        `[accounts] abuse signal: email=${redactEmail(email)} hit ${emailCount} failed logins ` +
          `within ${LOGIN_RATE_WINDOW_MS}ms (connection=${connectionId})`,
      );
    }
  }

  private clearFailures(email: string, connectionId: string): void {
    this.emailFailures.delete(email);
    this.connectionFailures.delete(connectionId);
  }

  private pushFailure(map: Map<string, number[]>, key: string, now: number): void {
    this.pruneFailures(map, key, now);
    const list = map.get(key) ?? [];
    list.push(now);
    map.set(key, list);
  }

  private pruneFailures(map: Map<string, number[]>, key: string, now: number): void {
    const list = map.get(key);
    if (!list) return;
    const windowStart = now - LOGIN_RATE_WINDOW_MS;
    while (list.length > 0 && list[0]! < windowStart) list.shift();
    if (list.length === 0) map.delete(key);
    else map.set(key, list);
  }

  private async issueSession(account: AccountRecord): Promise<string> {
    const token = randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);
    const now = Date.now();
    const doc: SessionDocument = {
      v: SCHEMA_VERSION,
      accountId: account.accountId,
      email: account.email,
      createdAtMs: now,
      expiresAtMs: now + SESSION_TTL_MS,
    };
    const ttlSeconds = Math.ceil(SESSION_TTL_MS / 1000);
    await this.redis.set(this.sessionKey(tokenHash), JSON.stringify(doc), "EX", ttlSeconds);
    return token;
  }

  private emailKey(email: string): string {
    return `${this.keyPrefix}:account:v1:email:${email}`;
  }

  private idKey(accountId: string): string {
    return `${this.keyPrefix}:account:v1:id:${accountId}`;
  }

  private sessionKey(tokenHash: string): string {
    return `${this.keyPrefix}:account:v1:session:${tokenHash}`;
  }
}

/** Precomputed bcrypt hash of "000-000" at BCRYPT_ROUNDS — timing pad only. */
const DUMMY_CODE_HASH = bcrypt.hashSync("000-000", BCRYPT_ROUNDS);

function generateDisplayCode(): string {
  const n = randomInt(0, 1_000_000);
  const left = Math.floor(n / 1000)
    .toString()
    .padStart(3, "0");
  const right = (n % 1000).toString().padStart(3, "0");
  return `${left}-${right}`;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Log-safe email redaction (keep domain, mask local part). */
function redactEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const hint = local.length <= 1 ? "*" : `${local[0]}***`;
  return `${hint}@${domain}`;
}
