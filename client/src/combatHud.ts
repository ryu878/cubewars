// Minimal combat HUD (EPIC 4 Story 4.3): crosshair (static, purely CSS —
// see client/index.html), health readout, and short-lived visual feedback
// pulses (muzzle flash on firing, hit marker on a confirmed landed hit,
// damage flash on taking a hit) plus a death overlay. Plain DOM/CSS per the
// fixed stack's "no UI framework" rule (global-standards.mdc) — this is all
// cosmetic client-side juice; it never decides who took damage or died,
// that always comes from server broadcasts (see main.ts wiring).

import type { WeaponType } from "@cubewars/shared";

const PULSE_MS = 160;

/**
 * Per-weapon muzzle-flash size/color (EPIC 10 Story 10.1 "weapon-distinct
 * fire feedback" ask) — escalates pistol -> rifle -> grenade launcher in
 * both size and color intensity, matching the grenade launcher's red/purple
 * identity, so the screen-space flash alone hints which weapon fired
 * (complementing the 3D viewmodel flash in client/src/viewmodel.ts).
 */
const MUZZLE_FLASH_STYLE: Record<WeaponType, { sizePx: number; background: string }> = {
  pistol: { sizePx: 40, background: "rgba(255, 235, 170, 0.92)" },
  rifle: { sizePx: 60, background: "rgba(255, 176, 64, 0.95)" },
  grenade_launcher: {
    sizePx: 100,
    background: "radial-gradient(circle, rgba(224,140,255,0.95) 0%, rgba(140,30,220,0.85) 65%, rgba(140,30,220,0) 100%)",
  },
};

function pulse(el: HTMLElement, timers: { handle: number | undefined }): void {
  el.classList.add("visible");
  if (timers.handle !== undefined) {
    window.clearTimeout(timers.handle);
  }
  timers.handle = window.setTimeout(() => {
    el.classList.remove("visible");
    timers.handle = undefined;
  }, PULSE_MS);
}

export class CombatHud {
  private healthEl: HTMLElement;
  private healthValueEl: HTMLElement;
  private armorEl: HTMLElement;
  private armorValueEl: HTMLElement;
  private hitMarkerEl: HTMLElement;
  private damageFlashEl: HTMLElement;
  private muzzleFlashEl: HTMLElement;
  private deathOverlayEl: HTMLElement;
  private weaponEl: HTMLElement;
  private weaponNameEl: HTMLElement;
  private ammoValueEl: HTMLElement;

  private hitMarkerTimer: { handle: number | undefined } = { handle: undefined };
  private damageFlashTimer: { handle: number | undefined } = { handle: undefined };
  private muzzleFlashTimer: { handle: number | undefined } = { handle: undefined };

  constructor() {
    this.healthEl = document.getElementById("healthHud") as HTMLElement;
    this.healthValueEl = document.getElementById("healthValue") as HTMLElement;
    this.armorEl = document.getElementById("armorHud") as HTMLElement;
    this.armorValueEl = document.getElementById("armorValue") as HTMLElement;
    this.hitMarkerEl = document.getElementById("hitMarker") as HTMLElement;
    this.damageFlashEl = document.getElementById("damageFlash") as HTMLElement;
    this.muzzleFlashEl = document.getElementById("muzzleFlash") as HTMLElement;
    this.deathOverlayEl = document.getElementById("deathOverlay") as HTMLElement;
    this.weaponEl = document.getElementById("weaponHud") as HTMLElement;
    this.weaponNameEl = document.getElementById("weaponName") as HTMLElement;
    this.ammoValueEl = document.getElementById("ammoValue") as HTMLElement;
  }

  /** Update the on-screen health readout (Story 4.3 AC: "Current health is visible on screen and updates when damaged"). Always driven by the server's own PlayerState.health — never a locally-guessed value. EPIC 13 Story 13.4: writes only the number into the dedicated #healthValue child span (label span is static markup, index.html), not a combined "Health: N" string on the whole badge. */
  setHealth(health: number): void {
    const clamped = Math.max(0, Math.round(health));
    this.healthValueEl.textContent = String(clamped);
    this.healthEl.dataset.low = clamped <= 30 ? "true" : "false";
  }

  /**
   * Update the on-screen armor readout (EPIC 7 Story 7.2 AC: "HUD shows
   * armor value alongside health"). Always driven by the server's own
   * PlayerState.armor (WorldStateMessage), never a locally-guessed value —
   * same discipline as setHealth() above. Hidden (0 armor is still shown,
   * not hidden) so the player always has a stable readout of "do I have any
   * armor right now". EPIC 13 Story 13.4: writes only the number into the
   * dedicated #armorValue child span, same split as setHealth() above.
   */
  setArmor(armor: number): void {
    const clamped = Math.max(0, Math.round(armor));
    this.armorValueEl.textContent = String(clamped);
    this.armorEl.dataset.zero = clamped <= 0 ? "true" : "false";
  }

  /**
   * Brief cosmetic pulse fired immediately on the local player's own
   * click-to-fire, before any server confirmation — responsiveness "juice",
   * not a claim of a landed hit. Sized/colored per the fired weapon (EPIC 10
   * Story 10.1) so pistol/rifle/grenade-launcher fire visibly differently
   * even from this 2D screen-space element alone.
   */
  showMuzzleFlash(weapon: WeaponType): void {
    const style = MUZZLE_FLASH_STYLE[weapon];
    this.muzzleFlashEl.style.width = `${style.sizePx}px`;
    this.muzzleFlashEl.style.height = `${style.sizePx}px`;
    this.muzzleFlashEl.style.marginLeft = `-${style.sizePx / 2}px`;
    this.muzzleFlashEl.style.marginTop = `-${style.sizePx / 2}px`;
    this.muzzleFlashEl.style.background = style.background;
    pulse(this.muzzleFlashEl, this.muzzleFlashTimer);
  }

  /** Brief cosmetic pulse fired only once the server confirms one of THIS client's shots landed (HitEvent.shooterId === selfId). */
  showHitMarker(): void {
    pulse(this.hitMarkerEl, this.hitMarkerTimer);
  }

  /** Brief cosmetic pulse fired only once the server confirms THIS client took damage (HitEvent.targetId === selfId). */
  showDamageFlash(): void {
    pulse(this.damageFlashEl, this.damageFlashTimer);
  }

  /** Show/hide the death overlay, driven by the server's alive state for this client. */
  setDead(dead: boolean): void {
    this.deathOverlayEl.classList.toggle("visible", dead);
  }

  /**
   * Update the weapon indicator (EPIC 6 Story 6.2 AC: "HUD always shows
   * which weapon is equipped and its ammo count") — always driven by the
   * server's own LoadoutMessage, never a locally-guessed value (same
   * discipline as setHealth() above). `ammo === null` means an
   * infinite-ammo weapon (the pistol), rendered as "∞"; `ammo === 0` is
   * called out as "EMPTY" so the player knows to switch or find ammo (EPIC 6
   * "dry weapon" rule).
   *
   * EPIC 13 Story 13.4: writes the weapon name and ammo token into their own
   * child spans (#weaponName / #ammoValue) instead of one combined
   * textContent string, so the ammo number can be sized independently
   * (index.html). `style.color` stays set on the whole #weaponHud badge
   * (unchanged from pre-EPIC-13) rather than on the child spans — neither
   * child span sets its own `color`, so both the weapon name AND the ammo
   * number inherit this same weapon-identity color via normal CSS
   * inheritance (verified in Tester's screenshot evidence, not just by
   * inspection, per the spec's explicit ask).
   */
  setWeapon(displayName: string, colorHex: number, ammo: number | null): void {
    const colorCss = `#${colorHex.toString(16).padStart(6, "0")}`;
    this.weaponEl.style.color = colorCss;
    const ammoText = ammo === null ? "∞" : ammo > 0 ? String(ammo) : "EMPTY";
    this.weaponNameEl.textContent = displayName;
    this.ammoValueEl.textContent = ammoText;
    this.weaponEl.dataset.empty = ammo === 0 ? "true" : "false";
  }
}
