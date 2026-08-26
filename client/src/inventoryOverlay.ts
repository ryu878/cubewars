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
  AvatarBodyPart,
  AvatarColors,
  ClientMessage,
  EconomyActionResultMessage,
  EconomyAmuletDto,
  EconomyEggDto,
  EconomyGemDto,
  EconomyPetDto,
  EconomyProfileMessage,
  InventoryFootprint,
  InventoryItemType,
  PetType,
} from "@cubewars/shared";
import {
  AVATAR_BODY_PARTS,
  AVATAR_COLOR_PALETTE,
  ECONOMY_CAPS,
  INVENTORY_GRID,
  cloneAvatarColors,
  defaultAvatarColors,
  describePetGrants,
  formatPetPrimaryGrant,
} from "@cubewars/shared";
import { shouldIgnoreGameHotkey } from "./uiInput";

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

/** Full English display names for inventory UI (EPIC 43). Never use STM/PET/etc. as primary labels. */
const ITEM_DISPLAY_NAME: Record<InventoryItemType, string> = {
  pet: "Pet",
  egg: "Egg",
  gem: "Gem",
  amulet: "Amulet",
  stimulator: "Stimulator",
  repair_kit: "Repair kit",
  shard_stack: "Shard stack",
};

/** Species-specific pet glyph (EPIC 50) — replaces the generic pig-snout square. */
function createPetIcon(petType: PetType, sizeClass = ""): HTMLElement {
  const icon = document.createElement("div");
  icon.className = `inv-icon inv-icon-pet inv-icon-pet-${petType}${sizeClass ? ` ${sizeClass}` : ""}`;
  icon.setAttribute("aria-hidden", "true");
  icon.dataset.petType = petType;

  if (petType === "dog") {
    const earL = document.createElement("span");
    earL.className = "inv-pet-dog-ear inv-pet-dog-ear-l";
    const earR = document.createElement("span");
    earR.className = "inv-pet-dog-ear inv-pet-dog-ear-r";
    const snout = document.createElement("span");
    snout.className = "inv-pet-dog-snout";
    icon.append(earL, earR, snout);
  } else if (petType === "cat") {
    const earL = document.createElement("span");
    earL.className = "inv-pet-cat-ear inv-pet-cat-ear-l";
    const earR = document.createElement("span");
    earR.className = "inv-pet-cat-ear inv-pet-cat-ear-r";
    const eyeL = document.createElement("span");
    eyeL.className = "inv-pet-cat-eye inv-pet-cat-eye-l";
    const eyeR = document.createElement("span");
    eyeR.className = "inv-pet-cat-eye inv-pet-cat-eye-r";
    icon.append(earL, earR, eyeL, eyeR);
  } else if (petType === "bird") {
    const beak = document.createElement("span");
    beak.className = "inv-pet-bird-beak";
    const eye = document.createElement("span");
    eye.className = "inv-pet-bird-eye";
    icon.append(beak, eye);
  } else {
    // lion: 6-tuft mane + face with eyes/muzzle (species-readable at bag/rail size)
    const mane = document.createElement("span");
    mane.className = "inv-pet-lion-mane";
    const face = document.createElement("span");
    face.className = "inv-pet-lion-face";
    const eyeL = document.createElement("span");
    eyeL.className = "inv-pet-lion-eye inv-pet-lion-eye-l";
    const eyeR = document.createElement("span");
    eyeR.className = "inv-pet-lion-eye inv-pet-lion-eye-r";
    const nose = document.createElement("span");
    nose.className = "inv-pet-lion-nose";
    icon.append(mane, face, eyeL, eyeR, nose);
  }
  return icon;
}

/** Geometric icon glyph for a bag / rail / ghost cell (CSS classes paint the shape). */
function createItemIcon(
  itemType: InventoryItemType,
  sizeClass = "",
  petType?: PetType,
): HTMLElement {
  if (itemType === "pet" && petType) {
    return createPetIcon(petType, sizeClass);
  }
  const icon = document.createElement("div");
  icon.className = `inv-icon inv-icon-${itemType}${sizeClass ? ` ${sizeClass}` : ""}`;
  icon.setAttribute("aria-hidden", "true");
  if (itemType === "pet") {
    // Fallback generic (should rarely show — prefer createPetIcon with type).
    icon.classList.add("inv-icon-pet-unknown");
  } else if (itemType === "amulet") {
    const hole = document.createElement("span");
    hole.className = "inv-icon-amulet-hole";
    icon.appendChild(hole);
  } else if (itemType === "stimulator") {
    const bolt = document.createElement("span");
    bolt.className = "inv-icon-stim-bolt";
    icon.appendChild(bolt);
  } else if (itemType === "repair_kit") {
    const cross = document.createElement("span");
    cross.className = "inv-icon-kit-cross";
    icon.appendChild(cross);
  } else if (itemType === "shard_stack") {
    for (let i = 0; i < 3; i++) {
      const shard = document.createElement("span");
      shard.className = `inv-icon-shard inv-icon-shard-${i}`;
      icon.appendChild(shard);
    }
  }
  return icon;
}

function petGemsMap(
  profile: EconomyProfileMessage,
  petId: number,
): Partial<Record<"health" | "armor" | "speed" | "damage", number>> {
  const out: Partial<Record<"health" | "armor" | "speed" | "damage", number>> = {};
  for (const gem of profile.gems) {
    if (gem.petId !== petId) continue;
    out[gem.gemType] = (out[gem.gemType] ?? 0) + gem.value;
  }
  return out;
}

function appendPetGrantLines(
  parent: HTMLElement,
  pet: EconomyPetDto,
  profile: EconomyProfileMessage,
  opts: { applySlotFraction: boolean; className?: string },
): void {
  const breakdown = describePetGrants(
    {
      type: pet.type,
      baseValue: pet.baseValue,
      equipSlot: pet.equipSlot,
      gems: petGemsMap(profile, pet.id),
    },
    { applySlotFraction: opts.applySlotFraction },
  );
  const block = document.createElement("div");
  block.className = opts.className ?? "inv-details-sub";

  const primary = document.createElement("div");
  primary.textContent = breakdown.primaryText;
  block.appendChild(primary);

  if (breakdown.gemTexts.length > 0) {
    const gemsTitle = document.createElement("div");
    gemsTitle.textContent = `Gems: ${breakdown.gemTexts.join(", ")}`;
    block.appendChild(gemsTitle);
  }

  if (breakdown.totalTexts.length > 0) {
    const totals = document.createElement("div");
    const fracNote =
      opts.applySlotFraction && breakdown.fraction !== 1
        ? ` (slot ×${breakdown.fraction})`
        : "";
    totals.textContent = `Total${fracNote}: ${breakdown.totalTexts.join(" · ")}`;
    block.appendChild(totals);
  }

  parent.appendChild(block);
}

export class InventoryOverlay {
  private overlayEl: HTMLElement;
  private gridEl: HTMLElement;
  private goldEl: HTMLElement;
  private poolBadgeEl: HTMLElement;
  private ratingsEl: HTMLElement;
  private capsEl: HTMLElement;
  private railEl: HTMLElement;
  private detailsEl: HTMLElement;
  private statusEl: HTMLElement;
  private appearanceRowsEl: HTMLElement;
  private petColorRowsEl: HTMLElement;

  private open = false;
  private profile: EconomyProfileMessage | null = null;
  /** EPIC 33: last known server-authoritative self colors (from world_state). */
  private avatarColors: AvatarColors = defaultAvatarColors();
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
    this.poolBadgeEl = document.getElementById("inventoryPoolBadge") as HTMLElement;
    this.ratingsEl = document.getElementById("inventoryRatings") as HTMLElement;
    this.capsEl = document.getElementById("inventoryCaps") as HTMLElement;
    this.railEl = document.getElementById("inventoryRail") as HTMLElement;
    this.detailsEl = document.getElementById("inventoryDetails") as HTMLElement;
    this.statusEl = document.getElementById("inventoryStatus") as HTMLElement;
    this.appearanceRowsEl = document.getElementById("inventoryAppearanceRows") as HTMLElement;
    this.petColorRowsEl = document.getElementById("inventoryPetColorRows") as HTMLElement;

    window.addEventListener("keydown", (event) => {
      if ((event.code !== "KeyI" && event.code !== "KeyP") || event.repeat) return;
      // Lobby / email / nickname typing must not open inventory (e.g. "i" in gmail).
      if (shouldIgnoreGameHotkey(event)) return;
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

  /** Player-facing status line (lobby waiting / errors) — does not mutate bag state. */
  setStatus(text: string): void {
    this.statusEl.textContent = text;
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
    } else if (message.action === "lobby_bind" && message.code === "nickname_invalid") {
      this.statusEl.textContent = "Enter a valid nickname to load inventory";
    } else if (message.code === "match_required") {
      this.statusEl.textContent = `${message.action} requires being in a Deathmatch match`;
    } else {
      this.statusEl.textContent = `${message.action} failed: ${message.code ?? "error"}`;
    }
    if (this.open) this.render();
  }

  /** EPIC 33: sync self avatar colors from authoritative world_state. */
  setAvatarColors(colors: AvatarColors): void {
    this.avatarColors = cloneAvatarColors(colors);
    if (this.open) this.renderAppearance();
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
      this.poolBadgeEl.textContent = "Pool: Deathmatch (waiting for profile)";
      this.poolBadgeEl.dataset.pool = "deathmatch";
      this.ratingsEl.textContent =
        "Waiting for inventory… Use Inventory on the lobby with a valid nickname, or join a match.";
      this.capsEl.textContent = "";
      this.gridEl.replaceChildren();
      this.railEl.replaceChildren();
      this.detailsEl.replaceChildren();
      this.renderAppearance();
      return;
    }
    const pool = this.profile.economyPool;
    this.poolBadgeEl.dataset.pool = pool;
    this.poolBadgeEl.textContent =
      pool === "sandbox"
        ? "Pool: Sandbox (bots / endless — separate from Deathmatch)"
        : "Pool: Deathmatch (competitive)";
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
    this.renderAppearance();
  }

  private renderAppearance(): void {
    if (!this.appearanceRowsEl) return;
    this.appearanceRowsEl.replaceChildren();
    for (const part of AVATAR_BODY_PARTS) {
      const row = document.createElement("div");
      row.className = "inv-appearance-row";
      const label = document.createElement("span");
      label.className = "inv-appearance-label";
      label.textContent = part;
      const swatches = document.createElement("div");
      swatches.className = "inv-swatches";
      AVATAR_COLOR_PALETTE.forEach((hex, index) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "inv-swatch";
        btn.title = `${part} color ${index + 1}`;
        btn.style.background = `#${hex.toString(16).padStart(6, "0")}`;
        btn.dataset.selected = this.avatarColors[part] === index ? "true" : "false";
        btn.addEventListener("click", () => this.onSwatchClick(part, index));
        swatches.appendChild(btn);
      });
      row.append(label, swatches);
      this.appearanceRowsEl.appendChild(row);
    }
    this.renderPetColorRows();
  }

  /** EPIC 39: color swatches for owned pets (selected pet emphasized). */
  private renderPetColorRows(): void {
    if (!this.petColorRowsEl) return;
    this.petColorRowsEl.replaceChildren();
    if (!this.profile || this.profile.pets.length === 0) {
      const empty = document.createElement("p");
      empty.className = "inv-meta";
      empty.textContent = "No pets yet.";
      this.petColorRowsEl.appendChild(empty);
      return;
    }

    const focusPetId =
      this.selected?.itemType === "pet"
        ? this.selected.itemId
        : this.profile.pets.find((p) => p.equipSlot === 1)?.id ??
          this.profile.pets.find((p) => p.equipSlot === 2)?.id ??
          this.profile.pets[0]!.id;

    for (const pet of this.profile.pets) {
      const row = document.createElement("div");
      row.className = "inv-appearance-row";
      if (pet.id === focusPetId) row.dataset.focus = "true";
      const label = document.createElement("span");
      label.className = "inv-appearance-label";
      label.textContent = `${pet.type} #${pet.id}`;
      label.title = "Click to select this pet";
      label.style.cursor = "pointer";
      label.addEventListener("click", () => {
        this.selected = { itemType: "pet", itemId: pet.id };
        this.render();
      });
      const swatches = document.createElement("div");
      swatches.className = "inv-swatches";
      AVATAR_COLOR_PALETTE.forEach((hex, index) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "inv-swatch";
        btn.title = `${pet.type} color ${index + 1}`;
        btn.style.background = `#${hex.toString(16).padStart(6, "0")}`;
        btn.dataset.selected = pet.colorIndex === index ? "true" : "false";
        btn.addEventListener("click", () => this.onPetColorClick(pet.id, index));
        swatches.appendChild(btn);
      });
      row.append(label, swatches);
      this.petColorRowsEl.appendChild(row);
    }
  }

  private onSwatchClick(part: AvatarBodyPart, paletteIndex: number): void {
    if (this.avatarColors[part] === paletteIndex) return;
    // Optimistic local highlight; world_state echo is authoritative.
    this.avatarColors = { ...this.avatarColors, [part]: paletteIndex };
    this.renderAppearance();
    this.send({ type: "avatar_set_color", part, paletteIndex });
    this.statusEl.textContent = `Appearance: ${part} → ${paletteIndex + 1}`;
  }

  private onPetColorClick(petId: number, paletteIndex: number): void {
    if (!this.profile) return;
    const pet = this.profile.pets.find((p) => p.id === petId);
    if (!pet || pet.colorIndex === paletteIndex) return;
    // Optimistic local highlight; economy_profile echo is authoritative.
    pet.colorIndex = paletteIndex;
    this.renderPetColorRows();
    this.send({ type: "economy_set_pet_color", petId, paletteIndex });
    this.statusEl.textContent = `Pet #${petId} color → ${paletteIndex + 1}`;
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
      const tooltip =
        formatRemaining(egg.hatchDeadlineMs, now) === "Ready"
          ? `Egg #${egg.id} · Ready to hatch`
          : `Egg #${egg.id} · Ready in ${formatRemaining(egg.hatchDeadlineMs, now)}`;
      eggEl.dataset.tooltip = tooltip;
      eggEl.setAttribute("aria-label", tooltip);
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

      if (entry.itemType === "pet") {
        const pet = this.profile!.pets.find((p) => p.id === entry.itemId);
        el.appendChild(createItemIcon("pet", "", pet?.type));
      } else {
        el.appendChild(createItemIcon(entry.itemType));
      }

      const metaText = this.metaFor(entry, now);
      if (metaText) {
        const meta = document.createElement("div");
        meta.className = "inv-item-meta";
        meta.textContent = metaText;
        el.appendChild(meta);
      }

      const tooltip = this.tooltipFor(entry, now);
      el.dataset.tooltip = tooltip;
      el.setAttribute("aria-label", tooltip);
      el.tabIndex = 0;

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
        return pet ? formatPetPrimaryGrant(pet.type, pet.baseValue) : "";
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

  /** Hover / focus tooltip: full English name + useful detail already on the profile. */
  private tooltipFor(entry: BagEntry, now: number): string {
    if (!this.profile) return ITEM_DISPLAY_NAME[entry.itemType];
    switch (entry.itemType) {
      case "pet": {
        const pet = this.profile.pets.find((p) => p.id === entry.itemId);
        return pet
          ? `Pet (${pet.type}) #${pet.id} · ${formatPetPrimaryGrant(pet.type, pet.baseValue)}`
          : `Pet #${entry.itemId}`;
      }
      case "egg": {
        const egg = this.profile.eggs.find((e) => e.id === entry.itemId);
        if (!egg) return `Egg #${entry.itemId}`;
        const timer = formatRemaining(egg.hatchDeadlineMs, now);
        return timer === "Ready"
          ? `Egg #${egg.id} · Ready to hatch`
          : `Egg #${egg.id} · Ready in ${timer}`;
      }
      case "gem": {
        const gem = this.profile.gems.find((g) => g.id === entry.itemId);
        return gem
          ? `Gem (${gem.gemType}) #${gem.id} · value ${gem.value}`
          : `Gem #${entry.itemId}`;
      }
      case "amulet": {
        const amulet = this.profile.amulets.find((a) => a.id === entry.itemId);
        return amulet
          ? `Amulet #${amulet.id} · durability ${amulet.durability}/${ECONOMY_CAPS.amuletDurabilityMax}`
          : `Amulet #${entry.itemId}`;
      }
      case "stimulator":
        return `Stimulator #${entry.itemId}`;
      case "repair_kit":
        return `Repair kit #${entry.itemId}`;
      case "shard_stack":
        return `Shards · ${this.profile.shardCount} in stack`;
    }
  }

  private detailsTitle(itemType: InventoryItemType, itemId: number): string {
    if (!this.profile) return `${ITEM_DISPLAY_NAME[itemType]} #${itemId}`;
    switch (itemType) {
      case "pet": {
        const pet = this.profile.pets.find((p) => p.id === itemId);
        return pet ? `Pet (${pet.type}) #${pet.id}` : `Pet #${itemId}`;
      }
      case "gem": {
        const gem = this.profile.gems.find((g) => g.id === itemId);
        return gem ? `Gem (${gem.gemType}) #${gem.id}` : `Gem #${itemId}`;
      }
      case "shard_stack":
        return `Shard stack (${this.profile.shardCount})`;
      default:
        return `${ITEM_DISPLAY_NAME[itemType]} #${itemId}`;
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
        let ghostPetType: PetType | undefined;
        if (drag.itemType === "pet" && this.profile) {
          ghostPetType = this.profile.pets.find((p) => p.id === drag.itemId)?.type;
        }
        ghost.appendChild(createItemIcon(drag.itemType, "inv-icon-sm", ghostPetType));
        const ghostLabel = document.createElement("span");
        ghostLabel.className = "inv-drag-ghost-label";
        ghostLabel.textContent = ITEM_DISPLAY_NAME[drag.itemType];
        ghost.appendChild(ghostLabel);
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
    const row = document.createElement("div");
    row.className = "inv-rail-item-row";
    row.appendChild(createItemIcon("pet", "inv-icon-sm", pet.type));
    const label = document.createElement("div");
    label.className = "inv-rail-item";
    const grant = describePetGrants(
      {
        type: pet.type,
        baseValue: pet.baseValue,
        equipSlot: pet.equipSlot,
        gems: petGemsMap(this.profile!, pet.id),
      },
      { applySlotFraction: true },
    );
    label.textContent = `${pet.type} · ${grant.primaryText}`;
    label.title = `Pet (${pet.type}) #${pet.id} · grants ${grant.totalTexts.join(" · ") || grant.primaryText}`;
    row.appendChild(label);
    box.appendChild(row);

    appendPetGrantLines(box, pet, this.profile!, {
      applySlotFraction: true,
      className: "inv-rail-sub",
    });

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
    const row = document.createElement("div");
    row.className = "inv-rail-item-row";
    row.appendChild(createItemIcon("amulet", "inv-icon-sm"));
    const label = document.createElement("div");
    label.className = "inv-rail-item";
    label.textContent = `Amulet #${amulet.id} · dur ${amulet.durability}/${ECONOMY_CAPS.amuletDurabilityMax}`;
    label.title = `Amulet #${amulet.id} · durability ${amulet.durability}/${ECONOMY_CAPS.amuletDurabilityMax}`;
    row.appendChild(label);
    box.appendChild(row);

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
    const titleRow = document.createElement("div");
    titleRow.className = "inv-details-title-row";
    let detailPetType: PetType | undefined;
    if (itemType === "pet") {
      detailPetType = this.profile.pets.find((p) => p.id === itemId)?.type;
    }
    titleRow.appendChild(createItemIcon(itemType, "inv-icon-sm", detailPetType));
    const titleText = document.createElement("span");
    titleText.textContent = this.detailsTitle(itemType, itemId);
    titleRow.appendChild(titleText);
    title.appendChild(titleRow);
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
        const equipped = pet.equipSlot === 1 || pet.equipSlot === 2;
        appendPetGrantLines(this.detailsEl, pet, this.profile, {
          applySlotFraction: equipped,
        });
        const colorInfo = document.createElement("div");
        colorInfo.className = "inv-details-sub";
        colorInfo.textContent = `Color palette index ${pet.colorIndex + 1} (see Pet colors below)`;
        this.detailsEl.appendChild(colorInfo);
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

    if (this.profile.economyPool === "deathmatch") {
      actions.appendChild(
        this.makeButton("Drop to ground (60s)", false, () => {
          this.send({ type: "economy_drop_item", itemType, itemId });
        }),
      );
      actions.appendChild(
        this.makeButton("Auction…", false, () => {
          window.dispatchEvent(new CustomEvent("cubewars-open-auction"));
        }),
      );
    }

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
