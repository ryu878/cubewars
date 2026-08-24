// Minimal pets / eggs panel (EPIC 24). Plain HTML/CSS/TS — not the EPIC 27
// 8×8 inventory grid. All values come from server `economy_profile`; buttons
// only send intents (equip/unequip/hatch/stimulator). Toggle with P.

import type {
  ClientMessage,
  EconomyActionResultMessage,
  EconomyEggDto,
  EconomyPetDto,
  EconomyProfileMessage,
  ProfileRatings,
} from "@cubewars/shared";

type SendFn = (message: ClientMessage) => void;

function formatRemaining(deadlineMs: number, nowMs: number): string {
  const remaining = Math.max(0, deadlineMs - nowMs);
  if (remaining <= 0) return "Ready";
  const totalSec = Math.ceil(remaining / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export class PetsPanel {
  private panelEl: HTMLElement;
  private goldEl: HTMLElement;
  private ratingsEl: HTMLElement;
  private eggsEl: HTMLElement;
  private petsEl: HTMLElement;
  private statusEl: HTMLElement;
  private stimEl: HTMLElement;
  private open = false;
  private profile: EconomyProfileMessage | null = null;
  private timer: number | null = null;

  constructor(private send: SendFn) {
    this.panelEl = document.getElementById("petsPanel") as HTMLElement;
    this.goldEl = document.getElementById("petsGold") as HTMLElement;
    this.ratingsEl = document.getElementById("petsRatings") as HTMLElement;
    this.eggsEl = document.getElementById("petsEggsList") as HTMLElement;
    this.petsEl = document.getElementById("petsPetsList") as HTMLElement;
    this.statusEl = document.getElementById("petsStatus") as HTMLElement;
    this.stimEl = document.getElementById("petsStimCount") as HTMLElement;

    window.addEventListener("keydown", (event) => {
      if (event.code !== "KeyP" || event.repeat) return;
      // Allow toggle in lobby (no pointer lock) and in-match.
      event.preventDefault();
      this.setOpen(!this.open);
    });

    const closeBtn = document.getElementById("petsCloseBtn");
    closeBtn?.addEventListener("click", () => this.setOpen(false));
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.panelEl.classList.toggle("visible", open);
    this.panelEl.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
      this.render();
      if (this.timer === null) {
        this.timer = window.setInterval(() => this.renderEggsOnly(), 1000);
      }
    } else if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Replace local snapshot from server `economy_profile`. */
  setProfile(message: EconomyProfileMessage): void {
    this.profile = message;
    if (this.open) this.render();
  }

  setActionResult(message: EconomyActionResultMessage): void {
    if (message.ok) {
      this.statusEl.textContent = `${message.action}: ok`;
    } else {
      this.statusEl.textContent = `${message.action} failed: ${message.code ?? "error"}`;
    }
  }

  private render(): void {
    if (!this.profile) {
      this.goldEl.textContent = "—";
      this.stimEl.textContent = "0";
      this.ratingsEl.textContent = "Join a match to load pets.";
      this.eggsEl.replaceChildren();
      this.petsEl.replaceChildren();
      return;
    }
    this.goldEl.textContent = String(this.profile.gold);
    this.stimEl.textContent = String(this.profile.stimulatorCount);
    this.renderRatings(this.profile.ratings);
    this.renderEggs(this.profile.eggs, this.profile.stimulatorCount);
    this.renderPets(this.profile.pets);
  }

  private renderEggsOnly(): void {
    if (!this.profile || !this.open) return;
    this.renderEggs(this.profile.eggs, this.profile.stimulatorCount);
  }

  private renderRatings(ratings: ProfileRatings): void {
    this.ratingsEl.textContent =
      `HP ${ratings.healthRating} · DR ${ratings.armorRating} · ` +
      `SPD ${ratings.speedRating} · DMG ${ratings.damageRating}` +
      (this.profile?.slot2Enabled ? "" : " · slot2 off");
  }

  private renderEggs(eggs: EconomyEggDto[], stimCount: number): void {
    this.eggsEl.replaceChildren();
    const now = Date.now();
    if (eggs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "pets-empty";
      empty.textContent = "No eggs";
      this.eggsEl.appendChild(empty);
      return;
    }
    for (const egg of eggs) {
      const row = document.createElement("div");
      row.className = "pets-row";

      const label = document.createElement("span");
      label.className = "pets-row-label";
      const ready = egg.hatchDeadlineMs <= now;
      label.textContent = `Egg #${egg.id} — ${formatRemaining(egg.hatchDeadlineMs, now)}`;

      const actions = document.createElement("span");
      actions.className = "pets-row-actions";

      const hatchBtn = document.createElement("button");
      hatchBtn.type = "button";
      hatchBtn.textContent = "Hatch";
      hatchBtn.disabled = !ready;
      hatchBtn.addEventListener("click", () => {
        this.send({ type: "economy_hatch_egg", eggId: egg.id });
      });

      const stimBtn = document.createElement("button");
      stimBtn.type = "button";
      stimBtn.textContent = "Stim";
      stimBtn.disabled = stimCount <= 0 || ready;
      stimBtn.title = ready ? "Egg already ready" : "Apply growth stimulator";
      stimBtn.addEventListener("click", () => {
        this.send({ type: "economy_apply_stimulator", eggId: egg.id });
      });

      actions.append(hatchBtn, stimBtn);
      row.append(label, actions);
      this.eggsEl.appendChild(row);
    }
  }

  private renderPets(pets: EconomyPetDto[]): void {
    this.petsEl.replaceChildren();
    if (pets.length === 0) {
      const empty = document.createElement("div");
      empty.className = "pets-empty";
      empty.textContent = "No pets";
      this.petsEl.appendChild(empty);
      return;
    }
    for (const pet of pets) {
      const row = document.createElement("div");
      row.className = "pets-row";
      if (pet.equipSlot === 1) row.classList.add("equipped");

      const label = document.createElement("span");
      label.className = "pets-row-label";
      label.textContent =
        `${pet.type} #${pet.id} · value ${pet.baseValue}` +
        (pet.equipSlot === 1 ? " · equipped" : "");

      const actions = document.createElement("span");
      actions.className = "pets-row-actions";

      if (pet.equipSlot === 1) {
        const unequipBtn = document.createElement("button");
        unequipBtn.type = "button";
        unequipBtn.textContent = "Unequip";
        unequipBtn.addEventListener("click", () => {
          this.send({ type: "economy_unequip_pet", petId: pet.id });
        });
        actions.appendChild(unequipBtn);
      } else {
        const equipBtn = document.createElement("button");
        equipBtn.type = "button";
        equipBtn.textContent = "Equip";
        equipBtn.addEventListener("click", () => {
          this.send({ type: "economy_equip_pet", petId: pet.id, slot: 1 });
        });
        actions.appendChild(equipBtn);
      }

      row.append(label, actions);
      this.petsEl.appendChild(row);
    }
  }
}
