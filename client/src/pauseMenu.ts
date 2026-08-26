// EPIC 47 in-match ESC pause menu — plain HTML/CSS/TS overlay.
// Owns open/close + pointer-lock exit; main.ts wires actions (leave / change map /
// inventory / auction). Resume closes the menu; click-to-play restores lock.

import { listMaps, type MapId, type MatchMode } from "@cubewars/shared";
import { isEditableTarget } from "./uiInput";

export type PauseMenuAction =
  | { type: "resume" }
  | { type: "exit_lobby" }
  | { type: "change_map"; mapId: MapId }
  | { type: "reload_endless" }
  | { type: "inventory" }
  | { type: "auction" };

type ActionHandler = (action: PauseMenuAction) => void;

export class PauseMenu {
  private overlayEl: HTMLElement;
  private mapPanelEl: HTMLElement;
  private mapSelectEl: HTMLSelectElement;
  private statusEl: HTMLElement;
  private changeMapBtn: HTMLButtonElement;
  private open = false;
  private mapPanelOpen = false;
  private inMatch = false;
  private mode: MatchMode | null = null;
  private mapId: MapId | null = null;

  constructor(private onAction: ActionHandler) {
    this.overlayEl = document.getElementById("pauseMenu") as HTMLElement;
    this.mapPanelEl = document.getElementById("pauseMapPanel") as HTMLElement;
    this.mapSelectEl = document.getElementById("pauseMapSelect") as HTMLSelectElement;
    this.statusEl = document.getElementById("pauseMenuStatus") as HTMLElement;
    this.changeMapBtn = document.getElementById("pauseChangeMapBtn") as HTMLButtonElement;

    this.populateMapSelect();

    document.getElementById("pauseResumeBtn")?.addEventListener("click", () => {
      this.onAction({ type: "resume" });
    });
    document.getElementById("pauseExitLobbyBtn")?.addEventListener("click", () => {
      this.onAction({ type: "exit_lobby" });
    });
    this.changeMapBtn.addEventListener("click", () => this.toggleMapPanel());
    document.getElementById("pauseMapConfirmBtn")?.addEventListener("click", () => {
      if (this.mode === "endless") {
        this.onAction({ type: "reload_endless" });
        return;
      }
      const mapId = this.mapSelectEl.value as MapId;
      this.onAction({ type: "change_map", mapId });
    });
    document.getElementById("pauseInventoryBtn")?.addEventListener("click", () => {
      this.onAction({ type: "inventory" });
    });
    document.getElementById("pauseAuctionBtn")?.addEventListener("click", () => {
      this.onAction({ type: "auction" });
    });

    window.addEventListener("keydown", (event) => {
      if (event.code !== "Escape" || event.repeat) return;
      if (isEditableTarget(event.target)) return;
      if (!this.inMatch) return;
      // Inventory/auction overlays own their own Esc behavior via close buttons;
      // if they are open, let them take Esc first by checking visibility.
      if (this.isBlockingOverlayOpen()) return;
      event.preventDefault();
      if (this.mapPanelOpen) {
        this.setMapPanelOpen(false);
        return;
      }
      if (this.open) {
        this.setOpen(false);
      } else {
        this.setOpen(true);
      }
    });
  }

  setMatchContext(mode: MatchMode | null, mapId: MapId | null): void {
    this.mode = mode;
    this.mapId = mapId;
    this.inMatch = mode !== null;
    this.updateLabels();
    if (!this.inMatch) {
      this.setOpen(false);
      this.setMapPanelOpen(false);
    }
  }

  isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.overlayEl.classList.toggle("visible", open);
    this.overlayEl.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      if (document.pointerLockElement) document.exitPointerLock();
      this.updateLabels();
      this.setMapPanelOpen(false);
    } else {
      this.setMapPanelOpen(false);
    }
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  private isBlockingOverlayOpen(): boolean {
    const inv = document.getElementById("inventoryOverlay");
    const auction = document.getElementById("auctionOverlay");
    const trade = document.getElementById("tradeOverlay");
    return (
      !!inv?.classList.contains("visible") ||
      !!auction?.classList.contains("visible") ||
      !!trade?.classList.contains("visible")
    );
  }

  private populateMapSelect(): void {
    this.mapSelectEl.replaceChildren();
    for (const map of listMaps()) {
      const option = document.createElement("option");
      option.value = map.id;
      option.textContent = map.displayNameRu
        ? `${map.displayName} / ${map.displayNameRu}`
        : map.displayName;
      this.mapSelectEl.appendChild(option);
    }
  }

  private toggleMapPanel(): void {
    this.setMapPanelOpen(!this.mapPanelOpen);
  }

  private setMapPanelOpen(open: boolean): void {
    this.mapPanelOpen = open;
    this.mapPanelEl.classList.toggle("visible", open);
    this.mapPanelEl.setAttribute("aria-hidden", open ? "false" : "true");
    if (open && this.mapId) {
      this.mapSelectEl.value = this.mapId;
    }
  }

  private updateLabels(): void {
    const mapLabel = this.mapId
      ? listMaps().find((m) => m.id === this.mapId)?.displayName ?? this.mapId
      : this.mode === "endless"
        ? "Endless"
        : "—";
    const modeLabel =
      this.mode === "public" ? "Deathmatch" : this.mode === "bots" ? "Bots" : this.mode === "endless" ? "Endless" : "—";
    this.statusEl.textContent = `${modeLabel} · ${mapLabel}`;

    if (this.mode === "endless") {
      this.changeMapBtn.textContent = "Reload Endless";
      this.mapSelectEl.disabled = true;
      this.mapPanelEl.querySelector(".pause-map-hint")!.textContent =
        "Endless has no catalog map picker — confirm to leave and start a new endless run.";
    } else {
      this.changeMapBtn.textContent = "Change Map / Reload";
      this.mapSelectEl.disabled = false;
      this.mapPanelEl.querySelector(".pause-map-hint")!.textContent =
        "Pick a map, then confirm to leave this match and start a new one.";
    }
  }
}
