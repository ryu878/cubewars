// Minimal pets / eggs / gems / amulets panel (EPIC 24–25). Plain HTML/CSS/TS —
// not the EPIC 27 8×8 inventory grid. All values come from server
// `economy_profile`; buttons only send intents. Toggle with P.

import type {
  ClientMessage,
  EconomyActionResultMessage,
  EconomyAmuletDto,
  EconomyEggDto,
  EconomyGemDto,
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
  private gemsEl: HTMLElement;
  private amuletsEl: HTMLElement;
  private statusEl: HTMLElement;
  private stimEl: HTMLElement;
  private shardsEl: HTMLElement;
  private kitsEl: HTMLElement;
  private open = false;
  private profile: EconomyProfileMessage | null = null;
  private timer: number | null = null;
  /** Gem currently selected for socketing onto a pet. */
  private selectedGemId: number | null = null;

  constructor(private send: SendFn) {
    this.panelEl = document.getElementById("petsPanel") as HTMLElement;
    this.goldEl = document.getElementById("petsGold") as HTMLElement;
    this.ratingsEl = document.getElementById("petsRatings") as HTMLElement;
    this.eggsEl = document.getElementById("petsEggsList") as HTMLElement;
    this.petsEl = document.getElementById("petsPetsList") as HTMLElement;
    this.gemsEl = document.getElementById("petsGemsList") as HTMLElement;
    this.amuletsEl = document.getElementById("petsAmuletsList") as HTMLElement;
    this.statusEl = document.getElementById("petsStatus") as HTMLElement;
    this.stimEl = document.getElementById("petsStimCount") as HTMLElement;
    this.shardsEl = document.getElementById("petsShardCount") as HTMLElement;
    this.kitsEl = document.getElementById("petsKitCount") as HTMLElement;

    window.addEventListener("keydown", (event) => {
      if (event.code !== "KeyP" || event.repeat) return;
      event.preventDefault();
      this.setOpen(!this.open);
    });

    const closeBtn = document.getElementById("petsCloseBtn");
    closeBtn?.addEventListener("click", () => this.setOpen(false));

    const craftBtn = document.getElementById("petsCraftAmuletBtn");
    craftBtn?.addEventListener("click", () => {
      this.send({ type: "economy_craft_amulet" });
    });
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
      this.shardsEl.textContent = "0";
      this.kitsEl.textContent = "0";
      this.ratingsEl.textContent = "Join a match to load pets.";
      this.eggsEl.replaceChildren();
      this.petsEl.replaceChildren();
      this.gemsEl.replaceChildren();
      this.amuletsEl.replaceChildren();
      return;
    }
    this.goldEl.textContent = String(this.profile.gold);
    this.stimEl.textContent = String(this.profile.stimulatorCount);
    this.shardsEl.textContent = String(this.profile.shardCount);
    this.kitsEl.textContent = String(this.profile.repairKitCount);
    this.renderRatings(this.profile.ratings);
    this.renderEggs(this.profile.eggs, this.profile.stimulatorCount);
    this.renderPets(this.profile.pets, this.profile.slot2Enabled);
    this.renderGems(this.profile.gems);
    this.renderAmulets(this.profile.amulets, this.profile.repairKitCount, this.profile.shardCount);

    const craftBtn = document.getElementById("petsCraftAmuletBtn") as HTMLButtonElement | null;
    if (craftBtn) {
      craftBtn.disabled = this.profile.shardCount < 10 || this.profile.amulets.length >= 4;
    }
  }

  private renderEggsOnly(): void {
    if (!this.profile || !this.open) return;
    this.renderEggs(this.profile.eggs, this.profile.stimulatorCount);
  }

  private renderRatings(ratings: ProfileRatings): void {
    this.ratingsEl.textContent =
      `HP ${ratings.healthRating} · DR ${ratings.armorRating} · ` +
      `SPD ${ratings.speedRating} · DMG ${ratings.damageRating}` +
      (this.profile?.slot2Enabled ? " · slot2 on" : " · slot2 off");
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

  private renderPets(pets: EconomyPetDto[], slot2Enabled: boolean): void {
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
      if (pet.equipSlot === 1 || pet.equipSlot === 2) row.classList.add("equipped");

      const label = document.createElement("span");
      label.className = "pets-row-label";
      const slotLabel =
        pet.equipSlot === 1 ? " · slot1" : pet.equipSlot === 2 ? " · slot2" : "";
      label.textContent = `${pet.type} #${pet.id} · value ${pet.baseValue}${slotLabel}`;

      const actions = document.createElement("span");
      actions.className = "pets-row-actions";

      if (pet.equipSlot === 1 || pet.equipSlot === 2) {
        const unequipBtn = document.createElement("button");
        unequipBtn.type = "button";
        unequipBtn.textContent = "Unequip";
        unequipBtn.addEventListener("click", () => {
          this.send({ type: "economy_unequip_pet", petId: pet.id });
        });
        actions.appendChild(unequipBtn);
      } else {
        const equip1 = document.createElement("button");
        equip1.type = "button";
        equip1.textContent = "Slot1";
        equip1.addEventListener("click", () => {
          this.send({ type: "economy_equip_pet", petId: pet.id, slot: 1 });
        });
        actions.appendChild(equip1);

        if (slot2Enabled) {
          const equip2 = document.createElement("button");
          equip2.type = "button";
          equip2.textContent = "Slot2";
          equip2.addEventListener("click", () => {
            this.send({ type: "economy_equip_pet", petId: pet.id, slot: 2 });
          });
          actions.appendChild(equip2);
        }
      }

      if (this.selectedGemId !== null) {
        const socketBtn = document.createElement("button");
        socketBtn.type = "button";
        socketBtn.textContent = "Socket gem";
        socketBtn.addEventListener("click", () => {
          if (this.selectedGemId === null) return;
          this.send({
            type: "economy_socket_gem",
            gemId: this.selectedGemId,
            petId: pet.id,
          });
          this.selectedGemId = null;
        });
        actions.appendChild(socketBtn);
      }

      row.append(label, actions);
      this.petsEl.appendChild(row);
    }
  }

  private renderGems(gems: EconomyGemDto[]): void {
    this.gemsEl.replaceChildren();
    if (gems.length === 0) {
      const empty = document.createElement("div");
      empty.className = "pets-empty";
      empty.textContent = "No gems";
      this.gemsEl.appendChild(empty);
      return;
    }
    for (const gem of gems) {
      const row = document.createElement("div");
      row.className = "pets-row";
      if (this.selectedGemId === gem.id) row.classList.add("equipped");

      const label = document.createElement("span");
      label.className = "pets-row-label";
      label.textContent =
        `${gem.gemType} #${gem.id} · ${gem.value}` +
        (gem.petId !== null ? ` · on pet #${gem.petId}` : " · bag");

      const actions = document.createElement("span");
      actions.className = "pets-row-actions";

      if (gem.petId !== null) {
        const unsocket = document.createElement("button");
        unsocket.type = "button";
        unsocket.textContent = "Unsocket";
        unsocket.addEventListener("click", () => {
          this.send({ type: "economy_unsocket_gem", gemId: gem.id });
        });
        actions.appendChild(unsocket);
      } else {
        const select = document.createElement("button");
        select.type = "button";
        select.textContent = this.selectedGemId === gem.id ? "Selected" : "Select";
        select.addEventListener("click", () => {
          this.selectedGemId = this.selectedGemId === gem.id ? null : gem.id;
          if (this.profile) this.render();
        });
        actions.appendChild(select);
      }

      row.append(label, actions);
      this.gemsEl.appendChild(row);
    }
  }

  private renderAmulets(
    amulets: EconomyAmuletDto[],
    kitCount: number,
    _shardCount: number,
  ): void {
    this.amuletsEl.replaceChildren();
    if (amulets.length === 0) {
      const empty = document.createElement("div");
      empty.className = "pets-empty";
      empty.textContent = "No amulets";
      this.amuletsEl.appendChild(empty);
      return;
    }
    for (const amulet of amulets) {
      const row = document.createElement("div");
      row.className = "pets-row";
      if (amulet.equipped) row.classList.add("equipped");

      const label = document.createElement("span");
      label.className = "pets-row-label";
      label.textContent =
        `Amulet #${amulet.id} · dur ${amulet.durability}/10` +
        (amulet.equipped ? " · equipped" : "");

      const actions = document.createElement("span");
      actions.className = "pets-row-actions";

      if (amulet.equipped) {
        const unequip = document.createElement("button");
        unequip.type = "button";
        unequip.textContent = "Unequip";
        unequip.addEventListener("click", () => {
          this.send({ type: "economy_unequip_amulet", amuletId: amulet.id });
        });
        actions.appendChild(unequip);
      } else {
        const equip = document.createElement("button");
        equip.type = "button";
        equip.textContent = "Equip";
        equip.addEventListener("click", () => {
          this.send({ type: "economy_equip_amulet", amuletId: amulet.id });
        });
        actions.appendChild(equip);
      }

      const repair = document.createElement("button");
      repair.type = "button";
      repair.textContent = "Repair";
      repair.disabled = kitCount <= 0 || amulet.durability >= 10;
      repair.addEventListener("click", () => {
        this.send({ type: "economy_repair_amulet", amuletId: amulet.id });
      });
      actions.appendChild(repair);

      row.append(label, actions);
      this.amuletsEl.appendChild(row);
    }
  }
}
