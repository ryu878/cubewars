// Procedural sound subsystem (EPIC 14 "Procedural Sound System") — every
// sound effect in this game (jump grunt, footsteps, per-weapon gunshots,
// per-category pickups, hit-taken) is synthesized at runtime via the native
// Web Audio API, per the EPIC's hard constraint: no audio library
// (howler.js/tone.js/etc.), no external/bundled audio asset files. Same
// "synthesize procedurally, no asset pipeline" philosophy EPIC 10 already
// established for visuals (client/src/textures.ts THREE.CanvasTexture wall/
// sky textures).
//
// AudioContext lifecycle (Design Decision 6): the context is constructed
// immediately (allowed without a user gesture — only STARTING playback /
// leaving `suspended` needs one), but unlock() must be called synchronously
// from inside a genuine user-gesture handler (main.ts's mode-select click)
// to actually resume it — never auto-resumed, per browser autoplay policy.
//
// Master chain: masterGain -> DynamicsCompressorNode -> destination. The
// compressor is a safety net against clipping when several sounds overlap
// (e.g. rapid pistol fire + footsteps landing in the same audio frame) —
// not the sole anti-clipping mechanism (individual sounds are also authored
// at a modest peak gain, see the PISTOL_/RIFLE_/etc. constants below).
//
// Every play* method emits one lightweight console.debug line naming the
// event + its key synth parameters — this is the REQUIRED verification
// substitute for a browser-audio-blind Playwright Tester (Story 14.1 AC):
// it cannot literally hear the result, so this is the deterministic,
// code-level trace of exactly which synth branch fired, with what
// parameters, at what trigger.

import type { PickupCategory, WeaponType } from "@cubewars/shared";
import { buildNoiseBuffer, playNoiseBurst, playTone } from "./synth";

/**
 * Master output gain (Design Decision 6: "a sane default master gain, e.g.
 * ~0.5-0.7"). 0.6 — the middle of the spec's suggested range, tuned by ear
 * against the loudest individual sound (the grenade launcher gunshot, the
 * only sound authored near peakGain 0.5) so normal play never audibly
 * clips even with the DynamicsCompressorNode backstop doing no real work in
 * the common case, only kicking in on genuine overlap (e.g. footstep +
 * gunshot landing in the same audio frame).
 */
const MASTER_GAIN = 0.6;

/**
 * Shared noise buffer length, seconds. Comfortably exceeds the longest
 * noise-burst duration in the sound-design table (grenade launcher gunshot,
 * ~300ms) even after the footstep system's down-pitch playbackRate
 * randomization (as low as ~0.9x, which "consumes" buffer time faster than
 * wall-clock time) — see synth.ts buildNoiseBuffer() doc comment.
 */
const NOISE_BUFFER_SECONDS = 1;

// --- Footstep cadence (Story 14.3) -----------------------------------

/**
 * Base interval between footstep sounds while grounded+moving, seconds —
 * the middle of the spec's "~300-350ms base interval, roughly a running
 * cadence" range.
 */
const FOOTSTEP_BASE_INTERVAL_SECONDS = 0.325;
/**
 * Per-step timing randomization, +/- fraction of the base interval — 7.5%,
 * the middle of the spec's required "+/-5-10%" range (Story 14.3 AC: this
 * is a REQUIRED acceptance criterion, not optional polish, per the
 * well-known "identical repeated samples read as robotic/fatiguing" sound
 * design failure mode cited in the spec).
 */
const FOOTSTEP_TIMING_JITTER_FRACTION = 0.075;
/**
 * Per-step pitch (noise-buffer playbackRate) randomization, +/- fraction of
 * 1.0 — 8%, same "+/-5-10%" range and reasoning as the timing jitter above,
 * applied independently (a fast step isn't necessarily also
 * higher/lower-pitched, and vice versa) so the two randomizations don't
 * visibly correlate in the captured synth-parameter evidence.
 */
const FOOTSTEP_PITCH_JITTER_FRACTION = 0.08;

function jitter(base: number, fraction: number): number {
  return base * (1 + (Math.random() * 2 - 1) * fraction);
}

export class SoundManager {
  private audioContext: AudioContext;
  private masterGain: GainNode;
  private compressor: DynamicsCompressorNode;
  private noiseBuffer: AudioBuffer;
  private unlocked = false;

  // Footstep cadence state (Story 14.3) — advanced by update(), never by a
  // separate timer/interval, so it stays in lockstep with the render loop
  // like every other per-frame system in this client (fps.update(dt),
  // viewmodel.update(dt)).
  private footstepActivePrev = false;
  private footstepClockSeconds = 0;
  private footstepNextIntervalSeconds = FOOTSTEP_BASE_INTERVAL_SECONDS;

  constructor() {
    // Constructing an AudioContext does NOT require a user gesture (only
    // resuming it out of `suspended` does, see unlock() below) — safe to do
    // at module-scope construction time in main.ts, before any click.
    this.audioContext = new AudioContext();

    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = MASTER_GAIN;
    this.compressor = this.audioContext.createDynamicsCompressor();
    this.masterGain.connect(this.compressor);
    this.compressor.connect(this.audioContext.destination);

    // Generated exactly once, here — never per-play, never per-frame (see
    // synth.ts buildNoiseBuffer() doc comment / Story 14.1 AC).
    this.noiseBuffer = buildNoiseBuffer(this.audioContext, NOISE_BUFFER_SECONDS);
  }

  /**
   * Resume the AudioContext out of the browser's autoplay-policy
   * `suspended` state. MUST be called synchronously from inside a genuine
   * user-gesture event handler (main.ts calls this from the mode-select
   * click callback, the first unavoidable user gesture in this game,
   * before `join` is even sent) — never auto-resumed on a timer or on
   * construction (Design Decision 6). Idempotent: safe to call more than
   * once.
   */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    void this.audioContext.resume();
  }

  // --- Story 14.2: jump grunt -----------------------------------------

  /**
   * Short, low, breathy "ух" burst (Design Decision 5) — filtered noise
   * layered with a downward-ramping tone for vocal "body", NOT a pure
   * oscillator beep (Story 14.2 AC explicitly requires a noise component).
   */
  playJumpGrunt(): void {
    const durationSeconds = 0.13;
    playNoiseBurst(this.audioContext, this.masterGain, this.noiseBuffer, {
      durationSeconds,
      peakGain: 0.32,
      filterType: "bandpass",
      filterFrequency: 380,
      filterQ: 0.9,
    });
    playTone(this.audioContext, this.masterGain, {
      type: "sine",
      frequency: 220,
      endFrequency: 90,
      durationSeconds,
      peakGain: 0.22,
    });
    console.debug(`[audio] jump grunt duration=${Math.round(durationSeconds * 1000)}ms`);
  }

  // --- Story 14.3: footsteps -------------------------------------------

  /**
   * Advance the footstep cadence timer by `dt` seconds and fire a footstep
   * sound whenever it elapses, gated entirely on `active` (main.ts computes
   * this from `fps.isRunning()` — grounded AND moving AND locked AND
   * alive, see fpsController.ts). Call once per render frame (main.ts's
   * animate() loop), the same "one shared per-frame update call" pattern as
   * `fps.update(dt)`/`viewmodel.update(dt)`.
   */
  update(dt: number, footstepActive: boolean): void {
    if (!footstepActive) {
      // Story 14.3 AC: "footsteps stop immediately ... no lingering
      // cadence" — reset rather than pause, so stopping and restarting
      // movement doesn't fire an early footstep from partially-elapsed
      // leftover time.
      this.footstepActivePrev = false;
      this.footstepClockSeconds = 0;
      return;
    }

    if (!this.footstepActivePrev) {
      // First frame of a fresh run: play immediately (feels responsive —
      // a real first footstep lands right as you start moving, not ~300ms
      // later) and start the cadence timer from here.
      this.footstepActivePrev = true;
      this.footstepClockSeconds = 0;
      this.footstepNextIntervalSeconds = jitter(FOOTSTEP_BASE_INTERVAL_SECONDS, FOOTSTEP_TIMING_JITTER_FRACTION);
      this.playFootstep();
      return;
    }

    this.footstepClockSeconds += dt;
    if (this.footstepClockSeconds >= this.footstepNextIntervalSeconds) {
      this.footstepClockSeconds = 0;
      this.footstepNextIntervalSeconds = jitter(FOOTSTEP_BASE_INTERVAL_SECONDS, FOOTSTEP_TIMING_JITTER_FRACTION);
      this.playFootstep();
    }
  }

  /**
   * A single footstep thud — a very short, low-pass-filtered noise burst.
   * Public (not just internal to update()'s cadence loop) so every sound
   * category has its own directly callable play method, per Story 14.1's
   * "declarative synth call per sound" shape.
   */
  playFootstep(): void {
    const durationSeconds = 0.055;
    // Story 14.3 AC: per-step pitch (playbackRate) randomization, applied
    // independently from the timing jitter above (see
    // FOOTSTEP_PITCH_JITTER_FRACTION doc comment).
    const playbackRate = jitter(1, FOOTSTEP_PITCH_JITTER_FRACTION);
    playNoiseBurst(this.audioContext, this.masterGain, this.noiseBuffer, {
      durationSeconds,
      peakGain: 0.22,
      filterType: "lowpass",
      filterFrequency: 900,
      playbackRate,
    });
    console.debug(
      `[audio] footstep duration=${Math.round(durationSeconds * 1000)}ms playbackRate=${playbackRate.toFixed(3)}`,
    );
  }

  // --- Story 14.4: per-weapon gunshots ----------------------------------

  /**
   * Per-weapon gunshot, escalating in duration/bassiness matching
   * RECOIL_PROFILES in client/src/viewmodel.ts (pistol smallest/shortest,
   * grenade launcher deepest/longest) — used for BOTH the local player's
   * own instant fire feedback and a remote player's/bot's fire, relayed via
   * FireBroadcastEvent (see main.ts wiring).
   */
  playGunshot(weapon: WeaponType): void {
    if (weapon === "pistol") {
      const durationSeconds = 0.075;
      playNoiseBurst(this.audioContext, this.masterGain, this.noiseBuffer, {
        durationSeconds,
        peakGain: 0.3,
        filterType: "highpass",
        filterFrequency: 1800,
      });
      playTone(this.audioContext, this.masterGain, {
        type: "triangle",
        frequency: 900,
        endFrequency: 600,
        durationSeconds,
        peakGain: 0.18,
      });
      console.debug(`[audio] gunshot weapon=pistol duration=${Math.round(durationSeconds * 1000)}ms`);
      return;
    }

    if (weapon === "rifle") {
      const durationSeconds = 0.115;
      playNoiseBurst(this.audioContext, this.masterGain, this.noiseBuffer, {
        durationSeconds,
        peakGain: 0.36,
        filterType: "bandpass",
        filterFrequency: 900,
        filterQ: 0.7,
      });
      playTone(this.audioContext, this.masterGain, {
        type: "sawtooth",
        frequency: 500,
        endFrequency: 320,
        durationSeconds,
        peakGain: 0.22,
      });
      console.debug(`[audio] gunshot weapon=rifle duration=${Math.round(durationSeconds * 1000)}ms`);
      return;
    }

    // grenade_launcher — deep, bassy thump/boom, the "heaviest" of the
    // three, longest decay.
    const durationSeconds = 0.3;
    playTone(this.audioContext, this.masterGain, {
      type: "sine",
      frequency: 80,
      endFrequency: 55,
      durationSeconds,
      peakGain: 0.5,
      attackSeconds: 0.008,
    });
    playNoiseBurst(this.audioContext, this.masterGain, this.noiseBuffer, {
      durationSeconds,
      peakGain: 0.28,
      filterType: "lowpass",
      filterFrequency: 500,
    });
    console.debug(`[audio] gunshot weapon=grenade_launcher duration=${Math.round(durationSeconds * 1000)}ms`);
  }

  // --- Story 14.5: pickups -----------------------------------------------

  /**
   * Category-distinct pickup sound (Design Decision 5): weapon — a rising
   * 3-note arpeggio ("upgrade" feel); armor — a single solid mid-tone
   * chime/clunk (noise-thump "edge", not bright); health — a brighter,
   * softer, gentler-attack tone, audibly distinct from armor's clunk.
   * "ammo" reuses the weapon family (Programmer's documented choice, per
   * Design Decision 3's explicit allowance) but as a 2-note rise rather
   * than weapon's 3-note rise, so an ammo refill still reads as
   * "positive/smaller" rather than being bit-for-bit identical to a
   * first-time weapon unlock.
   */
  playPickup(category: PickupCategory): void {
    if (category === "weapon" || category === "ammo") {
      // Ascending arpeggio: each note a discrete step higher than the
      // last, scheduled back-to-back via setTimeout (Web Audio's own
      // scheduling handles each individual tone's envelope; this just
      // sequences the calls, matching this codebase's existing
      // "setTimeout-driven" convention for `combatHud.ts` pulses).
      const notes = category === "weapon" ? [440, 554, 659] : [440, 554];
      const noteDurationSeconds = 0.09;
      notes.forEach((frequency, index) => {
        window.setTimeout(() => {
          playTone(this.audioContext, this.masterGain, {
            type: "triangle",
            frequency,
            durationSeconds: noteDurationSeconds,
            peakGain: 0.26,
            attackSeconds: 0.01,
          });
        }, index * 70);
      });
      console.debug(`[audio] pickup category=${category} notes=${notes.join(",")}`);
      return;
    }

    if (category === "armor") {
      const durationSeconds = 0.2;
      playTone(this.audioContext, this.masterGain, {
        type: "square",
        frequency: 330,
        durationSeconds,
        peakGain: 0.22,
        attackSeconds: 0.006,
      });
      playNoiseBurst(this.audioContext, this.masterGain, this.noiseBuffer, {
        durationSeconds: 0.05,
        peakGain: 0.18,
        filterType: "lowpass",
        filterFrequency: 500,
      });
      console.debug(`[audio] pickup category=armor frequency=330 duration=${Math.round(durationSeconds * 1000)}ms`);
      return;
    }

    // "health" — brighter, softer, more restorative-feeling.
    const durationSeconds = 0.26;
    playTone(this.audioContext, this.masterGain, {
      type: "sine",
      frequency: 660,
      durationSeconds,
      peakGain: 0.22,
      attackSeconds: 0.02,
    });
    playTone(this.audioContext, this.masterGain, {
      type: "sine",
      frequency: 990,
      durationSeconds: durationSeconds * 0.8,
      peakGain: 0.12,
      attackSeconds: 0.03,
    });
    console.debug(`[audio] pickup category=health frequency=660 duration=${Math.round(durationSeconds * 1000)}ms`);
  }

  // --- Story 14.6: hit-taken ---------------------------------------------

  /**
   * Short, sharp, unambiguously negative "I got hurt" sound — a quick
   * descending-pitch tone layered with a noise thud, deliberately
   * distinct (in frequency range, duration, and tone+noise composition)
   * from every pickup/footstep/jump sound above (Design Decision 5's
   * distinctness requirement).
   */
  playHitTaken(): void {
    const durationSeconds = 0.14;
    playTone(this.audioContext, this.masterGain, {
      type: "sawtooth",
      frequency: 480,
      endFrequency: 180,
      durationSeconds,
      peakGain: 0.28,
    });
    playNoiseBurst(this.audioContext, this.masterGain, this.noiseBuffer, {
      durationSeconds: 0.09,
      peakGain: 0.26,
      filterType: "lowpass",
      filterFrequency: 420,
    });
    console.debug(`[audio] hit-taken duration=${Math.round(durationSeconds * 1000)}ms`);
  }
}
