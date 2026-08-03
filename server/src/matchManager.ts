// Match manager (EPIC 9 "Bots & Match Modes" Architecture Section 2):
// Map<matchId, Match>, replacing the single global PlayerRegistry/
// PickupSpawner/tick-interval that existed pre-EPIC-9. Owns the one
// persistent "public" match (created here at construction time, fixed id)
// and creates/destroys private "bots:<connectionId>" matches on demand,
// driven entirely by server/src/index.ts's connection/message handling
// (this module has no `ws`/transport dependency of its own).

import { Match } from "./match.js";

/** Fixed id for the single persistent public match (EPIC 9 spec Section 2). */
export const PUBLIC_MATCH_ID = "public";

export class MatchManager {
  private matches = new Map<string, Match>();

  constructor() {
    // Created at startup, always exists, whether 0, 1, or many players are
    // in it — this IS today's pre-EPIC-9 single shared world, unchanged
    // (EPIC 9 spec Section 2: "If you're the only one in it, you're just
    // walking around alone ... this is the 'waiting for players' mode, not
    // a separate thing to build").
    const publicMatch = new Match({ id: PUBLIC_MATCH_ID, mode: "public" });
    publicMatch.start();
    this.matches.set(PUBLIC_MATCH_ID, publicMatch);
  }

  /** The single persistent public match. */
  getPublicMatch(): Match {
    const match = this.matches.get(PUBLIC_MATCH_ID);
    if (!match) {
      // Defensive only — the public match is created in the constructor
      // above and this class never removes it (see destroy()'s mode==="bots"
      // guard, mirrored by Match.removeHuman()'s own mode check).
      throw new Error("public match missing — this should never happen");
    }
    return match;
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
}
