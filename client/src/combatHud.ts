// Minimal combat HUD (EPIC 4 Story 4.3): crosshair (static, purely CSS —
// see client/index.html), health readout, and short-lived visual feedback
// pulses (muzzle flash on firing, hit marker on a confirmed landed hit,
// damage flash on taking a hit) plus a death overlay. Plain DOM/CSS per the
// fixed stack's "no UI framework" rule (global-standards.mdc) — this is all
// cosmetic client-side juice; it never decides who took damage or died,
// that always comes from server broadcasts (see main.ts wiring).

const PULSE_MS = 160;

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
  private hitMarkerEl: HTMLElement;
  private damageFlashEl: HTMLElement;
  private muzzleFlashEl: HTMLElement;
  private deathOverlayEl: HTMLElement;
  private weaponEl: HTMLElement;

  private hitMarkerTimer: { handle: number | undefined } = { handle: undefined };
  private damageFlashTimer: { handle: number | undefined } = { handle: undefined };
  private muzzleFlashTimer: { handle: number | undefined } = { handle: undefined };

  constructor() {
    this.healthEl = document.getElementById("healthHud") as HTMLElement;
    this.hitMarkerEl = document.getElementById("hitMarker") as HTMLElement;
    this.damageFlashEl = document.getElementById("damageFlash") as HTMLElement;
    this.muzzleFlashEl = document.getElementById("muzzleFlash") as HTMLElement;
    this.deathOverlayEl = document.getElementById("deathOverlay") as HTMLElement;
    this.weaponEl = document.getElementById("weaponHud") as HTMLElement;
  }

  /** Update the on-screen health readout (Story 4.3 AC: "Current health is visible on screen and updates when damaged"). Always driven by the server's own PlayerState.health — never a locally-guessed value. */
  setHealth(health: number): void {
    const clamped = Math.max(0, Math.round(health));
    this.healthEl.textContent = `Health: ${clamped}`;
    this.healthEl.dataset.low = clamped <= 30 ? "true" : "false";
  }

  /** Brief cosmetic pulse fired immediately on the local player's own click-to-fire, before any server confirmation — responsiveness "juice", not a claim of a landed hit. */
  showMuzzleFlash(): void {
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
   */
  setWeapon(displayName: string, colorHex: number, ammo: number | null): void {
    const colorCss = `#${colorHex.toString(16).padStart(6, "0")}`;
    this.weaponEl.style.color = colorCss;
    const ammoText = ammo === null ? "∞" : ammo > 0 ? String(ammo) : "EMPTY";
    this.weaponEl.textContent = `${displayName} — ${ammoText}`;
    this.weaponEl.dataset.empty = ammo === 0 ? "true" : "false";
  }
}
