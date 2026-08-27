// Same-match P2P trade window (EPIC 38). No fee; both must confirm.
// EPIC 52: player-facing chrome via t().

import type {
  ClientMessage,
  EconomyTradeStateMessage,
  InventoryItemType,
} from "@cubewars/shared";
import { subscribe, t } from "./i18n";

type SendFn = (message: ClientMessage) => void;

export class TradePanel {
  private overlayEl: HTMLElement;
  private statusEl: HTMLElement;
  private youEl: HTMLElement;
  private partnerEl: HTMLElement;
  private tradeId: string | null = null;
  private open = false;
  private lastTrade: EconomyTradeStateMessage | null = null;

  constructor(private send: SendFn) {
    this.ensureDom();
    this.overlayEl = document.getElementById("tradeOverlay") as HTMLElement;
    this.statusEl = document.getElementById("tradeStatus") as HTMLElement;
    this.youEl = document.getElementById("tradeYou") as HTMLElement;
    this.partnerEl = document.getElementById("tradePartner") as HTMLElement;

    document.getElementById("tradeCloseBtn")?.addEventListener("click", () => {
      if (this.tradeId) this.send({ type: "economy_trade_cancel", tradeId: this.tradeId });
      this.setOpen(false);
    });
    document.getElementById("tradeConfirmBtn")?.addEventListener("click", () => {
      if (!this.tradeId) return;
      this.send({ type: "economy_trade_confirm", tradeId: this.tradeId });
    });
    document.getElementById("tradeOfferBtn")?.addEventListener("click", () => this.submitOffer());
    subscribe(() => {
      this.applyStaticLabels();
      if (this.lastTrade) this.setTradeState(this.lastTrade);
    });
  }

  /** Open a trade with a partner playerId (from HUD / nearby list). */
  openWith(partnerId: string): void {
    this.send({ type: "economy_trade_open", partnerId });
  }

  setTradeState(message: EconomyTradeStateMessage): void {
    this.lastTrade = message;
    this.tradeId = message.tradeId;
    if (message.status === "cancelled" || message.status === "completed") {
      this.statusEl.textContent = t("trade.status", { status: message.status });
      this.setOpen(message.status === "completed" ? false : true);
      if (message.status === "cancelled") this.setOpen(false);
      return;
    }
    this.setOpen(true);
    this.statusEl.textContent = t("trade.with", { name: message.partnerNickname });
    this.youEl.textContent = t("trade.you", {
      gold: message.you.gold,
      n: message.you.items.length,
      confirmed: message.you.confirmed ? t("trade.confirmed") : "",
    });
    this.partnerEl.textContent = t("trade.partner", {
      gold: message.partner.gold,
      n: message.partner.items.length,
      confirmed: message.partner.confirmed ? t("trade.confirmed") : "",
    });
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.overlayEl.classList.toggle("visible", open);
    this.overlayEl.setAttribute("aria-hidden", open ? "false" : "true");
    if (open && document.pointerLockElement) document.exitPointerLock();
    if (open) this.applyStaticLabels();
  }

  private applyStaticLabels(): void {
    const close = document.getElementById("tradeCloseBtn");
    if (close) close.textContent = t("trade.cancel");
    const title = document.querySelector("#tradePanel h2");
    if (title) title.textContent = t("trade.title");
    const goldLabel = document.getElementById("tradeGoldLabel");
    if (goldLabel) goldLabel.childNodes[0].textContent = `${t("trade.gold")} `;
    const typeLabel = document.getElementById("tradeTypeLabel");
    if (typeLabel) typeLabel.childNodes[0].textContent = `${t("trade.itemType")} `;
    const idLabel = document.getElementById("tradeIdLabel");
    if (idLabel) idLabel.childNodes[0].textContent = `${t("trade.itemId")} `;
    const offerBtn = document.getElementById("tradeOfferBtn");
    if (offerBtn) offerBtn.textContent = t("trade.updateOffer");
    const confirmBtn = document.getElementById("tradeConfirmBtn");
    if (confirmBtn) confirmBtn.textContent = t("trade.confirm");
  }

  private submitOffer(): void {
    if (!this.tradeId) return;
    const goldEl = document.getElementById("tradeGold") as HTMLInputElement | null;
    const typeEl = document.getElementById("tradeItemType") as HTMLSelectElement | null;
    const idEl = document.getElementById("tradeItemId") as HTMLInputElement | null;
    const gold = Math.floor(Number(goldEl?.value || 0));
    const items: Array<{ itemType: InventoryItemType; itemId: number }> = [];
    if (typeEl && idEl && idEl.value.trim() !== "") {
      items.push({
        itemType: typeEl.value as InventoryItemType,
        itemId: Math.floor(Number(idEl.value)),
      });
    }
    this.send({ type: "economy_trade_offer", tradeId: this.tradeId, gold, items });
  }

  private ensureDom(): void {
    if (document.getElementById("tradeOverlay")) return;
    const wrap = document.createElement("div");
    wrap.id = "tradeOverlay";
    wrap.setAttribute("aria-hidden", "true");
    wrap.innerHTML = `
      <div id="tradePanel">
        <button id="tradeCloseBtn" type="button">Cancel</button>
        <h2>Trade</h2>
        <div id="tradeStatus"></div>
        <div id="tradeYou"></div>
        <div id="tradePartner"></div>
        <label id="tradeGoldLabel">Gold <input id="tradeGold" type="number" min="0" value="0" /></label>
        <label id="tradeTypeLabel">Item type
          <select id="tradeItemType">
            <option value="gem">gem</option>
            <option value="pet">pet</option>
            <option value="egg">egg</option>
            <option value="amulet">amulet</option>
            <option value="stimulator">stimulator</option>
            <option value="repair_kit">repair_kit</option>
            <option value="shard_stack">shard_stack</option>
          </select>
        </label>
        <label id="tradeIdLabel">Item id <input id="tradeItemId" type="number" min="0" /></label>
        <button id="tradeOfferBtn" type="button">Update offer</button>
        <button id="tradeConfirmBtn" type="button">Confirm</button>
      </div>`;
    document.body.appendChild(wrap);
    this.applyStaticLabels();
  }
}
