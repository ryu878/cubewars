// Ground drop HUD (EPIC 38). Lists nearby server ground items; F to pick up nearest.

import type {
  ClientMessage,
  EconomyGroundItemDto,
  EconomyGroundStateMessage,
  Vector3,
} from "@cubewars/shared";
import { shouldIgnoreGameHotkey } from "./uiInput";
import { t } from "./i18n";

type SendFn = (message: ClientMessage) => void;

const PICKUP_RANGE = 3;

export class GroundHud {
  private el: HTMLElement;
  private items: EconomyGroundItemDto[] = [];
  private selfPos: Vector3 | null = null;

  constructor(private send: SendFn) {
    this.ensureDom();
    this.el = document.getElementById("groundHud") as HTMLElement;
    window.addEventListener("keydown", (event) => {
      if (event.code !== "KeyF" || event.repeat) return;
      if (shouldIgnoreGameHotkey(event)) return;
      const nearest = this.nearest();
      if (!nearest) return;
      event.preventDefault();
      this.send({ type: "economy_pickup_ground", groundId: nearest.groundId });
    });
  }

  setGroundState(message: EconomyGroundStateMessage): void {
    this.items = message.items;
    this.render();
  }

  setSelfPosition(pos: Vector3 | null): void {
    this.selfPos = pos;
    this.render();
  }

  private nearest(): EconomyGroundItemDto | null {
    if (!this.selfPos || this.items.length === 0) return null;
    let best: EconomyGroundItemDto | null = null;
    let bestDist = Infinity;
    for (const item of this.items) {
      const dx = item.position.x - this.selfPos.x;
      const dy = item.position.y - this.selfPos.y;
      const dz = item.position.z - this.selfPos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < bestDist && d <= PICKUP_RANGE) {
        bestDist = d;
        best = item;
      }
    }
    return best;
  }

  private render(): void {
    if (this.items.length === 0) {
      this.el.textContent = "";
      this.el.classList.remove("visible");
      return;
    }
    this.el.classList.add("visible");
    const nearest = this.nearest();
    const lines = this.items.map((item) => {
      const label = `${item.item.itemType} ${item.item.label ?? ""}`.trim();
      const ttl = Math.max(0, Math.ceil((item.expiresAtMs - Date.now()) / 1000));
      const mark = nearest && nearest.groundId === item.groundId ? " ← F" : "";
      return `${label} (${ttl}s)${mark}`;
    });
    this.el.textContent = t("hud.ground", { items: lines.join(" · ") });
  }

  private ensureDom(): void {
    if (document.getElementById("groundHud")) return;
    const el = document.createElement("div");
    el.id = "groundHud";
    document.body.appendChild(el);
  }
}
