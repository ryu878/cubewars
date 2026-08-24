// 8x8 inventory grid overlay (EPIC 29). Plain HTML/CSS/TS — replaces the old
// list-only PetsPanel (client/src/petsPanel.ts, retired). Toggle with I (P
// stays as an alias — some players are used to it, see EPIC 29 spec §2.3).
//
// Server-authority discipline (security-baseline.mdc): this module only ever
// SENDS intents (economy_move_item / economy_discard_item / the existing
// hatch/stim/equip/socket/repair/craft messages) and RENDERS whatever the
// server's most recent `economy_profile` / `economy_action_result` says.
// Dragging an item never mutates the local profile snapshot — the item stays
// at its last server-confirmed anchor (shown with a "pending" visual) until
// the next `economy_profile` echo (success) or `economy_action_result`
// (failure) arrives, so a rejected move can never be silently believed by
// the UI.

import type {
  ClientMessage,
  EconomyActionResultMessage,
  EconomyAmuletDto,
  EconomyEggDto,
  EconomyGemDto,
  EconomyPetDto,
  EconomyProfileMessage,
  InventoryFootprint,
  InventoryItemType,
} from "@cubewars/shared";
import { ECONOMY_CAPS, INVENTORY_GRID } from "@cubewars/shared";

type SendFn = (message: ClientMessage) => void;

interface BagEntry {
  itemType: InventoryItemType;
  itemId: number;
  anchor: number;
  footprint: InventoryFootprint;
}

interface SelectedItem {
  itemType: InventoryItemType;
  itemId: number;
}

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

const ITEM_LABEL: Record<InventoryItemType, string> = {
  pet: "PET",
  egg: "EGG",
  gem: "GEM",
  amulet: "AMU",
  stimulator: "STM",
  repair_kit: "KIT",
  shard_stack: "SHD",
};

export class InventoryOverlay {
  private overlayEl: HTMLElement;
  private gridEl: HTMLElement;
  private goldEl: HTMLElement;
  private ratingsEl: HTMLElement;
  private capsEl: HTMLElement;
  private railEl: HTMLElement;
  private detailsEl: HTMLElement;
  private statusEl: HTMLElement;

  private open = false;
  private profile: EconomyProfileMessage | null = null;
  private timer: number | null = null;

  private selected: SelectedItem | null = null;
  /** Gem awaiting a target pet for socketing (mirrors old PetsPanel UX). */
  private selectedGemId: number | null = null;
  /** Item currently in-flight from a drag-move, cleared on next profile/result. */
  private pending: SelectedItem | null = null;
  /** Pending discard requiring a second confirming click. */
  private discardArm: SelectedItem | null = null;

  private dragState: {
    itemType: InventoryItemType;
    itemId: number;
    footprint: InventoryFootprint;
    ghost: HTMLElement | null;
    pointerId: number;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null = null;

  /** Below this pointer travel distance (px), a press+release is a click, not a drag. */
  private static readonly CLICK_DISTANCE_PX = 6;

  constructor(private send: SendFn) {
    this.overlayEl = document.getElementById("inventoryOverlay") as HTMLElement;
    this.gridEl = document.getElementById("inventoryGrid") as HTMLElement;
    this.goldEl = document.getElementById("inventoryGold") as HTMLElement;
    this.ratingsEl = document.getElementById("inventoryRatings") as HTMLElement;
    this.capsEl = document.getElementById("inventoryCaps") as HTMLElement;
    this.railEl = document.getElementById("inventoryRail") as HTMLElement;
    this.detailsEl = document.getElementById("inventoryDetails") as HTMLElement;
    this.statusEl = document.getElementById("inventoryStatus") as HTMLElement;

    window.addEventListener("keydown", (event) => {
      if ((event.code !== "KeyI" && event.code !== "KeyP") || event.repeat) return;
      event.preventDefault();
      this.setOpen(!this.open);
    });

    const closeBtn = document.getElementById("inventoryCloseBtn");
    closeBtn?.addEventListener("click", () => this.setOpen(false));

    const craftBtn = document.getElementById("inventoryCraftAmuletBtn");
    craftBtn?.addEventListener("click", () => {
      this.send({ type: "economy_craft_amulet" });
    });
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.overlayEl.classList.toggle("visible", open);
    this.overlayEl.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
      this.render();
      if (this.timer === null) {
        this.timer = window.setInterval(() => this.renderEggTimersOnly(), 1000);
      }
    } else if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
      this.selected = null;
      this.selectedGemId = null;
      this.discardArm = null;
    }
  }

  /** Replace local snapshot from server `economy_profile`; always authoritative. */
  setProfile(message: EconomyProfileMessage): void {
    this.profile = message;
    this.pending = null;
    if (this.open) this.render();
  }

  setActionResult(message: EconomyActionResultMessage): void {
    this.pending = null;
    if (message.ok) {
      this.statusEl.textContent = `${message.action}: ok`;
      if (message.action === "discard_item") this.discardArm = null;
    } else {
      this.statusEl.textContent = `${message.action} failed: ${message.code ?? "error"}`;
    }
    if (this.open) this.render();
  }

  private bagEntries(): BagEntry[] {
    if (!this.profile) return [];
    const entries: BagEntry[] = [];
    for (const pet of this.profile.pets) {
      if (pet.slotAnchor === null) continue;
      entries.push({ itemType: "pet", itemId: pet.id, anchor: pet.slotAnchor, footprint: 2 });
    }
    for (const egg of this.profile.eggs) {
      entries.push({ itemType: "egg", itemId: egg.id, anchor: egg.slotAnchor, footprint: 1 });
    }
    for (const gem of this.profile.gems) {
      if (gem.slotAnchor === null) continue;
      entries.push({ itemType: "gem", itemId: gem.id, anchor: gem.slotAnchor, footprint: 1 });
    }
    for (const amulet of this.profile.amulets) {
      if (amulet.slotAnchor === null) continue;
      entries.push({ itemType: "amulet", itemId: amulet.id, anchor: amulet.slotAnchor, footprint: 2 });
    }
    for (const stim of this.profile.stimulators) {
      entries.push({ itemType: "stimulator", itemId: stim.id, anchor: stim.slotAnchor, footprint: 1 });
    }
    for (const kit of this.profile.repairKits) {
      entries.push({ itemType: "repair_kit", itemId: kit.id, anchor: kit.slotAnchor, footprint: 1 });
    }
    if (this.profile.shardCount > 0 && this.profile.shardSlotAnchor !== null) {
      entries.push({
        itemType: "shard_stack",
        itemId: 0,
        anchor: this.profile.shardSlotAnchor,
        footprint: 1,
      });
    }
    return entries;
  }

  private render(): void {
    if (!this.profile) {
      this.goldEl.textContent = "—";
      this.ratingsEl.textContent = "Join a match to load your inventory.";
      this.capsEl.textContent = "";
      this.gridEl.replaceChildren();
      this.railEl.replaceChildren();
      this.detailsEl.replaceChildren();
      return;
    }
    this.goldEl.textContent = String(this.profile.gold);
    const r = this.profile.ratings;
    this.ratingsEl.textContent =
      `HP ${r.healthRating} · DR ${r.armorRating} · SPD ${r.speedRating} · DMG ${r.damageRating}` +
      (this.profile.slot2Enabled ? " · slot2 on" : " · slot2 off");

    const bag = this.bagEntries();
    const usedCells = bag.reduce((sum, e) => sum + e.footprint, 0);
    this.capsEl.textContent =
      `Cells ${usedCells}/${INVENTORY_GRID.cells} · Pets ${this.profile.pets.length}/${ECONOMY_CAPS.pets} · ` +
      `Eggs ${this.profile.eggs.length}/${ECONOMY_CAPS.eggs} · Gems ${this.profile.gems.length}/${ECONOMY_CAPS.gems} · ` +
      `Amulets ${this.profile.amulets.length}/${ECONOMY_CAPS.amulets} · Shards ${this.profile.shardCount}/${ECONOMY_CAPS.shards} · ` +
      `Stim ${this.profile.stimulatorCount} · Kits ${this.profile.repairKitCount}`;

    const craftBtn = document.getElementById("inventoryCraftAmuletBtn") as HTMLButtonElement | null;
    if (craftBtn) {
      craftBtn.disabled = this.profile.shardCount < 10 || this.profile.amulets.length >= 4;
    }

    this.renderGrid(bag);
    this.renderRail();
    this.renderDetails();
  }

  private renderEggTimersOnly(): void {
    if (!this.profile || !this.open) return;
    const now = Date.now();
    for (const eggEl of this.gridEl.querySelectorAll<HTMLElement>("[data-egg-id]")) {
      const eggId = Number(eggEl.dataset.eggId);
      const egg = this.profile.eggs.find((e) => e.id === eggId);
      if (!egg) continue;
      const metaEl = eggEl.querySelector(".inv-item-meta");
      if (metaEl) metaEl.textContent = formatRemaining(egg.hatchDeadlineMs, now);
    }
    // Details panel timer for a selected egg.
    if (this.selected?.itemType === "egg") this.renderDetails();
  }

  private renderGrid(bag: BagEntry[]): void {
    this.gridEl.replaceChildren();
    const now = Date.now();

    // Background drop-target cells, one per grid index (row-major).
    // Explicit gridColumn/gridRow placement is required here: CSS Grid's
    // auto-placement algorithm places explicitly-positioned items (the
    // .inv-item elements below) first, then slots any remaining
    // auto-placed elements into whatever cells are left over in DOM
    // order. Without an explicit position, a .inv-cell's rendered
    // location would drift away from its dataset.anchor index as soon as
    // any bag item occupies a cell, decoupling drop-target hit-testing
    // (finishDrag reads dataset.anchor from elementsFromPoint) from the
    // actual on-screen grid position.
    for (let i = 0; i < INVENTORY_GRID.cells; i++) {
      const cell = document.createElement("div");
      cell.className = "inv-cell";
      cell.dataset.anchor = String(i);
      const cellRow = Math.floor(i / INVENTORY_GRID.cols);
      const cellCol = i % INVENTORY_GRID.cols;
      cell.style.gridColumn = String(cellCol + 1);
      cell.style.gridRow = String(cellRow + 1);
      this.gridEl.appendChild(cell);
    }

    for (const entry of bag) {
      const el = document.createElement("div");
      el.className = "inv-item";
      el.classList.add(`inv-item-${entry.itemType}`);
      const row = Math.floor(entry.anchor / INVENTORY_GRID.cols);
      const col = entry.anchor % INVENTORY_GRID.cols;
      el.style.gridColumn = `${col + 1} / span ${entry.footprint}`;
      el.style.gridRow = `${row + 1}`;
      if (
        this.selected &&
        this.selected.itemType === entry.itemType &&
        this.selected.itemId === entry.itemId
      ) {
        el.classList.add("selected");
      }
      if (
        this.pending &&
        this.pending.itemType === entry.itemType &&
        this.pending.itemId === entry.itemId
      ) {
        el.classList.add("pending");
      }
      if (this.selectedGemId !== null && entry.itemType === "gem" && entry.itemId === this.selectedGemId) {
        el.classList.add("selected");
      }

      const label = document.createElement("div");
      label.className = "inv-item-label";
      label.textContent = ITEM_LABEL[entry.itemType];
      el.appendChild(label);

      const meta = document.createElement("div");
      meta.className = "inv-item-meta";
      meta.textContent = this.metaFor(entry, now);
      el.appendChild(meta);

      if (entry.itemType === "egg") {
        el.dataset.eggId = String(entry.itemId);
      }
      if (entry.itemType === "pet") {
        const gemBadges = this.profile!.gems.filter((g) => g.petId === entry.itemId);
        if (gemBadges.length > 0) {
          const badges = document.createElement("div");
          badges.className = "inv-item-badges";
          for (const g of gemBadges) {
            const dot = document.createElement("span");
            dot.className = `inv-badge inv-badge-${g.gemType}`;
            badges.appendChild(dot);
          }
          el.appendChild(badges);
        }
      }

      // Selection and drag-move both start from the same pointerdown — a
      // press that ends near where it started (see CLICK_DISTANCE_PX below)
      // is treated as a click-to-select, anything past that as a move drag.
      // Deliberately not a separate "click" listener: browsers do not
      // consistently suppress "click" after a dragged pointerdown/up pair,
      // which would otherwise re-select right after a drop.
      el.addEventListener("pointerdown", (ev) => this.onDragStart(ev, entry));

      this.gridEl.appendChild(el);
    }
  }

  private metaFor(entry: BagEntry, now: number): string {
    if (!this.profile) return "";
    switch (entry.itemType) {
      case "egg": {
        const egg = this.profile.eggs.find((e) => e.id === entry.itemId);
        return egg ? formatRemaining(egg.hatchDeadlineMs, now) : "";
      }
      case "pet": {
        const pet = this.profile.pets.find((p) => p.id === entry.itemId);
        return pet ? `${pet.type} ${pet.baseValue}` : "";
      }
      case "gem": {
        const gem = this.profile.gems.find((g) => g.id === entry.itemId);
        return gem ? `${gem.gemType} ${gem.value}` : "";
      }
      case "amulet": {
        const amulet = this.profile.amulets.find((a) => a.id === entry.itemId);
        return amulet ? `dur ${amulet.durability}/${ECONOMY_CAPS.amuletDurabilityMax}` : "";
      }
      case "shard_stack":
        return `x${this.profile.shardCount}`;
      case "stimulator":
      case "repair_kit":
        return "";
    }
  }

  private onItemClicked(itemType: InventoryItemType, itemId: number): void {
    if (itemType === "gem") {
      // Second click on the same gem toggles socket-target selection off.
      if (this.selectedGemId === itemId) {
        this.selectedGemId = null;
      }
    }
    if (this.selected && this.selected.itemType === itemType && this.selected.itemId === itemId) {
      this.selected = null;
    } else {
      this.selected = { itemType, itemId };
    }
    this.discardArm = null;
    this.render();
  }

  // --- Drag-and-drop move (pointer events) ---

  private onDragStart(ev: PointerEvent, entry: BagEntry): void {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();

    this.dragState = {
      itemType: entry.itemType,
      itemId: entry.itemId,
      footprint: entry.footprint,
      ghost: null,
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      dragging: false,
    };

    const onMove = (moveEv: PointerEvent) => {
      const drag = this.dragState;
      if (!drag) return;
      if (!drag.dragging) {
        const dist = Math.hypot(moveEv.clientX - drag.startX, moveEv.clientY - drag.startY);
        if (dist < InventoryOverlay.CLICK_DISTANCE_PX) return;
        drag.dragging = true;
        const ghost = document.createElement("div");
        ghost.className = `inv-drag-ghost inv-item-${drag.itemType}`;
        ghost.textContent = ITEM_LABEL[drag.itemType];
        document.body.appendChild(ghost);
        drag.ghost = ghost;
      }
      this.moveGhost(drag.ghost!, moveEv.clientX, moveEv.clientY);
    };
    const onUp = (upEv: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      this.finishDrag(upEv.clientX, upEv.clientY);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  private moveGhost(ghost: HTMLElement, clientX: number, clientY: number): void {
    ghost.style.left = `${clientX}px`;
    ghost.style.top = `${clientY}px`;
  }

  private finishDrag(clientX: number, clientY: number): void {
    const drag = this.dragState;
    this.dragState = null;
    if (!drag) return;
    drag.ghost?.remove();

    if (!drag.dragging) {
      // Press ended close to where it started — treat as a click-to-select.
      this.onItemClicked(drag.itemType, drag.itemId);
      return;
    }

    const target = document
      .elementsFromPoint(clientX, clientY)
      .find((el) => el instanceof HTMLElement && el.dataset.anchor !== undefined) as
      | HTMLElement
      | undefined;
    if (!target) return;
    const toAnchor = Number(target.dataset.anchor);
    if (!Number.isInteger(toAnchor)) return;

    this.pending = { itemType: drag.itemType, itemId: drag.itemId };
    this.render();
    this.send({
      type: "economy_move_item",
      itemType: drag.itemType,
      itemId: drag.itemId,
      toAnchor,
    });
  }

  // --- Equip rail (pets slot1/slot2, amulet) ---

  private renderRail(): void {
    this.railEl.replaceChildren();
    if (!this.profile) return;

    this.railEl.appendChild(this.renderPetSlot(1));
    if (this.profile.slot2Enabled) {
      this.railEl.appendChild(this.renderPetSlot(2));
    }
    this.railEl.appendChild(this.renderAmuletSlot());
  }

  private renderPetSlot(slot: 1 | 2): HTMLElement {
    const box = document.createElement("div");
    box.className = "inv-rail-slot";
    const title = document.createElement("div");
    title.className = "inv-rail-title";
    title.textContent = `Pet slot ${slot}`;
    box.appendChild(title);

    const pet = this.profile!.pets.find((p) => p.equipSlot === slot);
    if (!pet) {
      const empty = document.createElement("div");
      empty.className = "inv-rail-empty";
      empty.textContent = "Empty";
      box.appendChild(empty);
      return box;
    }
    const label = document.createElement("div");
    label.className = "inv-rail-item";
    label.textContent = `${pet.type} #${pet.id} · ${pet.baseValue}`;
    box.appendChild(label);

    const gems = this.profile!.gems.filter((g) => g.petId === pet.id);
    if (gems.length > 0) {
      const gemsLine = document.createElement("div");
      gemsLine.className = "inv-rail-sub";
      gemsLine.textContent = gems.map((g) => `${g.gemType}:${g.value}`).join(" ");
      box.appendChild(gemsLine);
    }

    const unequip = document.createElement("button");
    unequip.type = "button";
    unequip.textContent = "Unequip";
    unequip.addEventListener("click", () => {
      this.send({ type: "economy_unequip_pet", petId: pet.id });
    });
    box.appendChild(unequip);
    return box;
  }

  private renderAmuletSlot(): HTMLElement {
    const box = document.createElement("div");
    box.className = "inv-rail-slot";
    const title = document.createElement("div");
    title.className = "inv-rail-title";
    title.textContent = "Amulet";
    box.appendChild(title);

    const amulet = this.profile!.amulets.find((a) => a.equipped);
    if (!amulet) {
      const empty = document.createElement("div");
      empty.className = "inv-rail-empty";
      empty.textContent = "Empty";
      box.appendChild(empty);
      return box;
    }
    const label = document.createElement("div");
    label.className = "inv-rail-item";
    label.textContent = `#${amulet.id} · dur ${amulet.durability}/${ECONOMY_CAPS.amuletDurabilityMax}`;
    box.appendChild(label);

    const unequip = document.createElement("button");
    unequip.type = "button";
    unequip.textContent = "Unequip";
    unequip.addEventListener("click", () => {
      this.send({ type: "economy_unequip_amulet", amuletId: amulet.id });
    });
    box.appendChild(unequip);

    const repair = document.createElement("button");
    repair.type = "button";
    repair.textContent = "Repair";
    repair.disabled = this.profile!.repairKitCount <= 0 || amulet.durability >= ECONOMY_CAPS.amuletDurabilityMax;
    repair.addEventListener("click", () => {
      this.send({ type: "economy_repair_amulet", amuletId: amulet.id });
    });
    box.appendChild(repair);
    return box;
  }

  // --- Selected-item action panel ---

  private renderDetails(): void {
    this.detailsEl.replaceChildren();
    if (!this.profile) return;
    if (!this.selected) {
      const hint = document.createElement("div");
      hint.className = "inv-details-hint";
      hint.textContent = "Select a grid item for actions (Use / Equip / Socket / Discard).";
      this.detailsEl.appendChild(hint);
      return;
    }

    const { itemType, itemId } = this.selected;
    const title = document.createElement("div");
    title.className = "inv-details-title";
    title.textContent = `${ITEM_LABEL[itemType]} #${itemId}`;
    this.detailsEl.appendChild(title);

    const actions = document.createElement("div");
    actions.className = "inv-details-actions";

    if (itemType === "egg") {
      const egg = this.profile.eggs.find((e) => e.id === itemId) as EconomyEggDto | undefined;
      if (egg) {
        const now = Date.now();
        const ready = egg.hatchDeadlineMs <= now;
        const info = document.createElement("div");
        info.className = "inv-details-sub";
        info.textContent = ready ? "Ready to hatch" : `Ready in ${formatRemaining(egg.hatchDeadlineMs, now)}`;
        this.detailsEl.appendChild(info);

        const hatchBtn = this.makeButton("Hatch", !ready, () => {
          this.send({ type: "economy_hatch_egg", eggId: egg.id });
        });
        actions.appendChild(hatchBtn);

        const stimBtn = this.makeButton(
          "Apply stimulator",
          this.profile.stimulatorCount <= 0 || ready,
          () => {
            this.send({ type: "economy_apply_stimulator", eggId: egg.id });
          },
        );
        actions.appendChild(stimBtn);
      }
    } else if (itemType === "pet") {
      const pet = this.profile.pets.find((p) => p.id === itemId) as EconomyPetDto | undefined;
      if (pet) {
        actions.appendChild(
          this.makeButton("Equip slot 1", false, () => {
            this.send({ type: "economy_equip_pet", petId: pet.id, slot: 1 });
          }),
        );
        if (this.profile.slot2Enabled) {
          actions.appendChild(
            this.makeButton("Equip slot 2", false, () => {
              this.send({ type: "economy_equip_pet", petId: pet.id, slot: 2 });
            }),
          );
        }
        if (this.selectedGemId !== null) {
          const gemId = this.selectedGemId;
          actions.appendChild(
            this.makeButton("Socket selected gem", false, () => {
              this.send({ type: "economy_socket_gem", gemId, petId: pet.id });
              this.selectedGemId = null;
            }),
          );
        }
        const gems = this.profile.gems.filter((g) => g.petId === pet.id);
        for (const gem of gems) {
          actions.appendChild(
            this.makeButton(`Unsocket ${gem.gemType}`, false, () => {
              this.send({ type: "economy_unsocket_gem", gemId: gem.id });
            }),
          );
        }
      }
    } else if (itemType === "gem") {
      const gem = this.profile.gems.find((g) => g.id === itemId) as EconomyGemDto | undefined;
      if (gem) {
        const info = document.createElement("div");
        info.className = "inv-details-sub";
        info.textContent = "Select a pet in the grid, then Socket.";
        this.detailsEl.appendChild(info);
        actions.appendChild(
          this.makeButton(this.selectedGemId === gem.id ? "Selected for socketing" : "Select to socket", false, () => {
            this.selectedGemId = this.selectedGemId === gem.id ? null : gem.id;
            this.render();
          }),
        );
      }
    } else if (itemType === "amulet") {
      const amulet = this.profile.amulets.find((a) => a.id === itemId) as EconomyAmuletDto | undefined;
      if (amulet) {
        actions.appendChild(
          this.makeButton("Equip", false, () => {
            this.send({ type: "economy_equip_amulet", amuletId: amulet.id });
          }),
        );
        actions.appendChild(
          this.makeButton(
            "Repair",
            this.profile.repairKitCount <= 0 || amulet.durability >= ECONOMY_CAPS.amuletDurabilityMax,
            () => {
              this.send({ type: "economy_repair_amulet", amuletId: amulet.id });
            },
          ),
        );
      }
    } else if (itemType === "stimulator") {
      const info = document.createElement("div");
      info.className = "inv-details-sub";
      info.textContent = "Select an egg to apply this stimulator.";
      this.detailsEl.appendChild(info);
    } else if (itemType === "repair_kit") {
      const info = document.createElement("div");
      info.className = "inv-details-sub";
      info.textContent = "Select an amulet to consume this kit.";
      this.detailsEl.appendChild(info);
    } else if (itemType === "shard_stack") {
      const info = document.createElement("div");
      info.className = "inv-details-sub";
      info.textContent = `${this.profile.shardCount} shard(s). Craft an amulet from the header button.`;
      this.detailsEl.appendChild(info);
    }

    const armed = this.discardArm?.itemType === itemType && this.discardArm.itemId === itemId;
    const discardBtn = this.makeButton(armed ? "Confirm discard?" : "Discard", false, () => {
      if (armed) {
        this.send({ type: "economy_discard_item", itemType, itemId });
        this.discardArm = null;
      } else {
        this.discardArm = { itemType, itemId };
        this.render();
      }
    });
    discardBtn.classList.add("inv-discard-btn");
    if (armed) discardBtn.classList.add("armed");
    actions.appendChild(discardBtn);

    this.detailsEl.appendChild(actions);
  }

  private makeButton(text: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = text;
    btn.disabled = disabled;
    btn.addEventListener("click", onClick);
    return btn;
  }
}
