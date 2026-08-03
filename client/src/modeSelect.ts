// Mode-select overlay (EPIC 9 "Bots & Match Modes" Story 9.2): a simple
// pre-game overlay (two buttons, plain HTML/CSS — no new UI framework, per
// the fixed stack's "no UI framework" rule) shown before pointer lock is
// even available. Picking a mode hides the overlay and hands control back to
// main.ts to send the `join` message and start the normal input loop —
// this module never talks to the network itself (keep transport concerns in
// network.ts / main.ts, per global-standards.mdc "keep game/simulation logic
// separate from transport/rendering code").

import type { MatchMode } from "@cubewars/shared";

export class ModeSelect {
  private overlayEl: HTMLElement;
  private publicBtn: HTMLButtonElement;
  private botsBtn: HTMLButtonElement;

  /** `onSelect` fires exactly once, the first time either button is clicked. */
  constructor(private onSelect: (mode: MatchMode) => void) {
    this.overlayEl = document.getElementById("modeSelect") as HTMLElement;
    this.publicBtn = document.getElementById("modePublicBtn") as HTMLButtonElement;
    this.botsBtn = document.getElementById("modeBotsBtn") as HTMLButtonElement;

    this.publicBtn.addEventListener("click", () => this.select("public"));
    this.botsBtn.addEventListener("click", () => this.select("bots"));
  }

  /**
   * Enable the mode buttons — call only once the WS connection has actually
   * received `welcome`, so a click can never race ahead of
   * GameConnection.send()'s own "socket must be OPEN" guard (which would
   * otherwise silently drop an early `join` and leave the player stuck on
   * this screen with no error).
   */
  enable(): void {
    this.publicBtn.disabled = false;
    this.botsBtn.disabled = false;
  }

  private select(mode: MatchMode): void {
    if (this.publicBtn.disabled) return; // not enabled yet — ignore (shouldn't be reachable while disabled, defensive only)
    this.publicBtn.disabled = true;
    this.botsBtn.disabled = true;
    this.overlayEl.classList.add("hidden");
    this.onSelect(mode);
  }
}
