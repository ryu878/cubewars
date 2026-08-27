// Minimal combat HUD (EPIC 4 Story 4.3): crosshair (static, purely CSS —
// see client/index.html), health readout, and short-lived visual feedback
// pulses (muzzle flash on firing, hit marker on a confirmed landed hit,
// damage flash on taking a hit) plus a death overlay. Plain DOM/CSS per the
// fixed stack's "no UI framework" rule (global-standards.mdc) — this is all
// cosmetic client-side juice; it never decides who took damage or died,
// that always comes from server broadcasts (see main.ts wiring).

import type { WeaponType } from "@cubewars/shared";
import { formatRatingGrant } from "@cubewars/shared";

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
  private goldEl: HTMLElement;
  private goldValueEl: HTMLElement;
  private spawnProtectionEl: HTMLElement;
  private spawnProtectionValueEl: HTMLElement;
  private cooldownRingEl: SVGCircleElement | null;

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
    this.goldEl = document.getElementById("goldHud") as HTMLElement;
    this.goldValueEl = document.getElementById("goldValue") as HTMLElement;
    this.spawnProtectionEl = document.getElementById("spawnProtectionHud") as HTMLElement;
    this.spawnProtectionValueEl = document.getElementById("spawnProtectionValue") as HTMLElement;
    this.cooldownRingEl = document.getElementById("cooldownRingArc") as SVGCircleElement | null;
  }

  /**
   * Update the on-screen health readout as `current/max` (EPIC 55). Always
   * driven by server PlayerState.health / PlayerState.maxHealth — never a
   * locally-guessed max from pet ratings. Low-health styling keys off current.
   */
  setHealth(health: number, maxHealth: number): void {
    const current = Math.max(0, Math.round(health));
    const max = Math.max(1, Math.round(maxHealth));
    this.healthValueEl.textContent = `${current}/${max}`;
    this.healthEl.dataset.low = current <= 30 ? "true" : "false";
  }

  /**
   * Update the on-screen armor readout as `current/max` (EPIC 55). Always
   * driven by server PlayerState.armor / PlayerState.maxArmor.
   */
  setArmor(armor: number, maxArmor: number): void {
    const current = Math.max(0, Math.round(armor));
    const max = Math.max(1, Math.round(maxArmor));
    this.armorValueEl.textContent = `${current}/${max}`;
    this.armorEl.dataset.zero = current <= 0 ? "true" : "false";
  }

  /**
   * EPIC 36: brief local-player cue while spawn-protected. Driven only by
   * comparing WorldStateMessage.serverTimeMs to the local player's
   * spawnProtectedUntilMs — remaining seconds are recomputed every tick from
   * the broadcast deadline (no free-running client timer).
   */
  setSpawnProtection(remainingMs: number | null): void {
    if (remainingMs === null || remainingMs <= 0) {
      this.spawnProtectionEl.hidden = true;
      return;
    }
    const seconds = Math.max(0.1, remainingMs / 1000);
    this.spawnProtectionValueEl.textContent = seconds.toFixed(1);
    this.spawnProtectionEl.hidden = false;
  }

  /**
   * EPIC 57: crosshair cooldown ring. `progress` 0 = just fired (empty arc),
   * 1 = ready (full ring made transparent so it does not clutter the crosshair).
   */
  setCooldownProgress(progress: number): void {
    if (!this.cooldownRingEl) return;
    const p = Math.min(1, Math.max(0, progress));
    const circumference = 2 * Math.PI * 14; // r=14 in SVG
    this.cooldownRingEl.style.strokeDasharray = `${circumference}`;
    this.cooldownRingEl.style.strokeDashoffset = `${circumference * (1 - p)}`;
    this.cooldownRingEl.style.opacity = p >= 0.999 ? "0" : "0.85";
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

  /**
   * Update the gold readout (EPIC 23). Always driven by server
   * `economy_profile` / `economy_gold_update` — the client never invents or
   * accumulates gold locally.
   */
  setGold(gold: number): void {
    const clamped = Math.max(0, Math.round(gold));
    this.goldValueEl.textContent = String(clamped);
    this.goldEl.hidden = false;
  }

  /**
   * Show equipped pet ratings from server `economy_profile` (EPIC 24 / EPIC 56).
   * Display only — never computed from client pet lists. Uses EPIC 51
   * `formatRatingGrant` labels; only non-zero axes are shown; all-zero hides.
   */
  setRatings(ratings: {
    healthRating: number;
    armorRating: number;
    speedRating: number;
    damageRating: number;
  }): void {
    const el = document.getElementById("ratingsHud");
    const valueEl = document.getElementById("ratingsHudValue");
    if (!el || !valueEl) return;
    const parts: string[] = [];
    if (ratings.healthRating > 0) {
      parts.push(formatRatingGrant("health", ratings.healthRating));
    }
    if (ratings.armorRating > 0) {
      parts.push(formatRatingGrant("armor", ratings.armorRating));
    }
    if (ratings.speedRating > 0) {
      parts.push(formatRatingGrant("speed", ratings.speedRating));
    }
    if (ratings.damageRating > 0) {
      parts.push(formatRatingGrant("damage", ratings.damageRating));
    }
    if (parts.length === 0) {
      valueEl.textContent = "";
      el.hidden = true;
      return;
    }
    valueEl.textContent = parts.join(" · ");
    el.hidden = false;
  }
}
