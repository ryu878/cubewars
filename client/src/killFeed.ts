// Kill feed UI (EPIC 5 Story 5.1): a small transient "X eliminated Y" line
// for every kill, visible to EVERY connected client (not just the two
// players involved — Story 5.1 AC), fading out and expiring automatically
// rather than accumulating forever. Purely a renderer of the server's
// KillEvent broadcasts (security-baseline.mdc: the client never decides a
// kill happened) — plain DOM/CSS per the fixed stack's "no UI framework"
// rule, reusing the same transient-DOM-element pattern combatHud.ts already
// established for its pulses, just with a list instead of a single element.

/** How long an entry stays fully visible before it starts fading, ms. */
const ENTRY_LIFETIME_MS = 5000;
/** CSS transition duration for the fade-out, must match index.html's #killFeed .fading rule. */
const FADE_MS = 400;
/** Cap on simultaneously-shown entries, so a burst of kills can't grow the feed unboundedly even before the lifetime timer clears anything. */
const MAX_ENTRIES = 5;

/**
 * Shorten a server-issued player id (a random UUID, see server/src/index.ts
 * `randomUUID()`) to a short, readable label. Shared convention with
 * main.ts's own status readout (`playerId.slice(0, 8)`) and scoreboard.ts,
 * so the same player reads identically everywhere in the UI. Exported so
 * scoreboard.ts uses the exact same convention rather than a second one.
 */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

export class KillFeed {
  private containerEl: HTMLElement;

  /** `getSelfId` is a callback (not a snapshot) because this instance is constructed before the client knows its own id (welcome arrives asynchronously over the websocket) — see main.ts wiring. */
  constructor(private getSelfId: () => string | null) {
    this.containerEl = document.getElementById("killFeed") as HTMLElement;
  }

  /** Render one kill-feed line for a server-confirmed kill and schedule its own expiry. */
  addKill(attackerId: string, victimId: string, attackerNickname: string, victimNickname: string): void {
    const self = this.getSelfId();

    const entry = document.createElement("div");
    entry.className = "kill-feed-entry";
    if (attackerId === self || victimId === self) {
      entry.classList.add("involves-self");
    }

    // Built from separate text nodes/elements (never innerHTML) so this can
    // never be an injection vector even if a future EPIC adds player-chosen
    // display names in place of the id-derived label used here
    // (security-baseline.mdc: sanitize/escape user-generated content
    // rendered in the client).
    const attackerEl = document.createElement("span");
    attackerEl.className = "kill-feed-name";
    attackerEl.textContent = attackerId === self ? "You" : attackerNickname;

    const verbEl = document.createElement("span");
    verbEl.className = "kill-feed-verb";
    verbEl.textContent = " eliminated ";

    const victimEl = document.createElement("span");
    victimEl.className = "kill-feed-name";
    victimEl.textContent = victimId === self ? "you" : victimNickname;

    entry.append(attackerEl, verbEl, victimEl);
    this.containerEl.appendChild(entry);

    while (this.containerEl.childElementCount > MAX_ENTRIES) {
      this.containerEl.firstElementChild?.remove();
    }

    window.setTimeout(() => {
      entry.classList.add("fading");
      window.setTimeout(() => entry.remove(), FADE_MS);
    }, ENTRY_LIFETIME_MS);
  }
}
