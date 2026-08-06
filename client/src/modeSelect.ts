// Mode-select overlay (EPIC 9 "Bots & Match Modes" Story 9.2): a simple
// pre-game overlay (two buttons, plain HTML/CSS — no new UI framework, per
// the fixed stack's "no UI framework" rule) shown before pointer lock is
// even available. Picking a mode hides the overlay and hands control back to
// main.ts to send the `join` message and start the normal input loop —
// this module never talks to the network itself (keep transport concerns in
// network.ts / main.ts, per global-standards.mdc "keep game/simulation logic
// separate from transport/rendering code").

import {
  normalizeNickname,
  type EndlessLeaderboardEntry,
  type LeaderboardEntry,
  type LobbyMatchSummary,
  type MatchMode,
} from "@cubewars/shared";

export interface JoinSelection {
  mode: MatchMode;
  nickname: string;
  matchId?: string;
}

const NICKNAME_STORAGE_KEY = "cubewars.nickname";

export class ModeSelect {
  private overlayEl: HTMLElement;
  private publicBtn: HTMLButtonElement;
  private botsBtn: HTMLButtonElement;
  private endlessBtn: HTMLButtonElement;
  private nicknameInput: HTMLInputElement;
  private lobbyListEl: HTMLElement;
  private leaderboardListEl: HTMLElement;
  private endlessLeaderboardListEl: HTMLElement;
  private errorEl: HTMLElement;
  private pending = false;
  private enabled = false;

  /** `onSelect` fires exactly once, the first time either button is clicked. */
  constructor(private onSelect: (selection: JoinSelection) => void) {
    this.overlayEl = document.getElementById("modeSelect") as HTMLElement;
    this.publicBtn = document.getElementById("modePublicBtn") as HTMLButtonElement;
    this.botsBtn = document.getElementById("modeBotsBtn") as HTMLButtonElement;
    this.endlessBtn = document.getElementById("modeEndlessBtn") as HTMLButtonElement;
    this.nicknameInput = document.getElementById("nicknameInput") as HTMLInputElement;
    this.lobbyListEl = document.getElementById("lobbyList") as HTMLElement;
    this.leaderboardListEl = document.getElementById("leaderboardList") as HTMLElement;
    this.endlessLeaderboardListEl = document.getElementById("endlessLeaderboardList") as HTMLElement;
    this.errorEl = document.getElementById("modeSelectError") as HTMLElement;

    this.nicknameInput.value = localStorage.getItem(NICKNAME_STORAGE_KEY) ?? "";

    this.publicBtn.addEventListener("click", () => this.select("public"));
    this.botsBtn.addEventListener("click", () => this.select("bots"));
    this.endlessBtn.addEventListener("click", () => this.select("endless"));
    this.nicknameInput.addEventListener("input", () => {
      this.errorEl.textContent = "";
      this.updateButtons();
    });
  }

  /**
   * Enable the mode buttons — call only once the WS connection has actually
   * received `welcome`, so a click can never race ahead of
   * GameConnection.send()'s own "socket must be OPEN" guard (which would
   * otherwise silently drop an early `join` and leave the player stuck on
   * this screen with no error).
   */
  enable(): void {
    this.enabled = true;
    this.updateButtons();
  }

  setLobby(matches: LobbyMatchSummary[]): void {
    this.lobbyListEl.replaceChildren();
    if (matches.length === 0) {
      const empty = document.createElement("div");
      empty.className = "lobby-empty";
      empty.textContent = "No games yet";
      this.lobbyListEl.appendChild(empty);
      return;
    }

    for (const match of matches) {
      const row = document.createElement("div");
      row.className = "lobby-row";

      const label = document.createElement("span");
      label.className = "lobby-name";
      label.textContent = `${match.displayName} · ${match.players}/${match.maxPlayers}`;

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = match.players >= match.maxPlayers ? "Full" : "Join";
      button.disabled = this.pending || !this.enabled || match.players >= match.maxPlayers;
      button.addEventListener("click", () => this.select("public", match.id));

      row.append(label, button);
      this.lobbyListEl.appendChild(row);
    }
    this.updateButtons();
  }

  joinAccepted(nickname: string): void {
    localStorage.setItem(NICKNAME_STORAGE_KEY, nickname);
    this.pending = false;
    this.overlayEl.classList.add("hidden");
  }

  joinRejected(reason: string): void {
    this.pending = false;
    this.errorEl.textContent =
      reason === "nickname_taken"
        ? "This nickname is already used in that game"
        : reason === "match_full"
          ? "That game is full"
          : reason === "match_not_found"
            ? "That game is gone"
            : "Use 3-16 letters, numbers, spaces, _ or -";
    this.updateButtons();
  }

  setLeaderboard(entries: LeaderboardEntry[]): void {
    this.leaderboardListEl.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "leaderboard-empty";
      empty.textContent = "No scores yet";
      this.leaderboardListEl.appendChild(empty);
      return;
    }

    for (const [index, entry] of entries.entries()) {
      const row = document.createElement("div");
      row.className = "leaderboard-row";

      const rankEl = document.createElement("span");
      rankEl.className = "leaderboard-rank";
      rankEl.textContent = String(index + 1);

      const nameEl = document.createElement("span");
      nameEl.className = "leaderboard-name";
      nameEl.textContent = entry.nickname;

      const statsEl = document.createElement("span");
      statsEl.className = "leaderboard-stats";
      statsEl.textContent = `${entry.kills} K / ${entry.deaths} D`;

      row.append(rankEl, nameEl, statsEl);
      this.leaderboardListEl.appendChild(row);
    }
  }

  setEndlessLeaderboard(entries: EndlessLeaderboardEntry[]): void {
    this.endlessLeaderboardListEl.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "leaderboard-empty";
      empty.textContent = "No endless runs yet";
      this.endlessLeaderboardListEl.appendChild(empty);
      return;
    }

    for (const [index, entry] of entries.entries()) {
      const row = document.createElement("div");
      row.className = "leaderboard-row";

      const rankEl = document.createElement("span");
      rankEl.className = "leaderboard-rank";
      rankEl.textContent = String(index + 1);

      const nameEl = document.createElement("span");
      nameEl.className = "leaderboard-name";
      nameEl.textContent = entry.nickname;

      const statsEl = document.createElement("span");
      statsEl.className = "leaderboard-stats";
      statsEl.textContent = `${entry.botKills} bots / ${entry.distanceKm.toFixed(2)} km`;

      row.append(rankEl, nameEl, statsEl);
      this.endlessLeaderboardListEl.appendChild(row);
    }
  }

  private select(mode: MatchMode, matchId?: string): void {
    if (!this.enabled || this.pending) return;
    const normalized = normalizeNickname(this.nicknameInput.value);
    if (!normalized.ok) {
      this.errorEl.textContent = "Use 3-16 letters, numbers, spaces, _ or -";
      this.updateButtons();
      return;
    }
    this.pending = true;
    this.errorEl.textContent = "";
    this.updateButtons();
    this.onSelect({ mode, nickname: normalized.nickname, matchId });
  }

  private updateButtons(): void {
    const valid = normalizeNickname(this.nicknameInput.value).ok;
    const disabled = !this.enabled || this.pending || !valid;
    this.publicBtn.disabled = disabled;
    this.botsBtn.disabled = disabled;
    this.endlessBtn.disabled = disabled;
    for (const button of this.lobbyListEl.querySelectorAll("button")) {
      if (button.textContent !== "Full") {
        button.disabled = disabled;
      }
    }
  }
}
