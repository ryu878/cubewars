// Redis connection helpers for the Emerald Wasteland economy store (EPIC 27).

import { Redis } from "ioredis";

export const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379";

/** Resolve Redis URL from env (default local Redis). */
export function resolveRedisUrl(envValue: string | undefined = process.env.CUBEWARS_REDIS_URL): string {
  if (envValue && envValue.trim().length > 0) {
    return envValue.trim();
  }
  return DEFAULT_REDIS_URL;
}

export interface ConnectRedisOptions {
  /** Override URL (tests). */
  url?: string;
  /**
   * Key namespace prefix ending without trailing colon rules handled by callers.
   * Production default empty → keys start with `cw:`.
   * Tests pass e.g. `cw:test:<uuid>` so FLUSH is scoped via SCAN delete.
   */
  keyPrefix?: string;
}

/**
 * Connect and PING Redis. Fails fast with a clear error if Redis is unreachable.
 * Callers must `quit()` the client on shutdown.
 */
export async function connectRedis(options: ConnectRedisOptions = {}): Promise<{
  redis: Redis;
  url: string;
  keyPrefix: string;
}> {
  const url = options.url ?? resolveRedisUrl();
  const keyPrefix = options.keyPrefix?.replace(/:$/, "") ?? "cw";
  const redis = new Redis(url, {
    // Fail fast: do not hang forever when Redis is down.
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  try {
    await redis.connect();
    const pong = await redis.ping();
    if (pong !== "PONG") {
      throw new Error(`unexpected PING response: ${pong}`);
    }
  } catch (err) {
    try {
      redis.disconnect();
    } catch {
      // ignore disconnect errors after failed connect
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[economy] Redis unavailable at ${url}: ${detail}. ` +
        `Start Redis (AOF recommended), e.g. ` +
        `docker compose up -d redis  OR  ` +
        `docker run -d --name cubewars-redis -p 6379:6379 redis:7 redis-server --appendonly yes`,
    );
  }

  return { redis, url, keyPrefix };
}
