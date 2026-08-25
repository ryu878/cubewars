// Auction house panel (EPIC 38). Deathmatch pool only — sends intents,
// renders server `economy_auction_state`. Plain HTML/CSS/TS.

import type {
  ClientMessage,
  EconomyAuctionLotDto,
  EconomyAuctionStateMessage,
  EconomyProfileMessage,
  InventoryItemType,
} from "@cubewars/shared";
import { shouldIgnoreGameHotkey } from "./uiInput";

type SendFn = (message: ClientMessage) => void;

export class AuctionPanel {
  private overlayEl: HTMLElement;
  private listEl: HTMLElement;
  private statusEl: HTMLElement;
  private open = false;
  private lots: EconomyAuctionLotDto[] = [];
  private profile: EconomyProfileMessage | null = null;

  constructor(private send: SendFn) {
    this.ensureDom();
    this.overlayEl = document.getElementById("auctionOverlay") as HTMLElement;
    this.listEl = document.getElementById("auctionList") as HTMLElement;
    this.statusEl = document.getElementById("auctionStatus") as HTMLElement;

    document.getElementById("auctionCloseBtn")?.addEventListener("click", () => this.setOpen(false));
    document.getElementById("auctionRefreshBtn")?.addEventListener("click", () => {
      this.send({ type: "economy_auction_browse" });
    });
    document.getElementById("auctionListBtn")?.addEventListener("click", () => this.submitList());

    window.addEventListener("keydown", (event) => {
      if (event.code !== "KeyU" || event.repeat) return;
      if (shouldIgnoreGameHotkey(event)) return;
      event.preventDefault();
      this.setOpen(!this.open);
    });
    window.addEventListener("cubewars-open-auction", () => this.setOpen(true));
  }

  setProfile(profile: EconomyProfileMessage): void {
    this.profile = profile;
    if (this.open) this.renderListForm();
  }

  setAuctionState(message: EconomyAuctionStateMessage): void {
    this.lots = message.lots;
    this.statusEl.textContent = `Dev ledger: ${message.developerGoldLedger} gold · ${message.lots.length} active lot(s)`;
    if (this.open) this.renderLots();
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.overlayEl.classList.toggle("visible", open);
    this.overlayEl.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      if (document.pointerLockElement) document.exitPointerLock();
      this.send({ type: "economy_auction_browse" });
      this.renderListForm();
      this.renderLots();
    }
  }

  private submitList(): void {
    const typeEl = document.getElementById("auctionItemType") as HTMLSelectElement | null;
    const idEl = document.getElementById("auctionItemId") as HTMLSelectElement | null;
    const startEl = document.getElementById("auctionStartPrice") as HTMLInputElement | null;
    const buyoutEl = document.getElementById("auctionBuyoutPrice") as HTMLInputElement | null;
    const qtyEl = document.getElementById("auctionShardQty") as HTMLInputElement | null;
    if (!typeEl || !idEl || !startEl) return;
    const itemType = typeEl.value as InventoryItemType;
    const itemId = Number(idEl.value);
    const startPrice = Math.floor(Number(startEl.value));
    const buyoutRaw = buyoutEl?.value.trim() ?? "";
    const buyoutPrice = buyoutRaw === "" ? undefined : Math.floor(Number(buyoutRaw));
    const msg: ClientMessage = {
      type: "economy_auction_list",
      itemType,
      itemId: itemType === "shard_stack" ? 0 : itemId,
      startPrice,
      buyoutPrice,
      shardQuantity:
        itemType === "shard_stack" ? Math.floor(Number(qtyEl?.value || 0)) : undefined,
    };
    this.send(msg);
  }

  private renderListForm(): void {
    const idEl = document.getElementById("auctionItemId") as HTMLSelectElement | null;
    const typeEl = document.getElementById("auctionItemType") as HTMLSelectElement | null;
    if (!idEl || !typeEl || !this.profile) return;
    if (this.profile.economyPool !== "deathmatch") {
      idEl.innerHTML = "";
      this.statusEl.textContent =
        "Listing uses Deathmatch bag items. Bind Deathmatch from the lobby (Inventory or Auction) or open auction from a Deathmatch match.";
      return;
    }
    const fill = () => {
      const itemType = typeEl.value as InventoryItemType;
      idEl.innerHTML = "";
      const options: Array<{ id: number; label: string }> = [];
      if (!this.profile) return;
      if (itemType === "pet") {
        for (const p of this.profile.pets) {
          if (p.equipSlot) continue;
          options.push({ id: p.id, label: `${p.type}#${p.id} bv${p.baseValue}` });
        }
      } else if (itemType === "egg") {
        for (const e of this.profile.eggs) options.push({ id: e.id, label: `egg#${e.id}` });
      } else if (itemType === "gem") {
        for (const g of this.profile.gems) {
          if (g.petId !== null) continue;
          options.push({ id: g.id, label: `${g.gemType}#${g.id} v${g.value}` });
        }
      } else if (itemType === "amulet") {
        for (const a of this.profile.amulets) {
          if (a.equipped) continue;
          options.push({ id: a.id, label: `amulet#${a.id} d${a.durability}` });
        }
      } else if (itemType === "stimulator") {
        for (const s of this.profile.stimulators) options.push({ id: s.id, label: `stim#${s.id}` });
      } else if (itemType === "repair_kit") {
        for (const k of this.profile.repairKits) options.push({ id: k.id, label: `kit#${k.id}` });
      } else if (itemType === "shard_stack") {
        options.push({ id: 0, label: `shards x${this.profile.shardCount}` });
      }
      for (const o of options) {
        const opt = document.createElement("option");
        opt.value = String(o.id);
        opt.textContent = o.label;
        idEl.appendChild(opt);
      }
    };
    typeEl.onchange = fill;
    fill();
  }

  private renderLots(): void {
    this.listEl.innerHTML = "";
    if (this.lots.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "No active lots.";
      this.listEl.appendChild(empty);
      return;
    }
    for (const lot of this.lots) {
      const row = document.createElement("div");
      row.className = "auction-lot";
      const itemLabel = `${lot.item.itemType} ${lot.item.label ?? ""} ${lot.item.detail ?? ""}`.trim();
      const bid = lot.highestBid ?? "—";
      row.innerHTML = `<strong>#${lot.lotId}</strong> ${itemLabel}<br/>` +
        `Seller ${lot.sellerNickname} · start ${lot.startPrice}` +
        (lot.buyoutPrice !== null ? ` · buyout ${lot.buyoutPrice}` : "") +
        `<br/>High bid: ${bid}` +
        (lot.highestBidderNickname ? ` (${lot.highestBidderNickname})` : "") +
        (lot.isMine ? " · yours" : "");
      if (!lot.isMine) {
        const bidBtn = document.createElement("button");
        bidBtn.type = "button";
        bidBtn.textContent = "Bid +1";
        bidBtn.addEventListener("click", () => {
          const amount = (lot.highestBid ?? lot.startPrice - 1) + 1;
          this.send({ type: "economy_auction_bid", lotId: lot.lotId, amount });
        });
        row.appendChild(bidBtn);
        if (lot.buyoutPrice !== null) {
          const buyBtn = document.createElement("button");
          buyBtn.type = "button";
          buyBtn.textContent = `Buyout ${lot.buyoutPrice}`;
          buyBtn.addEventListener("click", () => {
            this.send({ type: "economy_auction_buyout", lotId: lot.lotId });
          });
          row.appendChild(buyBtn);
        }
      }
      this.listEl.appendChild(row);
    }
  }

  private ensureDom(): void {
    if (document.getElementById("auctionOverlay")) return;
    const wrap = document.createElement("div");
    wrap.id = "auctionOverlay";
    wrap.setAttribute("aria-hidden", "true");
    wrap.innerHTML = `
      <div id="auctionPanel">
        <button id="auctionCloseBtn" type="button">Close</button>
        <h2>Auction (Deathmatch)</h2>
        <p class="auction-hint">Press U to toggle. 10% fee on settle (5% burn / 5% developer).</p>
        <div id="auctionListForm">
          <label>Type <select id="auctionItemType">
            <option value="pet">pet</option>
            <option value="egg">egg</option>
            <option value="gem">gem</option>
            <option value="amulet">amulet</option>
            <option value="stimulator">stimulator</option>
            <option value="repair_kit">repair_kit</option>
            <option value="shard_stack">shard_stack</option>
          </select></label>
          <label>Item <select id="auctionItemId"></select></label>
          <label>Shards qty <input id="auctionShardQty" type="number" min="1" value="1" /></label>
          <label>Start <input id="auctionStartPrice" type="number" min="1" value="10" /></label>
          <label>Buyout <input id="auctionBuyoutPrice" type="number" min="1" placeholder="optional" /></label>
          <button id="auctionListBtn" type="button">List item</button>
          <button id="auctionRefreshBtn" type="button">Refresh</button>
        </div>
        <div id="auctionStatus"></div>
        <div id="auctionList"></div>
      </div>`;
    document.body.appendChild(wrap);
  }
}
