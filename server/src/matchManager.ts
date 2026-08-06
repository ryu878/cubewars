// Match manager (EPIC 9 "Bots & Match Modes" Architecture Section 2):
// Map<matchId, Match>, replacing the single global PlayerRegistry/
// PickupSpawner/tick-interval that existed pre-EPIC-9. Owns the one
// persistent "public" match (created here at construction time, fixed id)
// and creates/destroys private "bots:<connectionId>" matches on demand,
// driven entirely by server/src/index.ts's connection/message handling
// (this module has no `ws`/transport dependency of its own).

import { MAX_PUBLIC_PLAYERS_PER_MATCH, type LobbyMatchSummary } from "@cubewars/shared";
import { Match } from "./match.js";

/** Fixed id for the single persistent public match (EPIC 9 spec Section 2). */
export const PUBLIC_MATCH_ID = "public";

export class MatchManager {
  private matches = new Map<string, Match>();
  private nextPublicMatchNumber = 1;

  constructor() {
    // Created at startup, always exists, whether 0, 1, or many players are
    // in it — this IS today's pre-EPIC-9 single shared world, unchanged
    // (EPIC 9 spec Section 2: "If you're the only one in it, you're just
    // walking around alone ... this is the 'waiting for players' mode, not
    // a separate thing to build").
    this.createPublicMatch();
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
    const match = new Match({ id, mode: "public" });
    match.start();
    this.matches.set(id, match);
    console.log(`[server] public match available: ${id} (${MAX_PUBLIC_PLAYERS_PER_MATCH} max players)`);
    return match;
  }
}
