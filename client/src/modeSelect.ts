// Mode-select overlay (EPIC 9 "Bots & Match Modes" Story 9.2): a simple
// pre-game overlay (two buttons, plain HTML/CSS — no new UI framework, per
// the fixed stack's "no UI framework" rule) shown before pointer lock is
// even available. Picking a mode hides the overlay and hands control back to
// main.ts to send the `join` message and start the normal input loop —
// this module never talks to the network itself (keep transport concerns in
// network.ts / main.ts, per global-standards.mdc "keep game/simulation logic
// separate from transport/rendering code").
//
// EPIC 46: map picker for public + bots; lobby rows show map name.

import {
  DEFAULT_MAP_ID,
  listMaps,
  normalizeNickname,
  type EconomyPool,
  type EndlessLeaderboardEntry,
  type LeaderboardEntry,
  type LobbyMatchSummary,
  type MapId,
  type MatchMode,
} from "@cubewars/shared";

export interface JoinSelection {
  mode: MatchMode;
  nickname: string;
  matchId?: string;
  mapId?: MapId;
}

const NICKNAME_STORAGE_KEY = "cubewars.nickname";
const MAP_STORAGE_KEY = "cubewars.mapId";

export class ModeSelect {
  private overlayEl: HTMLElement;
  private publicBtn: HTMLButtonElement;
  private botsBtn: HTMLButtonElement;
  private endlessBtn: HTMLButtonElement;
  private deathmatchInventoryBtn: HTMLButtonElement;
  private botsInventoryBtn: HTMLButtonElement;
  private auctionBtn: HTMLButtonElement;
  private nicknameInput: HTMLInputElement;
  private mapSelect: HTMLSelectElement;
  private lobbyListEl: HTMLElement;
  private leaderboardListEl: HTMLElement;
  private endlessLeaderboardListEl: HTMLElement;
  private errorEl: HTMLElement;
  private goldValueEl: HTMLElement;
  private pending = false;
  private enabled = false;

  /**
   * `onSelect` fires when a mode join button is clicked.
   * `onInventory` fires when a lobby inventory button is clicked with a valid
   * nickname (EPIC 42/45) — main.ts binds nickname + pool and opens overlay.
   * `onAuction` fires when the lobby Auction button is clicked (EPIC 45).
   */
  constructor(
    private onSelect: (selection: JoinSelection) => void,
    private onInventory: (pool: EconomyPool) => void = () => undefined,
    private onAuction: () => void = () => undefined,
  ) {
    this.overlayEl = document.getElementById("modeSelect") as HTMLElement;
    this.publicBtn = document.getElementById("modePublicBtn") as HTMLButtonElement;
    this.botsBtn = document.getElementById("modeBotsBtn") as HTMLButtonElement;
    this.endlessBtn = document.getElementById("modeEndlessBtn") as HTMLButtonElement;
    this.deathmatchInventoryBtn = document.getElementById(
      "lobbyDeathmatchInventoryBtn",
    ) as HTMLButtonElement;
    this.botsInventoryBtn = document.getElementById("lobbyBotsInventoryBtn") as HTMLButtonElement;
    this.auctionBtn = document.getElementById("lobbyAuctionBtn") as HTMLButtonElement;
    this.nicknameInput = document.getElementById("nicknameInput") as HTMLInputElement;
    this.mapSelect = document.getElementById("mapSelect") as HTMLSelectElement;
    this.lobbyListEl = document.getElementById("lobbyList") as HTMLElement;
    this.leaderboardListEl = document.getElementById("leaderboardList") as HTMLElement;
    this.endlessLeaderboardListEl = document.getElementById("endlessLeaderboardList") as HTMLElement;
    this.errorEl = document.getElementById("modeSelectError") as HTMLElement;
    this.goldValueEl = document.getElementById("lobbyGoldValue") as HTMLElement;

    this.nicknameInput.value = localStorage.getItem(NICKNAME_STORAGE_KEY) ?? "";
    this.populateMapSelect();

    this.publicBtn.addEventListener("click", () => this.select("public"));
    this.botsBtn.addEventListener("click", () => this.select("bots"));
    this.endlessBtn.addEventListener("click", () => this.select("endless"));
    this.deathmatchInventoryBtn.addEventListener("click", () =>
      this.requestInventory("deathmatch"),
    );
    this.botsInventoryBtn.addEventListener("click", () => this.requestInventory("sandbox"));
    this.auctionBtn.addEventListener("click", () => this.requestAuction());
    this.nicknameInput.addEventListener("input", () => {
      this.errorEl.textContent = "";
      this.updateButtons();
    });
    this.mapSelect.addEventListener("change", () => {
      localStorage.setItem(MAP_STORAGE_KEY, this.mapSelect.value);
    });
  }

  private populateMapSelect(): void {
    this.mapSelect.replaceChildren();
    const saved = localStorage.getItem(MAP_STORAGE_KEY) ?? DEFAULT_MAP_ID;
    for (const map of listMaps()) {
      const option = document.createElement("option");
      option.value = map.id;
      option.textContent = map.displayNameRu
        ? `${map.displayName} / ${map.displayNameRu}`
        : map.displayName;
      if (map.id === saved) option.selected = true;
      this.mapSelect.appendChild(option);
    }
    if (!this.mapSelect.value) this.mapSelect.value = DEFAULT_MAP_ID;
  }

  private selectedMapId(): MapId {
    const value = this.mapSelect.value;
    return (listMaps().some((map) => map.id === value) ? value : DEFAULT_MAP_ID) as MapId;
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

  /** Normalized nickname when valid; empty string otherwise (EPIC 42). */
  getNickname(): string {
    const normalized = normalizeNickname(this.nicknameInput.value);
    return normalized.ok ? normalized.nickname : "";
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
      const mapLabel = match.mapDisplayName ?? match.mapId ?? "Base";
      label.textContent = `${match.displayName} · ${mapLabel} · ${match.players}/${match.maxPlayers}`;

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

  /** EPIC 47: show mode-select again after leave_match (socket stays connected). */
  showLobby(): void {
    this.pending = false;
    this.errorEl.textContent = "";
    this.overlayEl.classList.remove("hidden");
    this.updateButtons();
  }

  /** Selected catalog map (for pause-menu change-map / rejoin). */
  getSelectedMapId(): MapId {
    return this.selectedMapId();
  }

  setSelectedMapId(mapId: MapId): void {
    if (listMaps().some((map) => map.id === mapId)) {
      this.mapSelect.value = mapId;
      localStorage.setItem(MAP_STORAGE_KEY, mapId);
    }
  }

  /** Server-authored gold (EPIC 23) — display only, never computed client-side. */
  setGold(gold: number): void {
    this.goldValueEl.textContent = String(Math.max(0, Math.round(gold)));
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
            : reason === "map_invalid"
              ? "That map is not available"
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

  /** EPIC 42/45: open lobby inventory for the chosen pool after nickname / auth checks. */
  private requestInventory(pool: EconomyPool): void {
    if (!this.enabled) {
      this.errorEl.textContent = "Sign in first to open inventory";
      return;
    }
    const normalized = normalizeNickname(this.nicknameInput.value);
    if (!normalized.ok) {
      this.errorEl.textContent = "Enter a valid nickname to load inventory";
      return;
    }
    this.errorEl.textContent = "";
    localStorage.setItem(NICKNAME_STORAGE_KEY, normalized.nickname);
    this.onInventory(pool);
  }

  /** EPIC 45: open Deathmatch auction from lobby after nickname / auth checks. */
  private requestAuction(): void {
    if (!this.enabled) {
      this.errorEl.textContent = "Sign in first to open auction";
      return;
    }
    const normalized = normalizeNickname(this.nicknameInput.value);
    if (!normalized.ok) {
      this.errorEl.textContent = "Enter a valid nickname to open auction";
      return;
    }
    this.errorEl.textContent = "";
    localStorage.setItem(NICKNAME_STORAGE_KEY, normalized.nickname);
    this.onAuction();
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
    // EPIC 47: always include an explicit catalog mapId for public + bots so
    // the server never silently falls back to Base because of an empty select.
    const mapId = mode === "endless" ? undefined : this.selectedMapId();
    if (mode !== "endless") {
      localStorage.setItem(MAP_STORAGE_KEY, mapId!);
    }
    this.onSelect({ mode, nickname: normalized.nickname, matchId, mapId });
  }

  private updateButtons(): void {
    const valid = normalizeNickname(this.nicknameInput.value).ok;
    const disabled = !this.enabled || this.pending || !valid;
    this.publicBtn.disabled = disabled;
    this.botsBtn.disabled = disabled;
    this.endlessBtn.disabled = disabled;
    // Lobby economy buttons stay clickable after auth so invalid nickname can show a clear error.
    const lobbyDisabled = !this.enabled || this.pending;
    this.deathmatchInventoryBtn.disabled = lobbyDisabled;
    this.botsInventoryBtn.disabled = lobbyDisabled;
    this.auctionBtn.disabled = lobbyDisabled;
    this.mapSelect.disabled = lobbyDisabled;
    for (const button of this.lobbyListEl.querySelectorAll("button")) {
      if (button.textContent !== "Full") {
        button.disabled = disabled;
      }
    }
  }
}
