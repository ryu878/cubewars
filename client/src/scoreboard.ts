// Scoreboard UI (EPIC 5 Story 5.2): a live-updating list of connected
// players and their kill counts, entirely driven by the server's
// ScoreboardMessage broadcasts (join/leave/kill) — the client never
// computes or guesses a kill count itself, only renders what the server
// already decided (security-baseline.mdc). Toggle-visible while holding Tab
// (a common FPS convention) so it doesn't permanently occupy screen space;
// the underlying data still updates live even while hidden, so opening it
// always shows the current state immediately. Plain DOM/CSS per the fixed
// stack's "no UI framework" rule.

import type { PlayerScore } from "@cubewars/shared";
import { shortId } from "./killFeed";

export class Scoreboard {
  private panelEl: HTMLElement;
  private listEl: HTMLElement;

  /** `getSelfId` is a callback for the same reason as KillFeed's — this is constructed before the async "welcome" message resolves this client's own id. */
  constructor(private getSelfId: () => string | null) {
    this.panelEl = document.getElementById("scoreboard") as HTMLElement;
    this.listEl = document.getElementById("scoreboardList") as HTMLElement;

    window.addEventListener("keydown", (event) => {
      if (event.code !== "Tab") return;
      event.preventDefault(); // don't let Tab shift page focus while pointer-locked/playing
      this.panelEl.classList.add("visible");
    });
    window.addEventListener("keyup", (event) => {
      if (event.code === "Tab") this.panelEl.classList.remove("visible");
    });
    // Avoid a "stuck open" panel if the window loses focus while Tab is held
    // (same defensive pattern fpsController.ts uses for stuck movement keys).
    window.addEventListener("blur", () => this.panelEl.classList.remove("visible"));
  }

  /** Replace the rendered list with the server's latest full scoreboard snapshot (never a delta — see ScoreboardMessage doc comment). */
  update(players: PlayerScore[]): void {
    this.listEl.replaceChildren();
    const self = this.getSelfId();

    for (const player of players) {
      const row = document.createElement("div");
      row.className = "scoreboard-row";
      if (player.id === self) row.classList.add("self");

      const nameEl = document.createElement("span");
      nameEl.className = "scoreboard-name";
      nameEl.textContent = player.id === self ? `${shortId(player.id)} (you)` : shortId(player.id);

      const killsEl = document.createElement("span");
      killsEl.className = "scoreboard-kills";
      killsEl.textContent = String(player.kills);

      row.append(nameEl, killsEl);
      this.listEl.appendChild(row);
    }
  }
}
