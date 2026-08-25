// EPIC 33: account-level avatar color preference store.
// Separate Redis key namespace from EconomyStore (not gold/items / not EPIC 35 pools).

import type { Redis } from "ioredis";
import {
  AVATAR_BODY_PARTS,
  cloneAvatarColors,
  defaultAvatarColors,
  isValidPaletteIndex,
  type AvatarBodyPart,
  type AvatarColors,
} from "@cubewars/shared";
import { connectRedis, resolveRedisUrl } from "./economy/redis.js";

const SCHEMA_VERSION = 1;

interface AvatarDocument {
  v: number;
  colors: AvatarColors;
}

export interface AvatarProfileStoreOpenOptions {
  redisUrl?: string;
  keyPrefix?: string;
  /** Share an existing Redis client (e.g. from EconomyStore tests). Caller still owns quit(). */
  redis?: Redis;
}

export class AvatarProfileStore {
  readonly redisUrl: string;
  readonly keyPrefix: string;

  private readonly redis: Redis;
  private readonly ownsRedis: boolean;
  private readonly cache = new Map<string, AvatarColors>();

  private constructor(redis: Redis, redisUrl: string, keyPrefix: string, ownsRedis: boolean) {
    this.redis = redis;
    this.redisUrl = redisUrl;
    this.keyPrefix = keyPrefix;
    this.ownsRedis = ownsRedis;
  }

  private avatarKey(nicknameKey: string): string {
    return `${this.keyPrefix}:avatar:v1:${nicknameKey}`;
  }

  static async open(options: AvatarProfileStoreOpenOptions = {}): Promise<AvatarProfileStore> {
    if (options.redis) {
      const keyPrefix = options.keyPrefix?.replace(/:$/, "") ?? "cw";
      const url = options.redisUrl ?? resolveRedisUrl();
      return new AvatarProfileStore(options.redis, url, keyPrefix, false);
    }
    const { redis, url, keyPrefix } = await connectRedis({
      url: options.redisUrl ?? resolveRedisUrl(),
      keyPrefix: options.keyPrefix,
    });
    console.log(`[avatar] redis ready: ${url} (prefix=${keyPrefix})`);
    return new AvatarProfileStore(redis, url, keyPrefix, true);
  }

  async close(): Promise<void> {
    this.cache.clear();
    if (this.ownsRedis) {
      await this.redis.quit();
    }
  }

  async getColors(nicknameKey: string): Promise<AvatarColors> {
    const cached = this.cache.get(nicknameKey);
    if (cached) return cloneAvatarColors(cached);

    const raw = await this.redis.get(this.avatarKey(nicknameKey));
    if (!raw) {
      const defaults = defaultAvatarColors();
      this.cache.set(nicknameKey, defaults);
      return cloneAvatarColors(defaults);
    }

    try {
      const parsed = JSON.parse(raw) as AvatarDocument;
      const colors = sanitizeColors(parsed?.colors);
      this.cache.set(nicknameKey, colors);
      return cloneAvatarColors(colors);
    } catch {
      const defaults = defaultAvatarColors();
      this.cache.set(nicknameKey, defaults);
      return cloneAvatarColors(defaults);
    }
  }

  async setPart(nicknameKey: string, part: AvatarBodyPart, paletteIndex: number): Promise<AvatarColors> {
    if (!isValidPaletteIndex(paletteIndex)) {
      throw new Error(`invalid palette index: ${paletteIndex}`);
    }
    const current = await this.getColors(nicknameKey);
    current[part] = paletteIndex;
    await this.persist(nicknameKey, current);
    return cloneAvatarColors(current);
  }

  async setColors(nicknameKey: string, colors: AvatarColors): Promise<AvatarColors> {
    const sanitized = sanitizeColors(colors);
    await this.persist(nicknameKey, sanitized);
    return cloneAvatarColors(sanitized);
  }

  private async persist(nicknameKey: string, colors: AvatarColors): Promise<void> {
    const doc: AvatarDocument = { v: SCHEMA_VERSION, colors };
    await this.redis.set(this.avatarKey(nicknameKey), JSON.stringify(doc));
    this.cache.set(nicknameKey, cloneAvatarColors(colors));
  }
}

function sanitizeColors(input: Partial<AvatarColors> | undefined): AvatarColors {
  const defaults = defaultAvatarColors();
  if (!input || typeof input !== "object") return defaults;
  const out = defaultAvatarColors();
  for (const part of AVATAR_BODY_PARTS) {
    const value = input[part];
    out[part] = isValidPaletteIndex(value) ? value : defaults[part];
  }
  return out;
}
