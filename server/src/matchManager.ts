// Match manager (EPIC 9 "Bots & Match Modes" Architecture Section 2):
// Map<matchId, Match>, replacing the single global PlayerRegistry/
// PickupSpawner/tick-interval that existed pre-EPIC-9. Owns the public
// match pool (one is created at startup, new ones are added when the active
// games fill up) and creates/destroys private "bots:<connectionId>" matches
// on demand, driven entirely by server/src/index.ts's connection/message
// handling (this module has no `ws`/transport dependency of its own).
//
// EPIC 26–27: PvP career K/D and endless personal bests are durable in Redis
// via EconomyStore; in-memory Maps are write-through caches hydrated on start.

import {
  LEADERBOARD_LIMIT,
  MAX_PUBLIC_PLAYERS_PER_MATCH,
  normalizeNickname,
  type EndlessLeaderboardEntry,
  type LeaderboardEntry,
  type LobbyMatchSummary,
} from "@cubewars/shared";
import { Match } from "./match.js";
import type { EconomyStore } from "./economy/index.js";
import type { AvatarProfileStore } from "./avatarProfile.js";

/** Fixed id for the first persistent public match (EPIC 9 spec Section 2). */
export const PUBLIC_MATCH_ID = "public";

export interface MatchManagerOptions {
  onLeaderboardChanged?: (entries: LeaderboardEntry[]) => void;
  onEndlessLeaderboardChanged?: (entries: EndlessLeaderboardEntry[]) => void;
  economy?: EconomyStore;
  /** EPIC 33: avatar color preferences (separate from economy Redis docs). */
  avatarProfile?: AvatarProfileStore;
}

export class MatchManager {
  private matches = new Map<string, Match>();
  private nextPublicMatchNumber = 1;
  /** Cache of durable career K/D (hydrated from Redis when economy is set). */
  private leaderboard = new Map<string, LeaderboardEntry>();
  /** Cache of durable endless personal bests. */
  private endlessLeaderboard = new Map<string, EndlessLeaderboardEntry>();

  constructor(private options: MatchManagerOptions = {}) {
    // Created at startup and kept available as the first public game.
    this.createPublicMatch();
  }

  /** Hydrate lobby caches from Redis (call once after EconomyStore.open). */
  async hydrateFromEconomy(): Promise<void> {
    await this.hydrateLeaderboardsFromStore();
  }

  findOrCreatePublicMatch(): Match {
    for (const match of this.publicMatches()) {
      if (match.canAcceptHuman()) return match;
    }
    return this.createPublicMatch();
  }

  getPublicMatch(matchId: string): Match | null {
    const match = this.matches.get(matchId);
    if (!match || match.mode !== "public") return null;
    return match;
  }

  listPublicMatches(): LobbyMatchSummary[] {
    return this.publicMatches().map((match, index) => ({
      id: match.id,
      displayName: `Game ${index + 1}`,
      players: match.humanCount(),
      maxPlayers: MAX_PUBLIC_PLAYERS_PER_MATCH,
    }));
  }

  listLeaderboard(): LeaderboardEntry[] {
    return [...this.leaderboard.values()]
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.nickname.localeCompare(b.nickname))
      .slice(0, LEADERBOARD_LIMIT)
      .map((entry) => ({ ...entry }));
  }

  async recordKill(attackerNickname: string, victimNickname: string): Promise<void> {
    const economy = this.options.economy;
    if (economy) {
      const { attacker, victim } = await economy.incrementCareerKillDeath(
        attackerNickname,
        victimNickname,
      );
      this.leaderboard.set(attacker.nicknameKey, {
        nickname: attacker.nickname,
        kills: attacker.kills,
        deaths: attacker.deaths,
      });
      this.leaderboard.set(victim.nicknameKey, {
        nickname: victim.nickname,
        kills: victim.kills,
        deaths: victim.deaths,
      });
    } else {
      const attacker = this.getOrCreateLeaderboardEntry(attackerNickname);
      attacker.kills += 1;
      const victim = this.getOrCreateLeaderboardEntry(victimNickname);
      victim.deaths += 1;
    }
    this.broadcastLeaderboard();
  }

  listEndlessLeaderboard(): EndlessLeaderboardEntry[] {
    return [...this.endlessLeaderboard.values()]
      .sort(
        (a, b) =>
          b.botKills - a.botKills || b.distanceKm - a.distanceKm || a.nickname.localeCompare(b.nickname),
      )
      .slice(0, LEADERBOARD_LIMIT)
      .map((entry) => ({ ...entry }));
  }

  async recordEndlessProgress(nickname: string, botKills: number, distanceKm: number): Promise<void> {
    const economy = this.options.economy;
    if (economy) {
      const entry = await economy.upsertEndlessBest(nickname, botKills, distanceKm);
      this.endlessLeaderboard.set(entry.nicknameKey, {
        nickname: entry.nickname,
        botKills: entry.botKills,
        distanceKm: entry.distanceKm,
      });
    } else {
      const normalized = normalizeNickname(nickname);
      const key = normalized.ok ? normalized.key : nickname.toLocaleLowerCase();
      const current = this.endlessLeaderboard.get(key);
      const nextNickname = normalized.ok ? normalized.nickname : nickname;
      if (!current) {
        this.endlessLeaderboard.set(key, { nickname: nextNickname, botKills, distanceKm });
      } else {
        current.nickname = nextNickname;
        current.botKills = Math.max(current.botKills, botKills);
        current.distanceKm = Math.max(current.distanceKm, distanceKm);
      }
    }
    this.options.onEndlessLeaderboardChanged?.(this.listEndlessLeaderboard());
  }

  /**
   * Create a fresh private "bots:<connectionId>" match containing exactly
   * this one (about-to-join) human + 2 bots (EPIC 9 spec Section 2). The
   * caller (server/src/index.ts) is responsible for calling
   * `match.addHuman()` right after this returns to actually put the human
   * in it — this method only creates the match and its 2 bots.
   */
  createBotsMatch(connectionId: string): Match {
    const id = `bots:${connectionId}`;
    const match = new Match({
      id,
      mode: "bots",
      onEmpty: (matchId) => this.destroy(matchId),
      onKillRecorded: (attackerNickname, victimNickname) => {
        void this.recordKill(attackerNickname, victimNickname).catch((err) => {
          console.error(`[economy] recordKill failed:`, err);
        });
      },
      economy: this.options.economy,
      avatarProfile: this.options.avatarProfile,
    });
    match.start();
    this.matches.set(id, match);
    console.log(`[server] match created: ${id}`);
    return match;
  }

  createEndlessMatch(connectionId: string): Match {
    const id = `endless:${connectionId}`;
    const match = new Match({
      id,
      mode: "endless",
      onEmpty: (matchId) => this.destroy(matchId),
      onEndlessProgress: (nickname, botKills, distanceKm) => {
        void this.recordEndlessProgress(nickname, botKills, distanceKm).catch((err) => {
          console.error(`[economy] recordEndlessProgress failed:`, err);
        });
      },
      economy: this.options.economy,
      avatarProfile: this.options.avatarProfile,
    });
    match.start();
    this.matches.set(id, match);
    console.log(`[server] match created: ${id}`);
    return match;
  }

  destroyMatch(matchId: string): void {
    this.destroy(matchId);
  }

  /** Look up a match by id (currently unused outside this module, kept for symmetry/future use — e.g. ops tooling). */
  get(matchId: string): Match | undefined {
    return this.matches.get(matchId);
  }

  /** Count of currently-live match instances (ops/logging visibility only). */
  size(): number {
    return this.matches.size;
  }

  private async hydrateLeaderboardsFromStore(): Promise<void> {
    const economy = this.options.economy;
    if (!economy) return;
    for (const entry of await economy.listAllCareerStats()) {
      this.leaderboard.set(entry.nicknameKey, {
        nickname: entry.nickname,
        kills: entry.kills,
        deaths: entry.deaths,
      });
    }
    for (const entry of await economy.listAllEndlessCareerStats()) {
      this.endlessLeaderboard.set(entry.nicknameKey, {
        nickname: entry.nickname,
        botKills: entry.botKills,
        distanceKm: entry.distanceKm,
      });
    }
    console.log(
      `[economy] leaderboards hydrated: career=${this.leaderboard.size} endless=${this.endlessLeaderboard.size}`,
    );
  }

  private destroy(matchId: string): void {
    const match = this.matches.get(matchId);
    if (!match) return;
    match.destroy();
    this.matches.delete(matchId);
    console.log(`[server] match torn down: ${matchId} (${this.matches.size} live match(es))`);
  }

  private publicMatches(): Match[] {
    return [...this.matches.values()]
      .filter((match) => match.mode === "public")
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private createPublicMatch(): Match {
    const id = this.nextPublicMatchNumber === 1 ? PUBLIC_MATCH_ID : `public-${this.nextPublicMatchNumber}`;
    this.nextPublicMatchNumber += 1;
    const match = new Match({
      id,
      mode: "public",
      onKillRecorded: (attackerNickname, victimNickname) => {
        void this.recordKill(attackerNickname, victimNickname).catch((err) => {
          console.error(`[economy] recordKill failed:`, err);
        });
      },
      economy: this.options.economy,
      avatarProfile: this.options.avatarProfile,
    });
    match.start();
    this.matches.set(id, match);
    console.log(`[server] public match available: ${id} (${MAX_PUBLIC_PLAYERS_PER_MATCH} max players)`);
    return match;
  }

  private getOrCreateLeaderboardEntry(nickname: string): LeaderboardEntry {
    const normalized = normalizeNickname(nickname);
    const key = normalized.ok ? normalized.key : nickname.toLocaleLowerCase();
    let entry = this.leaderboard.get(key);
    if (!entry) {
      entry = { nickname: normalized.ok ? normalized.nickname : nickname, kills: 0, deaths: 0 };
      this.leaderboard.set(key, entry);
    } else if (normalized.ok) {
      entry.nickname = normalized.nickname;
    }
    return entry;
  }

  private broadcastLeaderboard(): void {
    const entries = this.listLeaderboard();
    for (const match of this.matches.values()) {
      match.broadcastLeaderboard(entries);
    }
    this.options.onLeaderboardChanged?.(entries);
  }
}
